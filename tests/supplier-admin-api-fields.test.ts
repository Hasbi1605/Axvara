import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { GET as tunvnProducts } from "@/app/api/admin/tunvn/products/route";
import { GET as aivaultProducts } from "@/app/api/admin/aivault/products/route";
import { GET as storebatProducts } from "@/app/api/admin/storebat/products/route";
import { GET as miraiProducts } from "@/app/api/admin/mirai/products/route";
import { GET as tunvnOrders } from "@/app/api/admin/tunvn/orders/route";
import { GET as aivaultOrders } from "@/app/api/admin/aivault/orders/route";
import { GET as storebatOrders } from "@/app/api/admin/storebat/orders/route";
import { GET as miraiOrders } from "@/app/api/admin/mirai/orders/route";
import { GET as tunvnBalance } from "@/app/api/admin/tunvn/balance/route";
import { GET as tunvnBuff } from "@/app/api/admin/tunvn/buff/route";
import { POST as tunvnPublish } from "@/app/api/admin/tunvn/publish/route";
import { GET as wrSyncLog } from "@/app/api/admin/warung/sync-log/route";
import { GET as skSyncLog } from "@/app/api/admin/sekalipay/sync-log/route";
import { GET as wrMarkup } from "@/app/api/admin/warung/markup/route";
import { GET as skMarkup } from "@/app/api/admin/sekalipay/markup/route";
import { GET as wrOrders } from "@/app/api/admin/warung/orders/route";
import { GET as skOrders } from "@/app/api/admin/sekalipay/orders/route";

const mocks = vi.hoisted(() => ({ publish: vi.fn(), fx: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => true }));
vi.mock("@/lib/payments/market-snapshot", () => ({ loadCurrentFxSnapshot: mocks.fx }));
vi.mock("@/lib/tunvn/catalog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tunvn/catalog")>("@/lib/tunvn/catalog");
  return { ...actual, publishTunvnCatalog: mocks.publish };
});

let fixture: ReturnType<typeof createD1Fixture>;
const at = "2026-11-19T00:00:00.000Z";
const get = (path: string) => new NextRequest(`http://localhost/api/admin/${path}`);

