// src/lib/warung-rebahan/sync/product.ts — WR product registry/catalog
// writes (3D-3, class E: pure move from sync.ts; MAP-1 (a) section 6 step 3).
//
// Verbatim bodies: planLinkedProductWrites (hot-path planner),
// upsertWrProduct (registry upsert), createAxvaraCatalogForWr (catalog
// creation). SQL, bind order, branch order, batching via runWrites, and
// admin-owned columns (name/descriptions/overrides) are unchanged. The
// barrel specifier @/lib/warung-rebahan/sync re-exports upsertWrProduct.

import type { DatabaseAccess } from "@/lib/db-access";
import type { WrProduct } from "../client";
import { generateProductSlug, mapWrCategory } from "./pricing";
import type { SqlWrite } from "./types";
import { runWrites } from "./writes";

/**
 * Rencanakan tulis untuk produk yang SUDAH terdaftar, punya pasangan katalog
 * hidup, dan tidak di-exclude — jalur terpanas (48 dari 48 produk pada sweep
 * normal). Nol round-trip: baris registry dan verifikasi tautan katalog
 * disuplai dari prefetch massal, tulisnya menyusul ikut batch produk.
 *
 * Jalur lain (excluded, tautan yatim, produk baru) TETAP berurutan karena
 * butuh `lastInsertRowid` atau membuat baris baru.
 */
export function planLinkedProductWrites(wrProduct: WrProduct, linked: number, now: string): SqlWrite[] {
  const description = (wrProduct as { description?: string }).description ?? null;
  return [
    {
      sql: `UPDATE wr_products SET wr_product_name=?, wr_category=?, wr_description=?,
            is_excluded=0, exclude_reason=NULL, last_synced_at=?, updated_at=?
           WHERE wr_product_id=?
             AND (wr_product_name IS NOT ? OR wr_category IS NOT ?
                  OR wr_description IS NOT ? OR is_excluded IS NOT 0
                  OR exclude_reason IS NOT NULL)`,
      params: [
        wrProduct.name,
        wrProduct.category || null,
        description,
        now,
        now,
        wrProduct.id,
        wrProduct.name,
        wrProduct.category || null,
        description,
      ],
    },
    {
      // Hanya `description` (milik WR). `admin_description_override` TIDAK
      // PERNAH disentuh sync — itu kolom milik admin (migrasi 0030).
      sql: `UPDATE products SET description=?, updated_at=datetime('now')
           WHERE products.archived_at IS NULL AND id=? AND description IS NOT ?`,
      params: [description, linked, description],
      optional: true,
      catalogDisplay: true,
    },
  ];
}

export async function upsertWrProduct(
  wrProduct: WrProduct,
  exclude: { excluded: boolean; reason: string | null },
  db: DatabaseAccess,
): Promise<{ axvaraProductId: number; isNew: boolean; descriptionChanged?: boolean }> {
  const { queryFirst, execRun } = db;
  const now = new Date().toISOString();
  const existing = await queryFirst(
    `SELECT id, axvara_product_id FROM wr_products WHERE wr_product_id=?`,
    wrProduct.id,
  );
  // Produk yang SUDAH terdaftar (baris registry ada, mis. dari masa excluded):
  // bila sekarang tidak lagi di-exclude TAPI belum punya pasangan katalog
  // (axvara_product_id NULL — kasus Canva/Gemini yang "diurungkan"
  // pengecualiannya), buat pasangan katalognya sekarang dengan aturan
  // anti-bentrok yang sama seperti produk baru (suffix -wr + nama "(WR)",
  // kecuali Antigravity yang nama publiknya tanpa suffix supplier).
  if (existing) {
    if (exclude.excluded) {
      await execRun(
        `UPDATE wr_products SET wr_product_name=?, wr_category=?, wr_description=?,
          is_excluded=1, exclude_reason=?, last_synced_at=?, updated_at=?
         WHERE wr_product_id=?
           AND (wr_product_name IS NOT ? OR wr_category IS NOT ?
                OR wr_description IS NOT ? OR is_excluded IS NOT 1
                OR exclude_reason IS NOT ?)`,
        wrProduct.name,
        wrProduct.category || null,
        (wrProduct as { description?: string }).description ?? null,
        exclude.reason,
        now,
        now,
        wrProduct.id,
        wrProduct.name,
        wrProduct.category || null,
        (wrProduct as { description?: string }).description ?? null,
        exclude.reason,
      );
      return { axvaraProductId: 0, isNew: false };
    }
    const linked = existing.axvara_product_id != null ? Number(existing.axvara_product_id) : 0;
    if (linked > 0) {
      // Guard link yatim (temuan 2026-09-11): axvara_product_id menunjuk ke
      // produk yang sudah tidak ada (dihapus manual saat bersih-bersih
      // duplikat) → anggap belum punya pasangan, buat baru di bawah.
      const target = await queryFirst(
        `SELECT id FROM products WHERE id=? AND source='warung_rebahan' AND wr_product_id=?`,
        linked,
        wrProduct.id,
      );
      if (target) {
        const descriptionChanged = await runWrites(planLinkedProductWrites(wrProduct, linked, now), db);
        return { axvaraProductId: linked, isNew: false, descriptionChanged };
      }
    }
    // linked <= 0 ATAU menunjuk produk yang sudah hilang → buat pasangan
    // katalog baru (idempoten: satu registry = satu produk WR hidup).
    const made = await createAxvaraCatalogForWr(wrProduct, db, now);
    await execRun(
      `UPDATE wr_products SET wr_product_name=?, wr_category=?, wr_description=?,
        axvara_product_id=?, is_excluded=0, exclude_reason=NULL,
        last_synced_at=?, updated_at=? WHERE wr_product_id=?`,
      wrProduct.name,
      wrProduct.category || null,
      (wrProduct as { description?: string }).description ?? null,
      made,
      now,
      now,
      wrProduct.id,
    );
    return { axvaraProductId: made, isNew: true };
  }

  // Produk BARU (belum ada di registry).
  if (exclude.excluded) {
    // Produk baru yang di-exclude: catat di registry saja, jangan buat katalog.
    await execRun(
      `INSERT INTO wr_products
        (wr_product_id, wr_product_name, wr_category, wr_description,
         axvara_product_id, is_excluded, exclude_reason, last_synced_at)
       VALUES (?,?,?,?,NULL,1,?,?)`,
      wrProduct.id,
      wrProduct.name,
      wrProduct.category || null,
      (wrProduct as { description?: string }).description ?? null,
      exclude.reason,
      now,
    );
    return { axvaraProductId: 0, isNew: false };
  }

  const axvaraProductId = await createAxvaraCatalogForWr(wrProduct, db, now);
  await execRun(
    `INSERT INTO wr_products
      (wr_product_id, wr_product_name, wr_category, wr_description,
       axvara_product_id, is_excluded, last_synced_at)
     VALUES (?,?,?,?,?,0,?)`,
    wrProduct.id,
    wrProduct.name,
    wrProduct.category || null,
    (wrProduct as { description?: string }).description ?? null,
    axvaraProductId,
    now,
  );
  return { axvaraProductId, isNew: true };
}

