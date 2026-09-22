// src/lib/warung-rebahan/sync.ts — Product sync engine WR → Axvara.
// Idempoten: upsert by wr_product_id / wr_variant_id. Produk yang hilang dari
// respons WR hanya di-nol-kan stoknya (WR bisa hide sementara), tidak dihapus.
//
// BUDGET-AWARE (P0-4): syncProducts menerima maxStatements dan berhenti
// sebelum budget habis, menyimpan cursor di wr_sync_state agar invocation
// berikutnya MELANJUTKAN (bukan mengulang dari awal). Kapasitas order
// diprioritaskan: pemanggil (cron) menjalankan processWrPendingOrders DULU
// sebelum sync produk. Exclusion rules di-cache sekali per run.
// DESTRUCTIVE GUARD: zeroMissingVariants hanya berjalan setelah satu sweep
// PENUH tervalidasi; respons malformed/empty/partial tidak me-zero katalog.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import {
  fetchProducts,
  isWrSyncEnabled,
  type WrProduct,
  type WrVariant,
} from "./client";
import { guessDeliveryClass } from "./delivery-class";

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
  /** True bila berhenti karena budget (cursor tersimpan, lanjutkan run berikut). */
  budgetYielded: boolean;
  /** True bila sweep penuh selesai tervalidasi (zero-missing diizinkan). */
  snapshotComplete: boolean;
};

// Biaya query konservatif per entitas (lihat plan §6).
export const COST_PER_WR_PRODUCT_SYNC = 3;
export const COST_PER_WR_VARIANT_SYNC = 2;
export const COST_WR_EXCLUSION_FETCH = 1;
// Ukuran batch produk per run sync (bounded agar order tidak starvation).
// Opsi A 2026-09-14: 48 = seluruh katalog WR saat ini dalam SATU sweep.
// Cursor antar-run tetap disimpan sebagai fallback bila run terpotong.
export const WR_SYNC_PRODUCTS_PER_RUN = 48;
// Plafon tambahan khusus sync katalog (lihat raiseCeilingForCatalogSync):
// Produk baru ~15 query/produk (upsert produk + kategori + 2 varian +
// agregat + log) — jauh di atas estimasi admission konservatif. 48 × 16 +
// margin = 800. Hanya untuk sync produk.
export const WR_SYNC_CATALOG_BUDGET_EXTRA = 800;
// Generasi: bila upstream mengembalikan data yang bentuknya berubah total
// (mis. array kosong padahal sebelumnya 48 produk), sweep ditandai parsial.
export const WR_SYNC_MIN_PRODUCTS_GUARD = 1;
// Checkpoint kemajuan sweep (anti-gap-tanpa-jejak, 2026-09-20). Sweep cron
// memakan 50–116 detik sementara plafon platform ~125 detik dan deploy bisa
// me-recycle Functions kapan saja. Dulu cursor + logSync HANYA ditulis di
// ujung — run kepotong = NOL jejak + ulang dari awal + kepotong lagi (tiga
// gap misterius 19–20 Sep, fetch 200 tiap 5 mnt di log proxy sebagai bukti
// kerja terbuang). Kini cursor + penanda kemajuan disimpan tiap N produk
// (6 tulis/run — murah) sehingga run berikut MELANJUTKAN, bukan mengulang.
export const WR_SYNC_CHECKPOINT_EVERY = 8;

type Row = Record<string, unknown>;

/**
 * Satu statement tulis yang SUDAH terikat parameternya tapi BELUM dikirim.
 *
 * KENAPA ADA (akar "sweep 32 detik untuk 13 produk"): kerja D1-nya sendiri
 * hampir gratis — `sql_duration_ms` terukur di produksi hanya 0,12–0,19 ms.
 * Yang mahal adalah JUMLAH round-trip: sweep lama mengirim 4 query per
 * produk + 4 per varian + 1 agregat secara BERURUTAN (13 produk/25 varian =
 * 165 round-trip), dan tiap round-trip menyeberang ke D1 primary di SIN.
 * Terukur ~197 ms per query, jadi 99,9% durasi sweep adalah menunggu
 * jaringan, bukan database.
 *
 * Dengan merencanakan tulis lebih dulu, seluruh tulis satu produk dikirim
 * sebagai SATU `batch()`. SQL-nya tetap tinggal di satu tempat (planner di
 * bawah) sehingga jalur berurutan lama dan jalur batch tidak bisa berbeda.
 */
