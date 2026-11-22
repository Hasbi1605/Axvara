import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { syncProducts } from "@/lib/warung-rebahan/sync";
import type { WrProduct } from "@/lib/warung-rebahan/client";
import { createD1Fixture } from "../helpers/d1-fixture";

const bump = vi.hoisted(() => vi.fn());
vi.mock("@/lib/catalog-cache", async original => {
  const actual = await original<typeof import("@/lib/catalog-cache")>();
  bump.mockImplementation(actual.bumpCatalogRevision);
  return { ...actual, bumpCatalogRevision: bump };
});

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network disabled in sync fixture"); }));
  bump.mockClear();
});
afterEach(() => { fx.close(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function catalog(n: number): WrProduct[] {
  return Array.from({ length: n }, (_, i) => {
    const id = String(i).padStart(3, "0");
    return { id: `prod-${id}`, name: `Fixture ${id}`, category: "Productivity", description: `Product ${id}`, variants: [
      { id: `var-${id}`, name: `Variant ${id}`, price: 5000, stock: 10, duration: "7 Hari", warranty: "7 Hari", type: "Private", terms: null, delivery_terms: null },
    ] };
  });
}
const state = (key: string) => fx.sql.prepare("SELECT value FROM wr_sync_state WHERE key=?").get(key)?.value;
const ids = () => fx.sql.prepare("SELECT wr_variant_id FROM wr_variants ORDER BY wr_variant_id").all().map(r => r.wr_variant_id);
const stock = (id: string) => fx.sql.prepare("SELECT wr_stock FROM wr_variants WHERE wr_variant_id=?").get(id)?.wr_stock;
const logCount = (supplier: "wr" | "sk") => fx.sql.prepare(`SELECT count(*) AS n FROM ${supplier}_sync_log`).get()?.n;
const run = (products: WrProduct[], options: Parameters<typeof syncProducts>[2] = {}) => syncProducts(createDatabaseAccess(fx.db), async () => products, options);

describe("T6 WR sync stages", () => {
  it("resumes the sorted cursor without zeroing unseen stock, then zeros missing on a validated full sweep", async () => {
    const initial = catalog(5);
    expect(await run(initial)).toMatchObject({ synced: 5, snapshotComplete: true, errors: [] });
    const next = initial.slice(0, 4).reverse();
    expect(await run(next, { maxProducts: 2 })).toMatchObject({ synced: 2, snapshotComplete: false, budgetYielded: true });
    expect([state("products_cursor"), state("products_snapshot_complete")]).toEqual(["2", "0"]);
    expect(stock("var-004")).toBe(10);
    next.find(p => p.id === "prod-000")!.variants[0].stock = 7;
    next.find(p => p.id === "prod-003")!.variants[0].stock = 8;
    expect(await run(next, { maxProducts: 2 })).toMatchObject({ synced: 2, snapshotComplete: true, errors: [] });
    expect([state("products_cursor"), stock("var-000"), stock("var-003"), stock("var-004")]).toEqual(["0", 10, 8, 10]);
    expect(await run(next)).toMatchObject({ synced: 4, snapshotComplete: true, errors: [] });
    expect([stock("var-000"), stock("var-004")]).toEqual([7, 0]);
  });

  it("preserves a nonzero resumed cursor when admission yields before the first product", async () => {
    const products = catalog(5);
    expect(await run(products)).toMatchObject({ synced: 5, snapshotComplete: true, errors: [] });
    expect(await run(products, { maxProducts: 2 })).toMatchObject({ synced: 2, snapshotComplete: false, budgetYielded: true });
    expect(state("products_cursor")).toBe("2");
    // Deny only the product-admission check (canSpend(cost+4)); state
    // writes still run so the finalize tail persists the resumed cursor.
    const db = createDatabaseAccess(fx.db);
    const realCanSpend = db.canSpend.bind(db);
    const guarded = { ...db, canSpend: (n: number) => (n > 10 ? false : realCanSpend(n)) };
    const yielded = await syncProducts(guarded as typeof db, async () => products, {});
    expect(yielded).toMatchObject({ synced: 0, budgetYielded: true, snapshotComplete: false, errors: [] });
    expect(state("products_cursor")).toBe("2");
  });

  it("prefetches existing product and variant rows across >50 IDs in a diff without remapping or dropping the second chunk", async () => {
    const products = catalog(53);
    const diff = () => ({ applyOnly: { products, removedVariantIds: [] } });
    const fetch = vi.fn(async () => { throw new Error("diff must not fetch the catalog"); });
    const db = createDatabaseAccess(fx.db);
    expect(await syncProducts(db, fetch, diff())).toMatchObject({ synced: 53, newProducts: 53, newVariants: 53, errors: [] });
    const before = fx.sql.prepare("SELECT wr_variant_id, axvara_variant_id FROM wr_variants ORDER BY wr_variant_id").all();
    const parents = fx.sql.prepare("SELECT wr_product_id, axvara_product_id FROM wr_products ORDER BY wr_product_id").all();
    for (const p of products) { p.variants[0].stock += 1; p.description = "changed"; }
    // Capture the actual result sizes of prefetch queries, not their SQL or bind text.
    const batches: number[] = [];
    const read = db.queryAll;
    db.queryAll = async (...args) => { const rows = await read(...args); if (rows.length) batches.push(rows.length); return rows; };
    expect(await syncProducts(db, fetch, diff())).toMatchObject({ synced: 53, newProducts: 0, newVariants: 0, stockChanges: 53, errors: [] });
    expect(batches).toEqual([50, 3, 50, 3]);
    expect(fx.sql.prepare("SELECT wr_variant_id, axvara_variant_id FROM wr_variants ORDER BY wr_variant_id").all()).toEqual(before);
    expect(fx.sql.prepare("SELECT wr_product_id, axvara_product_id FROM wr_products ORDER BY wr_product_id").all()).toEqual(parents);
    expect(fx.sql.prepare("SELECT count(*) AS n FROM wr_products WHERE wr_description='changed'").get()?.n).toBe(53);
    expect(stock("var-052")).toBe(11);
    expect(fetch).not.toHaveBeenCalled();
    expect([logCount("wr"), logCount("sk")]).toEqual([0, 0]);
  });

  it("falls back to sequential writes after an actual batch rollback and tolerates the optional parent-description write", async () => {
    const products = catalog(1);
    await run(products);
    const expectedDescription = fx.sql.prepare("SELECT description FROM products").get()?.description;
    fx.sql.exec(`CREATE TRIGGER reject_description BEFORE UPDATE OF description ON products
      WHEN NEW.description='fixture rejection' BEGIN SELECT RAISE(ABORT, 'fixture description failure'); END;`);
    const batch = fx.db.batch!;
    const rollbacks: string[] = [];
    fx.db.batch = async statements => {
      try { return await batch(statements); }
      catch (error) { rollbacks.push(String(error)); throw error; }
    };
    products[0].description = "fixture rejection";
    products[0].variants[0].stock = 7;
    expect(await run(products)).toMatchObject({ synced: 1, stockChanges: 1, errors: [] });
    expect(rollbacks).toEqual([expect.stringContaining("fixture description failure")]);
    expect(fx.sql.prepare("SELECT wr_description FROM wr_products").get()?.wr_description).toBe("fixture rejection");
    expect(fx.sql.prepare("SELECT description FROM products").get()?.description).toBe(expectedDescription);
    expect(stock("var-000")).toBe(7);
  });

  it("refreshes stale managed parent aggregates after zero-missing, but leaves an unrelated manual parent alone", async () => {
    const initial = catalog(3);
    await run(initial);
    fx.sql.exec(`INSERT INTO products(name, slug, price, stock) VALUES('Manual','fixture-manual',900,77);
      UPDATE products SET price=9000, stock=77 WHERE wr_product_id IN ('prod-000','prod-002');`);
    // Parent 002 is outside the incoming slice, so only the final refresh can fix it.
    const parent = (id: string) => fx.sql.prepare("SELECT stock,price FROM products WHERE wr_product_id=?").get(id);
    expect(await run(initial.slice(0, 2), { maxProducts: 1 })).toMatchObject({ budgetYielded: true });
    expect(parent("prod-002")).toEqual({ stock: 77, price: 9000 });
    await run(initial.slice(0, 2), { maxProducts: 1 });
    expect(parent("prod-002")).toEqual({ stock: 77, price: 9000 });
    await run(initial.slice(0, 2));
    expect(parent("prod-002")).toMatchObject({ stock: 0 });
    expect(parent("prod-002")?.price).not.toBe(9000);
    expect(fx.sql.prepare("SELECT stock,price FROM products WHERE slug='fixture-manual'").get()).toEqual({ stock: 77, price: 900 });
  });

  it("publishes exactly one revision for a change, including display-only metadata; not for an identical sweep", async () => {
    const products = catalog(2);
    const revision = () => fx.sql.prepare("SELECT value FROM store_settings WHERE key='catalog_revision_market'").get()?.value;
    await run(products);
    expect(bump).toHaveBeenCalledOnce();
    const initial = revision();
    expect(initial).toEqual(expect.any(String));
    bump.mockClear();
    await run(products);
    expect(bump).not.toHaveBeenCalled();
    expect(revision()).toBe(initial);
    products[0].description = "changed description";
    expect(await run(products)).toMatchObject({ stockChanges: 0, priceChanges: 0, errors: [] });
    expect(bump).toHaveBeenCalledExactlyOnceWith("market", expect.anything());
    const changed = revision();
    expect(changed).toEqual(expect.any(String));
    expect(changed).not.toBe(initial);
    bump.mockClear();
    await run(products);
    expect(bump).not.toHaveBeenCalled();
    expect(revision()).toBe(changed);
  });

  it("applyOnly changes a supplied variant and explicit removal without sweeping other rows or writing sync logs/cursor", async () => {
    const products = catalog(4);
    await run(products, { maxProducts: 2 });
    const log = [logCount("wr"), logCount("sk")];
    const cursor = state("products_cursor");
    await run([], { applyOnly: { products: [products[2]], removedVariantIds: ["var-000"] }, maxProducts: 1 });
    expect(ids()).toEqual(["var-000", "var-001", "var-002"]);
    expect([stock("var-000"), stock("var-001"), stock("var-002")]).toEqual([0, 10, 10]);
    expect([logCount("wr"), logCount("sk"), state("products_cursor")]).toEqual([...log, cursor]);
    expect(state("diff_last_at")).toBeTruthy();
  });

  it("the real +800 ceiling lets a tiny-budget run finish; the same access without the hook yields", async () => {
    const products = catalog(10);
    const capped = createBudgetedDatabase(20, 2, fx.db);
    const plain = { ...capped.access } as typeof capped.access & { raiseCeilingForCatalogSync?: (n: number) => void };
    delete plain.raiseCeilingForCatalogSync;
    const partial = await syncProducts(plain, async () => products);
    expect(partial).toMatchObject({ budgetYielded: true, snapshotComplete: false });
    expect(partial.synced).toBeLessThan(10);
    const extended = createBudgetedDatabase(20, 2, fx.db);
    const remainingBefore = extended.remaining;
    expect(await syncProducts(extended.access, async () => products)).toMatchObject({ synced: 10 - partial.synced, budgetYielded: false, snapshotComplete: true, errors: [] });
    expect(extended.remaining + extended.used - remainingBefore).toBe(800);
    expect(extended.used).toBeGreaterThan(18);
    expect(ids()).toHaveLength(10);
  });
});
