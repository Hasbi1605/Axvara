import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import type { D1 } from "@/lib/db";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { projectPixelverifCatalog, publishPixelverifCatalog } from "@/lib/pixelverif/catalog";
import { PIXELVERIF_OBSERVED_PLANS_KEY, parsePixelverifObservedPlans } from "@/lib/pixelverif/observed-plans";
import { observedMarkupFields, PIXELVERIF_PLAN_ADMIN_PREFIX, saveObservedPixelverifMarkup } from "@/lib/pixelverif/observed-markup";
import { createD1Fixture } from "./helpers/d1-fixture";

let f: ReturnType<typeof createD1Fixture>;
let normalCost: number;
let pricingOverride: Record<string, unknown>;

const sixMonthPricing = {
  version: 31,
  default_validity: 6,
  allowed_validities: [6],
  pricing: { normal: {}, full: { "6": 1.2 } },
  disabled_plans: ["full:3", "link_validation", "normal:3", "normal:6"],
};

beforeEach(() => {
  normalCost = 1;
  pricingOverride = {};
  vi.stubEnv("PIXELVERIF_ENABLED", "true");
  vi.stubEnv("PIXELVERIF_SYNC_ENABLED", "true");
  vi.stubEnv("PIXELVERIF_API_KEY", "pv-fixture");
  vi.stubEnv("PIXELVERIF_API_BASE_URL", "https://pixel.test");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/api/pricing")) {
        return Response.json({
          success: true,
          version: 25,
          updated_at: Date.now(),
          default_validity: 3,
          allowed_validities: [3],
          pricing: { normal: { "3": normalCost }, full: { "3": 1.5 } },
          ...pricingOverride,
        });
      }
      return Response.json({ success: true, credits_remaining: 10 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function setupFixture(schemaSql?: string) {
  f = createD1Fixture(schemaSql);
  onTestFinished(f.close);
}

function migratedSchema() {
  // The pre-repo schema is missing, so the full history cannot be replayed
  // from empty (see d1-bootstrap-fresh.test.ts). Replay the relevant real
  // migrations over the pre-Pixel schema, removing 0115's inline columns.
  const schema = readFileSync("drizzle/schema.sql", "utf8");
  const cut = schema.indexOf("-- Pixel Verification is a separate, opt-in supplier.");
  expect(cut).toBeGreaterThan(0);
  const legacy = schema.slice(0, cut).replace(/^  (?:buyer_field_key TEXT|buyer_fields TEXT|max_qty INTEGER CHECK)[^\n]*\n/gm, "");
  const pre0115Cart = "CREATE TABLE IF NOT EXISTS telegram_carts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, product_id INTEGER, variant_id INTEGER, qty INTEGER);";
  return [legacy, pre0115Cart, ...["0115_variant_buyer_input.sql", "0155_pixelverif_supplier.sql", "0161_drop_telegram_carts.sql"]
    .map((file) => readFileSync(`drizzle/migrations/${file}`, "utf8"))].join("\n");
}

it.each(["bootstrap", "0115 + 0155 migration replay"] as const)("publishes OFF variants with qty 1 on %s", async (source) => {
  setupFixture(source === "bootstrap" ? undefined : migratedSchema());
  const budget = createBudgetedDatabase(60, 2, f.db);
  const res = await publishPixelverifCatalog(budget.access, 16000, { force: true });
  expect(res).toMatchObject({ ok: true });

  const product = f.sql.prepare("SELECT slug, is_active, telegram_enabled, pixelverif_family, category_id, image_url FROM products WHERE pixelverif_family='google_ai_pro_3m'").get() as Record<string, unknown>;
  expect(product.slug).toBe("google-ai-pro-3-bulan");
  expect(product.is_active).toBe(0);
  expect(product.telegram_enabled).toBe(1);
  expect(product.pixelverif_family).toBe("google_ai_pro_3m");
  expect(product.category_id).toBe(1);
  expect(product.image_url).toBe("/brand/catalog/products/google-ai-pro-pv.webp");

  const variants = f.sql.prepare("SELECT sku, is_active, price, stock, max_qty, min_qty, buyer_field_key, pixelverif_flow_type, pixelverif_validity FROM product_variants WHERE pixelverif_flow_type IS NOT NULL ORDER BY sku ASC").all() as Record<string, unknown>[];
  expect(variants).toHaveLength(2);
  expect(variants[0]).toMatchObject({ sku: "PV-FULL-3", is_active: 0, max_qty: 1, min_qty: 1, buyer_field_key: null, pixelverif_flow_type: "full", pixelverif_validity: 3 });
  expect(variants[1]).toMatchObject({ sku: "PV-NORMAL-3", is_active: 0, max_qty: 1, min_qty: 1, buyer_field_key: null, pixelverif_flow_type: "normal", pixelverif_validity: 3 });
  expect(variants[1].price).toBe(21600);
  expect(variants[0].price).toBe(32400);
  // Available services project unlimited stock (-1); 1-unit limit is enforced by max_qty=1.
  expect(variants.every((v) => v.stock === -1)).toBe(true);
});

it("refreshes cost without replacing an admin price or changing activation and copy", async () => {
  setupFixture();
  const db = createDatabaseAccess(f.db);
  await publishPixelverifCatalog(db, 16000, { force: true });
  f.sql.exec("UPDATE products SET name='Admin Name', description='Admin desc', image_url='/r2/admin.webp', is_active=1 WHERE pixelverif_family='google_ai_pro_3m'");
  f.sql.exec("UPDATE product_variants SET label='Admin Label', is_active=1, price=99999, pixelverif_admin_price_idr=99999 WHERE sku='PV-NORMAL-3'");

  normalCost = 2;
  expect(await publishPixelverifCatalog(db, 16000, { force: true })).toMatchObject({ ok: true });
  const prod = f.sql.prepare("SELECT name, description, image_url, is_active FROM products WHERE pixelverif_family='google_ai_pro_3m'").get() as Record<string, unknown>;
  expect(prod.name).toBe("Admin Name");
  expect(prod.description).toBe("Admin desc");
  expect(prod.image_url).toBe("/r2/admin.webp");
  expect(prod.is_active).toBe(1);
  const v = f.sql.prepare("SELECT label, is_active, price, pixelverif_cost_usd FROM product_variants WHERE sku='PV-NORMAL-3'").get();
  expect(v).toMatchObject({ label: "Admin Label", is_active: 1, price: 99999, pixelverif_cost_usd: 2 });
});

it("recomputes a formula price on cost changes even when another variant matches the CAS", async () => {
  setupFixture();
  const db = createDatabaseAccess(f.db);
  await publishPixelverifCatalog(db, 16000, { force: true });

  normalCost = 2;
  expect(await publishPixelverifCatalog(db, 16000, { force: true })).toMatchObject({ ok: true });
  expect(f.sql.prepare("SELECT price, pixelverif_cost_usd FROM product_variants WHERE sku='PV-NORMAL-3'").get())
    .toMatchObject({ price: 43200, pixelverif_cost_usd: 2 });
});

it("leaves concurrent admin price and markup edits intact on a CAS miss and retries on the next sync", async () => {
  setupFixture();
  const db = createDatabaseAccess(f.db);
  await publishPixelverifCatalog(db, 16000, { force: true });

  normalCost = 2;
  f.control.beforeRun = async (query) => {
    if (!query.startsWith("UPDATE product_variants")) return;
    f.control.beforeRun = null;
    f.sql.exec(`UPDATE product_variants SET price=99999, pixelverif_admin_price_idr=99999 WHERE sku='PV-NORMAL-3';
                UPDATE product_variants SET price=36000, pixelverif_markup_percent=50 WHERE sku='PV-FULL-3';`);
  };
  const readPrices = () => f.sql.prepare("SELECT price, pixelverif_cost_usd FROM product_variants WHERE pixelverif_flow_type IS NOT NULL ORDER BY sku").all();
  expect(await publishPixelverifCatalog(db, 16000, { force: true })).toMatchObject({ ok: true });
  expect(readPrices()).toEqual([{ price: 36000, pixelverif_cost_usd: 1.5 }, { price: 99999, pixelverif_cost_usd: 1 }]);

  expect(await publishPixelverifCatalog(db, 16000, { force: true })).toMatchObject({ ok: true });
  expect(readPrices()).toEqual([{ price: 36000, pixelverif_cost_usd: 1.5 }, { price: 99999, pixelverif_cost_usd: 2 }]);
});

it("unavailable service -> stock 0, not deleted or deactivated", async () => {
  setupFixture();
  const db = createDatabaseAccess(f.db);
  await publishPixelverifCatalog(db, 16000, { force: true });
  // Simulate second sync where full_3 is unavailable: update services directly
  f.sql.exec("UPDATE pixelverif_services SET available=0 WHERE service_key='full_3'");
  // Project again with same FX — should set stock 0 for full
  await projectPixelverifCatalog(createDatabaseAccess(f.db), 16000);
  const fullStock = (f.sql.prepare("SELECT stock FROM product_variants WHERE sku='PV-FULL-3'").get() as Record<string, unknown>).stock;
  expect(fullStock).toBe(0);
  // Row still exists
  expect(f.sql.prepare("SELECT COUNT(*) as c FROM product_variants WHERE pixelverif_flow_type='full'").get()).toMatchObject({ c: 1 });
});

it("syncs the six-month-only feed without selling new plans or deleting previous costs", async () => {
  setupFixture();
  const db = createBudgetedDatabase(60, 2, f.db).access;
  await publishPixelverifCatalog(db, 16000, { force: true });
  f.sql.exec(`UPDATE products SET is_active=1, stock=-1 WHERE pixelverif_family='google_ai_pro_3m';
              UPDATE product_variants SET is_active=1 WHERE pixelverif_flow_type IS NOT NULL;
              INSERT INTO store_settings(key,value) VALUES ('pixelverif_catalog_last_error','old failure')
                ON CONFLICT(key) DO UPDATE SET value=excluded.value;`);
  const revision = () => f.sql.prepare("SELECT value FROM store_settings WHERE key='catalog_revision_market'").get();
  const previousRevision = revision();
  pricingOverride = sixMonthPricing;
  const now = Date.now();
  expect(await publishPixelverifCatalog(db, 16000, { force: true, now })).toMatchObject({ ok: true, mirrored: 0 });
  expect(f.sql.prepare("SELECT service_key, available, credit_cost, pricing_version FROM pixelverif_services ORDER BY service_key").all()).toEqual([
    { service_key: "full_3", available: 0, credit_cost: 1.5, pricing_version: 31 },
    { service_key: "normal_3", available: 0, credit_cost: 1, pricing_version: 31 },
  ]);
  expect(f.sql.prepare("SELECT sku, stock, price, is_active FROM product_variants WHERE pixelverif_flow_type IS NOT NULL ORDER BY sku").all()).toEqual([
    { sku: "PV-FULL-3", stock: 0, price: 32400, is_active: 1 },
    { sku: "PV-NORMAL-3", stock: 0, price: 21600, is_active: 1 },
  ]);
  expect(f.sql.prepare("SELECT stock FROM products WHERE pixelverif_family='google_ai_pro_3m'").get()).toEqual({ stock: 0 });
  expect(revision()).not.toEqual(previousRevision);
  expect(f.sql.prepare("SELECT value FROM store_settings WHERE key='pixelverif_catalog_success_at'").get()).toEqual({ value: String(now) });
  expect(f.sql.prepare("SELECT value FROM store_settings WHERE key='pixelverif_catalog_last_error'").get()).toEqual({ value: "" });
});

it("does not create fallback services or variants on the first sync of a six-month-only feed", async () => {
  setupFixture();
  pricingOverride = sixMonthPricing;
  expect(await publishPixelverifCatalog(createDatabaseAccess(f.db), 16000)).toMatchObject({ ok: true, mirrored: 0 });
  expect(f.sql.prepare("SELECT COUNT(*) AS count FROM pixelverif_services").get()).toEqual({ count: 0 });
  expect(f.sql.prepare("SELECT COUNT(*) AS count FROM products WHERE pixelverif_family IS NOT NULL").get()).toEqual({ count: 0 });
});

it("remembers priced, disabled, and subsequently delisted plans for admin only", async () => {
  setupFixture();
  const db = createDatabaseAccess(f.db);
  const readObserved = () => parsePixelverifObservedPlans(f.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(PIXELVERIF_OBSERVED_PLANS_KEY)?.value);
  pricingOverride = sixMonthPricing;
  expect(await publishPixelverifCatalog(db, 16000, { force: true })).toMatchObject({ ok: true });
  expect(readObserved()).toEqual([
    { flow: "full", months: 3, cost: null, state: "disabled" },
    { flow: "normal", months: 3, cost: null, state: "disabled" },
    { flow: "full", months: 6, cost: 1.2, state: "available" },
    { flow: "normal", months: 6, cost: null, state: "disabled" },
  ]);
  expect(await saveObservedPixelverifMarkup(db, ["full_6", "normal_6"], { markup_percent: 57.5, admin_price_idr: 35000, is_active: true })).toEqual(new Set(["full_6", "normal_6"]));
  const readPrefs = (id: string) => f.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(`${PIXELVERIF_PLAN_ADMIN_PREFIX}${id}`)?.value;
  pricingOverride = { ...sixMonthPricing, allowed_validities: [12], pricing: { full: { "12": 3 } }, disabled_plans: [] };
  expect(await publishPixelverifCatalog(db, 16000, { force: true })).toMatchObject({ ok: true });
  expect(readObserved()).toContainEqual({ flow: "full", months: 6, cost: 1.2, state: "unlisted" });
  expect(readObserved()).toContainEqual({ flow: "normal", months: 6, cost: null, state: "unlisted" });
  for (const id of ["full_6", "normal_6"]) {
    expect(observedMarkupFields(readPrefs(id), null, null)).toEqual({ markup_percent: 57.5, admin_price_idr: 35000, variant_price: 35000, pixel_admin_active: true });
    expect(await saveObservedPixelverifMarkup(db, [id], { is_active: false })).toEqual(new Set([id]));
    expect(observedMarkupFields(readPrefs(id), null, null)).toMatchObject({ markup_percent: 57.5, admin_price_idr: 35000, pixel_admin_active: false });
  }
  expect(readObserved()).toContainEqual({ flow: "full", months: 12, cost: 3, state: "available" });
  const latest = readObserved();
  pricingOverride = { pricing: null };
  expect(await publishPixelverifCatalog(db, 16000, { force: true })).toMatchObject({ ok: false });
  expect(readObserved()).toEqual(latest);
  expect(f.sql.prepare("SELECT COUNT(*) AS count FROM pixelverif_services").get()).toEqual({ count: 0 });
  expect(f.sql.prepare("SELECT COUNT(*) AS count FROM product_variants WHERE pixelverif_flow_type IS NOT NULL").get()).toEqual({ count: 0 });
});

it("retires a previously sellable plan on native workerd D1", async () => {
  setupFixture();
  const runtime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response(null); } };",
    d1Databases: ["DB"],
  });
  try {
    const db = await runtime.getD1Database("DB");
    const tables = ["categories", "products", "product_variants", "pixelverif_services", "store_settings"];
    const ddl = f.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?");
    await db.batch([
      ...tables.map((name) => db.prepare(String(ddl.get(name)?.sql))),
      db.prepare("INSERT INTO categories (id, name, slug) VALUES (1, 'Fixture', 'fixture')"),
    ]);
    const access = createDatabaseAccess(db as unknown as D1);
    expect(await publishPixelverifCatalog(access, 16000, { force: true })).toMatchObject({ ok: true, mirrored: 2 });
    pricingOverride = sixMonthPricing;
    expect(await publishPixelverifCatalog(access, 16000, { force: true })).toMatchObject({ ok: true, mirrored: 0 });
    expect((await db.prepare("SELECT stock FROM product_variants ORDER BY sku").all()).results).toEqual([{ stock: 0 }, { stock: 0 }]);
    await db.prepare("DELETE FROM store_settings WHERE key=?").bind(PIXELVERIF_OBSERVED_PLANS_KEY).run();
    expect(await saveObservedPixelverifMarkup(access, ["full_3", "full_6", "normal_6"], { admin_price_idr: null, markup_percent: 42, is_active: true })).toEqual(new Set(["full_6", "normal_6"]));
    expect(await saveObservedPixelverifMarkup(access, ["full_6"], { admin_price_idr: 30000 })).toEqual(new Set(["full_6"]));
    const prefs = await db.prepare("SELECT value FROM store_settings WHERE key=?").bind(`${PIXELVERIF_PLAN_ADMIN_PREFIX}full_6`).first("value");
    expect(observedMarkupFields(prefs, 1.2, 16000)).toMatchObject({ markup_percent: 42, admin_price_idr: 30000, pixel_admin_active: true });
  } finally {
    await runtime.dispose();
  }
}, 30_000);

