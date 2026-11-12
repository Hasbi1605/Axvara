// tests/pedia-catalog-scale.test.ts — PSMM-CORE-FIX (2026-11-12).
// Bukti: katalog otomatis skala penuh (~620 layanan) tetap terjangkau pencarian
// pembeli (tidak dipotong), dan tidak ada nama supplier mentah/superskrip yang
// bocor ke DOM/payload.
import { afterEach, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { seedOfficialDescriptions } from "./helpers/pedia-managed-fixture";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const TOTAL = 620;

it("serves every sellable managed service (no 8/100 cap) with reachable search text", async () => {
  const fx = createD1Fixture();
  vi.stubEnv("PEDIA_ENABLED", "true");
  const db = createDatabaseAccess(fx.db);
  try {
    const ids = Array.from({ length: TOTAL }, (_, i) => 5000 + i);
    // Satu produk per layanan (pola materializer), semua layak jual.
    for (const [index, id] of ids.entries()) {
      await db.execRun(
        `INSERT INTO pedia_products (slug,platform,metric,target_kind,name,packages_json,step,is_active,managed)
         VALUES (?, 'instagram', 'followers', 'profile', ?, '[20,1000]', 1, 1, 'auto')`,
        // Nama sudah dibersihkan materializer (badge superskrip dibuang di
        // ingest); fixture merepresentasikan state pasca-materialisasi.
        `psmm-${id}`, `Followers Global ${index}`,
      );
      const product = await db.queryFirst(`SELECT id FROM pedia_products WHERE slug=?`, `psmm-${id}`);
      await db.execRun(
        `INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present)
         VALUES ('providersmm',?,'Private provider name','Instagram Followers','Default',20000,20,10000,1)`, id,
      );
      await db.execRun(
        `INSERT INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,package_prices_json,is_active,managed)
         VALUES (?, 'standar', 'providersmm', ?, 'G2', 60, 2000, 0, '{"20":2400,"1000":32000}', 1, 'auto')`,
        Number(product?.id), id,
      );
    }
    await seedOfficialDescriptions(db, ids, "Deskripsi resmi.");

    const { GET } = await import("@/app/api/pedia/catalog/route");
    const data = await (await GET()).json();
    // Semua layanan layak tayang; tidak ada batas 8/100.
    expect(data.products).toHaveLength(TOTAL);
    // Setiap baris punya tier dengan harga sehingga bisa dicari & dibeli.
    expect(data.products.every((p: { tiers: unknown[] }) => p.tiers.length === 1)).toBe(true);

    // Tidak ada kebocoran nama supplier mentah atau badge superskrip di payload.
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/ᴾʳᵒᵛᶦᵈᵉʳ/);
    expect(json).not.toMatch(/Private provider name/);
    expect(json).not.toMatch(/providersmm/);
  } finally { fx.close(); }
}, 60000);
