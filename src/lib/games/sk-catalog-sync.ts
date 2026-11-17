// src/lib/games/sk-catalog-sync.ts — sinkron katalog AXVARA Games dari
// Sekalipay (kategori Game, H2H). P1 (2026-11-12): schema + katalog saja;
// belum ada dispatch/quote/order/cron hook. Jalur Digiflazz lama tidak diubah.
//
// Prinsip:
//  * Kelengkapan diverifikasi dari respons MENTAH: jumlah varian == meta.total_items
//    dan is_delta !== true. Parsial/kosong/rusak tidak menulis apa pun.
//  * Hanya snapshot lengkap yang boleh menonaktifkan baris yang hilang.
//  * Semua baris diupsert via `json_each` dalam batch atomik; jumlah statement
//    diadmit sebelum klaim tulis supaya satu run tidak melewati budget cron.
//  * `enabled=1` hanya saat insert; update TIDAK pernah mengubah `enabled`
//    (admin yang menonaktifkan tetap nonaktif pada sinkron berikutnya).
//  * Harga memakai `computeGamesMarkupPrice` (OD1: default 5 %/R100) dengan
//    markup efektif varian → game → global. Override markup admin
//    (`markup_percent`/`markup_fixed`) TIDAK pernah ditimpa upsert.

import type { DatabaseAccess } from "@/lib/db-access";
import { recordSyncError, recordSyncSuccess } from "@/lib/sync-status";
import {
  getSkProxyUrl,
  isSkEnabled,
  skFetch,
  type SkVariant,
} from "@/lib/sekalipay/client";
import { computeGamesMarkupPrice } from "./pricing";
import {
  gamesEffectiveMarkup,
  readGamesPricingSettings,
  readVariantMarkupMap,
  type GamesPricingSettings,
} from "./markup";
import { isGamesNicknameProduct } from "./sellable";
import {
  GAMES_SK_NOTE_MAX,
  GAMES_SK_ZONE_MAX,
  gamesSlugify,
  sanitizeSkImageUrl,
  type GamesSkContract,
  type GamesSkContractField,
} from "./registry";

export const GAMES_SK_CATALOG_SETTING_KEY = "games_sk_catalog_sync_at";
/** Sama dengan aturan katalog Games: jangan lebih sering dari ~10 menit. */
export const GAMES_SK_CATALOG_MIN_INTERVAL_MS = 9 * 60_000;
/** Budget cron lite D1 (docs/ARCHITECTURE §cron). Admission sebelum tulis. */
export const GAMES_SK_CATALOG_STATEMENT_BUDGET = 40;
/** Statement baca yang SUDAH terpakai sebelum admission: setting sinkron, slug,
 * setting harga, markup game, dan override markup varian. */
export const GAMES_SK_CATALOG_READ_STATEMENTS = 5;
/** Statement tulis tetap setelah admission: klaim CAS + deaktivasi + penanda sukses. */
export const GAMES_SK_CATALOG_WRITE_OVERHEAD = 3;
/** Sisa budget untuk chunk upsert (40 − 3 baca − 2 tulis). */
export const GAMES_SK_CATALOG_MAX_CHUNKS = GAMES_SK_CATALOG_STATEMENT_BUDGET - GAMES_SK_CATALOG_READ_STATEMENTS - GAMES_SK_CATALOG_WRITE_OVERHEAD;
const CHUNK_ROWS = 250;
/** Batas byte payload JSON per statement (di bawah batas SQL D1). */
export const GAMES_SK_CATALOG_CHUNK_BYTES = 80_000;
const DESCRIPTION_MAX = 400;
const LABEL_MAX = 40;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export type GamesSkCatalogSyncResult =
  | { skipped: "not_configured" | "throttled" | "claimed_elsewhere" }
  | { ok: false; error: "fetch_failed" | "incomplete_catalog" | "malformed_catalog" | "budget_exceeded" | "payload_too_large"; detail?: string; statements?: number; budget?: number }
  | { ok: true; products: number; variants: number; upserted: number; deactivated: number; unsupported: number; statements: number };