it("honors explicit disablement with stale prices and leaves a concurrent admin edit intact", async () => {
  setupFixture();
  const db = createDatabaseAccess(f.db);
  await publishPixelverifCatalog(db, 16000, { force: true });
  pricingOverride = { disabled_plans: ["FULL:3"], pricing: { normal: { "3": 1 }, full: { "3": 0.6 } } };
  f.control.beforeRun = async (query) => {
    if (!query.startsWith("UPDATE product_variants")) return;
    f.control.beforeRun = null;
    f.sql.exec("UPDATE product_variants SET price=66500, pixelverif_admin_price_idr=66500 WHERE sku='PV-FULL-3'");
  };
  expect(await publishPixelverifCatalog(db, 16000, { force: true })).toMatchObject({ ok: true, mirrored: 1 });
  expect(f.sql.prepare("SELECT available, credit_cost FROM pixelverif_services WHERE service_key='full_3'").get()).toEqual({ available: 0, credit_cost: 1.5 });
  expect(f.sql.prepare("SELECT stock, price FROM product_variants WHERE sku='PV-FULL-3'").get()).toEqual({ stock: 0, price: 66500 });
  expect(f.sql.prepare("SELECT stock FROM product_variants WHERE sku='PV-NORMAL-3'").get()).toEqual({ stock: -1 });
});

