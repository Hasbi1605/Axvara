import fs from "node:fs";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { assertSameBuyerCode,buyerSnapshotMatches,tunvnEligibility,validateBuyerFields,withoutPrivateBuyerData } from "@/lib/buyer-fields";
import { createOrderWithStock } from "@/lib/db/orders-create";
import { createChannelOrderAtomic,createPendingChannelOrder } from "@/lib/commerce";
import { verifyCheckoutQuoteToken } from "@/lib/auth";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";

const auth = vi.hoisted(() => ({ admin:true }));
const telegram = vi.hoisted(() => ({ send:vi.fn(),cart:vi.fn() }));
vi.mock("@/lib/telegram/api",() => ({ sendMessage:telegram.send }));
vi.mock("@/lib/telegram/handlers/cart",() => ({ handleShowCart:telegram.cart }));
vi.mock("@/lib/auth",async importOriginal => ({ ...await importOriginal<typeof import("@/lib/auth")>(),requireAdmin:vi.fn(async () => auth.admin ? { email:"fixture@example.test" } : null) }));
vi.mock("@/lib/payments/method-options",() => ({ buildMethodCatalog:vi.fn(async () => [{ id:"qris",account_number:"-",kind:"qris",available:true,label:"QRIS" }]) }));
let fx:ReturnType<typeof createD1Fixture>;
const config = { buyer_field_key:"muse_invite_code" as const,max_qty:30 };
const fields = { muse_invite_code:"Ab12cD" };
const req = (url:string,body:unknown,method="POST") => new NextRequest(`http://localhost${url}`,{ method,headers:{ "content-type":"application/json" },body:JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  telegram.send.mockResolvedValue({ ok:true,result:{ message_id:1 } });
  vi.stubEnv("PRODUCT_VARIANTS_READ","true");
  vi.stubEnv("PRODUCT_VARIANTS_WRITE","true");
  fx=createD1Fixture(); clearRateLimitBucketsForTest(); auth.admin=true;
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled) VALUES(1,'Muse AI','muse-ai-1-miliar-token',1500,-1,1,1),(2,'ChatGPT Private','chatgpt-tunvn',112400,30,0,1);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,tunvn_buff_quantity_b,buyer_field_key,max_qty,tunvn_source_product_id) VALUES(1,1,'TUNVN-BUFF-1B','Buff per 1B',1500,-1,1,1,'muse_invite_code',30,NULL),(2,1,'MUSE-ACCOUNT','Account',16000,20,1,NULL,NULL,NULL,NULL),(3,2,'TUNVN-86','Business 1 Bulan',112400,22,0,NULL,NULL,NULL,86),(4,2,'TUNVN-83','GPay 1 Bulan',121200,6,0,NULL,NULL,NULL,83);
    INSERT INTO tunvn_products(supplier_product_id,name,price_usdt,fx_idr_per_usdt,axvara_product_id) VALUES(86,'Business',4.6,18086,2),(83,'GPay',4.96,18086,2);`);
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); });
const quote = async (items:unknown[]) => (await import("@/app/api/checkout/quote/route")).POST(req("/api/checkout/quote",{ items }));
const buff = (qty=1,code="Ab12cD") => ({ product_id:1,variant_id:1,qty,buyer_fields:{ muse_invite_code:code } });
const atomicItem = (qty=1) => ({ product_id:1,variant_id:1,name:"Muse",price:1500,qty,...config,buyer_fields:fields });
const atomic = (items=[atomicItem()],quoteId="input-test") => createOrderWithStock({ code:"AXV-20261110-AABBCCDD",quoteId,customerName:"Fixture",customerWa:"628000000000",customerEmail:"fixture@example.test",items,subtotal:items.reduce((n,item)=>n+item.price*item.qty,0),paymentMethod:"qris",paymentAccount:"-",proofUrl:null });

describe("buyer preset + quote binding",() => {
  it("classifies only current TUNVN variants as automatic across catalog, quote and Telegram",async()=>{
    const {getProductDetail,buyerDeliveryKind,buyerDeliveryBadge}=await import("@/lib/catalog");
    const {catalogDeliveryBadge,catalogDeliveryEta}=await import("@/lib/i18n/catalog-copy");
    const product=await getProductDetail("muse-ai-1-miliar-token");
    const current=product!.variants.find(v=>v.id===1)!,original=product!.variants.find(v=>v.id===2)!;
    expect(current).toMatchObject({sku:"",fulfillment_mode:"manual",automatic_delivery:true});
    expect(buyerDeliveryKind(current)).toBe("instant");expect(buyerDeliveryBadge(current)).toBe("Kirim otomatis");
    expect(catalogDeliveryBadge(current,"en")).toBe("Automatic delivery");
    expect(catalogDeliveryEta(current,"id")).not.toMatch(/admin|Made By Order/);
    expect(buyerDeliveryKind(original)).toBe("queued");expect(original.automatic_delivery).toBeUndefined();
    expect((await (await quote([buff()])).json()).items[0].queued_delivery).toBe(false);
    expect((await (await quote([{product_id:1,variant_id:2,qty:1}])).json()).items[0].queued_delivery).toBe(true);
    const {telegramPaidDeliveryProfile}=await import("@/lib/telegram/order-notifications");
    const {createDatabaseAccess}=await import("@/lib/db-access");
    expect(await telegramPaidDeliveryProfile({items:JSON.stringify([{variant_id:1}])},createDatabaseAccess(fx.db))).toEqual({delivery:"instant",hasLocalManual:false});
    fx.sql.exec("UPDATE product_variants SET buyer_field_key=NULL WHERE id=1");
    expect((await getProductDetail("muse-ai-1-miliar-token"))!.variants.find(v=>v.id===1)!.automatic_delivery).toBeUndefined();
  });
  it("trims, preserves case, and defaults off for the original Muse account",() => {
    expect(validateBuyerFields(config,{ muse_invite_code:" Ab12cD " },30)).toEqual(fields);
    expect(validateBuyerFields({},undefined,1)).toEqual({});
    expect(fx.sql.prepare("SELECT buyer_field_key,max_qty,price FROM product_variants WHERE id=2").get()).toEqual({ buyer_field_key:null,max_qty:null,price:16000 });
  });
  it.each(["","abcde","abcdefg","ab12-é","AB 123","ＡB1234"])("rejects invalid code %s",code => expect(()=>validateBuyerFields(config,{ muse_invite_code:code },1)).toThrow());
  it("rejects missing, unknown preset and disabled config with supplied values",() => {
    expect(()=>validateBuyerFields(config,{},1)).toThrow();
    expect(()=>validateBuyerFields({ buyer_field_key:"unknown" },fields,1)).toThrow();
    expect(()=>validateBuyerFields({},fields,1)).toThrow();
    expect(buyerSnapshotMatches({ ...config,buyer_fields:fields },{ ...config,buyer_fields:{ muse_invite_code:"XY1234" } })).toBe(false);
  });
  it("same code is allowed, conflicting codes fail without changing line identity",() => {
    expect(()=>assertSameBuyerCode([buff(),buff(2)])).not.toThrow();
    expect(()=>assertSameBuyerCode([buff(),buff(2,"XY1234")])).toThrow();
  });
  it("merges same-code aliases and signs normalized code/config/aggregate qty",async () => {
    const response=await quote([buff(10," Ab12cD "),{ slug:"muse-ai-1-miliar-token",variant_id:1,qty:20,buyer_fields:fields }]);
    expect(response.status).toBe(200);
    const body=await response.json();
    expect(body.items).toHaveLength(1); expect(body.items[0]).toMatchObject({ qty:30,...config,buyer_fields:fields,price:1500 });
    const token=await verifyCheckoutQuoteToken(body.quoteToken);
    expect(token?.items[0]).toMatchObject({ qty:30,...config,buyer_fields:fields });
    expect(JSON.stringify(token)).not.toContain("TUNVN");
  });
  it.each([{items:[buff(20),buff(11)]},{items:[buff(),buff(1,"XY1234")]},{items:[{ product_id:1,variant_id:1,qty:1 }]}])("quote rejects aggregate overflow/conflict/missing input",async ({items}) => {
    const response=await quote(items); expect(response.status).toBe(409);
  });
  it("quote leaves non-field variants unchanged",async () => expect((await quote([{ product_id:1,variant_id:2,qty:1 }])).status).toBe(200));
  it("order refuses code substitution before invoice or order insertion",async () => {
    const body=await (await quote([buff()])).json();
    const { POST }=await import("@/app/api/orders/route");
    const response=await POST(req("/api/orders",{ customer_wa:"081234567890",customer_email:"fixture@example.test",items:[buff(1,"XY1234")],payment_method:"qris",quote_token:body.quoteToken }));
    expect(response.status).toBe(409); expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()).toEqual({ n:0 });
  });
});

describe("atomic snapshot and eligibility",() => {
  it("web and Telegram cannot snapshot half-published TUNVN costs while the catalog lease is active",async()=>{
    fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('tunvn_catalog_lease',?)").run(JSON.stringify({until:Date.now()+90000,owner:"fixture"}));
    await expect(atomic()).rejects.toThrow();
    const tg={ orderCode:"AXV-20261110-TGLEASE",lines:[{productId:1,variantId:1,qty:1,fulfillmentMode:"manual",stock:-1}],items:[atomicItem()],variantSnapshot:"{}",subtotal:1500,primaryVariantId:1,customerName:"Fixture",salesChannel:"telegram" as const,telegramChatId:"123",telegramUserId:"123",paymentMethod:"qris",paymentAccount:"-",fulfillmentStatus:"manual_required" };
    await expect(createChannelOrderAtomic(tg)).rejects.toThrow();
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()).toEqual({n:0});
    fx.sql.exec("DELETE FROM store_settings WHERE key='tunvn_catalog_lease'");
    await atomic(); await createChannelOrderAtomic(tg);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()).toEqual({n:2});
  });
  it("persists versioned server-derived identity and never trusts supplied stamp",async () => {
    await atomic([{ ...atomicItem(30),tunvn_eligibility:{ version:999 } } as ReturnType<typeof atomicItem>]);
    const items=JSON.parse(String(fx.sql.prepare("SELECT items FROM orders").get()!.items));
    expect(items[0]).toMatchObject({ qty:30,buyer_fields:fields,tunvn_eligibility:{ version:1,kind:"buff",source_product_id:null,source_variant_id:1,source_unit_b:1,quantity:30 } });
    expect(withoutPrivateBuyerData(items)[0]).not.toHaveProperty("buyer_fields");
    expect(withoutPrivateBuyerData(items)[0]).not.toHaveProperty("tunvn_eligibility");
  });
  it("config changed after quote rejects the whole reservation",async () => {
    fx.sql.exec("UPDATE product_variants SET buyer_field_key=NULL WHERE id=1");
    await expect(atomic()).rejects.toThrow(); expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()).toEqual({ n:0 });
  });
  it("aggregate cap cannot be bypassed through duplicate rows",async () => { await expect(atomic([atomicItem(20),atomicItem(11)])).rejects.toThrow(); });
  it("atomic guard also binds config/identity during a race",async () => {
    const batch=fx.db.batch;
    fx.db.batch=async statements => { fx.sql.exec("UPDATE product_variants SET max_qty=29 WHERE id=1"); return batch(statements); };
    await expect(atomic()).rejects.toThrow(); expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()).toEqual({ n:0 });
  });
  it("only current canonical identities qualify; bundles/base Muse/old rows remain manual",() => {
    expect(tunvnEligibility({ id:3,sku:"TUNVN-86",tunvn_source_product_id:86 },2)).toMatchObject({ kind:"account",source_product_id:86,quantity:2 });
    // Family mana pun (bukan hanya ChatGPT) ikut otomatis.
    expect(tunvnEligibility({ id:9,sku:"TUNVN-73",tunvn_source_product_id:73 },1)).toMatchObject({ kind:"account",source_product_id:73 });
    for (const sku of ["TUNVN-BUFF-5B","TUNVN-BUFF-10B","TUNVN-BUFF-20B","TUNVN-BUFF-30B","MUSE-ACCOUNT"]) expect(tunvnEligibility({ id:1,sku,product_slug:"muse-ai-1-miliar-token",...config },1)).toBeUndefined();
    // Identitas harus cocok dengan kolom durable; #60 tidak pernah eligible.
    expect(tunvnEligibility({ id:9,sku:"TUNVN-73",tunvn_source_product_id:72 },1)).toBeUndefined();
    expect(tunvnEligibility({ id:3,sku:"TUNVN-86" },1)).toBeUndefined();
    expect(tunvnEligibility({ id:9,sku:"TUNVN-60",tunvn_source_product_id:60 },1)).toBeUndefined();
  });
  it("Telegram order snapshots input and stamps via the atomic factory",async () => {
    await createChannelOrderAtomic({ orderCode:"AXV-20261110-AABBCCDD",lines:[{ productId:1,variantId:1,qty:2,fulfillmentMode:"manual",stock:-1 }],items:[atomicItem(2)],variantSnapshot:"{}",subtotal:3000,primaryVariantId:1,customerName:"Fixture",salesChannel:"telegram",telegramChatId:"123",telegramUserId:"123",paymentMethod:"qris",paymentAccount:"-",fulfillmentStatus:"manual_required" });
    expect(JSON.parse(String(fx.sql.prepare("SELECT items FROM orders").get()!.items))[0]).toMatchObject({ buyer_fields:fields,tunvn_eligibility:{ version:1,kind:"buff",quantity:2 } });
  });
  it("unsupported WA factory refuses before any order/invoice",async () => {
    const { getActiveVariant }=await import("@/lib/catalog");
    const variant=await getActiveVariant(1);
    await expect(createPendingChannelOrder({ salesChannel:"whatsapp",productId:1,productName:"Muse",variantId:1,variant:variant!,customerId:"123",customerName:"Fixture",idempotencyKey:"wa-test" })).rejects.toThrow("unsupported_buyer_input");
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()).toEqual({ n:0 });
  });
  it("Telegram approval binds the code and config without including code in callback",async () => {
    const line={ productId:1,variantId:1,qty:1,price:1500,buyerFieldKey:"muse_invite_code" as const,buyerFields:fields,maxQty:30 };
    expect(await checkoutApprovalTag([line])).not.toBe(await checkoutApprovalTag([{ ...line,buyerFields:{ muse_invite_code:"XY1234" } }]));
    expect(await checkoutApprovalTag([line])).not.toBe(await checkoutApprovalTag([{ ...line,maxQty:29 }]));
  });
});

describe("admin gates and data access",() => {
  const patch=async (id:number,body:unknown) => (await import("@/app/api/admin/tunvn/products/[id]/route")).PATCH(req(`/api/admin/tunvn/products/${id}`,body,"PATCH"),{ params:Promise.resolve({ id:String(id) }) });
  it("rejects obsolete switches and other unknown fields without a write",async () => {
    const before=fx.sql.prepare("SELECT * FROM tunvn_products WHERE supplier_product_id=86").get();
    expect((await patch(86,{ markup_percent:90,axvara_is_active:true })).status).toBe(400);
    expect((await patch(86,{ markup_percent:90,publish_requested:true })).status).toBe(400);
    expect((await patch(86,{ markup_percent:90,extra:true })).status).toBe(400);
    expect(fx.sql.prepare("SELECT * FROM tunvn_products WHERE supplier_product_id=86").get()).toEqual(before);
  });
  it("variant-only fields require a synced variant and never write partial mirror state",async () => {
    fx.sql.exec("DELETE FROM product_variants WHERE id=3");
    const response = await patch(86,{ is_active:true, markup_percent:90 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "variant_missing" });
    expect(fx.sql.prepare("SELECT markup_percent,visible FROM tunvn_products WHERE supplier_product_id=86").get()).toEqual({ markup_percent:35,visible:0 });
  });
  it("admin catalog lists mapped variants by durable identity, not slug",async () => {
    fx.sql.exec("UPDATE tunvn_products SET axvara_product_id=2");
    const { GET }=await import("@/app/api/admin/tunvn/products/route");
    const body=await (await GET(new NextRequest("http://localhost/api/admin/tunvn/products"))).json();
    expect(body.counts).toMatchObject({ total:2,mapped:2,active_variants:0 });
    expect(body.items.find((row:{supplier_product_id:number})=>row.supplier_product_id===86))
      .toMatchObject({ variant_sku:"TUNVN-86",variant_label:"Business 1 Bulan",axvara_name:"ChatGPT Private",family_key:"chatgpt",variant_id:3 });
  });
  it("rejects the excluded API TEST product and unknown mirror ids without writes",async () => {
    fx.sql.exec("INSERT INTO tunvn_products(supplier_product_id,name,price_usdt) VALUES(60,'API TEST',1)");
    const response = await patch(60,{ markup_percent:50, is_active:true });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "excluded_product" });
    expect((await patch(9999,{ markup_percent:50 })).status).toBe(404);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM tunvn_products WHERE supplier_product_id=60 AND markup_percent<>35").get()).toEqual({ n:0 });
  });
  it("activates either variant and deactivating one never hides the other",async () => {
    const readMirror = () => fx.sql.prepare("SELECT supplier_product_id,visible,publish_requested FROM tunvn_products ORDER BY supplier_product_id").all();
    const activated = await patch(86,{ is_active:true, label:"Edited label", admin_name:"Edited name", admin_description:"Edited description" });
    expect(activated.status).toBe(200);
    const { item } = await activated.json();
    expect(item).toMatchObject({ visible:0, admin_name:"Edited name", admin_description:"Edited description" });
    expect(item).not.toHaveProperty("publish_requested");
    expect(fx.sql.prepare("SELECT is_active,name,description FROM products WHERE id=2").get()).toEqual({ is_active:0, name:"Edited name", description:"Edited description" });
    expect(fx.sql.prepare("SELECT is_active,label FROM product_variants WHERE id=3").get()).toEqual({ is_active:1, label:"Edited label" });
    const { PUT }=await import("@/app/api/products/[id]/route");
    expect((await PUT(req("/api/products/2",{ isActive:true },"PUT"),{ params:Promise.resolve({ id:"2" }) })).status).toBe(200);
    expect(readMirror()).toContainEqual({ supplier_product_id:86, visible:1, publish_requested:0 });
    expect((await patch(83,{ is_active:true })).status).toBe(200);
    expect((await patch(86,{ is_active:false })).status).toBe(200);
    expect(readMirror()).toEqual([{ supplier_product_id:83, visible:1, publish_requested:0 },{ supplier_product_id:86, visible:0, publish_requested:0 }]);
    expect(fx.sql.prepare("SELECT is_active FROM products WHERE id=2").get()).toEqual({ is_active:1 });
    expect(fx.sql.prepare("SELECT sku,is_active FROM product_variants WHERE product_id=2 ORDER BY id").all()).toEqual([{ sku:"TUNVN-86",is_active:0 },{ sku:"TUNVN-83",is_active:1 }]);
  });
  it("general Products activation removes the initial dead end and survives product off/on",async () => {
    const { PUT, DELETE }=await import("@/app/api/products/[id]/route");
    const put=(isActive:boolean) => PUT(req("/api/products/2",{ isActive },"PUT"),{ params:Promise.resolve({ id:"2" }) });
    fx.sql.exec("UPDATE products SET price=999999 WHERE id=2; UPDATE tunvn_products SET publish_requested=1 WHERE supplier_product_id=83");
    expect((await put(true)).status).toBe(200);
    expect(fx.sql.prepare("SELECT price,stock,is_active FROM products WHERE id=2").get()).toEqual({ price:112400, stock:22, is_active:1 });
    expect(fx.sql.prepare("SELECT id,is_active FROM product_variants WHERE product_id=2 ORDER BY id").all()).toEqual([{ id:3,is_active:1 },{ id:4,is_active:0 }]);
    const readVisibility = () => fx.sql.prepare("SELECT visible FROM tunvn_products WHERE supplier_product_id=86").get();
    expect(readVisibility()).toEqual({ visible:1 });
    expect((await put(false)).status).toBe(200);
    expect(readVisibility()).toEqual({ visible:0 });
    expect((await put(true)).status).toBe(200);
    expect(readVisibility()).toEqual({ visible:1 });
    expect(fx.sql.prepare("SELECT is_active FROM product_variants WHERE id=4").get()).toEqual({ is_active:0 });
    expect((await DELETE(new NextRequest("http://localhost/api/products/2",{ method:"DELETE" }),{ params:Promise.resolve({ id:"2" }) })).status).toBe(200);
    expect(readVisibility()).toEqual({ visible:0 });
    expect(fx.sql.prepare("SELECT publish_requested FROM tunvn_products WHERE supplier_product_id=83").get()).toEqual({ publish_requested:1 });
  });
  it("buyer input is detail-only and requires admin auth",async () => {
    await atomic();
    const { GET }=await import("@/app/api/admin/orders/[code]/route");
    const request=new NextRequest("http://localhost/api/admin/orders/AXV-20261110-AABBCCDD");
    const params={ params:Promise.resolve({ code:"AXV-20261110-AABBCCDD" }) };
    auth.admin=false; expect((await GET(request,params)).status).toBe(401);
    auth.admin=true; const response=await GET(request,params);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ buyerInputs:[{ key:"muse_invite_code",value:"Ab12cD" }] });
    const { GET:list }=await import("@/app/api/admin/orders/route");
    const listing=await list(new NextRequest("http://localhost/api/admin/orders"));
    expect(listing.status).toBe(200);
    const text=await listing.text();
    expect(text).not.toContain("Ab12cD");
    expect(text).not.toContain("tunvn_eligibility");
    const { getProductDetail }=await import("@/lib/catalog");
    const product=await getProductDetail("muse-ai-1-miliar-token");
    expect(JSON.stringify(product)).not.toContain("Ab12cD");
    expect(JSON.stringify(product)).not.toContain("TUNVN-");
  });
  it("alternate variant API persists input switches and manual price",async () => {
    const { PUT,POST }=await import("@/app/api/admin/variants/route");
    const put=(body:unknown) => PUT(req("/api/admin/variants?id=1",body,"PUT"));
    expect((await put({ buyer_field_key:null,max_qty:30,price:1700 })).status).toBe(200);
    expect(fx.sql.prepare("SELECT buyer_field_key,max_qty,price,tunvn_admin_price_idr FROM product_variants WHERE id=1").get()).toEqual({ buyer_field_key:null,max_qty:30,price:1700,tunvn_admin_price_idr:1700 });
    expect((await put({ max_qty:31 })).status).toBe(400);
    expect((await put({ buyer_field_key:"muse_invite_code",max_qty:30 })).status).toBe(200);
    const before=fx.sql.prepare("SELECT * FROM product_variants WHERE id=1").get();
    expect((await put({ min_qty:31,max_qty:30,price:1900 })).status).toBe(400);
    expect(fx.sql.prepare("SELECT * FROM product_variants WHERE id=1").get()).toEqual(before);
    expect((await put({ sku:"NEW-IDENTITY" })).status).toBe(409);
    const row={ id:1,product_id:1,sku:"TUNVN-BUFF-1B",label:"Buff per 1B",price:1700,stock:-1,is_active:1,buyer_field_key:null,max_qty:30 };
    expect((await POST(req("/api/admin/variants",{ product_id:1,variants:[row] }))).status).toBe(200);
    expect(fx.sql.prepare("SELECT buyer_field_key,max_qty FROM product_variants WHERE id=1").get()).toEqual({ buyer_field_key:null,max_qty:30 });
    expect((await POST(req("/api/admin/variants",{ product_id:1,variants:[{ ...row,min_qty:31,max_qty:undefined }] }))).status).toBe(400);
    expect((await POST(req("/api/admin/variants",{ product_id:1,sku:"TEST-PRESET",label:"Preset",price:1000,buyer_field_key:"muse_invite_code",max_qty:10 }))).status).toBe(201);
    expect(fx.sql.prepare("SELECT buyer_field_key,max_qty FROM product_variants WHERE sku='TEST-PRESET'").get()).toEqual({ buyer_field_key:"muse_invite_code",max_qty:10 });
  });
  it("both admin editors omit retired Buff bundles while retaining inactive variants and historical IDs",async () => {
    for (const quantity of [5,10,20,30]) fx.sql.prepare("INSERT INTO product_variants(product_id,sku,label,price,is_active) VALUES(1,?,?,7500,0)").run(`TUNVN-BUFF-${quantity}B`,`Buff ${quantity}B`);
    fx.sql.exec("UPDATE product_variants SET is_active=0 WHERE id=2");
    const old=fx.sql.prepare("SELECT id FROM product_variants WHERE sku='TUNVN-BUFF-5B'").get()!;
    const items=JSON.stringify([{ variant_id:old.id,name:"Buff 5B",price:7500,qty:1 }]);
    fx.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,variant_id) VALUES('AXV-20261109-11223344','Fixture','628000000000',?,7500,'qris',?)").run(items,old.id);
    const { GET:product }=await import("@/app/api/products/[id]/route");
    const { GET:variants }=await import("@/app/api/admin/variants/route");
    const detail=await product(new NextRequest("http://localhost/api/products/1"),{ params:Promise.resolve({ id:"1" }) });
    const listing=await variants(new NextRequest("http://localhost/api/admin/variants?product_id=1"));
    expect(detail.status).toBe(200); expect(listing.status).toBe(200);
    for (const rows of [(await detail.json()).product.variants,(await listing.json()).variants]) {
      expect(rows.map((row:{sku:string})=>row.sku)).toEqual(["TUNVN-BUFF-1B","MUSE-ACCOUNT"]);
      expect(rows.find((row:{sku:string})=>row.sku==="MUSE-ACCOUNT").is_active).toBe(0);
    }
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE sku IN ('TUNVN-BUFF-5B','TUNVN-BUFF-10B','TUNVN-BUFF-20B','TUNVN-BUFF-30B') AND is_active=0").get()).toEqual({ n:4 });
    expect(fx.sql.prepare("SELECT variant_id,items FROM orders").get()).toEqual({ variant_id:old.id,items });
    expect(fx.sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("merge migration reruns without deleting IDs/prices/history or custom copy",() => {
    fx.sql.exec("UPDATE products SET slug='chatgpt-business-1-bulan-tunvn',name='Custom admin copy' WHERE id=2; INSERT INTO products(id,name,slug,price) VALUES(3,'GPay old','chatgpt-gpay-1-bulan-tunvn',121200); UPDATE product_variants SET product_id=3 WHERE id=4;");
    fx.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,variant_id) VALUES('AXV-20261109-11223344','Fixture','628000000000','[{\"variant_id\":4,\"qty\":1}]',121200,'qris',4)").run();
    const sql=fs.readFileSync("drizzle/migrations/0114_tunvn_chatgpt_merge.sql","utf8"); fx.sql.exec(sql); fx.sql.exec(sql);
    expect(fx.sql.prepare("SELECT product_id,price FROM product_variants WHERE id=4").get()).toEqual({ product_id:2,price:121200 });
    expect(fx.sql.prepare("SELECT name,slug FROM products WHERE id=2").get()).toEqual({ name:"Custom admin copy",slug:"chatgpt-tunvn" });
    expect(fx.sql.prepare("SELECT variant_id,items FROM orders").get()).toEqual({ variant_id:4,items:'[{"variant_id":4,"qty":1}]' });
    expect(fx.sql.prepare("SELECT is_active FROM products WHERE id=3").get()).toEqual({ is_active:0 });
  });
  it("0115 upgrades the old schema, retires bundles, and never stamps historical orders",() => {
    const base=fx.sql.prepare("SELECT * FROM product_variants WHERE id=2").get()!;
    fx.sql.exec(`UPDATE product_variants SET sku='TUNVN-BUFF-5B',tunvn_buff_quantity_b=5,tunvn_admin_price_idr=12345 WHERE id=1;
      DROP TRIGGER IF EXISTS tunvn_variant_publication; DROP TRIGGER tunvn_retired_bundle_update;
      ALTER TABLE product_variants DROP COLUMN buyer_field_key; ALTER TABLE product_variants DROP COLUMN max_qty;
      ALTER TABLE telegram_carts DROP COLUMN buyer_fields;
      INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,variant_id) VALUES('AXV-20261109-11223344','Fixture','628000000000','[{"variant_id":1,"qty":1}]',12345,'qris',1);`);
    fx.sql.exec(fs.readFileSync("drizzle/migrations/0115_variant_buyer_input.sql","utf8"));
    expect(fx.sql.prepare("SELECT price,tunvn_admin_price_idr,is_active FROM product_variants WHERE id=1").get()).toEqual({ price:1500,tunvn_admin_price_idr:12345,is_active:0 });
    expect(fx.sql.prepare("SELECT price,is_active,max_qty,buyer_field_key FROM product_variants WHERE sku='TUNVN-BUFF-1B'").get()).toEqual({ price:1500,is_active:0,max_qty:30,buyer_field_key:"muse_invite_code" });
    expect(fx.sql.prepare("SELECT * FROM product_variants WHERE id=2").get()).toEqual(base);
    expect(fx.sql.prepare("SELECT items FROM orders").get()).toEqual({ items:'[{"variant_id":1,"qty":1}]' });
    expect(() => fx.sql.exec("UPDATE product_variants SET is_active=1 WHERE id=1")).toThrow("retired_bundle");
  });
});

describe("Telegram private buyer input",() => {
  const buyer={ id:123,first_name:"Fixture" };
  beforeEach(() => fx.sql.exec("INSERT INTO telegram_users(user_id,chat_id) VALUES('123','123')"));
  it("collects privately, retries invalid input, trims and persists without echoing code",async () => {
    const { requestBuyerInput,handleBuyerInput }=await import("@/lib/telegram/handlers/buyer-input");
    expect(await requestBuyerInput(-123,buyer,1,1,2)).toBe(true);
    expect(telegram.send).not.toHaveBeenCalled();
    expect(await requestBuyerInput(123,buyer,1,1,2)).toBe(true);
    expect(await handleBuyerInput("bad",123,buyer)).toBe(true);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM telegram_carts").get()).toEqual({ n:0 });
    expect(await handleBuyerInput(" Ab12cD ",123,buyer)).toBe(true);
    expect(fx.sql.prepare("SELECT qty,buyer_fields FROM telegram_carts").get()).toEqual({ qty:2,buyer_fields:JSON.stringify(fields) });
    expect(telegram.cart).toHaveBeenCalledOnce();
    expect(JSON.stringify(telegram.send.mock.calls)).not.toContain("Ab12cD");
    expect(await handleBuyerInput("Ab12cD",123,buyer)).toBe(false);
  });
  it("same-code merges, conflicting codes and aggregate overflow leave cart untouched",async () => {
    const { addToCart,setCartLineQty }=await import("@/lib/telegram/cart");
    expect(await addToCart("123",1,1,20,1,fields)).toEqual({ ok:true });
    expect(await addToCart("123",1,1,10,1,fields)).toEqual({ ok:true });
    expect((await addToCart("123",1,1,1,1,fields)).ok).toBe(false);
    expect((await addToCart("123",1,1,1,1,{ muse_invite_code:"XY1234" })).ok).toBe(false);
    expect(await setCartLineQty("123",1,31)).toBe(false);
    expect(fx.sql.prepare("SELECT qty FROM telegram_carts WHERE variant_id=1").get()).toEqual({ qty:30 });
    expect(await addToCart("123",1,2,1)).toEqual({ ok:true });
  });
  it("no-field variants skip collection and creating anchors are never replaced",async () => {
    const { requestBuyerInput }=await import("@/lib/telegram/handlers/buyer-input");
    expect(await requestBuyerInput(123,buyer,1,2,1)).toBe(false);
    const anchor='payq1:{"st":"creating"}';
    fx.sql.prepare("UPDATE telegram_users SET pending_action=?").run(anchor);
    await requestBuyerInput(123,buyer,1,1,1);
    expect(fx.sql.prepare("SELECT pending_action FROM telegram_users").get()).toEqual({ pending_action:anchor });
  });
});