beforeEach(() => {
  fixture = createD1Fixture();
  for (const supplier of ["TUNVN", "AIVAULT"]) {
    vi.stubEnv(`${supplier}_BASE_URL`, "https://supplier.test");
    vi.stubEnv(`${supplier}_API_KEY`, "fixture-key");
    vi.stubEnv(`${supplier}_ENABLED`, "true");
    vi.stubEnv(`${supplier}_SYNC_ENABLED`, "true");
  }
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected external call"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

function seedSyncStatus(supplier: string) {
  const set = fixture.sql.prepare("INSERT INTO store_settings(key,value) VALUES(?,?)");
  set.run(`${supplier}_catalog_success_at`, String(Date.parse(at)));
  set.run(`${supplier}_catalog_last_error`, JSON.stringify({ at, error: "catalog_error fixture-key" }));
}

it("TUNVN products exposes aliases, a static and fallback family, and catalog health", async () => {
  fixture.sql.exec(`INSERT INTO products(id,name,slug,price,is_active,tunvn_family) VALUES(1,'Owner name','owner-slug',12345,1,'chatgpt');
    INSERT INTO tunvn_products(supplier_product_id,name,price_usdt,description) VALUES(86,'Business',4.6,'Supplier copy'),(899,'Unmapped Plan',1,'');
    INSERT INTO product_variants(product_id,sku,label,price,is_active,tunvn_source_product_id,tunvn_admin_price_idr)
    VALUES(1,'TUNVN-86','Owner variant',12345,1,86,12345);`);
  seedSyncStatus("tunvn");
  vi.stubEnv("TUNVN_SYNC_ENABLED", "false");
  const response = await tunvnProducts(get("tunvn/products"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ configured: true, dispatch_enabled: true, sync_enabled: false, last_sync_at: at,
    last_error: { at, error: "catalog_error [redacted]" }, counts: { requested: 1, active_variants: 1 } });
  expect(body.items[0]).toMatchObject({ id: 86, supplier_product_id: 86, product_name: "Owner name", axvara_name: "Owner name",
    product_slug: "owner-slug", axvara_slug: "owner-slug", variant_active: 1, variant_is_active: 1, product_active: 1, axvara_is_active: 1,
    label: "Owner variant", variant_label: "Owner variant", admin_price_idr: 12345, tunvn_admin_price_idr: 12345,
    cost_usdt: 4.6, price_usdt: 4.6, supplier_description: "Supplier copy", family_key: "chatgpt", tunvn_family: "chatgpt" });
  expect(body.items[0].family).toEqual({ key: "chatgpt", name: "ChatGPT Private", slug: "chatgpt-tunvn", label: "Business 1 Bulan" });
  expect(body.items[0]).not.toHaveProperty("publish_requested");
  expect(body.items[1]).toMatchObject({ id: 899, variant_id: null, tunvn_family: null, label: null, admin_price_idr: null,
    family: { key: "p899", name: "Unmapped Plan", slug: "unmapped-plan-tunvn", label: "Unmapped Plan" } });
});

it("AIVault products keeps legacy costs and mirrors aliases/flags/sanitized error", async () => {
  fixture.sql.exec(`INSERT INTO products(id,name,slug,price) VALUES(1,'Owner name','av-owner-slug',12345);
    INSERT INTO aivault_products(service_id,name,stock,unit_price_usd,pricing_tiers_json,axvara_product_id) VALUES('gemini','Gemini',5,0.5,'[]',1);
    INSERT INTO product_variants(product_id,sku,label,price,aivault_service_id,aivault_admin_price_idr) VALUES(1,'AV-gemini','Owner variant',12345,'gemini',12345);`);
  seedSyncStatus("aivault");
  const response = await aivaultProducts(get("aivault/products"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ configured: true, dispatch_enabled: true, sync_enabled: true,
    last_sync_at: String(Date.parse(at)), last_error: { at, error: "catalog_error [redacted]" },
    items: [{ service_id: "gemini", unit_price_usd: 0.5, price_usd: 0.5, product_slug: "av-owner-slug",
      aivault_admin_price_idr: 12345, admin_price_idr: 12345, bulk_markup_tiers: null, bulk_tiers_preview: [] }] });
});

it.each([
  { supplier: "storebat", route: storebatProducts, insert: `INSERT INTO storebat_products(id,name,price_usd,pricing_type,price_tiers_json,delivery_type,last_seen_at)
      VALUES(12,'Feed',0.6,'standard','[]','stock','${at}');
      INSERT INTO product_variants(product_id,sku,label,price,storebat_product_id) VALUES(1,'SB-12','Owner variant',12345,12);`, legacy: { id: 12, price_usd: 0.6 } },
  { supplier: "mirai", route: miraiProducts, insert: `INSERT INTO mirai_packages(package_code,group_key,name,quota_tokens,duration_seconds,reseller_price_vnd,cost_usdt)
      VALUES('GPT_10M','gpt','Feed',10000000,86400,13000,0.5);
      INSERT INTO product_variants(product_id,sku,label,price,mirai_package_code) VALUES(1,'MR-GPT_10M','Owner variant',12345,'GPT_10M');`,
    legacy: { package_code: "GPT_10M", cost_usdt: 0.5 } },
])("$supplier products exposes the actual parent slug", async ({ supplier, route, insert, legacy }) => {
  fixture.sql.exec("INSERT INTO products(id,name,slug,price) VALUES(1,'Owner name','actual-slug',12345);");
  fixture.sql.exec(insert);
  const response = await route(get(`${supplier}/products`));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ items: [{ ...legacy, product_name: "Owner name", product_slug: "actual-slug", admin_price_idr: null }] });
});

it.each([
  { supplier: "tunvn", route: tunvnOrders, fields: "kind,source_product_id,cost_usdt", values: "'account',86,4.6", legacy: { source_product_id: 86, kind: "account", cost_usdt: 4.6 } },
  { supplier: "aivault", route: aivaultOrders, fields: "service_id,cost_usd,external_order_id", values: "'gemini',0.5,'av-order'", legacy: { service_id: "gemini", cost_usd: 0.5 } },
  { supplier: "storebat", route: storebatOrders, fields: "kind,storebat_product_id,cost_usd,fx_idr_per_usd,idempotency_key", values: "'product',12,0.6,18000,'sb-order'", legacy: { kind: "product", storebat_product_id: 12, cost_usd: 0.6 } },
  { supplier: "mirai", route: miraiOrders, fields: "package_code,cost_usdt,external_order_id,idempotency_key", values: "'GPT_10M',0.5,'mr-order','mr-order'", legacy: { package_code: "GPT_10M", cost_usdt: 0.5 } },
])("$supplier orders exposes pre-send timestamps without exposing ciphertext", async ({ supplier, route, fields, values, legacy }) => {
  const created = "2026-11-19 00:00:00", updated = "2026-11-19 00:01:00";
  fixture.sql.exec(`INSERT INTO products(id,name,slug,price) VALUES(1,'Product','fixture',12345);
    INSERT INTO product_variants(id,product_id,sku,label,price) VALUES(1,1,'FIXTURE','Fixture',12345);
    INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method) VALUES('order','Buyer','000','[]',12345,'qris');
    INSERT INTO ${supplier}_order_links(order_code,item_index,product_id,variant_id,quantity,status,created_at,updated_at,receipt_ciphertext,${fields})
    VALUES('order',0,1,1,1,'needs_admin','${created}','${updated}','fixture-ciphertext',${values});`);
  const response = await route(get(`${supplier}/orders`));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json();
  expect(body.items).toHaveLength(1);
  expect(body.items[0]).toMatchObject({ ...legacy, order_code: "order", item_index: 0, request_sent_at: null,
    completed_at: null, created_at: created, updated_at: updated, has_receipt: 1, can_retry: 0 });
  expect(body.items[0]).not.toHaveProperty("receipt_ciphertext");
});

