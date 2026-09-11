// src/lib/warung-rebahan/sync.ts — Product sync engine WR → Axvara.
// Idempoten: upsert by wr_product_id / wr_variant_id. Produk yang hilang dari
// respons WR hanya di-nol-kan stoknya (WR bisa hide sementara), tidak dihapus.
//
// Budget-aware: pemanggil (cron/admin) memakai DatabaseAccess berbudget; modul
// ini tidak menghitung budget sendiri, hanya memakai query hemat.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import {
  fetchProducts,
  isWrSyncEnabled,
  type WrProduct,
  type WrVariant,
} from "./client";

export type SyncResult = {
  total: number;
  synced: number;
  excluded: number;
  newProducts: number;
  newVariants: number;
  variantsSynced: number;
  stockChanges: number;
  priceChanges: number;
  errors: string[];
  durationMs: number;
};

// Biaya query konservatif per entitas (lihat plan §6).
export const COST_PER_WR_PRODUCT_SYNC = 3;
export const COST_PER_WR_VARIANT_SYNC = 2;
export const COST_WR_EXCLUSION_FETCH = 1;

type Row = Record<string, unknown>;

function defaultMarkupPercent(): number {
  const raw = Number(process.env.WARUNG_REBAHAN_DEFAULT_MARKUP_PERCENT ?? 50);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 50;
}

function defaultMarkupFixed(): number {
  const raw = Number(process.env.WARUNG_REBAHAN_DEFAULT_MARKUP_FIXED ?? 0);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}

function defaultCategoryId(): number {
  const raw = Number(process.env.WARUNG_REBAHAN_DEFAULT_CATEGORY_ID ?? 2);
  return Number.isInteger(raw) && raw > 0 ? raw : 2;
}

/**
 * Harga jual = ceil(WR × (1 + %)) + fixed, dibulatkan ke kelipatan 500.
 * Contoh plan §15: 5000+50% → 7500; 3200+50% → 4800 → 5000.
 */
export function calculateSellPrice(
  wrPrice: number,
  markupPercent: number,
  markupFixed: number,
): number {
  const base = Math.ceil(wrPrice * (1 + markupPercent / 100)) + markupFixed;
  return Math.ceil(base / 500) * 500;
}

export function generateProductSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "produk-wr";
}

/** "7 Hari" → {7,day}; "1 Bulan" → {1,month}; "Lifetime" → lifetime. */
export function parseWrDuration(wrDuration: string | null | undefined): {
  value: number | null;
  unit: "day" | "month" | "year" | "lifetime" | "custom" | null;
  label: string;
} {
  const label = String(wrDuration ?? "").trim();
  if (!label) return { value: null, unit: null, label: "" };
  const lowered = label.toLowerCase();
  if (lowered.includes("lifetime") || lowered.includes("selamanya")) {
    return { value: null, unit: "lifetime", label };
  }
  const match = lowered.match(/(\d+)\s*(hari|day|minggu|week|bulan|month|tahun|year)/);
  if (!match) return { value: null, unit: "custom", label };
  const value = Number(match[1]);
  const raw = match[2];
  if (raw.startsWith("hari") || raw === "day") return { value, unit: "day", label };
  if (raw.startsWith("minggu") || raw === "week") return { value: value * 7, unit: "day", label };
  if (raw.startsWith("bulan") || raw === "month") return { value, unit: "month", label };
  return { value, unit: "year", label };
}

export function parseWrWarranty(wrWarranty: string | null | undefined): {
  type: "none" | "limited" | "full" | "custom";
  value: number | null;
  unit: "day" | "month" | "year" | "lifetime" | null;
  label: string;
} {
  const label = String(wrWarranty ?? "").trim();
  if (!label || /^(tanpa|no|none|-|tidak ada)/i.test(label)) {
    return { type: "none", value: null, unit: null, label };
  }
  const lowered = label.toLowerCase();
  if (lowered.includes("full")) {
    const duration = parseWrDuration(label);
    return {
      type: "full",
      value: duration.value,
      unit: duration.unit === "custom" ? null : duration.unit,
      label,
    };
  }
  const duration = parseWrDuration(label);
  if (duration.unit && duration.unit !== "custom") {
    return {
      type: "limited",
      value: duration.value,
      unit: duration.unit,
      label,
    };
  }
  return { type: "custom", value: null, unit: null, label };
}

