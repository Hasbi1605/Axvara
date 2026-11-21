import type { DatabaseAccess } from "@/lib/db-access";
import type { SqlWrite } from "./types";

/**
 * Kirim sekumpulan tulis. Dengan D1 nyata seluruh tulis satu produk pergi
 * sebagai SATU `batch()` — itulah sumber penghematan round-trip.
 *
 * Cakupan batch SENGAJA per produk, bukan per sweep: `batch()` adalah
 * transaksi, jadi satu produk bermasalah tidak boleh membatalkan produk lain
 * (jalur berurutan lama mencatat error per produk lalu lanjut — sifat itu
 * wajib dipertahankan).
 *
 * Bila batch gagal, tulis diulang satu per satu supaya `optional`
 * kembali bersifat toleran persis seperti sebelum batching: di batch, satu
 * statement gagal me-rollback semuanya, termasuk tulis wajib yang tadinya
 * sukses.
 */
export async function runWrites(writes: SqlWrite[], db: DatabaseAccess): Promise<boolean> {
  if (!writes.length) return false;
  const d1 = db.d1;
  if (d1 && writes.length > 1) {
    try {
      const results = await d1.batch(writes.map((write) => d1.prepare(write.sql).bind(...write.params)));
      return writes.some((write, idx) => write.catalogDisplay && Number(results?.[idx]?.meta?.changes ?? 0) > 0);
    } catch {
      /* turun ke jalur berurutan di bawah */
    }
  }
  let catalogChanged = false;
  for (const write of writes) {
    // Pra-migrasi 0060 (kolom wr_delivery_mode BELUM ada di D1 prod) TIDAK
    // BOLEH meruntuhkan seluruh produk: statement yang menyentuh kolom baru
    // memakai fallback tanpa kolom itu. Statement lain tanpa fallback tetap
    // naik bila gagal agar sync tercatat failed, bukan hilang diam-diam.
    let res: { changes?: number } = { changes: 0 };
    if (write.optional) {
      res = await db.execRun(write.sql, ...write.params).catch(() => ({ changes: 0 }));
    } else if (write.preMigrationFallback) {
      try {
        res = await db.execRun(write.sql, ...write.params);
      } catch {
        const fb = write.preMigrationFallback;
        res = await db.execRun(fb.sql, ...fb.params);
      }
    } else {
      res = await db.execRun(write.sql, ...write.params);
    }
    if (write.catalogDisplay && Number(res?.changes ?? 0) > 0) catalogChanged = true;
  }
  return catalogChanged;
}

/** `?,?,?` sebanyak n. */
export function placeholders(count: number): string {
  return new Array(count).fill("?").join(",");
}

export function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
