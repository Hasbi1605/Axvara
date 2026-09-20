// Kuota tulis D1 (2026-09-20): sweep katalog berjalan tiap 5 menit. Sebelum
// guard bersyarat, satu sweep TANPA perubahan apa pun tetap menulis ~398 baris
// (96 wr_variants + 96 product_variants + 96 agregat products + 48 wr_products
// + 48 deskripsi) — terukur ~28k rows-written/hari dari kuota Free 100k, dan
// sejak 1 Sep 2026 kuota habis = query D1 DIBLOKIR (toko mati), bukan sekadar
// peringatan. Test ini mengunci dua sisi sekaligus: sweep tanpa perubahan
// nyaris tidak menulis, tapi perubahan nyata TETAP merambat ke tiga lapis.
import { describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "../helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { syncProducts } from "@/lib/warung-rebahan/sync";
import type { WrProduct } from "@/lib/warung-rebahan/client";

vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");

const PRODUCTS = 12;
const VARIANTS_PER = 2;

function catalog(stockShift = 0): WrProduct[] {
  return Array.from({ length: PRODUCTS }, (_, p) => ({
    id: `prod-${p}`,
    name: `Produk ${p}`,
    category: "Productivity",
    description: "desc",
    variants: Array.from({ length: VARIANTS_PER }, (_, v) => ({
      id: `var-${p}-${v}`,
      name: `Paket ${v + 1}`,
      price: 5000 + p * 100,
      duration: "30 Hari",
      type: "Private",
      warranty: "7 Hari",
      stock: 10 + (p === 0 && v === 0 ? stockShift : 0),
      terms: null,
      delivery_terms: null,
    })),
  }));
}

/** Hitung baris yang BENAR-BENAR berubah (meta.changes), bukan jumlah statement. */
function countRowWrites(fx: ReturnType<typeof createD1Fixture>) {
  const rows = { total: 0 };
  const origPrepare = fx.db.prepare.bind(fx.db);
  (fx.db as unknown as { prepare: unknown }).prepare = ((query: string) => {
    const verb = query.trim().slice(0, 6).toUpperCase();
    const statement = origPrepare(query);
    if (!/^(UPDATE|INSERT|DELETE)/.test(verb)) return statement;
    const wrap = (s: typeof statement): typeof statement => ({
      ...s,
      bind: (...values: unknown[]) => wrap(s.bind(...values)),
      run: async () => {
        const result = await s.run();
        rows.total += Number(result?.meta?.changes ?? 0);
        return result;
      },
    });
    return wrap(statement);
  }) as typeof fx.db.prepare;
  return rows;
}

describe("WR sync — kuota tulis D1", () => {
  it("sweep tanpa perubahan upstream tidak menulis ulang katalog", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      await syncProducts(db, async () => catalog()); // sweep dingin: membuat semua baris

      const rows = countRowWrites(fx);
      const result = await syncProducts(db, async () => catalog());

      expect(result.stockChanges).toBe(0);
      expect(result.priceChanges).toBe(0);
      // Sisa tulis yang sah: baris wr_sync_log + penanda wr_sync_state yang
      // memang berubah tiap run (cursor/generation/waktu). Tanpa guard
      // bersyarat angka ini = 5 × jumlah varian + produk (98 untuk fixture ini).
      expect(rows.total).toBeLessThanOrEqual(15);
    } finally {
      fx.close();
    }
  });

  it("perubahan stok nyata tetap merambat ke wr_variants, product_variants, dan agregat induk", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      await syncProducts(db, async () => catalog());
      const result = await syncProducts(db, async () => catalog(-7));

      expect(result.stockChanges).toBeGreaterThan(0);
      const variant = fx.sql
        .prepare("SELECT wr_stock FROM wr_variants WHERE wr_variant_id='var-0-0'")
        .get() as { wr_stock: number };
      const catalogVariant = fx.sql
        .prepare("SELECT stock FROM product_variants WHERE wr_variant_id='var-0-0'")
        .get() as { stock: number };
      const parent = fx.sql
        .prepare("SELECT stock FROM products WHERE wr_product_id='prod-0'")
        .get() as { stock: number };

      expect(Number(variant.wr_stock)).toBe(3);
      expect(Number(catalogVariant.stock)).toBe(3);
      // Agregat induk = varian ke-0 (3) + varian ke-1 (10).
      expect(Number(parent.stock)).toBe(13);
    } finally {
      fx.close();
    }
  });

  it("perubahan harga nyata memperbarui harga jual dan agregat induk", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      await syncProducts(db, async () => catalog());
      const before = fx.sql
        .prepare("SELECT price FROM product_variants WHERE wr_variant_id='var-0-0'")
        .get() as { price: number };

      const naikkan = catalog().map((product) =>
        product.id === "prod-0"
          ? {
              ...product,
              variants: product.variants.map((variant, index) =>
                index === 0 ? { ...variant, price: variant.price + 4000 } : variant,
              ),
            }
          : product,
      );
      const result = await syncProducts(db, async () => naikkan);

      expect(result.priceChanges).toBeGreaterThan(0);
      const after = fx.sql
        .prepare("SELECT price FROM product_variants WHERE wr_variant_id='var-0-0'")
        .get() as { price: number };
      expect(Number(after.price)).toBeGreaterThan(Number(before.price));
    } finally {
      fx.close();
    }
  });
});