type SqlWrite = {
  sql: string;
  params: unknown[];
  /** Tulis yang boleh gagal diam-diam (dulu `.catch()` di jalur berurutan). */
  optional?: boolean;
};

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
async function runWrites(writes: SqlWrite[], db: DatabaseAccess): Promise<void> {
  if (!writes.length) return;
  const d1 = db.d1;
  if (d1 && writes.length > 1) {
    try {
      await d1.batch(writes.map((write) => d1.prepare(write.sql).bind(...write.params)));
      return;
    } catch {
      /* turun ke jalur berurutan di bawah */
    }
  }
  for (const write of writes) {
    if (write.optional) {
      await db.execRun(write.sql, ...write.params).catch(() => ({ changes: 0 }));
    } else {
      await db.execRun(write.sql, ...write.params);
    }
  }
}

/** `?,?,?` sebanyak n. */
function placeholders(count: number): string {
  return new Array(count).fill("?").join(",");
}

/** D1 menolak query dengan >100 bound parameter, jadi prefetch dipotong. */
const PREFETCH_PARAM_CHUNK = 50;

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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
 * `cachedRules`: cache sekali per run (P0-4) — null = baca dari DB.
 */
export async function isExcluded(
  productName: string,
  db: DatabaseAccess,
  cachedRules?: { pattern: string; reason: string | null }[] | null,
): Promise<{ excluded: boolean; reason: string | null }> {
  const rules =
    cachedRules ??
    ((await db
      .queryAll(`SELECT pattern, reason FROM wr_exclusions`)
      .catch(() => [] as Row[])) as { pattern: string; reason: string | null }[]);
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

/**
 * Rencanakan tulis untuk produk yang SUDAH terdaftar, punya pasangan katalog
 * hidup, dan tidak di-exclude — jalur terpanas (48 dari 48 produk pada sweep
 * normal). Nol round-trip: baris registry dan verifikasi tautan katalog
 * disuplai dari prefetch massal, tulisnya menyusul ikut batch produk.
 *
 * Jalur lain (excluded, tautan yatim, produk baru) TETAP berurutan karena
 * butuh `lastInsertRowid` atau membuat baris baru.
 */
function planLinkedProductWrites(wrProduct: WrProduct, linked: number, now: string): SqlWrite[] {
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
           WHERE id=? AND description IS NOT ?`,
      params: [description, linked, description],
      optional: true,
    },
  ];
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
        await runWrites(planLinkedProductWrites(wrProduct, linked, now), db);
        return { axvaraProductId: linked, isNew: false };
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
 * - nama: selalu "<nama WR> (WR)" agar tidak tertukar di storefront/admin.
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

export type VariantOutcome = { stockChanged: boolean; priceChanged: boolean; isNew: boolean };

/**
 * Rencanakan tulis untuk satu varian yang SUDAH ada barisnya, tanpa menyentuh
 * D1. Baris `existing` disuplai pemanggil (satu SELECT massal per produk),
 * jadi jalur ini nol round-trip sampai `runWrites` mengirimnya sebagai batch.
 */
function planExistingVariantWrites(
  wrVariant: WrVariant,
  existing: Row,
  now: string,
): { writes: SqlWrite[]; outcome: VariantOutcome } {
  const writes: SqlWrite[] = [];
  const markupPercent = Number(existing.markup_percent ?? defaultMarkupPercent());
    const markupFixed = Number(existing.markup_fixed ?? 0);
    const sellPrice = calculateSellPrice(Number(wrVariant.price), markupPercent, markupFixed);
    const stockChanged = Number(existing.wr_stock ?? -1) !== Number(wrVariant.stock);
    const priceChanged =
      Number(existing.wr_price ?? -1) !== Number(wrVariant.price) ||
      Number(existing.axvara_sell_price ?? -1) !== sellPrice;
    // Kuota D1: sweep menulis 96 baris wr_variants + 96 product_variants tiap
    // 5 menit walau WR tidak berubah sama sekali (~28k rows-written/hari dari
    // kuota 100k). `last_synced_at` TIDAK dibaca siapa pun, jadi menyegarkannya
    // sendirian tidak bernilai — guard null-safe (`IS NOT`) membuat baris yang
    // benar-benar sama tidak ditulis ulang.
    writes.push({
      sql: `UPDATE wr_variants SET wr_variant_name=?, wr_price=?, wr_duration=?,
        wr_type=?, wr_warranty=?, wr_stock=?, wr_terms=?, wr_delivery_terms=?,
        axvara_sell_price=?, last_synced_at=?, updated_at=?
       WHERE wr_variant_id=?
         AND (wr_variant_name IS NOT ? OR wr_price IS NOT ? OR wr_duration IS NOT ?
              OR wr_type IS NOT ? OR wr_warranty IS NOT ? OR wr_stock IS NOT ?
              OR wr_terms IS NOT ? OR wr_delivery_terms IS NOT ?
              OR axvara_sell_price IS NOT ?)`,
      params: [
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
        now,
        wrVariant.id,
        wrVariant.name,
        Number(wrVariant.price),
        wrVariant.duration || null,
        wrVariant.type || null,
        wrVariant.warranty || null,
        Number(wrVariant.stock),
        wrVariant.terms ?? null,
        wrVariant.delivery_terms ?? null,
        sellPrice,
      ],
    });
    // 2026-09-16: kelas pengiriman yang SUDAH dikunci (screenshot/admin/
    // system) tidak pernah ditimpa sync — pola admin_description_override.
    // HANYA yang masih NULL ditebak sistem dari sinyal API saat ini.
    writes.push({
      sql: `UPDATE wr_variants SET wr_delivery_class=?, wr_delivery_source='system',
        updated_at=? WHERE wr_variant_id=? AND wr_delivery_class IS NULL`,
      params: [
        guessDeliveryClass({
          productName: String((existing as { wr_product_name?: unknown }).wr_product_name || ""),
          variantName: wrVariant.name,
          type: wrVariant.type,
          stock: Number(wrVariant.stock),
          terms: wrVariant.terms,
          deliveryTerms: wrVariant.delivery_terms,
        }),
        now,
        wrVariant.id,
      ],
      optional: true,
    });
    const axvaraVariantId =
      existing.axvara_variant_id != null ? Number(existing.axvara_variant_id) : 0;
    if (axvaraVariantId > 0) {
      const duration = parseWrDuration(wrVariant.duration);
      const warranty = parseWrWarranty(wrVariant.warranty);
      writes.push({
        sql: `UPDATE product_variants SET label=?, price=?, stock=?,
          duration_value=?, duration_unit=?, duration_label=?,
          warranty_type=?, warranty_value=?, warranty_unit=?, warranty_label=?,
          updated_at=datetime('now')
         WHERE id=?
           AND (label IS NOT ? OR price IS NOT ? OR stock IS NOT ?
                OR duration_value IS NOT ? OR duration_unit IS NOT ?
                OR duration_label IS NOT ? OR warranty_type IS NOT ?
                OR warranty_value IS NOT ? OR warranty_unit IS NOT ?
                OR warranty_label IS NOT ?)`,
        params: [
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
        ],
        optional: true,
      });
    }
  return { writes, outcome: { stockChanged, priceChanged, isNew: false } };
}

export async function upsertWrVariant(
  wrVariant: WrVariant,
  wrProductId: string,
  axvaraProductId: number,
  db: DatabaseAccess,
): Promise<VariantOutcome> {
  const { queryFirst } = db;
  const now = new Date().toISOString();
  const existing = await queryFirst(
    `SELECT id, wr_price, wr_stock, markup_percent, markup_fixed,
            axvara_variant_id, axvara_sell_price
     FROM wr_variants WHERE wr_variant_id=?`,
    wrVariant.id,
  );
  if (existing) {
    const planned = planExistingVariantWrites(wrVariant, existing, now);
    await runWrites(planned.writes, db);
    return planned.outcome;
  }
  return insertNewVariant(wrVariant, wrProductId, axvaraProductId, db, now);
}

/**
 * Varian BARU. Tetap berurutan (tidak di-batch): butuh `lastInsertRowid` dari
 * insert `product_variants` untuk menautkan `wr_variants.axvara_variant_id`,
 * dan `batch()` tidak bisa memakai hasil statement sebelumnya. Varian baru
 * juga jarang — 0 dari 87 pada sweep normal — jadi tidak memengaruhi biaya.
 */
async function insertNewVariant(
  wrVariant: WrVariant,
  wrProductId: string,
  axvaraProductId: number,
  db: DatabaseAccess,
  now: string,
): Promise<VariantOutcome> {
  const { queryFirst, execRun } = db;
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
  // 2026-09-16: varian baru langsung ditebak kelasnya (sumber 'system');
  // seed screenshot 0032 + kunci admin menimpa via UPDATE terpisah. Sync
  // tidak pernah menimpa yang sudah terisi (kolom baru = NULL → ditebak).
  const guessedClass = guessDeliveryClass({
    productName: "",
    variantName: wrVariant.name,
    type: wrVariant.type,
    stock: Number(wrVariant.stock),
    terms: wrVariant.terms,
    deliveryTerms: wrVariant.delivery_terms,
  });
  await execRun(
    `INSERT OR IGNORE INTO wr_variants
      (wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_duration,
       wr_type, wr_warranty, wr_stock, wr_terms, wr_delivery_terms,
       axvara_variant_id, markup_percent, markup_fixed, axvara_sell_price,
       is_active, last_synced_at, wr_delivery_class, wr_delivery_source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
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
    guessedClass,
    "system",
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

/**
 * Statement agregat induk. SATU sumber SQL untuk jalur berurutan maupun batch.
 *
 * Guard kuota D1 (2026-09-20): agregat induk dihitung ulang tiap sweep dan
 * dulu SELALU ditulis walau hasilnya identik — 48 baris per sweep tanpa
 * perubahan apa pun. Subquery yang sama dipakai di WHERE sebagai pembanding
 * sehingga UPDATE hanya terjadi saat harga/stok agregat benar-benar bergeser.
 */
function planParentAggregateWrite(axvaraProductId: number): SqlWrite {
  return {
    sql: `UPDATE products
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
     WHERE id=?
       AND (price IS NOT COALESCE((
              SELECT MIN(price) FROM product_variants
              WHERE product_id=? AND is_active=1
            ),price)
         OR stock IS NOT CASE WHEN EXISTS(
              SELECT 1 FROM product_variants
              WHERE product_id=? AND is_active=1 AND stock=-1
            ) THEN -1 ELSE COALESCE((
              SELECT SUM(CASE WHEN stock>0 THEN stock ELSE 0 END)
              FROM product_variants WHERE product_id=? AND is_active=1
            ),0) END)`,
    params: new Array(7).fill(axvaraProductId),
    optional: true,
  };
}

/** Sinkronkan stok induk dari agregat varian aktif (SUM, unlimited bila ada -1). */
export async function refreshParentAggregates(
  axvaraProductId: number,
  db: DatabaseAccess,
): Promise<void> {
  if (!axvaraProductId) return;
  const write = planParentAggregateWrite(axvaraProductId);
  await db.execRun(write.sql, ...write.params).catch(() => ({ changes: 0 }));
}

/**
 * Ambil SEMUA baris `wr_variants` yang dibutuhkan sweep ini dalam beberapa
 * query `IN (...)`, bukan satu SELECT per varian.
 *
 * Ini separuh penghematan round-trip: sweep lama menembak 1 SELECT per varian
 * (87 round-trip untuk katalog penuh) hanya untuk membaca harga/stok/markup
 * lama sebagai pembanding. Dipotong per 50 id karena D1 menolak query dengan
 * lebih dari 100 bound parameter.
 */
async function prefetchVariantRows(
  wrVariantIds: string[],
  db: DatabaseAccess,
): Promise<Map<string, Row>> {
  const map = new Map<string, Row>();
  if (!wrVariantIds.length) return map;
  for (const chunk of chunked(wrVariantIds, PREFETCH_PARAM_CHUNK)) {
    const rows = await db
      .queryAll(
        // Kolom PERSIS sama dengan SELECT per-varian yang digantikan — jangan
        // tambah kolom. `wr_product_name` sengaja TIDAK diambil: SELECT lama
        // juga tidak mengambilnya, sehingga guessDeliveryClass selalu
        // menerima productName "" dan menambahkannya akan mengubah kelas
        // pengiriman yang ditebak (perubahan perilaku, bukan performa).
        `SELECT id, wr_variant_id, wr_price, wr_stock, markup_percent,
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
async function prefetchProductRows(
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

/** Baca state sync durable (cursor/generation). Aman bila tabel belum ada. */
export async function readSyncState(
  db: DatabaseAccess,
): Promise<{ cursor: number; generation: string; snapshotComplete: boolean }> {
  const out = { cursor: 0, generation: "", snapshotComplete: false };
  try {
    const rows = await db.queryAll(`SELECT key, value FROM wr_sync_state`);
    for (const row of rows) {
      const key = String(row.key || "");
      if (key === "products_cursor") out.cursor = Math.max(0, Number(row.value || 0));
      else if (key === "products_generation") out.generation = String(row.value || "");
      else if (key === "products_snapshot_complete") out.snapshotComplete = String(row.value) === "1";
    }
  } catch {
    /* DB pre-0029: mulai dari awal */
  }
  return out;
}

async function writeSyncState(db: DatabaseAccess, key: string, value: string): Promise<void> {
  try {
    await db.execRun(
      `INSERT INTO wr_sync_state (key, value, updated_at) VALUES (?,?,datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
       WHERE wr_sync_state.value IS NOT excluded.value`,
      key,
      value,
    );
  } catch {
    /* DB pre-0029: cursor best-effort */
  }
}

/**
 * Validasi respons katalog upstream (P0-4): tolak data mencurigakan SEBELUM
 * menyentuh stok lokal.
 * - bukan array / null / object → malformed (jangan zero apa pun).
 * - array kosong padahal generasi sebelumnya punya produk → suspicious
 *   (upstream error / akun kena suspend) — JANGAN zero seluruh katalog.
 * Mengembalikan { ok, reason } — reason null bila aman diproses.
 */
export function validateCatalogResponse(
  products: unknown,
  previousGeneration: string,
  previousCount: number,
): { ok: boolean; reason: string | null } {
  if (!Array.isArray(products)) return { ok: false, reason: "catalog_malformed_not_array" };
  if (products.length === 0 && previousCount > 0) {
    return { ok: false, reason: "catalog_suspicious_empty" };
  }
  return { ok: true, reason: null };
}

export type SyncOptions = {
  /** Batas produk per run (default WR_SYNC_PRODUCTS_PER_RUN). */
  maxProducts?: number;
  /** Izinkan zeroMissingVariants bila sweep penuh (default true). */
  allowZeroMissing?: boolean;
  /** Sumber sync: 'manual' (Force Sync admin) atau 'cron' (terjadwal).
   * Dicatat ke wr_sync_log.trigger agar kartu admin bisa membedakan
   * keduanya (default 'manual' agar pemanggil lama tetap bermakna). */
  trigger?: "manual" | "cron";
  /**
   * Sisa waktu invocation (ms) yang boleh dipakai sweep ini.
   *
   * KENAPA WAJIB ADA (akar \"sync tersendat berminggu-minggu\"): loop di bawah
   * hanya punya gerbang BUDGET QUERY (`canSpend`), tidak pernah gerbang
   * WAKTU. Sweep penuh 48 produk / 87 varian = ~366 query D1 BERURUTAN;
   * biayanya sepenuhnya ditentukan latensi D1 yang tidak kita kendalikan.
   * Terukur di produksi dengan beban identik: 12 dtk saat D1 sehat (~33 ms/
   * query) tetapi 115-122 dtk saat D1 lambat (~314 ms/query) — 68 dari 391
   * sweep (17%) melewati deadline cron 45 dtk.
   *
   * Akibatnya berantai: run dibunuh platform SEBELUM ekor handler menulis
   * `wr_sync_log` dan penanda fase, sehingga sweep tidak pernah tercatat,
   * fase terkunci, dan run 5-menit berikutnya mengulang pekerjaan berat yang
   * sama sampai kebetulan bertemu D1 cepat. Persis gejala \"rusak di tengah
   * jalan tanpa sebab\" — tanpa error, tanpa jejak.
   *
   * Dengan budget waktu, sweep berhenti di batas produk terakhir yang utuh,
   * menyimpan cursor, dan melaporkan `budgetYielded` — sama persis dengan
   * perilaku saat budget query habis, yang sudah terbukti aman dan dilanjut
   * run berikutnya.
   */
  timeBudgetMs?: number;
};

export async function syncProducts(
  database?: DatabaseAccess,
  fetchFn: () => Promise<WrProduct[]> = fetchProducts,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const started = Date.now();
  const db = database ?? createDatabaseAccess();
  const trigger = options.trigger ?? "manual";
  const maxProducts = Math.max(1, Math.min(options.maxProducts ?? WR_SYNC_PRODUCTS_PER_RUN, 48));
  // Deadline sweep: 0/undefined = tanpa batas (Force Sync admin lewat route
  // sendiri, bukan invocation cron yang dibunuh platform).
  const timeBudgetMs = Number(options.timeBudgetMs ?? 0);
  const hasTimeBudget = Number.isFinite(timeBudgetMs) && timeBudgetMs > 0;
  const timeLeftMs = () => timeBudgetMs - (Date.now() - started);
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
    budgetYielded: false,
    snapshotComplete: false,
  };
  if (!isWrSyncEnabled()) {
    result.errors.push("warung_rebahan_disabled");
    result.durationMs = Date.now() - started;
    return result;
  }
  // Cursor durable: lanjutkan dari posisi run sebelumnya (P0-4).
  const state = await readSyncState(db);
  // Opsi A: longgarkan plafon KHUSUS sync katalog agar 48 produk tuntas
  // satu sweep. Hanya bila db menyediakan hook-nya (BudgetedDatabase cron);
  // DatabaseAccess polos (admin/test) canSpend-nya selalu true.
  (db as unknown as { raiseCeilingForCatalogSync?: (n: number) => void })
    .raiseCeilingForCatalogSync?.(WR_SYNC_CATALOG_BUDGET_EXTRA);
  let products: WrProduct[];
  try {
    products = await fetchFn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message.slice(0, 300));
    await logSync({ ...result, status: "failed" }, db, trigger).catch(() => undefined);
    result.durationMs = Date.now() - started;
    return result;
  }
  // Guard data mencurigakan SEBELUM menyentuh stok (P0-4).
  const validation = validateCatalogResponse(products, state.generation, state.snapshotComplete ? Math.max(state.cursor, 1) : 0);
  if (!validation.ok) {
    result.errors.push(validation.reason || "catalog_rejected");
    await logSync({ ...result, status: "failed" }, db, trigger).catch(() => undefined);
    result.durationMs = Date.now() - started;
    return result;
  }
  result.total = products.length;
  // Generasi berubah (jumlah produk upstream berubah drastis) → catat, tapi
  // tetap proses (bukan tolak): penambahan/penghapusan massal yang sah
  // tetap harus tersync; yang dilarang hanya ZERO buta (di bawah).
  const generation = `${products.length}:${products[0] ? String((products[0] as WrProduct).id || "").slice(0, 8) : ""}`;
  // Cache exclusion rules sekali per run (P0-4): 1 query, bukan N.
  const cachedRules = (await db
    .queryAll(`SELECT pattern, reason FROM wr_exclusions`)
    .catch(() => [] as Row[])) as { pattern: string; reason: string | null }[];
  const seenVariantIds = new Set<string>();
  // Urutan stabil agar cursor bermakna lintas run.
  const ordered = [...products].sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  const startAt = state.cursor >= ordered.length ? 0 : state.cursor;
  // Prefetch baris varian untuk potongan yang AKAN dikerjakan run ini saja
  // (`maxProducts` dari cursor), bukan seluruh katalog: sweep parsial tidak
  // boleh membayar pembacaan produk yang tidak disentuhnya.
  const plannedSlice = ordered.slice(startAt, startAt + maxProducts);
  const variantRows = await prefetchVariantRows(
    plannedSlice
      .flatMap((product) => (product.variants || []).map((variant) => String(variant?.id || "")))
      .filter((id) => id.length > 0),
    db,
  );
  const productRows = await prefetchProductRows(
    plannedSlice.map((product) => String(product.id || "")).filter((id) => id.length > 0),
    db,
  );
  let cursor = startAt;
  let processedInRun = 0;
  for (let i = startAt; i < ordered.length; i++) {
    const product = ordered[i];
    // Admission biaya aktual (P0-4): berhenti SEBELUM budget habis.
    // Biaya konservatif per produk = upsert produk + varian-variannya +
    // agregat induk + margin tulis log.
    const variantCount = Array.isArray(product.variants) ? product.variants.length : 0;
    const cost =
      COST_PER_WR_PRODUCT_SYNC + variantCount * COST_PER_WR_VARIANT_SYNC + 2;
    if (!db.canSpend(cost + 4)) {
      result.budgetYielded = true;
      break;
    }
    // Admission WAKTU, sejajar dengan admission budget di atas. Biaya satu
    // produk = (1 + varian) × RTT D1 yang bisa 10x lebih lambat saat D1
    // sedang buruk, jadi sisa waktu diukur ulang TIAP iterasi memakai
    // latensi terukur run ini sendiri — bukan konstanta optimistis.
    if (hasTimeBudget && processedInRun > 0) {
      const msPerProductSoFar = (Date.now() - started) / processedInRun;
      if (timeLeftMs() < msPerProductSoFar) {
        result.budgetYielded = true;
        break;
      }
    }
    if (processedInRun >= maxProducts) {
      result.budgetYielded = true;
      break;
    }
    try {
      const exclude = await isExcluded(String(product.name || ""), db, cachedRules);
      if (exclude.excluded) {
        result.excluded++;
        await upsertWrProduct(product, exclude, db);
        cursor = i + 1;
        processedInRun++;
        continue;
      }
      // Tulis SATU produk dikumpulkan lalu dikirim sebagai satu batch:
      // seluruh varian + agregat induk = 1 round-trip, bukan 4 per varian + 1.
      const pendingWrites: SqlWrite[] = [];
      const now = new Date().toISOString();
      // Jalur terpanas: produk sudah terdaftar dengan pasangan katalog hidup
      // (48/48 pada sweep normal). Tulisnya ikut batch produk, jadi tidak ada
      // round-trip sebelum batch. Sisanya (baru/yatim/excluded) tetap lewat
      // upsertWrProduct yang berurutan.
      const registry = productRows.get(String(product.id || ""));
      let axvaraProductId: number;
      if (registry && registry.catalogAlive && registry.linked > 0) {
        axvaraProductId = registry.linked;
        pendingWrites.push(...planLinkedProductWrites(product, registry.linked, now));
        result.synced++;
      } else {
        const upserted = await upsertWrProduct(product, { excluded: false, reason: null }, db);
        axvaraProductId = upserted.axvaraProductId;
        if (upserted.isNew) result.newProducts++;
        result.synced++;
      }
      for (const variant of product.variants || []) {
        if (!variant?.id) continue;
        seenVariantIds.add(String(variant.id));
        const existing = variantRows.get(String(variant.id));
        let outcome: VariantOutcome;
        if (existing) {
          const planned = planExistingVariantWrites(variant, existing, now);
          pendingWrites.push(...planned.writes);
          outcome = planned.outcome;
        } else {
          // Varian baru butuh lastInsertRowid untuk menautkan barisnya, jadi
          // ia tetap berurutan. Tulis yang sudah terkumpul dikirim DULU agar
          // urutan efek ke DB tidak bergeser dari jalur lama.
          await runWrites(pendingWrites.splice(0), db);
          outcome = await insertNewVariant(variant, product.id, axvaraProductId, db, now);
        }
        result.variantsSynced++;
        if (outcome.isNew) result.newVariants++;
        if (outcome.stockChanged) result.stockChanges++;
        if (outcome.priceChanged) result.priceChanges++;
      }
      if (axvaraProductId) pendingWrites.push(planParentAggregateWrite(axvaraProductId));
      await runWrites(pendingWrites, db);
    } catch (error) {
      result.errors.push(
        `${String(product?.name || product?.id).slice(0, 80)}: ${
          error instanceof Error ? error.message : String(error)
        }`.slice(0, 300),
      );
    }
    cursor = i + 1;
    processedInRun++;
    // Checkpoint tahan-potong: simpan posisi + kemajuan tiap N produk agar
    // run yang dibunuh platform/deploy menyisakan jejak dan run berikut
    // melanjutkan (bukan mengulang 48 dari awal). writeSyncState best-effort
    // (try/catch di dalam) — checkpoint gagal tak menghentikan sweep.
    if (processedInRun % WR_SYNC_CHECKPOINT_EVERY === 0 && cursor < ordered.length) {
      await writeSyncState(db, "products_cursor", String(cursor));
      await writeSyncState(db, "products_progress_at", new Date().toISOString());
    }
  }
  const sweepComplete = cursor >= ordered.length;
  // Sweep dianggap PENUH hanya bila run ini memulai dari awal daftar. Tanpa
  // syarat startAt===0, run yang melanjutkan cursor (mis. 30→47) juga lolos
  // sebagai "complete" padahal seenVariantIds hanya berisi varian dari potongan
  // itu — zeroMissingVariants lalu me-nol-kan stok ~60 varian yang tidak
  // pernah dilihat run ini. Komentar guard di bawah sudah menyebut "dalam run
  // ini"; kondisinya yang belum menegakkan (ditutup 2026-09-18).
  const fullSweepInThisRun = sweepComplete && startAt === 0;
  // Simpan cursor + generasi (durable, lintas invocation).
  await writeSyncState(db, "products_cursor", String(sweepComplete ? 0 : cursor));
  await writeSyncState(db, "products_generation", generation);
  if (sweepComplete) {
    await writeSyncState(db, "products_snapshot_complete", "1");
    result.snapshotComplete = true;
  } else {
    // Sweep berhenti di tengah (budget query/waktu habis). Penanda WAJIB
    // turun ke '0': cron membacanya untuk memutuskan "lanjutkan SEGERA"
    // alih-alih menunggu interval 30 menit. Tanpa reset ini penanda macet
    // di '1' sejak sweep penuh terakhir, dan sisa katalog baru tersentuh
    // setengah jam kemudian — saat D1 lambat, katalog 48 produk butuh ~90
    // menit padahal kerjanya hanya ~2 menit CPU.
    await writeSyncState(db, "products_snapshot_complete", "0");
    result.snapshotComplete = false;
  }
  if (sweepComplete) {
    // DESTRUCTIVE GUARD (P0-4): zero-missing HANYA setelah sweep penuh
    // tervalidasi dalam run ini. Sweep parsial/budget-yield/lanjutan-cursor
    // TIDAK BOLEH me-zero varian yang belum terlihat.
    if (options.allowZeroMissing !== false && fullSweepInThisRun) {
      try {
        result.stockChanges += await zeroMissingVariants(seenVariantIds, db);
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
      // Refresh agregat induk setelah zero (P0-4): stok parent harus
      // mencerminkan varian yang baru di-nol-kan.
      try {
        await refreshAllParentAggregates(db);
      } catch {
        /* best-effort */
      }
    }
  } else if (!result.budgetYielded) {
    result.budgetYielded = true;
  }
  result.durationMs = Date.now() - started;
  const status = result.errors.length === 0 ? "success" : result.synced > 0 ? "partial" : "failed";
  await logSync({ ...result, status }, db, trigger).catch(() => undefined);
  return result;
}

/** Refresh agregat semua produk WR (dipanggil setelah zero-missing). */
async function refreshAllParentAggregates(db: DatabaseAccess): Promise<void> {
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

async function logSync(
  result: SyncResult & { status: "success" | "partial" | "failed" },
  db: DatabaseAccess,
  trigger: "manual" | "cron" = "manual",
): Promise<void> {
  await db.execRun(
    `INSERT INTO wr_sync_log
      (sync_type, status, products_total, products_synced, products_excluded,
       products_new, variants_synced, stock_changes, price_changes,
       error_message, duration_ms, trigger)
     VALUES ('products',?,?,?,?,?,?,?,?,?,?,?)`,
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
    trigger,
  );
}
