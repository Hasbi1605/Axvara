// src/lib/games/catalog-sync.ts — sinkron katalog Games dari price-list Digiflazz
// (docs/GAMES.md §12.5, harga referensi §12.7 P1). Dipanggil cron lite
// `games_catalog`; tidak pernah dari page view. Tidak mengubah `enabled`,
// `display_group` maupun `display_order`.
//
// Harga referensi dibaca dari `games_reference_prices` (sumber kebenaran, input
// admin) lalu DICERMINKAN ke `games_products.reference_price` + `sell_price`
// saat upsert. SKU tanpa baris referensi memakai batas bawah modal.
//
// Budget D1 (cron lite = 40 statement): ±600 baris diupsert lewat `json_each`
// dalam chunk 50 baris → ±12 statement upsert, bukan satu statement per baris.

import type { DatabaseAccess } from "@/lib/db-access";
import { recordSyncError, recordSyncSuccess } from "@/lib/sync-status";
import { fetchPrepaidPriceList, isDigiflazzConfigured, type DigiflazzPriceItem } from "./digiflazz";
import { computeGamesSellPrice } from "./pricing";

export const GAMES_CATALOG_SETTING_KEY = "games_catalog_sync_at";
/** Spesifikasi ≥10 menit; toleransi 1 menit karena tick cron `:x0` bisa tiba
 * beberapa detik lebih awal dari tick sebelumnya dicatat. */
export const GAMES_CATALOG_MIN_INTERVAL_MS = 9 * 60_000;
const CHUNK = 50;
const DESCRIPTION_MAX = 400;

export type GamesCatalogSyncResult =
  | { skipped: "not_configured" | "throttled" | "claimed_elsewhere" }
  | { ok: false; error: string; detail?: string }
  | { ok: true; games: number; upserted: number; backups_linked: number; deactivated: number; invalid: number };

const isGames = (item: DigiflazzPriceItem) => item.category.trim().toLowerCase() === "games";

export async function syncGamesCatalog(
  db: DatabaseAccess,
  opts: { now?: number; force?: boolean } = {},
): Promise<GamesCatalogSyncResult> {
  if (!isDigiflazzConfigured()) return { skipped: "not_configured" };
  const now = opts.now ?? Date.now();

  // Throttle + klaim CAS: hanya satu isolate yang lolos per jendela.
  const prev = await db.queryFirst("SELECT value FROM store_settings WHERE key=?", GAMES_CATALOG_SETTING_KEY);
  const prevValue = prev ? String(prev.value ?? "") : null;
  const last = prevValue === null ? NaN : Number(prevValue);
  if (!opts.force && Number.isFinite(last) && now - last >= 0 && now - last < GAMES_CATALOG_MIN_INTERVAL_MS) {
    return { skipped: "throttled" };
  }
  const claim = prevValue === null
    ? await db.execRun("INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO NOTHING", GAMES_CATALOG_SETTING_KEY, String(now))
    : await db.execRun("UPDATE store_settings SET value=?, updated_at=datetime('now') WHERE key=? AND value=?", String(now), GAMES_CATALOG_SETTING_KEY, prevValue);
  if (claim.changes !== 1) return { skipped: "claimed_elsewhere" };

  const listed = await fetchPrepaidPriceList();
  if (listed.kind !== "ok") {
    const detail = listed.kind === "api_error" ? `${listed.rc} ${listed.message}`.trim()
      : listed.kind === "http_error" ? `http_${listed.status}` : listed.reason;
    const error = `price_list_${listed.kind}`;
    await recordSyncError(db, "games_catalog", detail ? `${error}:${detail}` : error, now);
    return { ok: false, error, detail: detail.slice(0, 200) };
  }

  const games = listed.items.filter((item) => isGames(item) && item.price > 0 && item.product_name !== "");
  // Daftar kosong hampir pasti salah filter/akun, bukan "semua SKU hilang".
  if (games.length === 0) {
    await recordSyncError(db, "games_catalog", "empty_games_catalog", now);
    return { ok: false, error: "empty_games_catalog" };
  }

  const codes = new Set(games.map((g) => g.buyer_sku_code));
  const isBackup = (g: DigiflazzPriceItem) => g.buyer_sku_code.endsWith("b") && codes.has(g.buyer_sku_code.slice(0, -1));
  const backups = new Map<string, DigiflazzPriceItem>();
  for (const g of games) if (isBackup(g)) backups.set(g.buyer_sku_code.slice(0, -1), g);

  // Harga referensi (sumber kebenaran `games_reference_prices`, input admin)
  // dipakai untuk menghitung ulang sell_price sekaligus mencerminkannya.
  const refRows = await db.queryAll("SELECT buyer_sku_code, price FROM games_reference_prices");
  const refs = new Map(refRows.map((r) => [String(r.buyer_sku_code), Number(r.price)]));

  const syncedAt = new Date(now).toISOString();
  const rows = games.filter((g) => !isBackup(g)).map((g) => {
    const backup = backups.get(g.buyer_sku_code);
    const ref = refs.get(g.buyer_sku_code);
    return {
      sku: g.buyer_sku_code,
      backup_sku: backup?.buyer_sku_code ?? null,
      brand: g.brand,
      type: g.type,
      name: g.product_name,
      cost: Math.ceil(g.price),
      backup_cost: backup ? Math.ceil(backup.price) : null,
      active: g.buyer_product_status && g.seller_product_status ? 1 : 0,
      backup_active: backup && backup.buyer_product_status && backup.seller_product_status ? 1 : 0,
      unlimited: g.unlimited_stock ? 1 : 0,
      stock: Math.trunc(g.stock),
      multi: g.multi ? 1 : 0,
      start: g.start_cut_off,
      end: g.end_cut_off,
      desc: g.desc.slice(0, DESCRIPTION_MAX),
      reference: ref ?? null,
      sell: computeGamesSellPrice({ cost: Math.ceil(g.price), referencePrice: ref ?? null }).price,
    };
  });

  try {
    let upserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await db.execRun(UPSERT_SQL, syncedAt, syncedAt, JSON.stringify(chunk));
      upserted += chunk.length;
    }

    // Hanya setelah semua chunk sukses: baris yang pernah disinkron tapi tidak
    // tersentuh run ini hilang dari price-list.
    const gone = await db.execRun(
      `UPDATE games_products SET seller_active=0, backup_seller_active=0, updated_at=datetime('now')
       WHERE synced_at IS NOT NULL AND synced_at < ? AND (seller_active<>0 OR backup_seller_active<>0)`,
      syncedAt,
    );

    await recordSyncSuccess(db, "games_catalog", now);

    return {
      ok: true,
      games: games.length,
      upserted,
      backups_linked: rows.filter((r) => r.backup_sku).length,
      deactivated: Number(gone.changes ?? 0),
      invalid: listed.invalid,
    };
  } catch (error) {
    await recordSyncError(db, "games_catalog", error, now);
    throw error;
  }
}