/**
 * Buat baris katalog Axvara untuk satu produk WR dengan aturan anti-bentrok:
 * - slug: slug dasar, atau slug + "-wr" (hingga 5x varian) bila sudah dipakai
 *   produk manual sendiri (kasus "Canva Premium" WR vs "Canva Pro / Premium").
 * - nama: nama WR verbatim TANPA suffix supplier (keputusan owner 2026-09-30,
 *   preseden Antigravity: pembeli tahu ini produk Axvara). Pembedaan hanya di
 *   admin (badge asal) + slug. Nama ditulis SEKALI saat create, tidak pernah
 *   ditulis ulang sync.
 *
 * Guard duplikat (temuan 2026-09-11): SEBELUM insert, cari dulu produk WR
 * hidup dengan wr_product_id yang sama (dibuat sync sebelumnya yang
 * registry-nya ke-reset). Bila ada → pakai ulang, jangan buat baris kedua.
 */
async function createAxvaraCatalogForWr(
  wrProduct: WrProduct,
  db: DatabaseAccess,
  now: string,
): Promise<number> {
  const { queryFirst, execRun } = db;
  const dupe = await queryFirst(
    `SELECT id FROM products WHERE source='warung_rebahan' AND wr_product_id=? LIMIT 1`,
    wrProduct.id,
  );
  if (dupe) return Number(dupe.id);
  const baseSlug = generateProductSlug(wrProduct.name);
  let slug = baseSlug;
  for (let attempt = 0; attempt < 5; attempt++) {
    const collision = await queryFirst(`SELECT id FROM products WHERE slug=?`, slug);
    if (!collision) break;
    slug = `${baseSlug}-wr${attempt > 0 ? `-${attempt + 1}` : ""}`.slice(0, 80);
  }
  const slugTaken = await queryFirst(`SELECT id FROM products WHERE slug=?`, slug);
  if (slugTaken) throw new Error(`wr_slug_collision:${slug}`);
  // Nama bersih tanpa suffix (keputusan owner 2026-09-30, preseden Antigravity).
  const displayName = wrProduct.name.trim();
  const categoryId = mapWrCategory(wrProduct.category);
  const created = await execRun(
    `INSERT INTO products
      (category_id, name, slug, description, price, stock, is_active, sort_order,
       source, wr_product_id, wr_auto_managed, created_at, updated_at)
      VALUES (?,?,?,?,0,0,1,
        COALESCE((SELECT MIN(999989, MAX(sort_order)) + 10 FROM products),10),
        'warung_rebahan',?,1,?,?)`,
    categoryId,
    displayName,
    slug,
    (wrProduct as { description?: string }).description ?? null,
    wrProduct.id,
    now,
    now,
  );
  const axvaraProductId = Number(created.changes === 0 ? 0 : created.lastInsertRowid ?? 0);
  if (!axvaraProductId) throw new Error("wr_product_insert_failed");
  return axvaraProductId;
}
