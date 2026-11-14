import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import catalog from "../fixtures/wr-jaspay-catalog-20261114.json";
import { setupWrFixture, seedWrCatalog } from "./helpers";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { StockReservationError } from "@/lib/db/errors";
import { createOrderWithStock } from "@/lib/db";
import { getActiveVariant, getProductDetail, listActiveProducts } from "@/lib/catalog";
import { syncJaspayCatalog } from "@/lib/warung-rebahan/sync";
import { decodeJaspayVariantId, normalizeJaspayCatalog } from "@/lib/warung-rebahan/jaspay";
import { pollKnownJaspayInvoice, processWrPendingOrders } from "@/lib/warung-rebahan/order";
import { readAutomaticProgress } from "@/lib/warung-rebahan/progress";
import { decryptSecret } from "@/lib/fulfillment/crypto";
import { createChannelOrderAtomic } from "@/lib/commerce";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function enable() {
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_API_KEY", "fixture");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", Buffer.alloc(32, 9).toString("base64"));
}

it("accepts the real default packages, rejects absent/ambiguous IDs and missing prices", () => {
  const normalized = normalizeJaspayCatalog(catalog);
  expect(normalized).toHaveLength(10);
  expect(normalized.flatMap(p => p.packages.filter(k => p.available && k.available))).toHaveLength(17);
  expect(decodeJaspayVariantId("jaspay:scribd:")).toEqual({ product: "scribd", package: "" });
  expect(decodeJaspayVariantId("jaspay:scribd")).toBeNull();
  expect(decodeJaspayVariantId("jaspay:scribd:%xx")).toBeNull();
  expect(normalizeJaspayCatalog([{ product: "bad", packages: [{ name: "Default", price: 5000 }] }])).toEqual([]);
  expect(normalizeJaspayCatalog([{ product: "bad", packages: [{ id: "", name: "A", price: 5000 }, { id: "", name: "B", price: 5000 }] }])).toEqual([]);
  expect(normalizeJaspayCatalog([{ product: "bad", packages: [{ id: "", name: "A", price: null }] }])).toEqual([]);
});

it("publishes all 17 available packages, keeps explicit legacy product identity and never rewrites old variants", async () => {
  const fx = await setupWrFixture(); enable();
  try {
    seedWrCatalog(fx);
    fx.sql.exec(`UPDATE products SET slug='scribd',name='Scribd',image_url='/my-image.webp',wr_product_id='07ca3373-133e-11f1-bf18-bc241112a182' WHERE id=1;
      UPDATE wr_variants SET wr_delivery_class='made_by_order' WHERE wr_variant_id='var-1';`);
    const old = fx.sql.prepare("SELECT * FROM product_variants WHERE id=1").get();
    const db = createDatabaseAccess(fx.db);
    for (let i = 0; i < 2; i++) expect((await syncJaspayCatalog(db, async () => catalog)).errors).toEqual([]);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE wr_variant_id LIKE 'jaspay:%' AND stock=-1").get()).toMatchObject({ n: 17 });
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE wr_variant_id LIKE 'jaspay:%'").get()).toMatchObject({ n: 19 });
    expect(fx.sql.prepare("SELECT * FROM product_variants WHERE id=1").get()).toEqual(old);
    expect(fx.sql.prepare("SELECT product_id FROM product_variants WHERE wr_variant_id='jaspay:scribd:'").get()).toMatchObject({ product_id: 1 });
    expect(fx.sql.prepare("SELECT image_url,slug FROM products WHERE id=1").get()).toMatchObject({ image_url: "/my-image.webp", slug: "scribd" });
    const detail = await getProductDetail("scribd");
    expect(detail?.variants).toHaveLength(1);
    expect(detail?.variants[0]).toMatchObject({ wr_variant_id: "jaspay:scribd:", duration_value: 30, warranty_type: "none" });
    expect(detail?.variants[0].terms).toContain("Tidak ada garansi");
    expect(await getActiveVariant(1)).toBeNull();
    expect((await listActiveProducts()).find(p => p.slug === "scribd")?.variantCount).toBe(1);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE wr_variant_id LIKE 'jaspay:meitu:%' AND duration_value IN (7,14)").get()).toMatchObject({ n: 4 });
  } finally { fx.close(); }
});

