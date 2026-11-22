// Regresi 22 Nov 2026: sweep SK membaca markup, lalu menulis batch-nya setelah
// admin menyimpan markup baru. Dulu sweep menulis ulang markup lama (lost
// update) dan harga jual basi ke product_variants. Kini sweep compare-and-set.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createD1Fixture } from "../helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { calculateSkSellPrice, syncSkProducts } from "@/lib/sekalipay/sync";

let f: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  f = createD1Fixture();
  vi.stubEnv("SEKALIPAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_SYNC_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_API_KEY", "fixture");
});
afterEach(() => { f.close(); vi.unstubAllEnvs(); });

const db = () => createDatabaseAccess(f.db);
const catalog = (price: number) => ({
  server_time: "2026-11-22",
  data: [{ id: 1, name: "Aplikasi Premium", icon: null, products: [{ id: 77777, name: "Race SK", image: null, variants: [{
    id: 77771, sku: "RACE1", name: "One", price, stock: 5, order_process: "auto" as const,
    h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null,
  }] }] }],
});
const registry = () => f.sql.prepare("SELECT sk_price, markup_percent, axvara_sell_price, axvara_variant_id FROM sk_products WHERE sk_variant_id='77771'").get() as Record<string, number>;
const variantPrice = (id: number) => Number((f.sql.prepare("SELECT price FROM product_variants WHERE id=?").get(id) as { price: number }).price);

it("does not revert an admin markup saved between the sweep read and its write batch", async () => {
  expect((await syncSkProducts(db(), async () => catalog(1000))).errors).toEqual([]);
  const first = registry();
  const variantId = Number(first.axvara_variant_id);
  expect(variantId).toBeGreaterThan(0);
  expect(variantPrice(variantId)).toBe(Number(first.axvara_sell_price));

  // Admin saves markup 100% after the sweep prefetched the registry but before
  // its batch commits — same writes as saveSupplierMarkup.
  const adminPrice = calculateSkSellPrice(1000, 100, 0);
  const realBatch = f.db.batch.bind(f.db);
  let injected = false;
  f.db.batch = (async (statements: Parameters<typeof realBatch>[0]) => {
    const queries = statements.map((s) => String((s as unknown as { query: string }).query));
    if (!injected && queries.some((q) => q.includes("UPDATE sk_products SET"))) {
      injected = true;
      f.sql.exec(`UPDATE sk_products SET markup_percent=100, markup_fixed=0, axvara_sell_price=${adminPrice} WHERE sk_variant_id='77771'`);
      f.sql.exec(`UPDATE product_variants SET price=${adminPrice} WHERE id=${variantId}`);
    }
    return realBatch(statements);
  }) as typeof f.db.batch;

  // Supplier price changes, so the sweep has a reason to write with its stale markup.
  expect((await syncSkProducts(db(), async () => catalog(1200))).errors).toEqual([]);
  expect(injected).toBe(true);
  expect(registry().markup_percent).toBe(100);
  expect(registry().axvara_sell_price).toBe(adminPrice);
  expect(variantPrice(variantId)).toBe(adminPrice);

  // The next sweep re-reads the admin markup and applies the new supplier price.
  f.db.batch = realBatch;
  expect((await syncSkProducts(db(), async () => catalog(1200))).errors).toEqual([]);
  const expected = calculateSkSellPrice(1200, 100, 0);
  expect(registry()).toMatchObject({ sk_price: 1200, markup_percent: 100, axvara_sell_price: expected });
  expect(variantPrice(variantId)).toBe(expected);
});
