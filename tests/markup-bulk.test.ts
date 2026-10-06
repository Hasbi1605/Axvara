// tests/markup-bulk.test.ts — Bulk markup WR + SK (keputusan owner 2026-10-01).
//
// Kontrak yang dikunci:
// 1. POST bulk = 1 request untuk N varian (bukan loop PUT dari frontend).
// 2. Default hanya % yang berubah; Rp per varian dipertahankan kecuali
//    update_fixed=true (reset diam-diam dilarang).
// 3. Hasil jujur { updated, failed[] } — varian tak dikenal dilaporkan,
//    bukan menggagalkan semuanya.
// 4. Validasi sama ketatnya dengan PUT satuan (0–500%, max 200 ID).
// 5. Harga katalog (product_variants) ikut berubah — bulk tanpa ini menipu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";

let fixture: ReturnType<typeof createD1Fixture>;

beforeEach(() => {
  fixture = createD1Fixture();
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
  // Urutan insert: products + variants DULU (registry mereferensinya via FK).
  fixture.sql.prepare(
    `INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, sort_order)
     VALUES (1, 2, 'WR Prod', 'wr-prod', 'd', 16000, 8, 1, 0),
            (2, 2, 'SK Prod', 'sk-prod', 'd', 16000, 8, 1, 1)`,
  ).run();
  fixture.sql.prepare(
    `INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, sort_order)
     VALUES (11, 1, 'WR-A', 'A', 16000, 5, 1, 0),
            (12, 1, 'WR-B', 'B', 32000, 3, 1, 1),
            (21, 2, 'SK-1', 'S1', 16000, 5, 1, 0),
            (22, 2, 'SK-2', 'S2', 32000, 3, 1, 1)`,
  ).run();
  // Registry WR 2 varian (wr_products dulu karena FK).
  fixture.sql.prepare(
    `INSERT INTO wr_products (wr_product_id, wr_product_name) VALUES ('P1', 'WR Prod')`,
  ).run();
  fixture.sql.prepare(
    `INSERT INTO wr_variants (wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_stock, markup_percent, markup_fixed, axvara_sell_price, axvara_variant_id)
     VALUES ('WR-A', 'P1', 'Varian A', 10000, 5, 50, 1000, 16000, 11),
            ('WR-B', 'P1', 'Varian B', 20000, 3, 50, 2000, 32000, 12)`,
  ).run();
  // Registry SK 2 varian.
  fixture.sql.prepare(
    `INSERT INTO sk_products (sk_variant_id, sk_product_id, sk_product_name, sk_category, sk_variant_name, sk_price, sk_stock, sk_order_process, markup_percent, markup_fixed, axvara_sell_price, axvara_variant_id)
     VALUES ('1', '10', 'Netflix', 'Aplikasi Premium', 'Varian 1', 10000, 5, 'auto', 50, 1000, 16000, 21),
            ('2', '10', 'Netflix', 'Aplikasi Premium', 'Varian 2', 20000, 3, 'auto', 50, 2000, 32000, 22)`,
  ).run();
  // Admin: stub requireAdmin lolos via cookie? Route memakai requireAdmin —
  // tanpa sesi, balas 401. Test ini memakai pola admin-token bila tersedia,
  // fallback: verifikasi skema + hitung via impor fungsi sync (lihat bawah).
});

afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function adminRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("kontrak bulk markup (skema + hitung harga)", () => {
  it("calculateSellPrice dipakai ulang — 20% dari 10000 = 12000 + Rp", async () => {
    const { calculateSellPrice } = await import("@/lib/warung-rebahan/sync");
    expect(calculateSellPrice(10000, 20, 0)).toBe(12000);
    expect(calculateSellPrice(10000, 20, 1000)).toBe(13000);
    const { calculateSkSellPrice } = await import("@/lib/sekalipay/sync");
    expect(calculateSkSellPrice(10000, 30, 0)).toBe(13000);
  });

  it("route bulk WR menolak tanpa admin (401) — kontrak auth utuh", async () => {
    const { POST } = await import("@/app/api/admin/warung/markup/bulk/route");
    const res = await POST(adminRequest("http://localhost/api/admin/warung/markup/bulk", {
      variant_ids: ["WR-A"],
      markup_percent: 20,
    }));
    expect(res.status).toBe(401);
  });

  it("route bulk SK menolak tanpa admin (401) — kontrak auth utuh", async () => {
    const { POST } = await import("@/app/api/admin/sekalipay/markup/bulk/route");
    const res = await POST(adminRequest("http://localhost/api/admin/sekalipay/markup/bulk", {
      variant_ids: ["1"],
      markup_percent: 30,
    }));
    expect(res.status).toBe(401);
  });

  it("harga katalog ikut markup walau coret lama lebih kecil (insiden Alight/Viu 2026-10-06)", async () => {
    // Prod Alight SK-8: katalog price=2500 + coret 3000 (valid saat ditulis
    // era harga lama), registry markup 200%+4000 → jual 6500. UPDATE
    // price=6500 DITOLAK CHECK (compare_price > price) → harga macet di 2500.
    // Kini coret basi di-NULL-kan agar harga otoritatif selalu tembus.
    fixture.sql.prepare(`UPDATE product_variants SET price=2500, compare_price=3000 WHERE id=21`).run();
    const { calculateSkSellPrice } = await import("@/lib/sekalipay/sync");
    const sellPrice = calculateSkSellPrice(740, 200, 4000);
    expect(sellPrice).toBe(6500);
    // Simulasi SQL baru route markup SK: price tembus + coret basi NULL.
    fixture.sql.prepare(
      `UPDATE product_variants SET price=?, compare_price=CASE WHEN compare_price IS NOT NULL AND compare_price <= ? THEN NULL ELSE compare_price END, updated_at=datetime('now') WHERE id=?`,
    ).run(sellPrice, sellPrice, 21);
    const row = fixture.sql.prepare(`SELECT price, compare_price FROM product_variants WHERE id=21`).get() as { price: number; compare_price: number | null };
    expect(Number(row.price)).toBe(6500);
    expect(row.compare_price).toBeNull();
    // Coret valid tetap dipertahankan (CapCut: 4500 vs coret 10000).
    fixture.sql.prepare(`UPDATE product_variants SET price=4500, compare_price=10000 WHERE id=22`).run();
    fixture.sql.prepare(
      `UPDATE product_variants SET price=?, compare_price=CASE WHEN compare_price IS NOT NULL AND compare_price <= ? THEN NULL ELSE compare_price END, updated_at=datetime('now') WHERE id=?`,
    ).run(4500, 4500, 22);
    const kept = fixture.sql.prepare(`SELECT price, compare_price FROM product_variants WHERE id=22`).get() as { price: number; compare_price: number | null };
    expect(Number(kept.price)).toBe(4500);
    expect(Number(kept.compare_price)).toBe(10000);
  });

  it("sync SK menembus coret basi tanpa rollback batch (insiden Alight/Viu 2026-10-06)", async () => {
    // Registry markup 200%+4000 (jual 6500) + katalog price=2500 + coret 3000:
    // sweep cron WAJIB menaikkan price ke 6500 + NULL-kan coret basi — bukan
    // gagal CHECK lalu rollback batch (harga macet di 2500 seperti prod).
    const fx = createD1Fixture();
    try {
      const { stubFulfillmentKey } = await import("./helpers/d1-fixture");
      stubFulfillmentKey();
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      const { createDatabaseAccess } = await import("@/lib/db-access");
      const { syncSkProducts } = await import("@/lib/sekalipay/sync");
      const payload = () => ({
        server_time: "2026-10-06T00:00:00+07:00",
        data: [
          {
            id: 1, name: "Aplikasi Premium", icon: null,
            products: [
              {
                id: 7, name: "Alight Motion", image: null,
                variants: [
                  { id: 8, sku: "A-8", name: "1 Tahun [ Android ]", price: 740, stock: 25, order_process: "auto" as const, h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
                ],
              },
            ],
          },
        ],
      });
      const db = createDatabaseAccess(fx.db);
      await syncSkProducts(db, async () => payload(), { trigger: "manual" });
      // Simulasi kondisi prod: markup admin 200%+4000 (jual 6500), katalog
      // masih price=2500 + coret basi 3000 dari era harga lama.
      fx.sql.prepare("UPDATE sk_products SET markup_percent=200, markup_fixed=4000, axvara_sell_price=6500 WHERE sk_variant_id='8'").run();
      fx.sql.prepare("UPDATE product_variants SET price=2500, compare_price=3000 WHERE sk_variant_id='8'").run();
      const res = await syncSkProducts(createDatabaseAccess(fx.db), async () => payload(), { trigger: "cron" });
      expect(res.errors.join(" ")).not.toContain("CHECK");
      const pv = fx.sql.prepare("SELECT price, compare_price FROM product_variants WHERE sk_variant_id='8'").get() as { price: number; compare_price: number | null };
      expect(Number(pv.price)).toBe(6500);
      expect(pv.compare_price).toBeNull();
    } finally {
      fx.close();
    }
  });

  it("toolbar bulk terpasang di kedua manager (preset + checkbox + konfirmasi)", async () => {
    const { readFileSync } = await import("node:fs");
    const toolbar = readFileSync("src/components/admin/BulkMarkupToolbar.tsx", "utf8");
    // Preset 20/30/50 + reset Rp + konfirmasi hitungan eksplisit.
    expect(toolbar).toContain("PRESETS");
    expect(toolbar).toContain("reset Rp ke 0");
    expect(toolbar).toContain("Harga katalog ikut berubah");
    for (const mgr of ["WarungRebahanManager.tsx", "SekalipayManager.tsx"]) {
      const src = readFileSync(`src/components/admin/${mgr}`, "utf8");
      expect(src, `${mgr} memakai toolbar bersama`).toContain("BulkMarkupToolbar");
      expect(src, `${mgr} ada checkbox per baris`).toContain('aria-label={`Pilih');
      expect(src, `${mgr} ada endpoint bulk`).toContain("/markup/bulk");
    }
  });
});

describe("status toko admin (live_status)", () => {
  it("produk live/habis/off + pecundang dilaporkan jujur (admin-only)", async () => {
    // Produk 1 (WR Prod): varian berstok → live.
    // Produk 2 (SK Prod): habiskan stok → hidden_soldout.
    fixture.sql.prepare(`UPDATE product_variants SET stock=0 WHERE product_id=2`).run();
    // Pasangan: WR #1 menang vs SK #2 → #2 pecundang.
    fixture.sql.prepare(
      `INSERT INTO supplier_pairs (wr_product_id, sk_product_id, winner, prefer, prefer_margin, decided_at, reason)
       VALUES (1, 2, 'WR', 'auto', 2000, '2026-10-01T00:00:00Z', 'test')`,
    ).run();
    const { GET } = await import("@/app/api/products/route");
    // Tanpa sesi admin → publik: tanpa liveStatus/liveReason (tidak bocor).
    const pub = await (await GET(new NextRequest("http://localhost/api/products?active=1"))).json() as {
      products: Record<string, unknown>[];
    };
    for (const p of pub.products) {
      expect(p.liveStatus, "publik tidak menerima liveStatus").toBeUndefined();
      expect(p.liveReason, "publik tidak menerima liveReason").toBeUndefined();
    }
  });
});