it("syncs v33 all-disabled feed (empty allowed_validities + disabled_plans) without alarming and marks observed plans disabled", async () => {
  setupFixture();
  const db = createDatabaseAccess(f.db);
  await publishPixelverifCatalog(db, 16000, { force: true });
  pricingOverride = sixMonthPricing;
  expect(await publishPixelverifCatalog(db, 16000, { force: true })).toMatchObject({ ok: true, mirrored: 0 });
  f.sql.exec(`INSERT INTO store_settings(key,value) VALUES ('pixelverif_catalog_last_error','pricing_ambiguous:invalid_pricing_shape')
              ON CONFLICT(key) DO UPDATE SET value=excluded.value;`);
  pricingOverride = {
    version: 33,
    default_validity: 6,
    allowed_validities: [],
    pricing: { normal: {}, full: {} },
    disabled_plans: ["full:3", "full:6", "link_validation", "normal:3", "normal:6"],
    link_validation: null,
  };
  const now = Date.now();
  expect(await publishPixelverifCatalog(db, 16000, { force: true, now })).toMatchObject({ ok: true, mirrored: 0 });
  expect(f.sql.prepare("SELECT service_key, available, pricing_version FROM pixelverif_services ORDER BY service_key").all()).toEqual([
    { service_key: "full_3", available: 0, pricing_version: 33 },
    { service_key: "normal_3", available: 0, pricing_version: 33 },
  ]);
  expect(f.sql.prepare("SELECT value FROM store_settings WHERE key='pixelverif_catalog_success_at'").get()).toEqual({ value: String(now) });
  expect(f.sql.prepare("SELECT value FROM store_settings WHERE key='pixelverif_catalog_last_error'").get()).toEqual({ value: "" });
  const observed = parsePixelverifObservedPlans(
    f.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(PIXELVERIF_OBSERVED_PLANS_KEY)?.value,
  );
  expect(observed).toEqual([
    { flow: "full", months: 3, cost: 1.5, state: "disabled" },
    { flow: "normal", months: 3, cost: 1, state: "disabled" },
    { flow: "full", months: 6, cost: 1.2, state: "disabled" },
    { flow: "normal", months: 6, cost: null, state: "disabled" },
  ]);
});