/** Map kategori WR → category_id Axvara (Appendix C plan). */
export function mapWrCategory(wrCategory: string | null | undefined): number {
  const lowered = String(wrCategory ?? "").trim().toLowerCase();
  if (lowered.includes("ai")) return 1;
  if (lowered.includes("stream")) return 2;
  if (lowered.includes("gam")) return 2;
  if (
    lowered.includes("productiv") ||
    lowered.includes("vpn") ||
    lowered.includes("educ") ||
    lowered.includes("tool")
  ) {
    return 3;
  }
  return defaultCategoryId();
}

/**
 * Cek exclusion via tabel wr_exclusions (LIKE case-insensitive).
 * Pattern disimpan lowercase-safe: bandingkan lower(nama) LIKE lower(pattern).
 */
export async function isExcluded(
  productName: string,
  db: DatabaseAccess,
): Promise<{ excluded: boolean; reason: string | null }> {
  const rules = await db
    .queryAll(`SELECT pattern, reason FROM wr_exclusions`)
    .catch(() => [] as Row[]);
  const lowered = productName.toLowerCase();
  for (const rule of rules) {
    const pattern = String(rule.pattern || "").toLowerCase();
    // Ubah pola LIKE %x% menjadi contains-check sederhana (cukup untuk pola
    // prefix/suffix/contains; pola kompleks tetap dicoba via SQL di bawah).
    const stripped = pattern.replace(/^%+|%+$/g, "");
    const startsWild = pattern.startsWith("%");
    const endsWild = pattern.endsWith("%");
    let matched = false;
    if (startsWild && endsWild) matched = lowered.includes(stripped);
    else if (startsWild) matched = lowered.endsWith(stripped);
    else if (endsWild) matched = lowered.startsWith(stripped);
    else matched = lowered === stripped;
    if (matched) {
      return { excluded: true, reason: rule.reason ? String(rule.reason) : null };
    }
  }
  return { excluded: false, reason: null };
}