it("rotates the whole catalog under the unchanged 40-statement cron budget", async () => {
  const fx = await setupWrFixture(); enable();
  try {
    for (let i = 0; i < 11; i++) {
      const budget = createBudgetedDatabase(40, 2, fx.db);
      const result = await syncJaspayCatalog(budget.access, async () => catalog, { maxProducts: 1 });
      expect(result.errors).toEqual([]);
      expect(result.synced).toBe(1);
      expect(budget.used).toBeLessThanOrEqual(38);
    }
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE wr_variant_id LIKE 'jaspay:%' AND stock=-1").get()).toMatchObject({ n: 17 });
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM products WHERE wr_product_id LIKE 'jaspay:%'").get()).toMatchObject({ n: 10 });
  } finally { fx.close(); }
});

it("inherits image and gallery from an inactive MBO parent without reactivating it or overwriting new admin images", async () => {
  const fx = await setupWrFixture(); enable();
  try {
    seedWrCatalog(fx);
    fx.sql.exec(`UPDATE products SET is_active=0,wr_product_id='a86ef8b6-045f-11f1-bf18-bc241112a182',
      image_url='/r2/express-original.webp',images='["/r2/express-original.webp","/r2/express-second.webp"]' WHERE id=1`);
    const db=createDatabaseAccess(fx.db);
    const feed=async()=>catalog.filter(p=>p.product==='expressvpn');
    expect((await syncJaspayCatalog(db,feed)).errors).toEqual([]);
    const parent=fx.sql.prepare("SELECT id,image_url,images FROM products WHERE wr_product_id='jaspay:expressvpn'").get()!;
    expect(parent).toMatchObject({image_url:'/r2/express-original.webp',images:'["/r2/express-original.webp","/r2/express-second.webp"]'});
    expect(fx.sql.prepare("SELECT is_active FROM products WHERE id=1").get()).toMatchObject({is_active:0});
    fx.sql.prepare("UPDATE products SET image_url='/admin-custom.webp',images='[\"/admin-custom.webp\"]' WHERE id=?").run(parent.id);
    await syncJaspayCatalog(db,feed);
    expect(fx.sql.prepare("SELECT image_url FROM products WHERE id=?").get(parent.id)).toMatchObject({image_url:'/admin-custom.webp'});
  } finally {fx.close();}
});

it("blocks old manual quotes, reservation and public cards while leaving premium automatic stock available", async () => {
  const fx = await setupWrFixture(); enable();
  try {
    seedWrCatalog(fx);
    expect(await getActiveVariant(1)).not.toBeNull();
    fx.sql.exec("UPDATE wr_variants SET wr_delivery_class='made_by_order'");
    const { POST } = await import("@/app/api/checkout/quote/route");
    const response = await POST(new NextRequest("http://localhost/api/checkout/quote", { method: "POST", body: JSON.stringify({items:[{product_id:1,variant_id:1,qty:1}]}) }));
    expect(response.status).toBe(409);
    await expect(createOrderWithStock({ code: "AXV-PAUSED", quoteId: "old-quote", customerName: "Buyer", customerWa: "628000000000", customerEmail: "fixture@example.test", items: [{ product_id:1,variant_id:1,name:"Old package",price:7500,qty:1 }], subtotal:7500,paymentMethod:"qris",paymentAccount:"fixture",proofUrl:null })).rejects.toBeInstanceOf(StockReservationError);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()).toMatchObject({n:0});
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()).toMatchObject({stock:10});
    const { GET } = await import("@/app/api/products/route");
    const cards = await (await GET(new NextRequest("http://localhost/api/products?active=1"))).json();
    expect(cards.products).toEqual([]);
  } finally { fx.close(); }
});