const UPSERT_SQL = `INSERT INTO games_products
  (buyer_sku_code, backup_sku_code, game_brand, product_type, product_name, cost, backup_cost,
   seller_active, backup_seller_active, unlimited_stock, stock, multi, start_cut_off, end_cut_off,
   description, reference_price, sell_price, synced_at, updated_at)
SELECT json_extract(value,'$.sku'), json_extract(value,'$.backup_sku'), json_extract(value,'$.brand'),
  json_extract(value,'$.type'), json_extract(value,'$.name'), json_extract(value,'$.cost'),
  json_extract(value,'$.backup_cost'), json_extract(value,'$.active'), json_extract(value,'$.backup_active'),
  json_extract(value,'$.unlimited'), json_extract(value,'$.stock'), json_extract(value,'$.multi'),
  json_extract(value,'$.start'), json_extract(value,'$.end'), json_extract(value,'$.desc'),
  json_extract(value,'$.reference'), json_extract(value,'$.sell'), ?, ?
FROM json_each(?) WHERE true
ON CONFLICT(buyer_sku_code) DO UPDATE SET
  backup_sku_code = COALESCE(excluded.backup_sku_code, games_products.backup_sku_code),
  game_brand = excluded.game_brand,
  product_type = excluded.product_type,
  product_name = excluded.product_name,
  cost = excluded.cost,
  backup_cost = COALESCE(excluded.backup_cost, games_products.backup_cost),
  seller_active = excluded.seller_active,
  backup_seller_active = CASE WHEN excluded.backup_sku_code IS NULL THEN 0 ELSE excluded.backup_seller_active END,
  unlimited_stock = excluded.unlimited_stock,
  stock = excluded.stock,
  multi = excluded.multi,
  start_cut_off = excluded.start_cut_off,
  end_cut_off = excluded.end_cut_off,
  description = excluded.description,
  reference_price = excluded.reference_price,
  sell_price = excluded.sell_price,
  synced_at = excluded.synced_at,
  updated_at = excluded.updated_at`;