type RawCategory = { name?: unknown; products?: unknown };
type RawProduct = { id?: unknown; name?: unknown; image?: unknown; variants?: unknown };

export interface GamesSkFetchedVariant {
  productId: number;
  productName: string;
  productImage: string | null;
  variant: SkVariant;
}

export type GamesSkCatalogFetch =
  | { ok: true; products: number; variants: number; total: number; rows: GamesSkFetchedVariant[] }
  | { ok: false; error: "fetch_failed" | "incomplete_catalog" | "malformed_catalog"; detail: string };

const byteLength = (value: string): number => new TextEncoder().encode(value).length;

/** Teks polos: buang tag/karakter kontrol, pertahankan isi (termasuk aturan region). */
export function gamesSkPlainText(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Ambil katalog Game SCOPE PENUH dan verifikasi kelengkapan dari metadata
 * MENTAH (bukan hasil normalisasi `fetchSkItems`).
 */
export async function fetchGamesSkCatalog(): Promise<GamesSkCatalogFetch> {
  let res: { data?: unknown; meta?: { total_items?: unknown; is_delta?: unknown } };
  try {
    res = await skFetch<{ data?: unknown; meta?: { total_items?: unknown; is_delta?: unknown } }>("v1/item", {
      query: { category: "Game", per_page: "all" },
    });
  } catch (error) {
    return { ok: false, error: "fetch_failed", detail: (error instanceof Error ? error.message : String(error)).slice(0, 200) };
  }

  const categories = res?.data;
  if (!Array.isArray(categories) || categories.length === 0) {
    return { ok: false, error: "incomplete_catalog", detail: "empty" };
  }
  const rows: GamesSkFetchedVariant[] = [];
  const seen = new Set<number>();
  let productCount = 0;
  for (const rawCategory of categories) {
    if (!rawCategory || typeof rawCategory !== "object" || Array.isArray(rawCategory)) {
      return { ok: false, error: "malformed_catalog", detail: "category" };
    }
    const category = rawCategory as RawCategory;
    if (String(category.name ?? "").trim().toLowerCase() !== "game") {
      return { ok: false, error: "malformed_catalog", detail: "category_scope" };
    }
    const products = category.products;
    if (!Array.isArray(products)) return { ok: false, error: "malformed_catalog", detail: "products" };
    for (const rawProduct of products) {
      if (!rawProduct || typeof rawProduct !== "object" || Array.isArray(rawProduct)) {
        return { ok: false, error: "malformed_catalog", detail: "product" };
      }
      const product = rawProduct as RawProduct;
      const productId = Number(product.id);
      const productName = String(product.name ?? "").trim();
      if (!Number.isInteger(productId) || productId <= 0 || productName === "" || !Array.isArray(product.variants)) {
        return { ok: false, error: "malformed_catalog", detail: "product_fields" };
      }
      productCount += 1;
      for (const rawVariant of product.variants) {
        if (!rawVariant || typeof rawVariant !== "object" || Array.isArray(rawVariant)) {
          return { ok: false, error: "malformed_catalog", detail: "variant" };
        }
        const variant = rawVariant as SkVariant;
        const variantId = Number(variant.id);
        if (!Number.isInteger(variantId) || variantId <= 0 || String(variant.name ?? "").trim() === "") {
          return { ok: false, error: "malformed_catalog", detail: "variant_fields" };
        }
        // Duplikat id berarti snapshot tidak bisa dipercaya untuk upsert unik.
        if (seen.has(variantId)) return { ok: false, error: "malformed_catalog", detail: `duplicate_variant_${variantId}` };
        seen.add(variantId);
        rows.push({
          productId,
          productName,
          productImage: typeof product.image === "string" ? product.image : null,
          variant,
        });
      }
    }
  }

  const meta = res?.meta ?? {};
  const total = Number(meta.total_items);
  if (meta.is_delta === true) return { ok: false, error: "incomplete_catalog", detail: "is_delta" };
  if (!Number.isInteger(total) || total <= 0) return { ok: false, error: "incomplete_catalog", detail: "meta_total_missing" };
  if (rows.length === 0) return { ok: false, error: "incomplete_catalog", detail: "empty" };
  if (rows.length !== total) return { ok: false, error: "incomplete_catalog", detail: `count_${rows.length}_of_${total}` };
  return { ok: true, products: productCount, variants: rows.length, total, rows };
}

const defaultLabel = (key: "note" | "zone_id"): string => (key === "note" ? "User ID" : "Zone ID");

/**
 * Normalisasi `required_fields` + `validation` per varian menjadi kontrak
 * statis. Hanya key `note`/`zone_id` yang didukung; input selalu teks (ID
 * game bisa mengandung huruf/spasi/#), panjang dibatasi, tanpa regex upstream.
 */
/** Sumber minimum untuk normalisasi kontrak (varian katalog maupun detail live). */
export type GamesSkContractSource = Pick<SkVariant,
  "order_process" | "required_fields" | "validation" | "provider_meta" | "min_order">;

export function normalizeSkGamesContract(variant: GamesSkContractSource): GamesSkContract {
  const providerMeta = variant.provider_meta;
  const openDenom = Boolean(providerMeta && typeof providerMeta === "object" && !Array.isArray(providerMeta)
    && (providerMeta as Record<string, unknown>).open_denom === true);
  const validation = variant.validation;
  const validationBad = validation !== null && validation !== undefined
    && (typeof validation !== "object" || Array.isArray(validation));
  const validationAvailable = !validationBad && (validation as { available?: unknown } | null | undefined)?.available === true;
  const validationRequiresZone = !validationBad && (validation as { requires_zone_id?: unknown } | null | undefined)?.requires_zone_id === true;
  const orderProcess = String(variant.order_process ?? "").trim().toLowerCase();
  // `min_order` hilang = default supplier yang terdokumentasi (1). Nilai ada
  // tetapi rusak TIDAK boleh ditebak menjadi 1: kontrak jadi tidak didukung.
  const rawMinOrder = variant.min_order;
  const minOrderMissing = rawMinOrder === undefined || rawMinOrder === null;
  const minOrderValue = Number(rawMinOrder);
  const minOrderInvalid = !minOrderMissing && (!Number.isInteger(minOrderValue) || minOrderValue < 1);

  let reason: string | null = null;
  const fields: GamesSkContractField[] = [];
  const rawFields = variant.required_fields;
  if (validationBad) {
    reason = "malformed_validation";
  } else if (orderProcess !== "h2h") {
    reason = "order_process";
  } else if (minOrderInvalid) {
    reason = "invalid_min_order";
  } else if (rawFields !== null && rawFields !== undefined && !Array.isArray(rawFields)) {
    reason = "malformed_required_fields";
  } else {
    const entries = Array.isArray(rawFields) ? rawFields : [];
    const present = new Map<"note" | "zone_id", boolean>();
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        reason = "malformed_required_fields";
        break;
      }
      const record = entry as Record<string, unknown>;
      const key = String(record.key ?? "").trim().toLowerCase();
      if (key !== "note" && key !== "zone_id") {
        reason = reason ?? "unknown_field";
        continue;
      }
      if (present.has(key)) {
        reason = reason ?? "duplicate_field";
        continue;
      }
      const required = record.required !== false;
      present.set(key, required);
      const label = gamesSkPlainText(record.label, LABEL_MAX) || defaultLabel(key);
      fields.push({
        key,
        label,
        required,
        input: "text",
        min: 1,
        max: key === "note" ? GAMES_SK_NOTE_MAX : GAMES_SK_ZONE_MAX,
      });
    }
    if (!reason && openDenom) reason = "open_denom";
    if (!reason && !present.has("note")) reason = "missing_note";
    if (!reason && validationRequiresZone && !present.has("zone_id")) reason = "missing_zone";
  }
  return {
    version: 1,
    fields,
    requires_zone_id: validationRequiresZone || fields.some((field) => field.key === "zone_id" && field.required),
    validation_available: validationAvailable,
    open_denom: openDenom,
    supported: reason === null,
    reason,
  };
}