export async function upsertWrProduct(
  wrProduct: WrProduct,
  exclude: { excluded: boolean; reason: string | null },
  db: DatabaseAccess,
): Promise<{ axvaraProductId: number; isNew: boolean }> {
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
  // anti-bentrok yang sama seperti produk baru (suffix -wr + nama "(WR)").
  if (existing) {
    if (exclude.excluded) {
      await execRun(
        `UPDATE wr_products SET wr_product_name=?, wr_category=?, wr_description=?,
          is_excluded=1, exclude_reason=?, last_synced_at=?, updated_at=?
         WHERE wr_product_id=?`,
        wrProduct.name,
        wrProduct.category || null,
        (wrProduct as { description?: string }).description ?? null,
        exclude.reason,
        now,
        wrProduct.id,
      );
      return { axvaraProductId: 0, isNew: false };
    }
    const linked = existing.axvara_product_id != null ? Number(existing.axvara_product_id) : 0;
    if (linked <= 0) {
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
        wrProduct.id,
      );
      return { axvaraProductId: made, isNew: true };
    }
    await execRun(
      `UPDATE wr_products SET wr_product_name=?, wr_category=?, wr_description=?,
        is_excluded=0, exclude_reason=NULL, last_synced_at=?, updated_at=?
       WHERE wr_product_id=?`,
      wrProduct.name,
      wrProduct.category || null,
      (wrProduct as { description?: string }).description ?? null,
      now,
      wrProduct.id,
    );
    await execRun(
      `UPDATE products SET description=?, updated_at=datetime('now') WHERE id=?`,
      (wrProduct as { description?: string }).description ?? null,
      linked,
    ).catch(() => ({ changes: 0 }));
    return { axvaraProductId: linked, isNew: false };
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
 * - nama: selalu "<nama WR> (WR)" agar tidak tertukar di storefront/admin.
 */
async function createAxvaraCatalogForWr(
  wrProduct: WrProduct,
  db: DatabaseAccess,
  now: string,
): Promise<number> {
  const { queryFirst, execRun } = db;
  const baseSlug = generateProductSlug(wrProduct.name);
  let slug = baseSlug;
  for (let attempt = 0; attempt < 5; attempt++) {
    const collision = await queryFirst(`SELECT id FROM products WHERE slug=?`, slug);
    if (!collision) break;
    slug = `${baseSlug}-wr${attempt > 0 ? `-${attempt + 1}` : ""}`.slice(0, 80);
  }
  const slugTaken = await queryFirst(`SELECT id FROM products WHERE slug=?`, slug);
  if (slugTaken) throw new Error(`wr_slug_collision:${slug}`);
  const displayName = `${wrProduct.name} (WR)`;
  const categoryId = mapWrCategory(wrProduct.category);
  const created = await execRun(
    `INSERT INTO products
      (category_id, name, slug, description, price, stock, is_active, sort_order,
       source, wr_product_id, wr_auto_managed, created_at, updated_at)
     VALUES (?,?,?,?,0,0,1,0,'warung_rebahan',?,1,?,?)`,
    categoryId,
    displayName,
    slug,
    (wrProduct as { description?: string }).description ?? null,
    wrProduct.id,
    now,
    now,
  );
  const axvaraProductId = Number(created.lastInsertRowid ?? 0);
  if (!axvaraProductId) throw new Error("wr_product_insert_failed");
  return axvaraProductId;
}

export async function upsertWrVariant(
  wrVariant: WrVariant,
  wrProductId: string,
  axvaraProductId: number,
  db: DatabaseAccess,
): Promise<{ stockChanged: boolean; priceChanged: boolean; isNew: boolean }> {
  const { queryFirst, execRun } = db;
  const now = new Date().toISOString();
  const existing = await queryFirst(
    `SELECT id, wr_price, wr_stock, markup_percent, markup_fixed,
            axvara_variant_id, axvara_sell_price
     FROM wr_variants WHERE wr_variant_id=?`,
    wrVariant.id,
  );
  if (existing) {
    const markupPercent = Number(existing.markup_percent ?? defaultMarkupPercent());
    const markupFixed = Number(existing.markup_fixed ?? 0);
    const sellPrice = calculateSellPrice(Number(wrVariant.price), markupPercent, markupFixed);
    const stockChanged = Number(existing.wr_stock ?? -1) !== Number(wrVariant.stock);
    const priceChanged =
      Number(existing.wr_price ?? -1) !== Number(wrVariant.price) ||
      Number(existing.axvara_sell_price ?? -1) !== sellPrice;
    await execRun(
      `UPDATE wr_variants SET wr_variant_name=?, wr_price=?, wr_duration=?,
        wr_type=?, wr_warranty=?, wr_stock=?, wr_terms=?, wr_delivery_terms=?,
        axvara_sell_price=?, last_synced_at=?, updated_at=?
       WHERE wr_variant_id=?`,
      wrVariant.name,
      Number(wrVariant.price),
      wrVariant.duration || null,
      wrVariant.type || null,
      wrVariant.warranty || null,
      Number(wrVariant.stock),
      wrVariant.terms ?? null,
      wrVariant.delivery_terms ?? null,
      sellPrice,
      now,
      wrVariant.id,
    );
    const axvaraVariantId =
      existing.axvara_variant_id != null ? Number(existing.axvara_variant_id) : 0;
    if (axvaraVariantId > 0) {
      const duration = parseWrDuration(wrVariant.duration);
      const warranty = parseWrWarranty(wrVariant.warranty);
      await execRun(
        `UPDATE product_variants SET label=?, price=?, stock=?,
          duration_value=?, duration_unit=?, duration_label=?,
          warranty_type=?, warranty_value=?, warranty_unit=?, warranty_label=?,
          updated_at=datetime('now') WHERE id=?`,
        wrVariant.name,
        sellPrice,
        Number(wrVariant.stock),
        duration.value,
        duration.unit,
        duration.label || null,
        warranty.type,
        warranty.value,
        warranty.unit,
        warranty.label || null,
        axvaraVariantId,
      ).catch(() => ({ changes: 0 }));
    }
    return { stockChanged, priceChanged, isNew: false };
  }

  if (!axvaraProductId) return { stockChanged: false, priceChanged: false, isNew: false };
  const markupPercent = defaultMarkupPercent();
  const markupFixed = defaultMarkupFixed();
  const sellPrice = calculateSellPrice(Number(wrVariant.price), markupPercent, markupFixed);
  const duration = parseWrDuration(wrVariant.duration);
  const warranty = parseWrWarranty(wrVariant.warranty);
  // SKU dari UUID WR tanpa strip (36 char alnum) + suffix 6 char dari UUID agar
  // unik per varian. Temuan 2026-09-11: strip+slice(0,24) membuat "Member Pro"
  // Canva (2 varian) dan "Pro Member"/"Head" Gemini (3 varian) tabrakan SKU
  // karena 24 char pertama UUID-nya sama — varian ke-2 dst gagal dengan
  // D1_ERROR binding/UNIQUE lalu seluruh produk dicatat error (stok 0).
  const uuidAlnum = String(wrVariant.id).replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "X";
  const sku = `WR-${uuidAlnum.slice(0, 24)}${uuidAlnum.slice(-6)}`;
  const created = await execRun(
    `INSERT INTO product_variants
      (product_id, sku, label, duration_value, duration_unit, duration_label,
       warranty_type, warranty_value, warranty_unit, warranty_label,
       price, stock, fulfillment_mode, is_active, sort_order,
       wr_variant_id, wr_auto_managed, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?)`,
    axvaraProductId,
    sku,
    wrVariant.name,
    duration.value,
    duration.unit,
    duration.label || null,
    warranty.type,
    warranty.value,
    warranty.unit,
    warranty.label || null,
    sellPrice,
    Number(wrVariant.stock),
    "manual",
    1,
    0,
    wrVariant.id,
    1,
    now,
    now,
  ).catch(() => ({ changes: 0 as number | undefined, lastInsertRowid: undefined as number | undefined }));
  let axvaraVariantId = Number(created.lastInsertRowid ?? 0);
  if (!axvaraVariantId) {
    // SKU collision (retry sync / UUID pendek sama): pakai baris yang ada.
    const conflict = await queryFirst(
      `SELECT id FROM product_variants WHERE sku=?`,
      sku,
    );
    axvaraVariantId = conflict ? Number(conflict.id) : 0;
  }
  await execRun(
    `INSERT OR IGNORE INTO wr_variants
      (wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_duration,
       wr_type, wr_warranty, wr_stock, wr_terms, wr_delivery_terms,
       axvara_variant_id, markup_percent, markup_fixed, axvara_sell_price,
       is_active, last_synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
    wrVariant.id,
    wrProductId,
    wrVariant.name,
    Number(wrVariant.price),
    wrVariant.duration || null,
    wrVariant.type || null,
    wrVariant.warranty || null,
    Number(wrVariant.stock),
    wrVariant.terms ?? null,
    wrVariant.delivery_terms ?? null,
    axvaraVariantId || null,
    markupPercent,
    markupFixed,
    sellPrice,
    now,
  );
  if (axvaraVariantId > 0) {
    await execRun(
      `UPDATE product_variants SET wr_variant_id=?, wr_auto_managed=1,
        updated_at=datetime('now') WHERE id=?`,
      wrVariant.id,
      axvaraVariantId,
    ).catch(() => ({ changes: 0 }));
  }
  return { stockChanged: true, priceChanged: true, isNew: true };
}

/** Sinkronkan stok induk dari agregat varian aktif (SUM, unlimited bila ada -1). */
export async function refreshParentAggregates(
  axvaraProductId: number,
  db: DatabaseAccess,
): Promise<void> {
  if (!axvaraProductId) return;
  const { execRun } = db;
  await execRun(
    `UPDATE products
     SET price=COALESCE((
           SELECT MIN(price) FROM product_variants
           WHERE product_id=? AND is_active=1
         ),price),
         stock=CASE WHEN EXISTS(
           SELECT 1 FROM product_variants
           WHERE product_id=? AND is_active=1 AND stock=-1
         ) THEN -1 ELSE COALESCE((
           SELECT SUM(CASE WHEN stock>0 THEN stock ELSE 0 END)
           FROM product_variants WHERE product_id=? AND is_active=1
         ),0) END,
         updated_at=datetime('now')
     WHERE id=?`,
    axvaraProductId,
    axvaraProductId,
    axvaraProductId,
    axvaraProductId,
  ).catch(() => ({ changes: 0 }));
}

/**
 * Varian WR yang hilang dari respons API: set stock=0 (bukan delete).
 * WR bisa hide/unhide sementara; sync berikutnya memulihkan otomatis.
 */
export async function zeroMissingVariants(
  seenVariantIds: Set<string>,
  db: DatabaseAccess,
): Promise<number> {
  const { queryAll, execRun } = db;
  const rows = await queryAll(
    `SELECT wr_variant_id, axvara_variant_id FROM wr_variants WHERE is_active=1`,
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
        `UPDATE product_variants SET stock=0, updated_at=datetime('now') WHERE id=?`,
        axvaraVariantId,
      ).catch(() => ({ changes: 0 }));
    }
    zeroed++;
  }
  return zeroed;
}

export async function syncProducts(
  database?: DatabaseAccess,
  fetchFn: () => Promise<WrProduct[]> = fetchProducts,
): Promise<SyncResult> {
  const started = Date.now();
  const db = database ?? createDatabaseAccess();
  const result: SyncResult = {
    total: 0,
    synced: 0,
    excluded: 0,
    newProducts: 0,
    newVariants: 0,
    variantsSynced: 0,
    stockChanges: 0,
    priceChanges: 0,
    errors: [],
    durationMs: 0,
  };
  if (!isWrSyncEnabled()) {
    result.errors.push("warung_rebahan_disabled");
    result.durationMs = Date.now() - started;
    return result;
  }
  let products: WrProduct[];
  try {
    products = await fetchFn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message.slice(0, 300));
    await logSync({ ...result, status: "failed" }, db).catch(() => undefined);
    result.durationMs = Date.now() - started;
    return result;
  }
  result.total = products.length;
  const seenVariantIds = new Set<string>();
  for (const product of products) {
    try {
      const exclude = await isExcluded(String(product.name || ""), db);
      if (exclude.excluded) {
        result.excluded++;
        await upsertWrProduct(product, exclude, db);
        continue;
      }
      const { axvaraProductId, isNew } = await upsertWrProduct(
        product,
        { excluded: false, reason: null },
        db,
      );
      if (isNew) result.newProducts++;
      result.synced++;
      for (const variant of product.variants || []) {
        if (!variant?.id) continue;
        seenVariantIds.add(String(variant.id));
        const outcome = await upsertWrVariant(variant, product.id, axvaraProductId, db);
        result.variantsSynced++;
        if (outcome.isNew) result.newVariants++;
        if (outcome.stockChanged) result.stockChanges++;
        if (outcome.priceChanged) result.priceChanges++;
      }
      await refreshParentAggregates(axvaraProductId, db);
    } catch (error) {
      result.errors.push(
        `${String(product?.name || product?.id).slice(0, 80)}: ${
          error instanceof Error ? error.message : String(error)
        }`.slice(0, 300),
      );
    }
  }
  try {
    result.stockChanges += await zeroMissingVariants(seenVariantIds, db);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  result.durationMs = Date.now() - started;
  const status = result.errors.length === 0 ? "success" : result.synced > 0 ? "partial" : "failed";
  await logSync({ ...result, status }, db).catch(() => undefined);
  return result;
}

async function logSync(
  result: SyncResult & { status: "success" | "partial" | "failed" },
  db: DatabaseAccess,
): Promise<void> {
  await db.execRun(
    `INSERT INTO wr_sync_log
      (sync_type, status, products_total, products_synced, products_excluded,
       products_new, variants_synced, stock_changes, price_changes,
       error_message, duration_ms)
     VALUES ('products',?,?,?,?,?,?,?,?,?,?)`,
    result.status,
    result.total,
    result.synced,
    result.excluded,
    result.newProducts,
    result.variantsSynced,
    result.stockChanges,
    result.priceChanges,
    result.errors.length ? result.errors.slice(0, 5).join(" | ").slice(0, 1000) : null,
    result.durationMs,
  );
}