it("TUNVN balance retains username and legacy amounts with the USDT aliases", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, username: "fixture-user", balance_usdt: 2.5, balance_vnd: 55000, usdt_vnd: 22000 })));
  const response = await tunvnBalance(get("tunvn/balance"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, configured: true, kind: "ok", username: "fixture-user",
    balance: 2.5, currency: "USDT", balance_usdt: 2.5, balance_vnd: 55000, usdt_vnd: 22000 });
});

it.each(["throttled", "claimed_elsewhere", "not_configured"])("TUNVN publish exposes skip reason %s", async skipped => {
  if (skipped === "not_configured") vi.stubEnv("TUNVN_SYNC_ENABLED", "false");
  mocks.fx.mockResolvedValue({ rateText: "18086" });
  mocks.publish.mockResolvedValue({ skipped });
  const response = await tunvnPublish(new NextRequest("http://localhost/api/admin/tunvn/publish", { method: "POST", body: "{}" }));
  expect(response.status).toBe(skipped === "not_configured" ? 503 : 502);
  expect(await response.json()).toEqual({ ok: false, error: skipped, skipped });
});

it("WR/SK sync-log exposes env flags and bounded DB counts without eager markup/provider requests", async () => {
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example.test");
  vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "proxy-tok");
  vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "false");

  vi.stubEnv("SEKALIPAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_API_KEY", "sk-key");
  vi.stubEnv("SEKALIPAY_AUTO_ORDER_ENABLED", "false");
  vi.stubEnv("SEKALIPAY_SYNC_ENABLED", "true");

  fixture.sql.exec(`
    INSERT INTO products(id,name,slug,price,is_active) VALUES
      (1,'WR Live','wr-live',10000,1),
      (2,'WR Archived','wr-arch',10000,0),
      (3,'SK Live','sk-live',12000,1);
    INSERT INTO product_variants(id,product_id,sku,label,price,is_active) VALUES
      (11,1,'WR-1','V1',15000,1),
      (12,2,'WR-2','V2',15000,0),
      (13,3,'SK-1','S1',18000,1);
    UPDATE products SET archived_at=datetime('now') WHERE id=2;
    INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES ('WP1','WR Live',1),('WP2','WR Arch',2);
    INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,is_active) VALUES
      ('WV1','WP1','V1',10000,5,11,1),
      ('WV2','WP2','V2',10000,5,12,1),
      ('WV3','WP2','V3 Unmapped',10000,5,NULL,1);
    INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_category,sk_variant_name,sk_price,sk_stock,axvara_product_id,axvara_variant_id,is_active) VALUES
      ('SV1','SP1','SK Live','Aplikasi Premium','S1',12000,5,3,13,1),
      ('SV2','SP2','SK Unmapped','Aplikasi Premium','S2',12000,5,NULL,NULL,1),
      ('GAME1','GP1','Mobile Legends','Games','86D',15000,5,NULL,NULL,1);
  `);

  const wrBody = await (await wrSyncLog(get("warung/sync-log?limit=5"))).json();
  expect(wrBody).toMatchObject({
    configured: true,
    dispatch_enabled: true,
    sync_enabled: false,
    counts: { active_variants: 1, mapped_variants: 2, total_variants: 3, families: 2 },
  });
  expect(Array.isArray(wrBody.logs)).toBe(true);
  expect(wrBody.diff).toBeDefined();

  const skBody = await (await skSyncLog(get("sekalipay/sync-log?limit=5"))).json();
  expect(skBody).toMatchObject({
    configured: true,
    dispatch_enabled: false,
    sync_enabled: true,
    counts: { active_variants: 1, mapped_variants: 1, total_variants: 2, families: 2 },
  });
  expect(Array.isArray(skBody.logs)).toBe(true);
  expect(skBody.diff).toBeDefined();
});

