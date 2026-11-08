import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { syncGamesCatalog } from "@/lib/games/catalog-sync";
import { createD1Fixture } from "./helpers/d1-fixture";

const item = (sku: string, over: Record<string, unknown> = {}) => ({
  buyer_sku_code: sku, product_name: `Produk ${sku}`, category: "Games", brand: "MOBILE LEGENDS", type: "Umum",
  price: 10000, buyer_product_status: true, seller_product_status: true, unlimited_stock: true, stock: 0, multi: false,
  start_cut_off: "00:00", end_cut_off: "00:00", desc: "deskripsi", ...over,
});
const priceList = (rows: unknown[]) => vi.fn(async () => new Response(JSON.stringify({ data: rows }), { status: 200 }));

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("DIGIFLAZZ_USERNAME", "u");
  vi.stubEnv("DIGIFLAZZ_API_KEY", "k");
  vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.test");
  vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "t");
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const db = () => createDatabaseAccess(fx.db);
const row = (sku: string) => fx.sql.prepare("SELECT * FROM games_products WHERE buyer_sku_code=?").get(sku) as Record<string, unknown> | undefined;
const T0 = Date.UTC(2026, 10, 9, 10, 0, 0);

describe("syncGamesCatalog", () => {
  it("is a no-op without credentials and does not touch fetch or settings", async () => {
    vi.stubEnv("DIGIFLAZZ_API_KEY", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await syncGamesCatalog(db(), { now: T0 })).toEqual({ skipped: "not_configured" });
    expect(f).not.toHaveBeenCalled();
    expect(fx.sql.prepare("SELECT 1 FROM store_settings WHERE key='games_catalog_sync_at'").get()).toBeUndefined();
  });

  it("inserts Games rows only, computing sell_price from cost (floor, no reference)", async () => {
    vi.stubGlobal("fetch", priceList([
      item("ml86", { price: 19500, stock: "5", unlimited_stock: false, multi: true, start_cut_off: "23:45", end_cut_off: "00:15" }),
      item("pulsa1", { category: "Pulsa" }),
      item("ml5", { category: " games ", seller_product_status: false }),
    ]));
    const r = await syncGamesCatalog(db(), { now: T0 });
    expect(r).toMatchObject({ ok: true, games: 2, upserted: 2, deactivated: 0 });
    expect(row("pulsa1")).toBeUndefined();
    expect(row("ml86")).toMatchObject({
      game_brand: "MOBILE LEGENDS", product_type: "Umum", product_name: "Produk ml86", cost: 19500, seller_active: 1,
      unlimited_stock: 0, stock: 5, multi: 1, start_cut_off: "23:45", end_cut_off: "00:15", description: "deskripsi",
      sell_price: Math.ceil(19500 * 1.03), enabled: 0, reference_price: null, backup_sku_code: null,
    });
    expect(row("ml86")!.synced_at).toBe(new Date(T0).toISOString());
    expect(row("ml5")).toMatchObject({ seller_active: 0 });
  });

  it("updates existing rows, preserves enabled/reference_price, and recomputes sell_price using the reference", async () => {
    fx.sql.exec(`INSERT INTO games_products(buyer_sku_code,product_name,cost,reference_price,enabled,sell_price) VALUES('ml86','old',1,20000,1,5)`);
    vi.stubGlobal("fetch", priceList([item("ml86", { price: 15000, product_name: "ML 86 DM" })]));
    await syncGamesCatalog(db(), { now: T0 });
    expect(row("ml86")).toMatchObject({ product_name: "ML 86 DM", cost: 15000, reference_price: 20000, enabled: 1, sell_price: 19600 });
    expect(fx.sql.prepare("SELECT COUNT(*) c FROM games_products").get()).toEqual({ c: 1 });
  });

  it("maps b-suffixed codes onto the base row when the base exists; orphan b codes stay products", async () => {
    vi.stubGlobal("fetch", priceList([
      item("ml86", { price: 19500 }),
      item("ml86b", { price: 19900, seller_product_status: true }),
      item("ff140b", { price: 1000 }),
    ]));
    const r = await syncGamesCatalog(db(), { now: T0 });
    expect(r).toMatchObject({ ok: true, upserted: 2, backups_linked: 1 });
    expect(row("ml86b")).toBeUndefined();
    expect(row("ml86")).toMatchObject({ backup_sku_code: "ml86b", backup_cost: 19900, backup_seller_active: 1 });
    expect(row("ff140b")).toMatchObject({ backup_sku_code: null });
    // backup becomes inactive upstream, then disappears: base keeps its code but is marked inactive
    vi.stubGlobal("fetch", priceList([item("ml86", { price: 19500 }), item("ml86b", { seller_product_status: false })]));
    await syncGamesCatalog(db(), { now: T0 + 10 * 60_000 });
    expect(row("ml86")).toMatchObject({ backup_sku_code: "ml86b", backup_seller_active: 0 });
    vi.stubGlobal("fetch", priceList([item("ml86", { price: 19500 }), item("ff140b")]));
    await syncGamesCatalog(db(), { now: T0 + 20 * 60_000 });
    expect(row("ml86")).toMatchObject({ backup_sku_code: "ml86b", backup_seller_active: 0 });
  });

  it("marks previously synced rows missing from the list inactive, leaving never-synced rows alone", async () => {
    vi.stubGlobal("fetch", priceList([item("a1"), item("a2", { price: 20000 })]));
    await syncGamesCatalog(db(), { now: T0 });
    fx.sql.exec(`INSERT INTO games_products(buyer_sku_code,product_name,seller_active) VALUES('manual','m',1)`);
    vi.stubGlobal("fetch", priceList([item("a1")]));
    const r = await syncGamesCatalog(db(), { now: T0 + 10 * 60_000 });
    expect(r).toMatchObject({ ok: true, deactivated: 1 });
    expect(row("a1")).toMatchObject({ seller_active: 1 });
    expect(row("a2")).toMatchObject({ seller_active: 0, backup_seller_active: 0 });
    expect(row("manual")).toMatchObject({ seller_active: 1 });
  });

  it("changes nothing when price-list fails, is empty, or is not Games", async () => {
    vi.stubGlobal("fetch", priceList([item("a1")]));
    await syncGamesCatalog(db(), { now: T0 });
    for (const f of [
      vi.fn(async () => new Response(JSON.stringify({ data: { rc: "83", message: "Rate limit" } }), { status: 200 })),
      vi.fn(async () => new Response("", { status: 502 })),
      priceList([item("p", { category: "Pulsa" })]),
    ]) {
      vi.stubGlobal("fetch", f);
      const r = await syncGamesCatalog(db(), { now: T0, force: true });
      expect(r).toMatchObject({ ok: false });
      expect(row("a1")).toMatchObject({ seller_active: 1 });
    }
  });

  it("throttles to one run per window, honours force, and claims atomically", async () => {
    const f = priceList([item("a1")]);
    vi.stubGlobal("fetch", f);
    expect(await syncGamesCatalog(db(), { now: T0 })).toMatchObject({ ok: true });
    expect(await syncGamesCatalog(db(), { now: T0 + 5 * 60_000 })).toEqual({ skipped: "throttled" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(await syncGamesCatalog(db(), { now: T0 + 5 * 60_000, force: true })).toMatchObject({ ok: true });
    expect(f).toHaveBeenCalledTimes(2);
    expect(await syncGamesCatalog(db(), { now: T0 + 5 * 60_000 + 10 * 60_000 })).toMatchObject({ ok: true });
    // A concurrent isolate that read the old value loses the CAS.
    const stale = createDatabaseAccess(fx.db);
    const realFirst = stale.queryFirst;
    let first = true;
    stale.queryFirst = async (q, ...p) => {
      const out = await realFirst(q, ...p);
      if (first && q.includes("store_settings")) { first = false; fx.sql.prepare("UPDATE store_settings SET value='999' WHERE key='games_catalog_sync_at'").run(); }
      return out;
    };
    expect(await syncGamesCatalog(stale, { now: T0 + 60 * 60_000 })).toEqual({ skipped: "claimed_elsewhere" });
  });

  it("stays within the cron statement budget for ~600 rows", async () => {
    const rows = Array.from({ length: 600 }, (_, i) => item(`ml${i}`, { price: 1000 + i }));
    vi.stubGlobal("fetch", priceList(rows));
    fx.control.queries = 0;
    const r = await syncGamesCatalog(db(), { now: T0 });
    expect(r).toMatchObject({ ok: true, upserted: 600 });
    expect(fx.control.queries).toBeLessThanOrEqual(25);
    expect(fx.sql.prepare("SELECT COUNT(*) c FROM games_products").get()).toEqual({ c: 600 });
  });
});
