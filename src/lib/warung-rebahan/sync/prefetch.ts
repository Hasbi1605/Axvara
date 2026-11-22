// sync/prefetch.ts - bulk prefetch (3D-5, class E: pure move from sync.ts).
import type { DatabaseAccess } from "@/lib/db-access";
import type { Row } from "./types";
import { PREFETCH_PARAM_CHUNK } from "./constants";
import { chunked, placeholders } from "./writes";

/**
 * Ambil SEMUA baris `wr_variants` yang dibutuhkan sweep ini dalam beberapa
 * query `IN (...)`, bukan satu SELECT per varian.
 *
 * Ini separuh penghematan round-trip: sweep lama menembak 1 SELECT per varian
 * (87 round-trip untuk katalog penuh) hanya untuk membaca harga/stok/markup
 * lama sebagai pembanding. Dipotong per 50 id karena D1 menolak query dengan
 * lebih dari 100 bound parameter.
 */
export async function prefetchVariantRows(
  wrVariantIds: string[],
  db: DatabaseAccess,
): Promise<Map<string, Row>> {
  const map = new Map<string, Row>();
  if (!wrVariantIds.length) return map;
  for (const chunk of chunked(wrVariantIds, PREFETCH_PARAM_CHUNK)) {
    const rows = await db
      .queryAll(
        // Kolom PERSIS sama dengan SELECT per-varian yang digantikan — jangan
        // tambah kolom. `wr_product_name` sengaja TIDAK diambil (tidak ada
        // pemakai di planner; kelas kini murni dari delivery_mode API).
        `SELECT id, wr_variant_id, wr_variant_name, wr_price, wr_stock, markup_percent,
                markup_fixed, axvara_variant_id, axvara_sell_price
         FROM wr_variants WHERE wr_variant_id IN (${placeholders(chunk.length)})`,
        ...chunk,
      )
      .catch(() => [] as Row[]);
    for (const row of rows) {
      const id = String(row.wr_variant_id || "");
      if (id) map.set(id, row);
    }
  }
  return map;
}

/**
 * Ambil baris registri produk + verifikasi tautan katalognya sekaligus.
 *
 * Menggantikan 2 SELECT berurutan per produk (`wr_products` lalu guard link
 * yatim di `products`). `catalog_id` hanya terisi bila tautannya benar-benar
 * masih hidup — syarat yang sama dengan guard lama
 * (`id=? AND source='warung_rebahan' AND wr_product_id=?`), sehingga tautan
 * yatim tetap jatuh ke jalur pembuatan pasangan baru.
 */
export async function prefetchProductRows(
  wrProductIds: string[],
  db: DatabaseAccess,
): Promise<Map<string, { linked: number; catalogAlive: boolean }>> {
  const map = new Map<string, { linked: number; catalogAlive: boolean }>();
  if (!wrProductIds.length) return map;
  for (const chunk of chunked(wrProductIds, PREFETCH_PARAM_CHUNK)) {
    const rows = await db
      .queryAll(
        `SELECT wp.wr_product_id, wp.axvara_product_id, wp.is_excluded, p.id AS catalog_id
         FROM wr_products wp
         LEFT JOIN products p
           ON p.id = wp.axvara_product_id
          AND p.source = 'warung_rebahan'
          AND p.wr_product_id = wp.wr_product_id
         WHERE wp.wr_product_id IN (${placeholders(chunk.length)})`,
        ...chunk,
      )
      .catch(() => [] as Row[]);
    for (const row of rows) {
      const id = String(row.wr_product_id || "");
      if (!id) continue;
      map.set(id, {
        linked: row.axvara_product_id != null ? Number(row.axvara_product_id) : 0,
        catalogAlive: row.catalog_id != null,
      });
    }
  }
  return map;
}
