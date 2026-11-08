import { expect, it, vi } from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import {
  bulkOwnerFromJoinedRow,
  bulkOwnerFromProductRow,
  bulkUnitPrice,
  isManualProductForBulk,
  resolveBulkPriceForProduct,
  validateBulkPricing,
} from "@/lib/bulk-pricing";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";

const tiers = [{ min_qty: 10, unit_price: 90000 }, { min_qty: 50, unit_price: 80000 }];
it("uses highest per-variant tier for all units without changing base or caps", () => {
  const config = { enabled: true, tiers };
  expect([9, 10, 49, 50].map((qty) => bulkUnitPrice(100000, qty, config))).toEqual([100000, 90000, 90000, 80000]);
  expect(bulkUnitPrice(100000, 50, { enabled: false, tiers })).toBe(100000);
  expect(validateBulkPricing({ enabled: true, tiers: [{ min_qty: 50, unit_price: 100000 }] }, 100000)).not.toBeNull();
  expect(() => bulkUnitPrice(Number.MAX_SAFE_INTEGER, 2, { enabled: false, tiers: [] })).toThrow("bulk_pricing_total_overflow");
});
it("rejects invalid, unordered, unsafe, duplicate or increasing tiers", () => {
  for (const invalid of [
    { enabled: true, tiers: [] }, { enabled: true, tiers: "not-json" }, { enabled: 1, tiers },
    { enabled: true, tiers: [{ min_qty: 1, unit_price: 1 }] }, { enabled: true, tiers: [{ min_qty: 2.5, unit_price: 1 }] },
    { enabled: true, tiers: [{ min_qty: 2, unit_price: 0 }] }, { enabled: true, tiers: [{ min_qty: 2, unit_price: 100001 }] },
    { enabled: true, tiers: [...tiers].reverse() }, { enabled: true, tiers: [tiers[0], tiers[0]] },
    { enabled: true, tiers: [{ min_qty: 2, unit_price: 90000 }, { min_qty: 3, unit_price: 95000 }] },
    { enabled: true, tiers: Array.from({ length: 6 }, (_, i) => ({ min_qty: i + 2, unit_price: 1 })) },
    { enabled: true, tiers: [{ min_qty: Number.MAX_SAFE_INTEGER + 1, unit_price: 1 }] },
  ]) expect(validateBulkPricing(invalid, 100000)).toBeNull();
  expect(validateBulkPricing({ enabled: true, tiers: [{ min_qty: 2, unit_price: 1 }] }, 0)).toBeNull();
});
it("catalog projects sanitized active tiers and preserves disabled configuration", async () => {
  const fixture = createD1Fixture();
  try {
    vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
    await insertTestProduct(fixture.sql);
    fixture.sql.prepare("UPDATE product_variants SET price=100000,min_qty=50,bulk_pricing_enabled=1,bulk_pricing_tiers=? WHERE id=1").run(JSON.stringify(tiers));
    const { getProductDetail, getActiveVariant } = await import("@/lib/catalog");
    expect((await getProductDetail(1))?.variants[0]).toMatchObject({ price: 100000, min_qty: 50, bulk_pricing_enabled: true, bulk_pricing_tiers: tiers, bulk_pricing_invalid: false });
    expect(await getActiveVariant(1)).toMatchObject({ bulk_pricing_enabled: true, bulk_pricing_tiers: tiers });
    const { GET } = await import("@/app/api/catalog/route");
    const publicResponse = await GET(new Request("http://localhost/api/catalog?slug=fixture"));
    expect((await publicResponse.json()).product.variants[0]).toMatchObject({ bulk_pricing_enabled: true, bulk_pricing_tiers: tiers });
    fixture.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=0 WHERE id=1").run();
    expect(await getActiveVariant(1)).toMatchObject({ bulk_pricing_enabled: false, bulk_pricing_tiers: [] });
    expect(fixture.sql.prepare("SELECT bulk_pricing_tiers,stock FROM product_variants WHERE id=1").get()).toMatchObject({ bulk_pricing_tiers: JSON.stringify(tiers), stock: 100 });
    fixture.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=1,price=1 WHERE id=1").run();
    expect(await getActiveVariant(1)).toMatchObject({ bulk_pricing_enabled: false, bulk_pricing_invalid: true, bulk_pricing_tiers: [] });
  } finally { fixture.close(); vi.unstubAllEnvs(); }
});
it("harga grosir hanya untuk produk manual: identitas supplier (WR/SK) diabaikan", async () => {
  expect(isManualProductForBulk(bulkOwnerFromProductRow({ source: "manual" }))).toBe(true);
  expect(isManualProductForBulk(bulkOwnerFromProductRow({ source: "manual", wr_product_id: null, sk_product_id: null, wr_auto_managed: 0, sk_auto_managed: 0 }))).toBe(true);
  // source bukan manual (check lama D1) atau id/flag supplier => bukan manual.
  for (const row of [
    { source: "warung_rebahan" },
    { source: "manual", wr_product_id: "WR-1" },
    { source: "manual", wr_auto_managed: 1 },
    // SK memakai source='manual' + sk_product_id NOT NULL.
    { source: "manual", sk_product_id: "SK-1" },
    { source: "manual", sk_auto_managed: 1 },
    { source: "sekalipay" },
  ]) expect(isManualProductForBulk(bulkOwnerFromProductRow(row))).toBe(false);
  expect(isManualProductForBulk(null)).toBe(false);
  expect(isManualProductForBulk(bulkOwnerFromJoinedRow({ p_source: "manual", p_sk_product_id: null }))).toBe(true);
  expect(isManualProductForBulk(bulkOwnerFromJoinedRow({ p_source: "manual", p_wr_product_id: "x" }))).toBe(false);

  // Resolver: produk supplier selalu harga dasar walau data tier tersimpan.
  expect(resolveBulkPriceForProduct(100000, 50, 1, JSON.stringify(tiers), { source: "manual" }).price).toBe(80000);
  expect(resolveBulkPriceForProduct(100000, 50, 1, JSON.stringify(tiers), { source: "warung_rebahan" })).toEqual({ price: 100000 });
  expect(resolveBulkPriceForProduct(100000, 50, 1, JSON.stringify(tiers), bulkOwnerFromProductRow({ source: "manual", sk_product_id: "SK-1" })).price).toBe(100000);
  expect(resolveBulkPriceForProduct(100000, 50, 0, JSON.stringify(tiers), { source: "manual" }).price).toBe(100000);
});

