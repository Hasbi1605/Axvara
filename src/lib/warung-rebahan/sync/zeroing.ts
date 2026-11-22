// sync/zeroing.ts - stock zeroing + aggregate refresh (3D-5, class E: pure move).
import type { DatabaseAccess } from "@/lib/db-access";
import type { Row } from "./types";
import { PREFETCH_PARAM_CHUNK } from "./constants";
import { chunked, placeholders } from "./writes";
import { refreshParentAggregates } from "./variant";

/**
 * Varian WR yang hilang dari respons API: set stock=0 (bukan delete).
 * WR bisa hide/unhide sementara; sync berikutnya memulihkan otomatis.
 *
 * WR3: baris `jaspay:%` TIDAK PERNAH disentuh sweep premium (sync Jaspay
 * punya seen-set sendiri). Filter eksplisit agar feed premium yang tak
 * membawa Jaspay tidak me-nol-kan katalog Jaspay.
 */
export async function zeroMissingVariants(
  seenVariantIds: Set<string>,
  db: DatabaseAccess,
): Promise<number> {
  const { queryAll, execRun } = db;
  const rows = await queryAll(
    // Hanya baris yang masih punya stok (registry atau katalog) — yang sudah
    // 0 tidak ditulis ulang tiap sweep (hemat tulis D1 + durasi potongan).
    `SELECT w.wr_variant_id, w.axvara_variant_id FROM wr_variants w
     LEFT JOIN product_variants pv ON pv.id = w.axvara_variant_id
     WHERE w.is_active=1 AND w.wr_variant_id NOT LIKE 'jaspay:%'
       AND (w.wr_stock > 0 OR COALESCE(pv.stock, 0) > 0)`,
  ).catch(() => [] as Row[]);
  let zeroed = 0;
  for (const row of rows) {
    const id = String(row.wr_variant_id || "");
    if (!id || seenVariantIds.has(id)) continue;
    await execRun(
      `UPDATE wr_variants SET wr_stock=0, last_synced_at=?, updated_at=?
       WHERE wr_variant_id=?`,
      new Date().toISOString(),
      new Date().toISOString(),
      id,
    );
    const axvaraVariantId =
      row.axvara_variant_id != null ? Number(row.axvara_variant_id) : 0;
    if (axvaraVariantId > 0) {
      await execRun(
        `UPDATE product_variants SET stock=0, updated_at=datetime('now') WHERE EXISTS(SELECT 1 FROM products archive_parent WHERE archive_parent.id=product_variants.product_id AND archive_parent.archived_at IS NULL) AND id=?`,
        axvaraVariantId,
      ).catch(() => ({ changes: 0 }));
    }
    zeroed++;
  }
  return zeroed;
}

/**
 * Nol-kan varian WR tertentu (mode diff: dihapus upstream). Hanya baris yang
 * masih berstok; agregat induk produk terdampak disegarkan.
 *
 * WR3: ID `jaspay:%` diabaikan di sini (milik sync Jaspay); ID premium di
 * sync Jaspay diabaikan di sana. Tidak ada zero lintas-famili.
 */
export async function zeroVariantsByIds(ids: string[], db: DatabaseAccess): Promise<number> {
  const unique = [...new Set(ids.map(String).filter((id) => id.length > 0 && !id.startsWith("jaspay:")))].slice(0, 200);
  if (!unique.length) return 0;
  const rows: Row[] = [];
  for (const part of chunked(unique, PREFETCH_PARAM_CHUNK)) {
    const chunkRows = await db.queryAll(
      `SELECT w.wr_variant_id, w.axvara_variant_id, pv.product_id FROM wr_variants w
       LEFT JOIN product_variants pv ON pv.id = w.axvara_variant_id
       WHERE w.is_active=1 AND w.wr_variant_id IN (${placeholders(part.length)})
         AND (w.wr_stock > 0 OR COALESCE(pv.stock, 0) > 0)`,
      ...part,
    );
    rows.push(...chunkRows);
  }
  const now = new Date().toISOString();
  const parents = new Set<number>();
  for (const row of rows) {
    await db.execRun(
      `UPDATE wr_variants SET wr_stock=0, last_synced_at=?, updated_at=? WHERE wr_variant_id=?`,
      now, now, String(row.wr_variant_id),
    );
    const vid = row.axvara_variant_id != null ? Number(row.axvara_variant_id) : 0;
    if (vid > 0) {
      await db.execRun(
        `UPDATE product_variants SET stock=0, updated_at=datetime('now') WHERE EXISTS(SELECT 1 FROM products archive_parent WHERE archive_parent.id=product_variants.product_id AND archive_parent.archived_at IS NULL) AND id=?`,
        vid,
      );
    }
    if (row.product_id != null) parents.add(Number(row.product_id));
  }
  for (const productId of parents) {
    if (productId > 0) await refreshParentAggregates(productId, db).catch(() => undefined);
  }
  return rows.length;
}

/** Refresh agregat semua produk WR (dipanggil setelah zero-missing). */
export async function refreshAllParentAggregates(db: DatabaseAccess): Promise<void> {
  const rows = await db
    .queryAll(`SELECT DISTINCT product_id FROM product_variants WHERE wr_auto_managed=1`)
    .catch(() => [] as Row[]);
  for (const row of rows) {
    const productId = Number(row.product_id || 0);
    if (productId > 0 && db.canSpend(2)) {
      await refreshParentAggregates(productId, db);
    }
  }
}
