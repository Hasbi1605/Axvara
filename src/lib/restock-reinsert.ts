import type { DatabaseAccess } from "@/lib/db-access";
import { reinsertionKey } from "@/lib/product-order";

/**
 * Selipkan produk yang baru restok kembali ke sekitar posisi semula
 * (2026-10-02, keputusan owner).
 *
 * Dipanggil SETELAH batch tulis stok per produk selesai (agregat parent
 * sudah final), dan HANYA bila produk itu transisi habis → ready:
 * - stok parent SEBELUM batch = 0 (atau tidak buyable) — dibaca dari snapshot
 *   yang disuplai pemanggil (prefetch / outcome), bukan SELECT baru;
 * - stok parent SESUDAH batch > 0 (atau -1) — dibaca via 1 SELECT agregat.
 *
 * Bila transisi terkonfirmasi: baca daftar sort_order produk ready lain
 * (1 SELECT), hitung kunci selipan via reinsertionKey(), tulis 1 UPDATE
 * hanya bila berbeda. Total biaya saat transisi: 2 query + 1 write.
 * Bila bukan transisi: 0 query tambahan.
 *
 * Guard budget: pemanggil wajib cek canSpend(3) dulu (cermin admission sync).
 */
export async function maybeReinsertRestockedProduct(
  db: DatabaseAccess,
  productId: number,
  parentWasEmpty: boolean,
): Promise<{ reinserted: boolean; oldKey: number; newKey: number }> {
  const noop = { reinserted: false, oldKey: 0, newKey: 0 };
  if (!parentWasEmpty || !(productId > 0)) return noop;
  // Stok parent SESUDAH batch (final): agregat varian aktif.
  const after = await db
    .queryFirst(
      `SELECT p.stock AS parent_stock, p.sort_order AS parent_order, p.is_active AS parent_active
       FROM products p WHERE p.id=?`,
      productId,
    )
    .catch(() => null);
  if (!after) return noop;
  const parentStock = Number(after.parent_stock ?? 0);
  const isReady = parentStock === -1 || parentStock > 0;
  // Bukan transisi habis→ready (masih habis / nonaktif) → diam.
  if (!isReady || Number(after.parent_active ?? 1) !== 1) return noop;
  const oldKey = Number(after.parent_order ?? 0);
  // Daftar kunci yang ditempati produk AKTIF lain (ready + habis — yang
  // habis tidak tampil tapi key-nya tetap ditempati). Pecundang pasangan
  // tetap dihitung sebagai tetangga dengan alasan yang sama. Nonaktif
  // dikecualikan: mereka di bucket paling belakang dan tidak tampil.
  const rows = await db
    .queryAll(
      `SELECT sort_order FROM products WHERE id != ? AND is_active=1`,
      productId,
    )
    .catch(() => [] as { sort_order?: unknown }[]);
  const takenKeys = rows.map((row) => Number(row.sort_order ?? 0)).filter((key) => Number.isFinite(key));
  const newKey = reinsertionKey(oldKey, takenKeys);
  if (newKey === oldKey) return { reinserted: false, oldKey, newKey };
  await db
    .execRun(`UPDATE products SET sort_order=?, updated_at=datetime('now') WHERE id=?`, newKey, productId)
    .catch(() => ({ changes: 0 }));
  return { reinserted: true, oldKey, newKey };
}