it("WR/SK markup exposes grouping metadata, limit<=500/offset slicing, stable ordering, and live-status hierarchy", async () => {
  fixture.sql.exec(`
    INSERT INTO products(id,name,slug,price,is_active) VALUES
      (1,'Winner','winner',10000,1),
      (2,'Loser','loser',10000,1),
      (3,'Archived','archived',10000,0),
      (4,'UniqueSoldout','unique-soldout',10000,1);
    INSERT INTO product_groups(id,name,winner_product_id) VALUES(1,'Group 1',1);
    INSERT INTO product_group_members(group_id,product_id,position) VALUES(1,1,0),(1,2,1);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,min_qty,fulfillment_mode,is_active) VALUES
      (11,1,'WR-1','Win Var',15000,5,1,'manual',1),
      (12,2,'WR-2','Lose Var',15000,5,1,'manual',1),
      (13,3,'WR-3','Arch Var',15000,5,1,'manual',0),
      (14,4,'WR-4','Uniq Var',15000,5,1,'unique',1),
      (21,1,'SK-1','SK Win',15000,5,1,'manual',1),
      (22,2,'SK-2','SK Lose',15000,5,1,'manual',1),
      (23,3,'SK-3','SK Arch',15000,5,1,'manual',0),
      (24,4,'SK-4','SK Min',15000,2,5,'manual',1);
    UPDATE products SET archived_at=datetime('now') WHERE id=3;
    INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES
      ('WP1','Alpha',1),('WP2','Beta',2),('WP3','Gamma',3),('WP4','Delta',4);
    INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,is_active) VALUES
      ('WV1','WP1','A',10000,5,11,1),
      ('WV2','WP2','B',10000,5,12,1),
      ('WV3','WP3','C',10000,5,13,1),
      ('WV4','WP4','D',10000,5,14,1),
      ('WV5','WP1','E',10000,5,NULL,1);
    INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_category,sk_variant_name,sk_price,sk_stock,axvara_product_id,axvara_variant_id,is_active) VALUES
      ('SV1','SP1','Alpha','Aplikasi Premium','A',10000,5,1,21,1),
      ('SV2','SP2','Beta','Aplikasi Premium','B',10000,5,2,22,1),
      ('SV3','SP3','Gamma','Aplikasi Premium','C',10000,5,3,23,1),
      ('SV4','SP4','Delta','Aplikasi Premium','D',10000,5,4,24,1),
      ('SV5','SP1','Alpha','Aplikasi Premium','E',10000,5,NULL,NULL,1);
  `);

  const wrPage1 = await (await wrMarkup(get("warung/markup?limit=2&offset=0"))).json();
  const wrPage2 = await (await wrMarkup(get("warung/markup?limit=2&offset=2"))).json();
  const wrAll = await (await wrMarkup(get("warung/markup?limit=500"))).json();
  expect(wrPage1.total).toBe(5);
  expect(wrPage1.variants).toHaveLength(2);
  expect(wrPage2.variants).toHaveLength(2);
  expect(wrAll.variants).toHaveLength(5);
  expect(wrAll.variants.slice(0, 2).map((v: { wr_variant_id: string }) => v.wr_variant_id)).toEqual(
    wrPage1.variants.map((v: { wr_variant_id: string }) => v.wr_variant_id),
  );
  const wrById = Object.fromEntries(wrAll.variants.map((v: Record<string, unknown>) => [v.wr_variant_id, v]));
  expect(wrById.WV1).toMatchObject({
    axvara_product_id: 1, supplier_product_id: "WP1", product_name: "Winner", product_slug: "winner",
    variant_label: "Win Var", product_archived: 0, variant_status: "live",
  });
  expect(wrById.WV2).toMatchObject({ variant_status: "hidden_loser", variant_reason: "Kalah vs Winner #1" });
  expect(wrById.WV3).toMatchObject({ product_archived: 1, variant_status: "off", variant_reason: "Produk diarsipkan" });
  expect(wrById.WV4).toMatchObject({ variant_status: "hidden_soldout" });
  expect(wrById.WV5).toMatchObject({ variant_status: "hidden_nocatalog" });

  const skAll = await (await skMarkup(get("sekalipay/markup?limit=500&offset=0"))).json();
  expect(skAll.total).toBe(5);
  const skById = Object.fromEntries(skAll.variants.map((v: Record<string, unknown>) => [v.sk_variant_id, v]));
  expect(skById.SV1).toMatchObject({
    axvara_product_id: 1, supplier_product_id: "SP1", product_name: "Winner", product_slug: "winner",
    variant_label: "SK Win", product_archived: 0, variant_status: "live",
  });
  expect(skById.SV2).toMatchObject({ variant_status: "hidden_loser", variant_reason: "Kalah vs Winner #1" });
  expect(skById.SV3).toMatchObject({ product_archived: 1, variant_status: "off", variant_reason: "Produk diarsipkan" });
  expect(skById.SV4).toMatchObject({ variant_status: "hidden_soldout" });
  expect(skById.SV5).toMatchObject({ variant_status: "hidden_nocatalog" });
});

