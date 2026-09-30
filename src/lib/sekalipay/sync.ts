// src/lib/sekalipay/sync.ts — Sync engine Sekalipay → Axvara (supplier kedua).
//
// STRATEGI (keputusan owner 2026-09-30): SK paralel dengan WR, BUKAN failover
// otomatis. Produk yang tampil dipilih manual (Netflix WR vs Netflix SK =
// dua baris katalog berbeda, admin yang mengaktifkan salah satu).
//
// Kontrak kepemilikan (cermin migrasi WR 0030):
//   SK    : stok, harga modal, label varian, seller_note, order_process.
//   Admin : foto, badge, sort_order, is_active, markup, tampil/tidak.
// Sync TIDAK PERNAH menulis: sold_count, admin_* copy, require_email,
// min_qty, fulfillment_mode non-SK.
//
// Fase 1: hanya varian `order_process=auto` kategori Aplikasi Premium yang
// dibuatkan pasangan katalog. Varian manual/h2h/smm/vip dicatat di registry
// (sk_variants) tapi TANPA pasangan katalog — dibuka bertahap fase 2+.
//
  // Budget-aware (pola WR sync.ts): maxStatements + cursor + timeBudgetMs +
  // zero-missing hanya setelah sweep penuh tervalidasi dalam run ini.
  //
  // SCOPE FETCH (2026-09-30): selalu `category=Aplikasi Premium` (+ delta
  // `updated_since` saat cron). Full all-kategori 4,3MB/11–29 dtk = timeout
  // BERULANG (6x sk_request_timeout + 1x Heroku 503); premium-only 99 varian /
  // 93KB / ~3,6 dtk, premium+delta 104 varian / 95KB / ~7 dtk. Cursor +
// zero-missing berlaku dalam scope premium (bukan all-kategori).

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import {
  fetchSkItems,
  isSkSyncEnabled,
  SK_SYNC_CATEGORY,
  type SkCategory,
  type SkVariant,
} from "./client";

export type SkSyncResult = {
  /** Produk unik (sk_product_id) yang disentuh run ini — cermin WR products_synced. */
  total: number;
  synced: number;
  skippedNonAuto: number;
  newProducts: number;
  newVariants: number;
  /** Varian yang pasangan katalognya di-refresh — cermin WR variants_synced. */
  variantsSynced: number;
  stockChanges: number;
  priceChanges: number;
  errors: string[];
  durationMs: number;
  budgetYielded: boolean;
  snapshotComplete: boolean;
};

export const COST_PER_SK_PRODUCT_SYNC = 3;
export const COST_PER_SK_VARIANT_SYNC = 2;
// Fase 1 sempit (1 kategori premium): 24 produk/run cukup; cursor fallback.
export const SK_SYNC_PRODUCTS_PER_RUN = 24;
export const SK_SYNC_CATALOG_BUDGET_EXTRA = 400;
export const SK_SYNC_MIN_PRODUCTS_GUARD = 1;
export const SK_SYNC_CHECKPOINT_EVERY = 8;

type Row = Record<string, unknown>;

/** Hanya varian auto yang dibuatkan katalog di fase 1. */
export function isSkAutoVariant(variant: Pick<SkVariant, "order_process">): boolean {
  return String(variant?.order_process || "") === "auto";
}

function defaultMarkupPercent(): number {
  const raw = Number(process.env.SEKALIPAY_DEFAULT_MARKUP_PERCENT ?? 50);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 50;
}

function defaultMarkupFixed(): number {
  const raw = Number(process.env.SEKALIPAY_DEFAULT_MARKUP_FIXED ?? 0);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}

function defaultCategoryId(): number {
  const raw = Number(process.env.SEKALIPAY_DEFAULT_CATEGORY_ID ?? 1);
  return Number.isInteger(raw) && raw > 0 ? raw : 1;
}

