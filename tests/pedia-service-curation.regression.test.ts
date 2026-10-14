// tests/pedia-service-curation.regression.test.ts — Rebuild kurasi Pedia 2026-10-14.
//
// Mengunci model baru yang diminta owner:
// 1. Banyak layanan per produk (plafon UNIQUE(product,tier) 3-nama hilang):
//    dua layanan supplier berbeda pada produk yang sama sama-sama tampil.
// 2. Katalog memuat kurasi publik (public_name/description/atribut/harga
//    per 1.000) TANPA membocorkan identitas supplier/rate mentah (AC-16).
// 3. Order jumlah BEBAS di luar paket tersimpan diterima quote (harga dari
//    rate live), selama di dalam min–max layanan.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function seed() {
  const fixture = createD1Fixture();
  vi.stubEnv("PEDIA_ENABLED", "true");
  vi.stubEnv("PEDIA_ORDERS_ENABLED", "true");
  vi.stubEnv("ADMIN_JWT_SECRET", "curation-test-secret");
  const db = createDatabaseAccess(fixture.db);
  await db.execRun(`INSERT INTO pedia_products (slug, platform, metric, target_kind, name, packages_json, step, is_active)
    VALUES ('followers-instagram','instagram','followers','profile','Followers Instagram','[100,250,500]',1,1)`);
  const product = await db.queryFirst("SELECT id FROM pedia_products WHERE slug='followers-instagram'");
  const pid = Number(product?.id);
  const svc = async (id: number, rate: number, min: number, max: number) => {
    await db.execRun(`INSERT INTO pedia_supplier_services (supplier,service_id,name,type,category,rate_idr_per_1k,min_qty,max_qty,present)
      VALUES ('providersmm',?,'NAMA MENTAH SUPPLIER','Default','IG',?,?,?,1)`, id, rate, min, max);
  };
  await svc(11, 20000, 100, 10000);
  await svc(12, 8000, 10, 5000);
  await svc(13, 50000, 50, 2000);
  const tier = async (serviceId: number, name: string, rec: number, region: string, prices: string) => {
    await db.execRun(`INSERT INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,package_prices_json,is_active,public_name,description_md,region,quality,is_recommended,sort_order)
      VALUES (?,?, 'providersmm', ?, 'G2', 60, 1000, 30, ?, 1, ?, 'Deskripsi bahasa manusia.', ?, 'standar', ?, 10)`,
    pid, serviceId === 11 ? "hemat" : serviceId === 12 ? "standar" : "premium", serviceId, prices, name, region, rec);
  };
  await tier(11, "Followers Indonesia Refill 30 Hari", 1, "indonesia", '{"100":3400,"250":6000}');
  await tier(12, "Followers Global Ekonomis", 0, "global", '{"100":1500}');
  await tier(13, "Followers Real Premium", 0, "global", '{"100":9000}');
  return { db, fixture, pid };
}

describe("kurasi layanan Pedia (rebuild 2026-10-14)", () => {
  it("banyak layanan per produk tampil; rekomendasi lebih dulu; tanpa bocor supplier", async () => {
    const { db } = await seed();
    const { GET } = await import("@/app/api/pedia/catalog/route");
    const data = await (await GET()).json();
    expect(data.products).toHaveLength(1);
    const tiers = data.products[0].tiers as Record<string, unknown>[];
    expect(tiers).toHaveLength(3);
    expect(tiers[0]).toMatchObject({ public_name: "Followers Indonesia Refill 30 Hari", recommended: true, region: "indonesia" });
    expect(tiers[0].price_per_1k).toBeGreaterThan(20000);
    expect(JSON.stringify(data)).not.toMatch(/NAMA MENTAH|supplier_service_id|rate_snapshot|markup/);
    void db;
  });

  it("quote menerima jumlah bebas di luar paket (harga dari rate live)", async () => {
    const { db } = await seed();
    const tierRow = await db.queryFirst("SELECT id FROM pedia_tiers WHERE supplier_service_id=12");
    const { POST } = await import("@/app/api/pedia/quote/route");
    const req = new Request("http://x/api/pedia/quote", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.99" },
      body: JSON.stringify({ product_id: 1, tier_id: Number(tierRow?.id), quantity: 333, target: "https://instagram.com/buyer" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { total: number };
    // rate 8.000/1K, markup 60% -> per unit 12,8; 333 x 12,8 = 4.262 -> dibulatkan 4.300.
    expect(body.total).toBe(4300);
    // Di luar min–max tetap ditolak.
    const bad = await POST(new Request("http://x/api/pedia/quote", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.98" },
      body: JSON.stringify({ product_id: 1, tier_id: Number(tierRow?.id), quantity: 5, target: "https://instagram.com/buyer" }),
    }) as never);
    expect(bad.status).toBe(422);
  });

  it("migrasi 0062 mempertahankan id tier yang dirujuk order lama", async () => {
    const { db } = await seed();
    const tiers = await db.queryAll("SELECT id FROM pedia_tiers ORDER BY id");
    expect(tiers.map((t) => Number(t.id))).toEqual([1, 2, 3]);
    const unique = await db.queryFirst(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='pedia_tiers'`,
    );
    expect(String(unique?.sql)).toContain("UNIQUE(product_id, supplier, supplier_service_id)");
    expect(String(unique?.sql)).not.toContain("UNIQUE(product_id, tier)");
  });
});