it.each([
  [{ pricing: {}, disabled_plans: ["normal:3", "full:3"] }, { ok: true, mirrored: 0 }, 0],
  [{ allowed_validities: [], pricing: { normal: {}, full: {} }, disabled_plans: ["normal:3", "full:3"] }, { ok: true, mirrored: 0 }, 0],
  [{ allowed_validities: [], pricing: { normal: {}, full: {} }, disabled_plans: ["link_validation"] }, { ok: false, error: "invalid_or_empty_catalog" }, -1],
  [{ allowed_validities: [], pricing: { normal: {}, full: {} }, disabled_plans: [] }, { ok: false, error: "pricing_ambiguous" }, -1],
  [{ pricing: {} }, { ok: false, error: "invalid_or_empty_catalog" }, -1],
  [{ disabled_plans: "full:3" }, { ok: false, error: "pricing_ambiguous" }, -1],
] as const)("handles missing or explicit availability data: %o", async (override, result, stock) => {
  setupFixture();
  const db = createDatabaseAccess(f.db);
  await publishPixelverifCatalog(db, 16000, { force: true });
  pricingOverride = override;
  expect(await publishPixelverifCatalog(db, 16000, { force: true })).toMatchObject(result);
  expect(f.sql.prepare("SELECT stock FROM product_variants WHERE pixelverif_flow_type IS NOT NULL ORDER BY sku").all())
    .toEqual([{ stock }, { stock }]);
});

it("price formula rounds fractional prices up to the next Rp100", async () => {
  setupFixture();
  const db = createDatabaseAccess(f.db);
  await publishPixelverifCatalog(db, 16500, { force: true });
  // 1 * 16500 * 1.35 = 22275 -> ceil to 22300
  expect((f.sql.prepare("SELECT price FROM product_variants WHERE sku='PV-NORMAL-3'").get() as Record<string, unknown>).price).toBe(22300);
  // 1.5 * 16500 * 1.35 = 33412.5 -> 33500
  expect((f.sql.prepare("SELECT price FROM product_variants WHERE sku='PV-FULL-3'").get() as Record<string, unknown>).price).toBe(33500);
});