it("WR/SK orders includes product and variant names while preserving existing contracts", async () => {
  fixture.sql.exec(`
    INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,sales_channel)
    VALUES('AXV-ORD-1','Budi','6281234567890','budi@example.com','[]',15000,'qris','lunas','paid','web');
    INSERT INTO wr_products(wr_product_id,wr_product_name) VALUES('WP-1','WR ChatGPT');
    INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock) VALUES('WV-1','WP-1','1 Bulan',10000,5);
    INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-ORD-1','RBHN-1','WV-1',1,10000,'processing');
    INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_category,sk_variant_name,sk_price,sk_stock)
    VALUES('SV-1','SP-1','SK Netflix','Aplikasi Premium','Sharing 1B',12000,5);
    INSERT INTO sk_order_links(order_code,sk_variant_id,sk_invoice,quantity,sk_cost,status) VALUES('AXV-ORD-1','SV-1','SK-INV-1',1,12000,'processing');
  `);
  const wrBody = await (await wrOrders(get("warung/orders?per_page=20&page=1&status=processing&q=RBHN-1"))).json();
  expect(wrBody.orders[0]).toMatchObject({
    order_code: "AXV-ORD-1",
    wr_variant_name: "1 Bulan",
    wr_product_name: "WR ChatGPT",
    customer_name: "Budi",
    customer_wa: "6281234567890",
    customer_email: "budi@example.com",
  });
  const skBody = await (await skOrders(get("sekalipay/orders?per_page=20&page=1&status=processing&q=SK-INV-1"))).json();
  expect(skBody.orders[0]).toMatchObject({
    order_code: "AXV-ORD-1",
    sk_variant_name: "Sharing 1B",
    sk_product_name: "SK Netflix",
    customer_name: "Budi",
    customer_wa: "6281234567890",
    customer_email: "budi@example.com",
  });
});

it("Other 4 orders expose masked buyer fields without inferring names from email or leaking credentials", async () => {
  fixture.sql.exec(`
    INSERT INTO products(id,name,slug,price) VALUES(1,'Product','fixture',12345);
    INSERT INTO product_variants(id,product_id,sku,label,price) VALUES(1,1,'FIXTURE','Fixture',12345);
    INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,sales_channel,supplier_purchase_disabled) VALUES
      ('ORD-1','','6281234567890','secretperson@example.com','[]',12345,'qris','web',1),
      ('ORD-2','  ','081','a@b.co','[]',12345,'qris','telegram',0),
      ('ORD-3','Rina','123456','invalid-email','[]',12345,'qris','whatsapp',0);
    INSERT INTO aivault_order_links(order_code,item_index,product_id,variant_id,service_id,quantity,cost_usd,external_order_id,status,receipt_ciphertext) VALUES
      ('ORD-1',0,1,1,'gemini',1,0.5,'av-1','needs_admin','CIPHER-1'),
      ('ORD-2',0,1,1,'gemini',1,0.5,'av-2','needs_admin','CIPHER-2'),
      ('ORD-3',0,1,1,'gemini',1,0.5,'av-3','needs_admin','CIPHER-3');
    INSERT INTO tunvn_order_links(order_code,item_index,product_id,variant_id,kind,source_product_id,quantity,cost_usdt,status,receipt_ciphertext) VALUES
      ('ORD-1',0,1,1,'account',86,1,4.6,'needs_admin','CIPHER-1');
    INSERT INTO storebat_order_links(order_code,item_index,product_id,variant_id,storebat_product_id,kind,quantity,cost_usd,fx_idr_per_usd,idempotency_key,status,receipt_ciphertext) VALUES
      ('ORD-1',0,1,1,12,'product',1,0.6,18000,'sb-1','needs_admin','CIPHER-1');
    INSERT INTO mirai_order_links(order_code,item_index,product_id,variant_id,package_code,quantity,cost_usdt,external_order_id,idempotency_key,status,receipt_ciphertext) VALUES
      ('ORD-1',0,1,1,'GPT_10M',1,0.5,'mr-1','mr-1','needs_admin','CIPHER-1');
  `);

  const av = await (await aivaultOrders(get("aivault/orders"))).json();
  const byCode = Object.fromEntries(av.items.map((row: Record<string, unknown>) => [row.order_code, row]));
  expect(byCode["ORD-1"]).toMatchObject({
    customer_name: null,
    customer_wa: "62812****7890",
    customer_email: "s***n@example.com",
    sales_channel: "web",
    purchase_disabled: 1,
    has_receipt: 1,
  });
  expect(JSON.stringify(byCode["ORD-1"])).not.toContain("secretperson");
  expect(JSON.stringify(byCode["ORD-1"])).not.toContain("6281234567890");
  expect(JSON.stringify(byCode["ORD-1"])).not.toContain("CIPHER-1");

  expect(byCode["ORD-2"]).toMatchObject({
    customer_name: null,
    customer_wa: "****",
    customer_email: "***@b.co",
    sales_channel: "telegram",
    purchase_disabled: 0,
  });
  expect(byCode["ORD-3"]).toMatchObject({
    customer_name: "Rina",
    customer_wa: "12****",
    customer_email: "***",
    sales_channel: "whatsapp",
    purchase_disabled: 0,
  });

  for (const route of [tunvnOrders, storebatOrders, miraiOrders]) {
    const body = await (await route(get("orders"))).json();
    expect(body.items[0]).toMatchObject({
      customer_name: null,
      customer_wa: "62812****7890",
      customer_email: "s***n@example.com",
      sales_channel: "web",
      purchase_disabled: 1,
    });
    expect(JSON.stringify(body)).not.toContain("secretperson");
    expect(JSON.stringify(body)).not.toContain("CIPHER-1");
  }
});

