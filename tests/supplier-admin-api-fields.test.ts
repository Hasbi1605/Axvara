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
import { POST as tunvnPublish } from "@/app/api/admin/tunvn/publish/route";

const mocks = vi.hoisted(() => ({ publish: vi.fn(), fx: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => true }));
vi.mock("@/lib/payments/market-snapshot", () => ({ loadCurrentFxSnapshot: mocks.fx }));
vi.mock("@/lib/tunvn/catalog", () => ({ publishTunvnCatalog: mocks.publish }));

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