interface GamesSkDbRow {
  sku: string;
  variantId: number;
  skSku: string;
  productId: number;
  productName: string;
  slug: string;
  brand: string;
  typeName: string;
  name: string;
  cost: number;
  sell: number;
  stock: number;
  minOrder: number;
  active: number;
  desc: string;
  image: string | null;
  fieldsJson: string;
  validationJson: string | null;
}

export interface GamesSkMarkupContext {
  settings: GamesPricingSettings;
  /** slug → markup persen khusus game (games_meta). */
  gamePercent: Map<string, number>;
  /** buyer_sku_code → override markup varian yang sudah ada di DB. */
  variantMarkup: Map<string, { percent: number | null; fixed: number | null }>;
}

function buildRows(
  fetched: GamesSkFetchedVariant[],
  knownSlugs: Map<number, string>,
  markup: GamesSkMarkupContext,
): { rows: GamesSkDbRow[]; contracts: GamesSkContract[]; products: number } {
  // Slug stabil per produk: pakai yang sudah tersimpan, selain itu turunkan
  // dari nama supplier dan de-duplikasi deterministik (urutan product id).
  const productIds = [...new Set(fetched.map((row) => row.productId))].sort((a, b) => a - b);
  const names = new Map<number, string>();
  for (const row of fetched) if (!names.has(row.productId)) names.set(row.productId, row.productName);
  const used = new Set(knownSlugs.values());
  const slugs = new Map(knownSlugs);
  for (const productId of productIds) {
    if (slugs.get(productId)) continue;
    const base = gamesSlugify(names.get(productId)) || `game-${productId}`;
    let slug = base;
    for (let suffix = 2; used.has(slug); suffix += 1) slug = `${base}-${suffix}`;
    slugs.set(productId, slug);
    used.add(slug);
  }

  const contracts: GamesSkContract[] = [];
  const rows = fetched.map(({ productId, productName, productImage, variant }) => {
    const variantId = Number(variant.id);
    const sku = `sk:${variantId}`;
    const contract = normalizeSkGamesContract(variant);
    contracts.push(contract);
    const price = Number(variant.price);
    const cost = Number.isFinite(price) && price > 0 ? Math.ceil(price) : 0;
    const stockRaw = Number(variant.stock);
    // -1 = stok tak terbatas (kontrak SK premium/live); 0/negatif lain = kosong.
    const stock = Number.isFinite(stockRaw) && (stockRaw === -1 || stockRaw > 0) ? Math.trunc(stockRaw) : 0;
    const minOrderRaw = variant.min_order;
    const minOrder = minOrderRaw === undefined || minOrderRaw === null
      ? 1
      : Number.isInteger(Number(minOrderRaw)) && Number(minOrderRaw) >= 1 ? Number(minOrderRaw) : Number.MAX_SAFE_INTEGER;
    const slug = slugs.get(productId) ?? (gamesSlugify(productName) || `game-${productId}`);
    // Markup efektif: override varian (sudah tersimpan) → markup game → global.
    const existing = markup.variantMarkup.get(sku);
    const effective = gamesEffectiveMarkup(
      { markup_percent: existing?.percent ?? null, markup_fixed: existing?.fixed ?? null },
      markup.gamePercent.get(slug) ?? null,
      markup.settings,
    );
    const sell = cost > 0
      ? computeGamesMarkupPrice({
          cost,
          markupPercent: effective.percent,
          markupFixed: effective.fixed,
          rounding: markup.settings.rounding,
        })
      : 0;
    return {
      sku,
      variantId,
      skSku: gamesSkPlainText(variant.sku, LABEL_MAX),
      productId,
      productName,
      slug,
      brand: productName,
      typeName: gamesSkPlainText(variant.product_type?.name, LABEL_MAX),
      name: gamesSkPlainText(variant.name, 120),
      cost,
      sell,
      stock,
      minOrder,
      active: String(variant.status ?? "").trim().toLowerCase() === "on" ? 1 : 0,
      desc: gamesSkPlainText(variant.description, DESCRIPTION_MAX),
      image: sanitizeSkImageUrl(productImage),
      fieldsJson: JSON.stringify(contract),
      validationJson: JSON.stringify({ available: contract.validation_available, requires_zone_id: contract.requires_zone_id }),
    };
  });
  return { rows, contracts, products: productIds.length };
}