/** Harga jual = ceil(modal × (1 + %)) + fixed, kelipatan 500 (sama dengan WR). */
export function calculateSkSellPrice(modal: number, markupPercent: number, markupFixed: number): number {
  const base = Math.ceil(modal * (1 + markupPercent / 100)) + markupFixed;
  return Math.ceil(base / 500) * 500;
}

export function generateSkProductSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "produk-sk";
}

/** Map kategori SK → category_id Axvara. Default: AI & Chatbot (id 1). */
export function mapSkCategory(skCategory: string | null | undefined): number {
  const lowered = String(skCategory ?? "").trim().toLowerCase();
  if (lowered.includes("stream") || lowered.includes("hibur") || lowered.includes("musik") || lowered.includes("video")) return 2;
  if (lowered.includes("productiv") || lowered.includes("office") || lowered.includes("educ") || lowered.includes("belajar")) return 3;
  if (lowered.includes("design") || lowered.includes("desain") || lowered.includes("canva") || lowered.includes("edit")) return 5;
  if (lowered.includes("vpn") || lowered.includes("develop") || lowered.includes("code") || lowered.includes("tool")) return 6;
  if (lowered.includes("bundle") || lowered.includes("hemat") || lowered.includes("paket")) return 4;
  return defaultCategoryId();
}

/**
 * Cek exclusion via tabel sk_exclusions (cermin WR isExcluded): produk yang
 * cocok pola tidak dibuatkan pasangan katalog (registry tetap dicatat agar
 * keputusan terlihat di panel admin).
 */
