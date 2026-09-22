// Round-trip D1 (2026-09-22): akar "sweep 32 detik untuk 13 produk" BUKAN
// kerja database — `sql_duration_ms` terukur di produksi hanya 0,12–0,19 ms.
// Yang mahal adalah JUMLAH round-trip berurutan: sweep lama mengirim 642 query
// satu per satu untuk 48 produk/87 varian, dan tiap query menyeberang ke D1
// primary di SIN (~197 ms), sehingga 99,9% durasi sweep adalah menunggu
// jaringan. Bukti beban IDENTIK di produksi: 8.551 ms (178 ms/produk) vs
// 122.473 ms (2.552 ms/produk) — selisih 14x tanpa perubahan kerja.
//
// Test ini mengunci tiga hal sekaligus, karena batching bisa salah di tiga
// arah berbeda: (1) round-trip benar-benar turun, (2) `batch()` adalah
// TRANSAKSI sehingga cakupannya wajib per-produk — satu produk gagal tidak
// boleh membatalkan produk lain, (3) perubahan nyata tetap merambat.
import { describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "../helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { syncProducts } from "@/lib/warung-rebahan/sync";
import type { WrProduct } from "@/lib/warung-rebahan/client";

vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");

/** Bentuk katalog produksi: 48 produk -> 87 varian (39 produk 2 varian, 9 produk 1). */
function catalog(stockShift = 0): WrProduct[] {
  return Array.from({ length: 48 }, (_, p) => ({
    id: `prod-${String(p).padStart(2, "0")}`,
    name: `Produk ${p}`,
    category: "Productivity",
    description: "desc",
    variants: Array.from({ length: p < 39 ? 2 : 1 }, (_, v) => ({
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

/**
 * Hitung ROUND-TRIP, bukan statement: satu `batch()` berisi 9 statement tetap
 * satu perjalanan jaringan — itulah metrik yang menentukan durasi sweep.
 */
function countRoundTrips(fx: ReturnType<typeof createD1Fixture>) {
  const counter = { trips: 0, statementsInBatches: 0 };
  const originalPrepare = fx.db.prepare.bind(fx.db);
  const originalBatch = fx.db.batch.bind(fx.db);
  (fx.db as unknown as { batch: unknown }).batch = async (statements: unknown[]) => {
    counter.trips++;
    counter.statementsInBatches += statements.length;
    return originalBatch(statements as Parameters<typeof originalBatch>[0]);
  };
  (fx.db as unknown as { prepare: unknown }).prepare = ((query: string) => {
    const statement = originalPrepare(query);
    const wrap = (s: typeof statement): typeof statement => ({
      ...s,
      bind: (...values: unknown[]) => wrap(s.bind(...values)),
      first: async () => { counter.trips++; return s.first(); },
      all: async () => { counter.trips++; return s.all(); },
      run: async () => { counter.trips++; return s.run(); },
    });
    return wrap(statement);
  }) as typeof fx.db.prepare;
  return counter;
}

describe("WR sync — round-trip D1", () => {
  it("sweep katalog penuh memakai batch, bukan ratusan query berurutan", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      await syncProducts(db, async () => catalog()); // sweep dingin

      const counter = countRoundTrips(fx);
      const result = await syncProducts(db, async () => catalog());

      expect(result.synced).toBe(48);
      expect(result.variantsSynced).toBe(87);
      // Sebelum batching: 642 round-trip. Ambang 200 memberi ruang tumbuh
      // tanpa membiarkan regresi ke pola satu-query-per-varian lolos.
      expect(counter.trips).toBeLessThan(200);
      // Bukti tulisnya memang dibundel, bukan round-trip yang hilang karena
      // pekerjaannya dilewati.
      expect(counter.statementsInBatches).toBeGreaterThan(200);
    } finally {
      fx.close();
    }
  });

  it("satu produk gagal tidak membatalkan produk lain (batch per-produk)", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      await syncProducts(db, async () => catalog());

      // `batch()` me-rollback SELURUH anggotanya saat satu statement gagal.
      // Kalau cakupan batch melebar ke seluruh sweep, sabotase satu varian
      // akan menelan perubahan stok 86 varian lainnya.
      fx.control.fail = (query, params) =>
        query.startsWith("UPDATE wr_variants") && params.includes("var-1-0");
      const result = await syncProducts(db, async () => catalog(-7));
      fx.control.fail = null;

      const stockOf = (id: string) =>
        Number(
          (
            fx.sql
              .prepare("SELECT wr_stock FROM wr_variants WHERE wr_variant_id=?")
              .get(id) as { wr_stock: number }
          ).wr_stock,
        );

      expect(result.errors.length).toBeGreaterThan(0);
      // Produk yang disabotase tidak berubah, produk lain TETAP tersync.
      expect(stockOf("var-1-0")).toBe(10);
      expect(stockOf("var-0-0")).toBe(3);
      expect(result.synced).toBe(48);
    } finally {
      fx.close();
    }
  });
  it("state DB jalur batch identik dengan jalur berurutan", async () => {
    // Bukti paling kuat bahwa batching murni optimasi: jalankan skenario yang
    // sama pada dua jalur eksekusi (batch vs execRun satu-per-satu, dipilih
    // dari ada/tidaknya `db.d1`) lalu bandingkan isi keempat tabel.
    const scenario = async (useBatch: boolean) => {
      const fx = createD1Fixture();
      try {
        const db = createDatabaseAccess(useBatch ? fx.db : null);
        if (!useBatch) (globalThis as unknown as { DB?: unknown }).DB = fx.db;
        await syncProducts(db, async () => catalog());
        await syncProducts(db, async () => catalog(-7)); // stok 10 -> 3
        const strip = (rows: unknown[]) =>
          JSON.stringify(
            rows.map((row) => {
              const { updated_at, last_synced_at, created_at, ...rest } =
                row as Record<string, unknown>;
              return rest;
            }),
          );
        return {
          wr_variants: strip(fx.sql.prepare("SELECT * FROM wr_variants ORDER BY wr_variant_id").all()),
          product_variants: strip(fx.sql.prepare("SELECT * FROM product_variants ORDER BY wr_variant_id").all()),
          products: strip(fx.sql.prepare("SELECT id,name,slug,price,stock,description FROM products ORDER BY id").all()),
          wr_products: strip(fx.sql.prepare("SELECT * FROM wr_products ORDER BY wr_product_id").all()),
        };
      } finally {
        fx.close();
      }
    };

    const batched = await scenario(true);
    const sequential = await scenario(false);
    for (const table of ["wr_variants", "product_variants", "products", "wr_products"] as const) {
      expect(batched[table], `tabel ${table} berbeda antara batch dan berurutan`).toBe(
        sequential[table],
      );
    }
  });
});
