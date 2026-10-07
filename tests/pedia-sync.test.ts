// tests/pedia-sync.test.ts — PEDIA M1: diff providersmm → D1 (PD-30–33).
// Dikunci: upsert cermin, hitung ulang harga paket, guard margin (PD-32),
// layanan hilang → nonaktif (PD-33), idempoten, indeks dipakai (pola 0057).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { applyProvidersmmDiff } from "@/lib/pedia/sync";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const svc = (over: Record<string, unknown> = {}) => ({
  service_id: 86,
  name: "IG Followers",
  type: "Default",
  category: "IG",
  rate: 38750,
  min_qty: 100,
  max_qty: 1000,
  api_refill: 0,
  api_cancel: 0,
  api_dripfeed: 1,
  ...over,
});

async function seedProductTier(db: ReturnType<typeof createDatabaseAccess>) {
  await db.execRun(
    `INSERT INTO pedia_products (slug, platform, metric, target_kind, name, packages_json, step, is_active)
     VALUES ('followers-instagram','instagram','followers','profile','Followers Instagram','[100,250,500]',10,1)`,
  );
  const p = await db.queryFirst(`SELECT id FROM pedia_products WHERE slug='followers-instagram'`);
  await db.execRun(
    `INSERT INTO pedia_tiers (product_id, tier, supplier, supplier_service_id, price_group,
       markup_pct, min_profit_rp, refill_days, package_prices_json, is_active)
     VALUES (?, 'standar', 'providersmm', 86, 'G3', 20, 1000, 30, '{}', 1)`,
    Number(p?.id),
  );
  return Number(p?.id);
}

describe("diff providersmm PD-30–33", () => {
  it("upsert cermin + hitung ulang harga paket dari rate terkini", async () => {
    const { db: d1 } = createD1Fixture();
    const db = createDatabaseAccess(d1);
    await seedProductTier(db);
    const r = await applyProvidersmmDiff(db, [svc()], []);
    expect(r.upserted).toBe(1);
    expect(r.errors).toEqual([]);
    const row = await db.queryFirst(
      `SELECT * FROM pedia_supplier_services WHERE supplier='providersmm' AND service_id=86`,
    );
    expect(Number(row?.rate_idr_per_1k)).toBe(38750);
    // 250 @ rate 38750 G3 → 12000 (lihat pedia-pricing.test).
    const tier = await db.queryFirst(`SELECT * FROM pedia_tiers WHERE supplier_service_id=86`);
    expect(JSON.parse(String(tier?.package_prices_json))).toMatchObject({ "250": 12000 });
    expect(Number(tier?.is_active)).toBe(1);
  });

  it("PD-32: rate naik melewati margin → tingkat nonaktif + alasan margin", async () => {
    const { db: d1 } = createD1Fixture();
    const db = createDatabaseAccess(d1);
    await seedProductTier(db);
    await applyProvidersmmDiff(db, [svc()], []);
    const r = await applyProvidersmmDiff(db, [svc({ rate: 200000 })], []);
    expect(r.tiersAutoDisabled).toEqual([{ tierId: expect.any(Number), reason: "margin" }]);
    const tier = await db.queryFirst(`SELECT * FROM pedia_tiers WHERE supplier_service_id=86`);
    expect(Number(tier?.is_active)).toBe(0);
    expect(tier?.auto_disabled_reason).toBe("margin");
  });

  it("PD-33: layanan hilang → tingkat nonaktif + alasan service_missing", async () => {
    const { db: d1 } = createD1Fixture();
    const db = createDatabaseAccess(d1);
    await seedProductTier(db);
    await applyProvidersmmDiff(db, [svc()], []);
    const r = await applyProvidersmmDiff(db, [], [86]);
    expect(r.markedMissing).toBe(1);
    const tier = await db.queryFirst(`SELECT * FROM pedia_tiers WHERE supplier_service_id=86`);
    expect(Number(tier?.is_active)).toBe(0);
    expect(tier?.auto_disabled_reason).toBe("service_missing");
  });

  it("pulih TIDAK otomatis: rate kembali normal tidak mengaktifkan ulang", async () => {
    const { db: d1 } = createD1Fixture();
    const db = createDatabaseAccess(d1);
    await seedProductTier(db);
    await applyProvidersmmDiff(db, [svc()], []);
    await applyProvidersmmDiff(db, [svc({ rate: 200000 })], []);
    await applyProvidersmmDiff(db, [svc()], []);
    const tier = await db.queryFirst(`SELECT * FROM pedia_tiers WHERE supplier_service_id=86`);
    expect(Number(tier?.is_active)).toBe(0);
  });

  it("idempoten: diff sama dua kali tidak mengubah harga", async () => {
    const { db: d1 } = createD1Fixture();
    const db = createDatabaseAccess(d1);
    await seedProductTier(db);
    await applyProvidersmmDiff(db, [svc()], []);
    const before = await db.queryFirst(`SELECT package_prices_json FROM pedia_tiers WHERE supplier_service_id=86`);
    const r = await applyProvidersmmDiff(db, [svc()], []);
    expect(r.errors).toEqual([]);
    const after = await db.queryFirst(`SELECT package_prices_json FROM pedia_tiers WHERE supplier_service_id=86`);
    expect(after?.package_prices_json).toBe(before?.package_prices_json);
  });

  it("query polling memakai indeks (pola 0057, anti rows_read)", async () => {
    const { db: d1 } = createD1Fixture();
    const db = createDatabaseAccess(d1);
    const plans = await db.queryAll(
      `EXPLAIN QUERY PLAN SELECT * FROM pedia_order_items WHERE status IN ('submitted','in_progress') ORDER BY last_polled_at LIMIT 100`,
    );
    expect(JSON.stringify(plans)).toMatch(/idx_pedia_items_status/i);
    const plans2 = await db.queryAll(
      `EXPLAIN QUERY PLAN SELECT * FROM pedia_order_items WHERE target_normalized=? AND product_id=? AND status IN ('queued','submitting','submitted','in_progress')`,
      "https://www.instagram.com/x/", 1,
    );
    expect(JSON.stringify(plans2)).toMatch(/idx_pedia_items_target/i);
  });
});