export async function isSkExcluded(
  productName: string,
  db: DatabaseAccess,
  cachedRules?: { pattern: string; reason: string | null }[] | null,
): Promise<{ excluded: boolean; reason: string | null }> {
  const rules =
    cachedRules ??
    ((await db
      .queryAll(`SELECT pattern, reason FROM sk_exclusions`)
      .catch(() => [] as Row[])) as { pattern: string; reason: string | null }[]);
  const lowered = productName.toLowerCase();
  for (const rule of rules) {
    const pattern = String(rule.pattern || "").toLowerCase();
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

/** Flatten respons GET /v1/item → daftar {category, product, variant}. */
export type SkFlatVariant = {
  categoryName: string;
  productId: number;
  productName: string;
  productImage: string | null;
  variant: SkVariant;
};

export function flattenSkItems(categories: SkCategory[]): SkFlatVariant[] {
  const out: SkFlatVariant[] = [];
  for (const cat of categories || []) {
    for (const product of cat?.products || []) {
      for (const variant of product?.variants || []) {
        if (variant?.id == null) continue;
        out.push({
          categoryName: String(cat?.name || ""),
          productId: Number(product?.id),
          productName: String(product?.name || ""),
          productImage: product?.image ? String(product.image) : null,
          variant,
        });
      }
    }
  }
  return out.sort((a, b) => a.variant.id - b.variant.id);
}

async function writeSyncState(db: DatabaseAccess, key: string, value: string): Promise<void> {
  try {
    await db.execRun(
      `INSERT INTO sk_sync_state (key, value, updated_at) VALUES (?,?,datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
       WHERE sk_sync_state.value IS NOT excluded.value`,
      key,
      value,
    );
  } catch {
    /* DB pre-0049: cursor best-effort */
  }
}

export async function readSkSyncState(db: DatabaseAccess): Promise<{
  cursor: number;
  serverTime: string;
  snapshotComplete: boolean;
}> {
  const out = { cursor: 0, serverTime: "", snapshotComplete: false };
  try {
    const rows = await db.queryAll(`SELECT key, value FROM sk_sync_state`);
    for (const row of rows) {
      const key = String(row.key || "");
      if (key === "products_cursor") out.cursor = Math.max(0, Number(row.value || 0));
      else if (key === "products_server_time") out.serverTime = String(row.value || "");
      else if (key === "products_snapshot_complete") out.snapshotComplete = String(row.value) === "1";
    }
  } catch {
    /* DB pre-0049: mulai dari awal */
  }
  return out;
}

export function validateSkCatalogResponse(
  items: unknown,
  previousCount: number,
): { ok: boolean; reason: string | null } {
  if (!Array.isArray(items)) return { ok: false, reason: "catalog_malformed_not_array" };
  if (items.length === 0 && previousCount > 0) {
    return { ok: false, reason: "catalog_suspicious_empty" };
  }
  return { ok: true, reason: null };
}

export type SkSyncOptions = {
  maxProducts?: number;
  allowZeroMissing?: boolean;
  trigger?: "manual" | "cron";
  timeBudgetMs?: number;
  /** true = full `per_page=all` walau server_time sudah ada (Force Sync admin). */
  full?: boolean;
};

/** Penanda produk SK di katalog utama (pola fulfillment WR: mode 'manual' +
 *  wr_link_id NOT NULL — CHECK lama tidak disentuh, D1 menolak rebuild).
 *  D1 prod memakai CHECK source lama (manual/warung_rebahan): baris SK memakai
 *  source='manual' + sk_product_id NOT NULL. Bootstrap baru (schema.sql final)
 *  memakai source='sekalipay'. Kode WAJIB memakai helper ini, bukan literal. */
export const SK_PRODUCT_SOURCE_LEGACY = "manual";
export const SK_PRODUCT_SOURCE_FINAL = "sekalipay";

export function skProductWhere(prefix = ""): string {
  const p = prefix ? `${prefix}.` : "";
  return `(${p}sk_product_id IS NOT NULL)`;
}

/** Buat baris katalog Axvara untuk satu produk SK (anti-bentrok slug + nama (SK)). */
async function createAxvaraCatalogForSk(
  categoryName: string,
  productName: string,
  db: DatabaseAccess,
  now: string,
  skProductId: number,
): Promise<number> {
  const { queryFirst, execRun } = db;
  // Duplikat SK = sk_product_id cocok (tanpa filter source: D1 prod memakai
  // source=manual + sk_product_id, bootstrap baru source=sekalipay).
  const dupe = await queryFirst(
    `SELECT id FROM products WHERE sk_product_id=? LIMIT 1`,
    String(skProductId),
  );
  if (dupe) return Number(dupe.id);
  const baseSlug = `${generateSkProductSlug(productName)}-sk`;
  let slug = baseSlug;
  for (let attempt = 0; attempt < 5; attempt++) {
    const collision = await queryFirst(`SELECT id FROM products WHERE slug=?`, slug);
    if (!collision) break;
    slug = `${baseSlug}-${attempt + 2}`.slice(0, 80);
  }
  const slugTaken = await queryFirst(`SELECT id FROM products WHERE slug=?`, slug);
  if (slugTaken) throw new Error(`sk_slug_collision:${slug}`);
  // Nama storefront BERSIH tanpa suffix supplier (keputusan owner 2026-09-30:
  // pembeli tahu ini produk Axvara, bukan toko lain). Pembedaan WR vs SK hanya
  // di admin (badge asal) + slug (-sk). Nama ditulis SEKALI saat create dan
  // tidak pernah ditulis ulang sync (kupasan nama di bawah untuk data lama).
  const displayName = productName.trim();
  const categoryId = mapSkCategory(categoryName);
  const created = await execRun(
    `INSERT INTO products
      (category_id, name, slug, description, price, stock, is_active, sort_order,
       source, sk_product_id, sk_auto_managed, created_at, updated_at)
      VALUES (?,?,?,?,0,0,1,
        COALESCE((SELECT MIN(999989, MAX(sort_order)) + 10 FROM products),10),
        'manual',?,1,?,?)`,
    categoryId,
    displayName,
    slug,
    null,
    String(skProductId),
    now,
    now,
  );
  const axvaraProductId = Number(created.lastInsertRowid ?? 0);
  if (!axvaraProductId) throw new Error("sk_product_insert_failed");
  return axvaraProductId;
}

export async function syncSkProducts(
  database?: DatabaseAccess,
  fetchFn?: () => Promise<{ data: SkCategory[]; server_time: string }>,
  options: SkSyncOptions = {},
): Promise<SkSyncResult> {
  const started = Date.now();
  const db = database ?? createDatabaseAccess();
  const trigger = options.trigger ?? "manual";
  const maxProducts = Math.max(1, Math.min(options.maxProducts ?? SK_SYNC_PRODUCTS_PER_RUN, 48));
  const timeBudgetMs = Number(options.timeBudgetMs ?? 0);
  const hasTimeBudget = Number.isFinite(timeBudgetMs) && timeBudgetMs > 0;
  const timeLeftMs = () => timeBudgetMs - (Date.now() - started);
  const result: SkSyncResult = {
    total: 0,
    synced: 0,
    skippedNonAuto: 0,
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
  if (!isSkSyncEnabled()) {
    result.errors.push("sekalipay_disabled");
    result.durationMs = Date.now() - started;
    return result;
  }
  const state = await readSkSyncState(db);
  (db as unknown as { raiseCeilingForCatalogSync?: (n: number) => void }).raiseCeilingForCatalogSync?.(
    SK_SYNC_CATALOG_BUDGET_EXTRA,
  );
  let fetched: { data: SkCategory[]; server_time: string };
  try {
    // Scope hemat fase 1 (2026-09-30): HANYA kategori Aplikasi Premium.
    // Pelajaran 6x sk_request_timeout 09:05–10:00 + 1x Heroku 503: "delta"
    // tanpa scope masih 2681 varian / 1,8MB / 9–29 dtk (gagal BERULANG).
    // Premium + delta = 104 varian / 95KB / ~7 dtk — muat timeout Pages 12 dtk.
    // Full hanya saat belum pernah sync atau Force Sync admin (jujur +
    // zero-missing hanya jalan di sweep penuh scope premium).
    const since = state.serverTime.trim();
    const wantFull = options.full === true || !since;
    const scopeParams = wantFull
      ? { perPage: "all" as const, category: SK_SYNC_CATEGORY }
      : { perPage: "all" as const, category: SK_SYNC_CATEGORY, updatedSince: since };
    const res = await (fetchFn
      ? fetchFn()
      : fetchSkItems(scopeParams));
    fetched = res;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message.slice(0, 300));
    await logSkSync({ ...result, status: "failed" }, db, trigger).catch(() => undefined);
    result.durationMs = Date.now() - started;
    return result;
  }
  const flat = flattenSkItems(fetched.data);
  const validation = validateSkCatalogResponse(
    flat,
    state.snapshotComplete ? Math.max(state.cursor, 1) : 0,
  );
  if (!validation.ok) {
    result.errors.push(validation.reason || "catalog_rejected");
    await logSkSync({ ...result, status: "failed" }, db, trigger).catch(() => undefined);
    result.durationMs = Date.now() - started;
    return result;
  }
  result.total = flat.length;
  // SEMANTIK products_synced SK (2026-09-30, cermin WR): jumlah PRODUK
  // (sk_product_id unik) yang disentuh run ini, bukan jumlah baris varian.
  // Panel menampilkan p/v seperti WR (48p/90v); total = varian dalam scope.
  const touchedProductIds = new Set<string>();
  const startAt = state.cursor >= flat.length ? 0 : state.cursor;
  let cursor = startAt;
  let processedInRun = 0;
  const seenVariantIds = new Set<string>();
  const now = new Date().toISOString();
  // Cache exclusion rules sekali per run (pola WR): 1 query, bukan N.
  const cachedExclusions = (await db
    .queryAll(`SELECT pattern, reason FROM sk_exclusions`)
    .catch(() => [] as Row[])) as { pattern: string; reason: string | null }[];
  for (let i = startAt; i < flat.length; i++) {
    const row = flat[i];
    const variant = row.variant;
    const skVariantId = String(variant.id);
    seenVariantIds.add(skVariantId);
    if (!db.canSpend(COST_PER_SK_PRODUCT_SYNC + COST_PER_SK_VARIANT_SYNC + 2)) {
      result.budgetYielded = true;
      break;
    }
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
      // Registry SELALU dicatat (semua order_process) — katalog hanya untuk auto.
      const auto = isSkAutoVariant(variant);
      if (!auto) result.skippedNonAuto++;
      // Exclusion: produk yang cocok pola tidak dibuatkan pasangan katalog
      // (registry tetap dicatat agar keputusan terlihat di panel admin).
      const exclude = await isSkExcluded(row.productName, db, cachedExclusions);
      const catalogAllowed = auto && !exclude.excluded;
      const regExisting = await db
        .queryFirst(`SELECT id, axvara_product_id, axvara_variant_id FROM sk_products WHERE sk_variant_id=?`, skVariantId)
        .catch(() => null);
      let axvaraProductId = regExisting?.axvara_product_id != null ? Number(regExisting.axvara_product_id) : 0;
      let axvaraVariantId = regExisting?.axvara_variant_id != null ? Number(regExisting.axvara_variant_id) : 0;
      if (auto && !(axvaraProductId > 0)) {
        // Guard link yatim: registry tanpa pasangan / pasangan hilang → buat baru.
        // Dikecualikan exclusion: jangan buat katalog untuk produk yang difilter.
        if (!catalogAllowed) {
          axvaraProductId = 0;
          axvaraVariantId = 0;
        } else {
          const alive = axvaraProductId > 0
            ? await db
                .queryFirst(
                  `SELECT id FROM products WHERE id=? AND sk_product_id=?`,
                  axvaraProductId,
                  String(row.productId),
                )
                .catch(() => null)
            : null;
          if (!alive) {
            axvaraProductId = await createAxvaraCatalogForSk(row.categoryName, row.productName, db, now, row.productId);
            result.newProducts++;
            axvaraVariantId = 0;
          }
        }
      }
      if (catalogAllowed && axvaraProductId > 0 && !(axvaraVariantId > 0)) {
        const created = await db.execRun(
          `INSERT INTO product_variants
            (product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order,
             sk_variant_id, sk_auto_managed, created_at, updated_at)
           VALUES (?,?,?,?,?, 'manual', 1, 0, ?, 1, ?, ?)`,
          axvaraProductId,
          `SK-${skVariantId}`.slice(0, 40),
          variant.name,
          calculateSkSellPrice(Number(variant.price), defaultMarkupPercent(), defaultMarkupFixed()),
          Number(variant.stock),
          skVariantId,
          now,
          now,
        ).catch(() => ({ changes: 0 as number | undefined, lastInsertRowid: undefined as number | undefined }));
        axvaraVariantId = Number(created.lastInsertRowid ?? 0);
        if (!axvaraVariantId) {
          const conflict = await db
            .queryFirst(`SELECT id FROM product_variants WHERE sku=?`, `SK-${skVariantId}`.slice(0, 40))
            .catch(() => null);
          axvaraVariantId = conflict ? Number(conflict.id) : 0;
        }
        if (axvaraVariantId > 0) {
          await db.execRun(
            `UPDATE product_variants SET sk_variant_id=?, sk_auto_managed=1, updated_at=datetime('now') WHERE id=?`,
            skVariantId,
            axvaraVariantId,
          ).catch(() => ({ changes: 0 }));
          result.newVariants++;
        }
      }
      // Upsert registry (idempoten). Field khas SK ikut tersimpan agar panel
      // admin bisa menampilkan capability tanpa panggil API lagi: min_order,
      // status, description, seller_note, required_fields, validation.
      const sellPrice = calculateSkSellPrice(Number(variant.price), defaultMarkupPercent(), defaultMarkupFixed());
      const skDescription = typeof variant.description === "string" ? variant.description.slice(0, 2000) : null;
      const skSellerNote = typeof (variant as { seller_note?: unknown }).seller_note === "string"
        ? String((variant as { seller_note?: unknown }).seller_note).slice(0, 2000)
        : null;
      const skRequiredFields = Array.isArray(variant.required_fields)
        ? JSON.stringify(variant.required_fields).slice(0, 2000)
        : null;
      const skValidation = variant.validation != null
        ? JSON.stringify(variant.validation).slice(0, 2000)
        : null;
      await db.execRun(
        `INSERT INTO sk_products
          (sk_variant_id, sk_product_id, sk_product_name, sk_category, sk_variant_name,
           sk_price, sk_stock, sk_order_process, sk_seller_note, sk_description,
           sk_min_order, sk_status, sk_required_fields, sk_validation,
           axvara_product_id,
           axvara_variant_id, markup_percent, markup_fixed, axvara_sell_price, last_synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(sk_variant_id) DO UPDATE SET
           sk_product_name=excluded.sk_product_name, sk_category=excluded.sk_category,
           sk_variant_name=excluded.sk_variant_name, sk_price=excluded.sk_price,
           sk_stock=excluded.sk_stock, sk_order_process=excluded.sk_order_process,
           sk_seller_note=excluded.sk_seller_note, sk_description=excluded.sk_description,
           sk_min_order=excluded.sk_min_order, sk_status=excluded.sk_status,
           sk_required_fields=excluded.sk_required_fields, sk_validation=excluded.sk_validation,
           axvara_product_id=COALESCE(sk_products.axvara_product_id, excluded.axvara_product_id),
           axvara_variant_id=COALESCE(sk_products.axvara_variant_id, excluded.axvara_variant_id),
            axvara_sell_price=excluded.axvara_sell_price,
            last_synced_at=excluded.last_synced_at`,
        skVariantId,
        String(row.productId),
        row.productName,
        row.categoryName || null,
        variant.name,
        Number(variant.price),
        Number(variant.stock),
        String(variant.order_process || ""),
        skSellerNote,
        skDescription,
        Number(variant.min_order ?? 1) || 1,
        typeof variant.status === "string" ? variant.status : null,
        skRequiredFields,
        skValidation,
        axvaraProductId > 0 ? axvaraProductId : null,
        axvaraVariantId > 0 ? axvaraVariantId : null,
        defaultMarkupPercent(),
        defaultMarkupFixed(),
        sellPrice,
        now,
      ).catch(() => ({ changes: 0 }));
      // Refresh harga/stok pasangan katalog (milik SK — admin pegang sisanya).
      if (catalogAllowed && axvaraVariantId > 0) {
        const before = await db
          .queryFirst(`SELECT price, stock FROM product_variants WHERE id=?`, axvaraVariantId)
          .catch(() => null);
        if (before && (Number(before.price) !== sellPrice || Number(before.stock) !== Number(variant.stock))) {
          await db.execRun(
            `UPDATE product_variants SET price=?, stock=?, label=?, updated_at=datetime('now') WHERE id=?`,
            sellPrice,
            Number(variant.stock),
            variant.name,
            axvaraVariantId,
          ).catch(() => ({ changes: 0 }));
          if (Number(before.price) !== sellPrice) result.priceChanges++;
          if (Number(before.stock) !== Number(variant.stock)) result.stockChanges++;
        }
        await db.execRun(
          `UPDATE products SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=? AND is_active=1),price),
            stock=CASE WHEN EXISTS(SELECT 1 FROM product_variants WHERE product_id=? AND is_active=1 AND stock=-1)
              THEN -1 ELSE COALESCE((SELECT SUM(CASE WHEN stock>0 THEN stock ELSE 0 END) FROM product_variants WHERE product_id=? AND is_active=1),0) END,
            updated_at=datetime('now') WHERE id=?`,
          axvaraProductId, axvaraProductId, axvaraProductId, axvaraProductId,
        ).catch(() => ({ changes: 0 }));
        result.variantsSynced++;
      }
      touchedProductIds.add(String(row.productId));
      result.synced = touchedProductIds.size;
    } catch (error) {
      result.errors.push(
        `${String(row.productName || row.variant?.id).slice(0, 80)}: ${
          error instanceof Error ? error.message : String(error)
        }`.slice(0, 300),
      );
    }
    cursor = i + 1;
    processedInRun++;
    if (processedInRun % SK_SYNC_CHECKPOINT_EVERY === 0 && cursor < flat.length) {
      await writeSyncState(db, "products_cursor", String(cursor));
    }
  }
  const sweepComplete = cursor >= flat.length;
  // fullSweep = awal→ujung daftar SCOPE INI dalam run ini (cermin WR:
  // startAt===0). BUKAN "delta vs full": delta premium 104 varian tetap
  // sweep PENUH scope premium bila dikerjakan awal→ujung — zero-missing AMAN
  // karena scope fetch tidak berubah antar run (selalu premium-only).
  const fullSweepInThisRun = sweepComplete && startAt === 0;
  await writeSyncState(db, "products_cursor", String(sweepComplete ? 0 : cursor));
  if (fetched.server_time) await writeSyncState(db, "products_server_time", String(fetched.server_time));
  if (sweepComplete) {
    await writeSyncState(db, "products_snapshot_complete", "1");
    result.snapshotComplete = true;
  } else {
    await writeSyncState(db, "products_snapshot_complete", "0");
    result.snapshotComplete = false;
  }
  if (sweepComplete) {
    if (options.allowZeroMissing !== false && fullSweepInThisRun) {
      try {
        result.stockChanges += await zeroMissingSkVariants(seenVariantIds, db);
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  } else if (!result.budgetYielded) {
    result.budgetYielded = true;
  }
  result.durationMs = Date.now() - started;
  const status = result.errors.length === 0 ? "success" : result.synced > 0 ? "partial" : "failed";
  await logSkSync({ ...result, status }, db, trigger).catch(() => undefined);
  return result;
}

/** Varian SK hilang dari respons: stok registry + katalog di-nol-kan (bukan delete). */
export async function zeroMissingSkVariants(
  seenVariantIds: Set<string>,
  db: DatabaseAccess,
): Promise<number> {
  const rows = await db
    .queryAll(`SELECT sk_variant_id, axvara_variant_id FROM sk_products WHERE is_active=1`)
    .catch(() => [] as Row[]);
  let zeroed = 0;
  const now = new Date().toISOString();
  for (const row of rows) {
    const id = String(row.sk_variant_id || "");
    if (!id || seenVariantIds.has(id)) continue;
    await db.execRun(
      `UPDATE sk_products SET sk_stock=0, last_synced_at=?, updated_at=? WHERE sk_variant_id=?`,
      now, now, id,
    );
    const axvaraVariantId = row.axvara_variant_id != null ? Number(row.axvara_variant_id) : 0;
    if (axvaraVariantId > 0) {
      await db.execRun(
        `UPDATE product_variants SET stock=0, updated_at=datetime('now') WHERE id=?`,
        axvaraVariantId,
      ).catch(() => ({ changes: 0 }));
    }
    zeroed++;
  }
  return zeroed;
}

async function logSkSync(
  result: SkSyncResult & { status: "success" | "partial" | "failed" },
  db: DatabaseAccess,
  trigger: "manual" | "cron" = "manual",
): Promise<void> {
  await db.execRun(
    `INSERT INTO sk_sync_log
      (sync_type, status, products_total, products_synced, products_excluded,
       products_new, variants_synced, stock_changes, price_changes,
       error_message, duration_ms, trigger)
     VALUES ('products',?,?,?,?,?,?,?,?,?,?,?)`,
    result.status,
    result.total,
    result.synced,
    result.skippedNonAuto,
    result.newProducts,
    result.variantsSynced,
    result.stockChanges,
    result.priceChanges,
    result.errors.length ? result.errors.slice(0, 3).join(" | ").slice(0, 500) : null,
    result.durationMs,
    trigger,
  ).catch(() => undefined);
}