it("omits the default package on purchase, persists queue state and delivers the known invoice on polling without a second purchase", async () => {
  const fx = await setupWrFixture(); enable();
  try {
    const db=createDatabaseAccess(fx.db);
    await syncJaspayCatalog(db, async () => catalog.filter(p => p.product === "scribd"));
    const variant=fx.sql.prepare("SELECT id,product_id FROM product_variants WHERE wr_variant_id='jaspay:scribd:'").get()!;
    fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,fulfillment_status)
      VALUES('AXV-JSP-AUTO','Buyer','628000000000',?,7500,'qris','lunas','paid','queued')`).run(JSON.stringify([{product_id:variant.product_id,variant_id:variant.id,qty:1,price:7500}]));
    fx.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status) VALUES('AXV-JSP-AUTO',0,?,?,1,'manual','web','queued')`).run(variant.product_id,variant.id);
    const calls: string[]=[];
    vi.stubGlobal("fetch",vi.fn(async (url: string, init: RequestInit) => {
      calls.push(String(url)); const payload=JSON.parse(String(init.body));
      if (String(url).endsWith('/jaspay/order')) {
        expect(payload.product).toBe('scribd'); expect(payload).not.toHaveProperty('package');
        expect(payload.ref_id).toMatch(/^axv-[a-f0-9]{32}$/);
        return Response.json({success:true,data:{invoice:'JSP-FIXTURE',status:'processing',product:'scribd',quantity:1,phase:'queued',queue_position:3,progress:{done:0,success:0},accounts:[]}});
      }
      if (String(url).endsWith('/jaspay/status')) return Response.json({success:true,data:{invoice:'JSP-FIXTURE',status:'completed',product:'scribd',quantity:1,success_count:1,accounts:[{email:'fixture@example.test',password:'fixture-only-password'}]}});
      throw Error('Unexpected external fixture request');
    }));
    await processWrPendingOrders(db);
    expect(await readAutomaticProgress('AXV-JSP-AUTO',db)).toMatchObject([{stage:'queued',queuePosition:3,ready:0,total:1}]);
    const link=fx.sql.prepare("SELECT id FROM wr_order_links WHERE order_code='AXV-JSP-AUTO'").get()!;
    await pollKnownJaspayInvoice(Number(link.id),db);
    const row=fx.sql.prepare("SELECT status,wr_account_details,wr_account_iv,jaspay_progress FROM wr_order_links WHERE id=?").get(link.id)!;
    expect(row.status).toBe('completed');
    expect(await decryptSecret(String(row.wr_account_details),String(row.wr_account_iv))).toContain('fixture@example.test');
    expect(String(row.jaspay_progress)).not.toContain('password');
    expect(await readAutomaticProgress('AXV-JSP-AUTO',db)).toMatchObject([{stage:'ready',ready:1,total:1}]);
    expect(fx.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-JSP-AUTO'").get()).toMatchObject({fulfillment_status:'delivered'});
    expect(calls.filter(p=>p.endsWith('/jaspay/order'))).toHaveLength(1);
    expect(calls.some(p=>p.endsWith('/api/v1/order'))).toBe(false);
  } finally { fx.close(); }
});

it("enforces the supplier cap for duplicate Telegram cart lines inside the reservation transaction", async () => {
  const fx=await setupWrFixture();enable();
  try {
    await syncJaspayCatalog(createDatabaseAccess(fx.db),async()=>catalog.filter(p=>p.product==='scribd'));
    const v=fx.sql.prepare("SELECT * FROM product_variants WHERE wr_variant_id='jaspay:scribd:'").get()!;
    const order=(quantities:number[])=>createChannelOrderAtomic({
      orderCode:`AXV-TGCAP-${quantities.join('-')}`,salesChannel:'telegram',primaryVariantId:Number(v.id),
      customerName:'Fixture',customerEmail:'fixture@example.test',paymentMethod:'qris',paymentAccount:'fixture',fulfillmentStatus:'queued',variantSnapshot:'{}',
      subtotal:quantities.reduce((n,q)=>n+q*Number(v.price),0),
      lines:quantities.map(qty=>({productId:Number(v.product_id),variantId:Number(v.id),qty,fulfillmentMode:'manual',stock:-1})),
      items:quantities.map(qty=>({product_id:v.product_id,variant_id:v.id,name:'Scribd',price:v.price,qty})),
    });
    await expect(order([6,6])).rejects.toBeInstanceOf(StockReservationError);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()).toMatchObject({n:0});
    await expect(order([1])).resolves.toMatchObject({isExisting:false});
  } finally {fx.close();}
});
