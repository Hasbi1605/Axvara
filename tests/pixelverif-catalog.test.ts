import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { projectPixelverifCatalog, publishPixelverifCatalog } from "@/lib/pixelverif/catalog";
import { createD1Fixture } from "./helpers/d1-fixture";

let f: ReturnType<typeof createD1Fixture>;
let normalCost: number;

beforeEach(() => {
  normalCost = 1;
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
  return [legacy, ...["0115_variant_buyer_input.sql", "0155_pixelverif_supplier.sql"]
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

it("price formula rounds fractional prices up to the next Rp100", async () => {
  setupFixture();
  const db = createDatabaseAccess(f.db);
  await publishPixelverifCatalog(db, 16500, { force: true });
  // 1 * 16500 * 1.35 = 22275 -> ceil to 22300
  expect((f.sql.prepare("SELECT price FROM product_variants WHERE sku='PV-NORMAL-3'").get() as Record<string, unknown>).price).toBe(22300);
  // 1.5 * 16500 * 1.35 = 33412.5 -> 33500
  expect((f.sql.prepare("SELECT price FROM product_variants WHERE sku='PV-FULL-3'").get() as Record<string, unknown>).price).toBe(33500);
});