function chunkRows(rows: GamesSkDbRow[]): { payloads: string[] } | { error: "payload_too_large"; detail: string } {
  const payloads: string[] = [];
  let current: GamesSkDbRow[] = [];
  let bytes = 2; // "[]"
  for (const row of rows) {
    const itemBytes = byteLength(JSON.stringify(row)) + 1;
    if (itemBytes + 2 > GAMES_SK_CATALOG_CHUNK_BYTES) {
      return { error: "payload_too_large", detail: `row_${row.sku}_${itemBytes}` };
    }
    if (current.length > 0 && (current.length >= CHUNK_ROWS || bytes + itemBytes > GAMES_SK_CATALOG_CHUNK_BYTES)) {
      payloads.push(JSON.stringify(current));
      current = [];
      bytes = 2;
    }
    current.push(row);
    bytes += itemBytes;
  }
  if (current.length > 0) payloads.push(JSON.stringify(current));
  return { payloads };
}

export function isGamesSkCatalogConfigured(): boolean {
  return isSkEnabled() && (Boolean(getSkProxyUrl()) || Boolean(process.env.SEKALIPAY_API_KEY?.trim()));
}

export async function syncGamesSkCatalog(
  db: DatabaseAccess,
  opts: { now?: number; force?: boolean } = {},
): Promise<GamesSkCatalogSyncResult> {
  if (!isGamesSkCatalogConfigured()) return { skipped: "not_configured" };
  const now = opts.now ?? Date.now();

  // Throttle berbasis nilai terakhir yang SUKSES diklaim. Run yang gagal
  // sebelum klaim tidak memakan jendela, jadi tick berikutnya boleh retry.
  const prev = await db.queryFirst("SELECT value FROM store_settings WHERE key=?", GAMES_SK_CATALOG_SETTING_KEY);
  const prevValue = prev ? String(prev.value ?? "") : null;
  const last = prevValue === null ? NaN : Number(prevValue);
  if (!opts.force && Number.isFinite(last) && now - last >= 0 && now - last < GAMES_SK_CATALOG_MIN_INTERVAL_MS) {
    return { skipped: "throttled" };
  }

  const fetched = await fetchGamesSkCatalog();
  if (!fetched.ok) {
    await recordSyncError(db, "games_sk_catalog", `${fetched.error}:${fetched.detail}`, now);
    return { ok: false, error: fetched.error, detail: fetched.detail };
  }

  const existingRows = await db.queryAll(
    `SELECT buyer_sku_code, sk_product_id, game_slug, supplier_active, sell_price, stock,
            product_name, min_order, unlimited_stock, description, image_url,
            required_fields_json, validation_json
       FROM games_products WHERE supplier='sekalipay'`,
  );
  const knownSlugs = new Map<number, string>();
  const existingBySku = new Map<string, Record<string, unknown>>();
  for (const row of existingRows) {
    const sku = String(row.buyer_sku_code ?? "");
    if (sku) existingBySku.set(sku, row);
    const productId = Number(row.sk_product_id);
    const slug = String(row.game_slug ?? "").trim();
    if (Number.isInteger(productId) && productId > 0 && slug) {
      const prevSlug = knownSlugs.get(productId);
      if (!prevSlug || slug < prevSlug) knownSlugs.set(productId, slug);
    }
  }
  const settings = await readGamesPricingSettings(db);
  const gameMarkupRows = await db.queryAll(
    "SELECT slug, markup_percent FROM games_meta WHERE markup_percent IS NOT NULL",
  ).catch(() => [] as Record<string, unknown>[]);
  const gamePercent = new Map<string, number>();
  for (const row of gameMarkupRows) {
    const slug = String(row.slug ?? "").trim();
    const percent = Number(row.markup_percent);
    if (slug && Number.isFinite(percent)) gamePercent.set(slug, percent);
  }
  // Override markup varian yang sudah diedit admin harus bertahan DAN dipakai
  // saat menghitung harga pada sinkron ini. Tabel terpisah: upsert katalog
  // tidak pernah menulisnya.
  const variantMarkup = await readVariantMarkupMap(db);

  const built = buildRows(
    fetched.rows.filter((row) => !isGamesNicknameProduct({
      buyer_sku_code: `sk:${Number(row.variant.id)}`,
      product_name: `${row.productName} ${String(row.variant.name ?? "")}`,
    })),
    knownSlugs,
    { settings, gamePercent, variantMarkup },
  );
  let catalogChanged = false;
  const builtSkus = new Set<string>();
  for (const row of built.rows) {
    builtSkus.add(row.sku);
    const prev = existingBySku.get(row.sku);
    if (!prev
      || Number(prev.supplier_active) !== row.active
      || Number(prev.sell_price) !== row.sell
      || Number(prev.stock) !== row.stock
      || String(prev.product_name ?? "") !== row.name
      || Number(prev.min_order) !== row.minOrder
      || Number(prev.unlimited_stock) !== 0
      || String(prev.description ?? "") !== row.desc
      || String(prev.image_url ?? "") !== (row.image ?? String(prev.image_url ?? ""))
      || String(prev.required_fields_json ?? "") !== row.fieldsJson
      || String(prev.validation_json ?? "") !== row.validationJson) {
      catalogChanged = true;
    }
  }
  if (!catalogChanged) {
    for (const [sku, prev] of existingBySku) {
      if (!builtSkus.has(sku) && Number(prev.supplier_active) !== 0) {
        catalogChanged = true;
        break;
      }
    }
  }
  const chunked = chunkRows(built.rows);
  if ("error" in chunked) {
    await recordSyncError(db, "games_sk_catalog", `${chunked.error}:${chunked.detail}`, now);
    return { ok: false, error: chunked.error, detail: chunked.detail };
  }

  // Admission: hitung sisa statement SETELAH 3 baca yang sudah terpakai di atas;
  // `canSpend` menilai sisa itu terhadap ceiling cron yang sebenarnya.
  const remainingStatements = chunked.payloads.length + GAMES_SK_CATALOG_WRITE_OVERHEAD;
  const statements = remainingStatements + GAMES_SK_CATALOG_READ_STATEMENTS;
  if (remainingStatements > GAMES_SK_CATALOG_MAX_CHUNKS + GAMES_SK_CATALOG_WRITE_OVERHEAD
    || statements > GAMES_SK_CATALOG_STATEMENT_BUDGET || !db.canSpend(remainingStatements)) {
    await recordSyncError(db, "games_sk_catalog", `budget_exceeded:${statements}>${GAMES_SK_CATALOG_STATEMENT_BUDGET}`, now);
    return {
      ok: false,
      error: "budget_exceeded",
      detail: `${statements}>${GAMES_SK_CATALOG_STATEMENT_BUDGET}`,
      statements,
      budget: GAMES_SK_CATALOG_STATEMENT_BUDGET,
    };
  }

  const claim = prevValue === null
    ? await db.execRun(
        "INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO NOTHING",
        GAMES_SK_CATALOG_SETTING_KEY,
        String(now),
      )
    : await db.execRun(
        "UPDATE store_settings SET value=?, updated_at=datetime('now') WHERE key=? AND value=?",
        String(now),
        GAMES_SK_CATALOG_SETTING_KEY,
        prevValue,
      );
  if (claim.changes !== 1) return { skipped: "claimed_elsewhere" };

  const syncedAt = new Date(now).toISOString();
  let deactivated = 0;
  try {
    if (db.d1) {
      const { generateCatalogRevision, noteCatalogRevisionUpdated } = await import("@/lib/catalog-cache");
      const nextRevision = catalogChanged ? generateCatalogRevision(db) : null;
      // Satu batch atomik: kegagalan di tengah tidak meninggalkan snapshot parsial.
      const results = await db.d1.batch([
        ...chunked.payloads.map((payload) => db.d1!.prepare(UPSERT_SQL).bind(syncedAt, syncedAt, payload)),
        db.d1.prepare(DEACTIVATE_SQL).bind(syncedAt),
        nextRevision
          ? db.d1.prepare(SUCCESS_MARKER_WITH_REV_SQL).bind(
              "games_sk_catalog_success_at",
              String(now),
              "games_sk_catalog_last_error",
              nextRevision,
            )
          : db.d1.prepare(SUCCESS_MARKER_SQL).bind("games_sk_catalog_success_at", String(now), "games_sk_catalog_last_error"),
      ]);
      deactivated = Number(results[chunked.payloads.length]?.meta?.changes ?? 0);
      if (nextRevision) noteCatalogRevisionUpdated("games", nextRevision, db);
    } else {
      for (const payload of chunked.payloads) await db.execRun(UPSERT_SQL, syncedAt, syncedAt, payload);
      deactivated = Number((await db.execRun(DEACTIVATE_SQL, syncedAt)).changes ?? 0);
      await recordSyncSuccess(db, "games_sk_catalog", now);
      if (catalogChanged || deactivated > 0) {
        const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
        await bumpCatalogRevision("games", db);
      }
    }
  } catch (error) {
    await recordSyncError(db, "games_sk_catalog", error, now);
    throw error;
  }

  return {
    ok: true,
    products: built.products,
    variants: fetched.variants,
    upserted: built.rows.length,
    deactivated,
    unsupported: built.contracts.filter((contract) => !contract.supported).length,
    statements,
  };
}