it("supplier variant dengan tier tersimpan tetap dihargai harga dasar", async () => {
  const fixture = createD1Fixture();
  try {
    vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
    await insertTestProduct(fixture.sql);
    fixture.sql.prepare("UPDATE product_variants SET price=100000, bulk_pricing_enabled=1, bulk_pricing_tiers=? WHERE id=1")
      .run(JSON.stringify(tiers));
    const { getActiveVariant, getProductDetail } = await import("@/lib/catalog");
    // Baseline manual: tier aktif.
    expect(await getActiveVariant(1)).toMatchObject({ bulk_pricing_enabled: true, bulk_pricing_tiers: tiers });
    // WR: data tersimpan diabaikan, bukan ditandai rusak.
    fixture.sql.prepare("UPDATE products SET source='warung_rebahan', wr_product_id='WR-9', wr_auto_managed=1 WHERE id=1").run();
    expect(await getActiveVariant(1)).toMatchObject({ bulk_pricing_enabled: false, bulk_pricing_tiers: [], bulk_pricing_invalid: false });
    expect((await getProductDetail(1))?.variants[0]).toMatchObject({ bulk_pricing_enabled: false, bulk_pricing_tiers: [] });
    // SK: source tetap manual + sk_product_id.
    fixture.sql.prepare("UPDATE products SET source='manual', wr_product_id=NULL, wr_auto_managed=0, sk_product_id='SK-9', sk_auto_managed=1 WHERE id=1").run();
    expect(await getActiveVariant(1)).toMatchObject({ bulk_pricing_enabled: false, bulk_pricing_tiers: [] });
    // Data tersimpan tidak dihapus — hanya tidak dipakai.
    expect(fixture.sql.prepare("SELECT bulk_pricing_enabled, bulk_pricing_tiers FROM product_variants WHERE id=1").get())
      .toMatchObject({ bulk_pricing_enabled: 1, bulk_pricing_tiers: JSON.stringify(tiers) });
  } finally { fixture.close(); vi.unstubAllEnvs(); }
});

it("workerd D1 enforces native JSON and flag constraints with legacy defaults", async () => {
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06", script: "export default {fetch(){return new Response('ok')}}", d1Databases: ["DB"] });
  try {
    const db = await runtime.getD1Database("DB");
    await db.batch([db.prepare("CREATE TABLE product_variants(id INTEGER PRIMARY KEY)"), db.prepare("INSERT INTO product_variants(id) VALUES(1)")]);
    const migration = readFileSync("drizzle/migrations/0099_variant_bulk_pricing.sql", "utf8");
    await db.batch(migration.split(";").map((sql) => sql.trim()).filter(Boolean).map((sql) => db.prepare(sql)));
    expect(await db.prepare("SELECT bulk_pricing_enabled,bulk_pricing_tiers FROM product_variants WHERE id=1").first()).toMatchObject({ bulk_pricing_enabled: 0, bulk_pricing_tiers: "[]" });
    for (const invalid of ["{", "{}", "[1,2,3,4,5,6]"]) await expect(db.prepare("UPDATE product_variants SET bulk_pricing_tiers=? WHERE id=1").bind(invalid).run()).rejects.toThrow();
    await expect(db.prepare("UPDATE product_variants SET bulk_pricing_enabled=2 WHERE id=1").run()).rejects.toThrow();
    await db.prepare("CREATE TABLE orders(items TEXT NOT NULL)").run();
    await db.prepare("INSERT INTO orders(items) VALUES(?)").bind(JSON.stringify([{ variant_id: 1, qty: 10, price: 90000, base_price: 100000, applied_tier_min_qty: 10 }])).run();
    expect(await db.prepare("SELECT json_extract(items,'$[0].price') AS price,json_extract(items,'$[0].applied_tier_min_qty') AS tier FROM orders").first()).toMatchObject({ price: 90000, tier: 10 });
  } finally { await runtime.dispose(); }
});