it("Other 4 catalog /products and TUNVN /buff compute variant_status hierarchy and effective buyability", async () => {
  fixture.sql.exec(`
    INSERT INTO products(id,name,slug,price,is_active,aivault_family,tunvn_family,storebat_family,mirai_family) VALUES
      (1,'Winner Product','winner-p',10000,1,'gemini','chatgpt','gemini','gpt'),
      (2,'Loser Product','loser-p',10000,1,'chatgpt-plus','claude','claude-api','claude'),
      (3,'Archived Product','arch-p',10000,0,'adobe-express','other','codex-api','full'),
      (4,'Soldout Product','sold-p',10000,1,'apple-music','gamma','grok','tau'),
      (5,'Muse AI 1 Miliar Token','muse-ai-1-miliar-token',1500,1,NULL,NULL,NULL,NULL);
    INSERT INTO product_groups(id,name,winner_product_id) VALUES(1,'Group A',1);
    INSERT INTO product_group_members(group_id,product_id,position) VALUES(1,1,0),(1,2,1);

    INSERT INTO product_variants(id,product_id,sku,label,price,stock,min_qty,fulfillment_mode,is_active,aivault_service_id,tunvn_source_product_id,storebat_product_id,mirai_package_code,tunvn_buff_quantity_b,tunvn_cost_usdt,tunvn_markup_percent,tunvn_fx_idr_per_usdt) VALUES
      (11,1,'AV-svc_live','Live',15000,5,1,'manual',1,'svc_live',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
      (12,2,'AV-svc_loser','Loser',15000,5,1,'manual',1,'svc_loser',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
      (13,3,'AV-svc_arch','Arch',15000,5,1,'manual',0,'svc_arch',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
      (14,4,'AV-svc_uniq','Uniq',15000,5,1,'unique',1,'svc_uniq',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
      (15,1,'AV-svc_off','Off',15000,5,1,'manual',0,'svc_off',NULL,NULL,NULL,NULL,NULL,NULL,NULL),

      (21,1,'TUNVN-101','T Live',15000,5,1,'manual',1,NULL,101,NULL,NULL,NULL,NULL,NULL,NULL),
      (22,2,'TUNVN-102','T Loser',15000,5,1,'manual',1,NULL,102,NULL,NULL,NULL,NULL,NULL,NULL),
      (23,3,'TUNVN-103','T Arch',15000,5,1,'manual',0,NULL,103,NULL,NULL,NULL,NULL,NULL,NULL),
      (24,4,'TUNVN-104','T Min',15000,2,5,'manual',1,NULL,104,NULL,NULL,NULL,NULL,NULL,NULL),

      (31,1,'SB-201','SB Live',15000,5,1,'manual',1,NULL,NULL,201,NULL,NULL,NULL,NULL,NULL),
      (32,2,'SB-202','SB Loser',15000,5,1,'manual',1,NULL,NULL,202,NULL,NULL,NULL,NULL,NULL),
      (33,3,'SB-203','SB Arch',15000,5,1,'manual',0,NULL,NULL,203,NULL,NULL,NULL,NULL,NULL),
      (34,4,'SB-204','SB Zero',15000,0,1,'manual',1,NULL,NULL,204,NULL,NULL,NULL,NULL,NULL),

      (41,1,'MR-M_LIVE','M Live',15000,-1,1,'manual',1,NULL,NULL,NULL,'M_LIVE',NULL,NULL,NULL,NULL),
      (42,2,'MR-M_LOSER','M Loser',15000,5,1,'manual',1,NULL,NULL,NULL,'M_LOSER',NULL,NULL,NULL,NULL),
      (43,3,'MR-M_ARCH','M Arch',15000,5,1,'manual',0,NULL,NULL,NULL,'M_ARCH',NULL,NULL,NULL,NULL),
      (44,4,'MR-M_MIN','M Min',15000,1,3,'manual',1,NULL,NULL,NULL,'M_MIN',NULL,NULL,NULL,NULL),

      (51,5,'TUNVN-BUFF-1B','Buff 1B',1500,-1,1,'manual',1,NULL,NULL,NULL,NULL,1,0.0588,40,18086);
    UPDATE products SET archived_at=datetime('now') WHERE id=3;

    INSERT INTO aivault_products(service_id,name,stock,unit_price_usd,pricing_tiers_json,axvara_product_id) VALUES
      ('svc_live','Live',5,0.5,'[]',1),
      ('svc_loser','Loser',5,0.5,'[]',2),
      ('svc_arch','Arch',5,0.5,'[]',3),
      ('svc_uniq','Uniq',5,0.5,'[]',4),
      ('svc_off','Off',5,0.5,'[]',1),
      ('svc_unmapped','Unmapped',5,0.5,'[]',NULL);

    INSERT INTO tunvn_products(supplier_product_id,name,price_usdt,stock,axvara_product_id) VALUES
      (60,'API TEST',1,5,NULL),
      (101,'T Live',1,5,1),
      (102,'T Loser',1,5,2),
      (103,'T Arch',1,5,3),
      (104,'T Min',1,2,4),
      (105,'T Unmapped',1,5,NULL);

    INSERT INTO storebat_products(id,name,price_usd,stock,pricing_type,price_tiers_json,delivery_type,last_seen_at) VALUES
      (201,'SB Live',0.5,5,'standard','[]','stock','${at}'),
      (202,'SB Loser',0.5,5,'standard','[]','stock','${at}'),
      (203,'SB Arch',0.5,5,'standard','[]','stock','${at}'),
      (204,'SB Zero',0.5,0,'standard','[]','stock','${at}'),
      (205,'SB Unmapped',0.5,5,'standard','[]','stock','${at}');

    INSERT INTO mirai_packages(package_code,group_key,name,quota_tokens,duration_seconds,reseller_price_vnd,cost_usdt,unlimited,remaining_today) VALUES
      ('M_LIVE','gpt','M Live',10000000,86400,13000,0.5,1,0),
      ('M_LOSER','gpt','M Loser',10000000,86400,13000,0.5,0,5),
      ('M_ARCH','gpt','M Arch',10000000,86400,13000,0.5,0,5),
      ('M_MIN','gpt','M Min',10000000,86400,13000,0.5,0,1),
      ('M_UNMAPPED','gpt','M Unmapped',10000000,86400,13000,0.5,0,5);
  `);

  const av = await (await aivaultProducts(get("aivault/products"))).json();
  const avById = Object.fromEntries(av.items.map((r: Record<string, unknown>) => [r.service_id, r]));
  expect(avById.svc_live).toMatchObject({ variant_status: "live" });
  expect(avById.svc_loser).toMatchObject({ variant_status: "hidden_loser", variant_reason: "Kalah vs Winner Product #1" });
  expect(avById.svc_arch).toMatchObject({ variant_status: "off", variant_reason: "Produk diarsipkan" });
  expect(avById.svc_uniq).toMatchObject({ variant_status: "hidden_soldout" });
  expect(avById.svc_off).toMatchObject({ variant_status: "off", variant_reason: "Nonaktif manual" });
  expect(avById.svc_unmapped).toMatchObject({ variant_status: "hidden_nocatalog" });

  const tv = await (await tunvnProducts(get("tunvn/products"))).json();
  const tvById = Object.fromEntries(tv.items.map((r: Record<string, unknown>) => [r.id, r]));
  expect(tvById[60]).toMatchObject({ variant_status: "off" });
  expect(tvById[101]).toMatchObject({ variant_status: "live" });
  expect(tvById[102]).toMatchObject({ variant_status: "hidden_loser", variant_reason: "Kalah vs Winner Product #1" });
  expect(tvById[103]).toMatchObject({ variant_status: "off", variant_reason: "Produk diarsipkan" });
  expect(tvById[104]).toMatchObject({ variant_status: "hidden_soldout" });
  expect(tvById[105]).toMatchObject({ variant_status: "hidden_nocatalog" });

  const sb = await (await storebatProducts(get("storebat/products"))).json();
  const sbById = Object.fromEntries(sb.items.map((r: Record<string, unknown>) => [r.id, r]));
  expect(sbById[201]).toMatchObject({ variant_status: "live" });
  expect(sbById[202]).toMatchObject({ variant_status: "hidden_loser", variant_reason: "Kalah vs Winner Product #1" });
  expect(sbById[203]).toMatchObject({ variant_status: "off", variant_reason: "Produk diarsipkan" });
  expect(sbById[204]).toMatchObject({ variant_status: "hidden_soldout" });
  expect(sbById[205]).toMatchObject({ variant_status: "hidden_nocatalog" });

  const mr = await (await miraiProducts(get("mirai/products"))).json();
  const mrById = Object.fromEntries(mr.items.map((r: Record<string, unknown>) => [r.package_code, r]));
  expect(mrById.M_LIVE).toMatchObject({ variant_status: "live" });
  expect(mrById.M_LOSER).toMatchObject({ variant_status: "hidden_loser", variant_reason: "Kalah vs Winner Product #1" });
  expect(mrById.M_ARCH).toMatchObject({ variant_status: "off", variant_reason: "Produk diarsipkan" });
  expect(mrById.M_MIN).toMatchObject({ variant_status: "hidden_soldout" });
  expect(mrById.M_UNMAPPED).toMatchObject({ variant_status: "hidden_nocatalog" });

  vi.stubEnv("TUNVN_ENABLED", "false");
  let buffBody = await (await tunvnBuff(get("tunvn/buff"))).json();
  expect(buffBody.variants[0]).toMatchObject({ sku: "TUNVN-BUFF-1B", variant_status: "live" });

  fixture.sql.exec("UPDATE product_variants SET stock=0 WHERE id=51");
  buffBody = await (await tunvnBuff(get("tunvn/buff"))).json();
  expect(buffBody.variants[0]).toMatchObject({ sku: "TUNVN-BUFF-1B", variant_status: "hidden_soldout" });

  fixture.sql.exec("UPDATE products SET is_active=0, archived_at=datetime('now') WHERE id=5");
  buffBody = await (await tunvnBuff(get("tunvn/buff"))).json();
  expect(buffBody.variants[0]).toMatchObject({ sku: "TUNVN-BUFF-1B", variant_status: "off", variant_reason: "Produk diarsipkan" });
});