const SUCCESS_MARKER_SQL = `INSERT INTO store_settings (key, value, updated_at)
VALUES (?, ?, datetime('now')), (?, '', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`;

const SUCCESS_MARKER_WITH_REV_SQL = `INSERT INTO store_settings (key, value, updated_at)
VALUES (?, ?, datetime('now')), (?, '', datetime('now')), ('catalog_revision_games', ?, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`;

const UPSERT_SQL = `INSERT INTO games_products
  (buyer_sku_code, supplier, supplier_active, sk_variant_id, sk_sku, sk_product_id, sk_product_name,
   game_slug, game_brand, product_type, product_type_name, product_name, cost, sell_price, stock,
   min_order, unlimited_stock, description, image_url, required_fields_json, validation_json,
   enabled, synced_at, updated_at)
SELECT json_extract(value,'$.sku'), 'sekalipay', json_extract(value,'$.active'),
  json_extract(value,'$.variantId'), json_extract(value,'$.skSku'), json_extract(value,'$.productId'),
  json_extract(value,'$.productName'), json_extract(value,'$.slug'), json_extract(value,'$.brand'),
  json_extract(value,'$.typeName'), json_extract(value,'$.typeName'), json_extract(value,'$.name'),
  json_extract(value,'$.cost'), json_extract(value,'$.sell'), json_extract(value,'$.stock'),
  json_extract(value,'$.minOrder'), 0, json_extract(value,'$.desc'), json_extract(value,'$.image'),
  json_extract(value,'$.fieldsJson'), json_extract(value,'$.validationJson'), 1, ?, ?
FROM json_each(?) WHERE true
ON CONFLICT(buyer_sku_code) DO UPDATE SET
  supplier = 'sekalipay',
  supplier_active = excluded.supplier_active,
  sk_variant_id = excluded.sk_variant_id,
  sk_sku = excluded.sk_sku,
  sk_product_id = excluded.sk_product_id,
  sk_product_name = excluded.sk_product_name,
  game_slug = COALESCE(games_products.game_slug, excluded.game_slug),
  game_brand = excluded.game_brand,
  product_type = excluded.product_type,
  product_type_name = excluded.product_type_name,
  product_name = excluded.product_name,
  cost = excluded.cost,
  sell_price = excluded.sell_price,
  stock = excluded.stock,
  min_order = excluded.min_order,
  unlimited_stock = excluded.unlimited_stock,
  description = excluded.description,
  image_url = COALESCE(excluded.image_url, games_products.image_url),
  required_fields_json = excluded.required_fields_json,
  validation_json = excluded.validation_json,
  synced_at = excluded.synced_at,
  updated_at = excluded.updated_at`;

const DEACTIVATE_SQL = `UPDATE games_products SET supplier_active=0, updated_at=datetime('now')
  WHERE supplier='sekalipay' AND synced_at IS NOT NULL AND synced_at < ? AND supplier_active<>0`;