it.each([
  {
    supplier: "tunvn",
    route: tunvnOrders,
    cols: "kind,source_product_id,cost_usdt,invite_code",
    vals: (idx: number) => `'buff',86,0.583,'INVITE-SECRET-${idx}'`,
  },
  {
    supplier: "storebat",
    route: storebatOrders,
    cols: "kind,storebat_product_id,cost_usd,fx_idr_per_usd,idempotency_key",
    vals: (idx: number) => `'product',12,0.6,18000,'sb-rm-${idx}'`,
  },
  {
    supplier: "mirai",
    route: miraiOrders,
    cols: "package_code,cost_usdt,external_order_id,idempotency_key",
    vals: (idx: number) => `'GPT_10M',0.5,'mr-rm-${idx}','mr-rm-${idx}'`,
  },
  {
    supplier: "aivault",
    route: aivaultOrders,
    cols: "service_id,cost_usd,external_order_id",
    vals: (idx: number) => `'gemini',0.5,'av-rm-${idx}'`,
  },
])("$supplier orders marks non-completed links as resolved_manually only when matching fulfillment_items row is delivered (status-only metadata)", async ({ supplier, route, cols, vals }) => {
  fixture.sql.exec(`
    INSERT INTO products(id,name,slug,price) VALUES(1,'Product','fixture',12345);
    INSERT INTO product_variants(id,product_id,sku,label,price) VALUES(1,1,'FIXTURE','Fixture',12345);
    INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status)
      VALUES('ORD-RM','Buyer','6281234567890','[]',12345,'qris','lunas');
    INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,status,delivered_message_id,delivered_ciphertext,delivered_iv,last_error) VALUES
      ('ORD-RM',0,1,1,1,'manual','delivered','manual','DELIVERED-CIPHER-0','iv-0','manual_handover:admin'),
      ('ORD-RM',1,1,1,1,'manual','delivered','manual','DELIVERED-CIPHER-1','iv-1','manual_handover:admin'),
      ('ORD-RM',2,1,1,1,'manual','manual_required',NULL,NULL,NULL,'supplier_needs_admin');
    INSERT INTO ${supplier}_order_links(order_code,item_index,product_id,variant_id,quantity,status,last_error,receipt_ciphertext,${cols}) VALUES
      ('ORD-RM',0,1,1,1,'needs_admin','unconfirmed_buff_receipt','RECEIPT-CIPHER-0',${vals(0)}),
      ('ORD-RM',1,1,1,1,'completed',NULL,'RECEIPT-CIPHER-1',${vals(1)}),
      ('ORD-RM',2,1,1,1,'needs_admin','attempts_exhausted',NULL,${vals(2)}),
      ('ORD-RM',3,1,1,1,'needs_admin','attempts_exhausted',NULL,${vals(3)});
  `);

  const response = await route(get(`${supplier}/orders`));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json() as { ok: boolean; items: Record<string, unknown>[] };
  expect(body.ok).toBe(true);
  const byIdx = Object.fromEntries(body.items.map((item) => [Number(item.item_index), item]));
  expect(byIdx[0].resolved_manually).toBe(true);
  expect(byIdx[1].resolved_manually).toBe(false);
  expect(byIdx[2].resolved_manually).toBe(false);
  expect(byIdx[3].resolved_manually).toBe(false);

  const serialized = JSON.stringify(body.items);
  expect(serialized).not.toMatch(/RECEIPT-CIPHER|DELIVERED-CIPHER|INVITE-SECRET/);
});
