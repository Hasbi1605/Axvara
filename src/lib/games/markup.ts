// src/lib/games/markup.ts — harga markup Games (keputusan owner OD1, 14 Nov 2026)
// dan hitung ulang massal. Semua rumus ada di `pricing.ts`; modul ini hanya
// membaca/menulis setting global dan menyusun SATU statement UPDATE.
//
// Sumber markup efektif: varian (`games_products.markup_percent`/`markup_fixed`)
// → game (`games_meta.markup_percent`) → global (`store_settings`).
// Harga referensi Oura TIDAK lagi dibaca untuk baris Sekalipay.

import type { DatabaseAccess } from "@/lib/db-access";
import {
  computeGamesMarkupPrice,
  GAMES_MARKUP_DEFAULT_PERCENT,
  GAMES_MARKUP_MAX_PERCENT,
  GAMES_PRICE_DEFAULT_ROUNDING,
  GAMES_PRICE_ROUNDINGS,
  type GamesPriceRounding,
} from "./pricing";

export const GAMES_MARKUP_SETTING_KEY = "games_markup_percent";
export const GAMES_ROUNDING_SETTING_KEY = "games_price_rounding";

export interface GamesPricingSettings {
  markup_percent: number;
  rounding: GamesPriceRounding;
}

/** Markup persen sah: 0–100, maksimal 2 desimal. Melempar RangeError. */
export function parseGamesMarkupPercent(value: unknown): number {
  const percent = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent > GAMES_MARKUP_MAX_PERCENT) {
    throw new RangeError("markup_percent tidak valid");
  }
  if (Math.abs(Math.round(percent * 100) - percent * 100) > 1e-6) {
    throw new RangeError("markup_percent maksimal 2 desimal");
  }
  return percent;
}

/** Pembulatan sah: 1 | 100 | 500 | 1000. Melempar RangeError. */
export function parseGamesRounding(value: unknown): GamesPriceRounding {
  const rounding = Number(value);
  if (!(GAMES_PRICE_ROUNDINGS as readonly number[]).includes(rounding)) {
    throw new RangeError("rounding tidak valid");
  }
  return rounding as GamesPriceRounding;
}

export const DEFAULT_GAMES_PRICING: GamesPricingSettings = {
  markup_percent: GAMES_MARKUP_DEFAULT_PERCENT,
  rounding: GAMES_PRICE_DEFAULT_ROUNDING,
};

/** Baca setting global (1 statement). Nilai rusak jatuh ke default. */
export async function readGamesPricingSettings(db: DatabaseAccess): Promise<GamesPricingSettings> {
  const rows = await db.queryAll(
    "SELECT key, value FROM store_settings WHERE key IN (?, ?)",
    GAMES_MARKUP_SETTING_KEY,
    GAMES_ROUNDING_SETTING_KEY,
  );
  const values = new Map(rows.map((row) => [String(row.key), String(row.value ?? "")]));
  let markup = DEFAULT_GAMES_PRICING.markup_percent;
  let rounding = DEFAULT_GAMES_PRICING.rounding;
  try { markup = parseGamesMarkupPercent(values.get(GAMES_MARKUP_SETTING_KEY)); } catch { /* default */ }
  try { rounding = parseGamesRounding(values.get(GAMES_ROUNDING_SETTING_KEY)); } catch { /* default */ }
  return { markup_percent: markup, rounding };
}

/** Simpan setting global dalam satu batch (2 statement). */
export async function writeGamesPricingSettings(
  db: DatabaseAccess,
  settings: GamesPricingSettings,
): Promise<void> {
  const upsert = `INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`;
  if (db.d1) {
    await db.d1.batch([
      db.d1.prepare(upsert).bind(GAMES_MARKUP_SETTING_KEY, String(settings.markup_percent)),
      db.d1.prepare(upsert).bind(GAMES_ROUNDING_SETTING_KEY, String(settings.rounding)),
    ]);
    return;
  }
  await db.execRun(upsert, GAMES_MARKUP_SETTING_KEY, String(settings.markup_percent));
  await db.execRun(upsert, GAMES_ROUNDING_SETTING_KEY, String(settings.rounding));
}

export type GamesMarkupSource = "global" | "game" | "variant";

export interface GamesVariantMarkup {
  percent: number | null;
  fixed: number | null;
}

/** Override markup per varian dari `games_variant_markup` (1 statement). */
export async function readVariantMarkupMap(db: DatabaseAccess): Promise<Map<string, GamesVariantMarkup>> {
  const rows = await db.queryAll("SELECT buyer_sku_code, markup_percent, markup_fixed FROM games_variant_markup")
    .catch(() => [] as Record<string, unknown>[]);
  const map = new Map<string, GamesVariantMarkup>();
  for (const row of rows) {
    const percent = row.markup_percent === null || row.markup_percent === undefined ? null : Number(row.markup_percent);
    const fixed = row.markup_fixed === null || row.markup_fixed === undefined ? null : Number(row.markup_fixed);
    map.set(String(row.buyer_sku_code), {
      percent: percent !== null && Number.isFinite(percent) ? percent : null,
      fixed: fixed !== null && Number.isFinite(fixed) ? fixed : null,
    });
  }
  return map;
}

/**
 * Tulis override markup untuk sekumpulan varian dalam SATU statement per
 * operasi: `null/null` berarti kembali ikut markup game/global (baris dihapus).
 * Tidak pernah menyentuh baris Digiflazz (`skus` selalu `sk:<id>`).
 */
export async function writeVariantMarkup(
  db: DatabaseAccess,
  skus: string[],
  markup: GamesVariantMarkup,
): Promise<void> {
  if (skus.length === 0) return;
  const payload = JSON.stringify(skus);
  if (markup.percent === null && markup.fixed === null) {
    await db.execRun(
      "DELETE FROM games_variant_markup WHERE buyer_sku_code IN (SELECT value FROM json_each(?))",
      payload,
    );
    return;
  }
  await db.execRun(
    `INSERT INTO games_variant_markup(buyer_sku_code, markup_percent, markup_fixed, updated_at)
     SELECT value, ?, ?, datetime('now') FROM json_each(?) WHERE true
     ON CONFLICT(buyer_sku_code) DO UPDATE SET
       markup_percent = excluded.markup_percent,
       markup_fixed = excluded.markup_fixed,
       updated_at = excluded.updated_at`,
    markup.percent, markup.fixed, payload,
  );
}

export interface GamesEffectiveMarkup {
  percent: number;
  fixed: number;
  source: GamesMarkupSource;
}

/** Markup efektif untuk satu baris varian. */
export function gamesEffectiveMarkup(
  row: { markup_percent?: unknown; markup_fixed?: unknown },
  gamePercent: number | null | undefined,
  settings: GamesPricingSettings,
): GamesEffectiveMarkup {
  const variantPercent = row.markup_percent === null || row.markup_percent === undefined
    ? null : Number(row.markup_percent);
  const variantFixed = row.markup_fixed === null || row.markup_fixed === undefined
    ? 0 : Number(row.markup_fixed);
  if (Number.isFinite(variantPercent)) {
    return { percent: variantPercent as number, fixed: Number.isFinite(variantFixed) ? variantFixed : 0, source: "variant" };
  }
  const game = gamePercent === null || gamePercent === undefined ? null : Number(gamePercent);
  if (game !== null && Number.isFinite(game)) {
    return { percent: game, fixed: Number.isFinite(variantFixed) ? variantFixed : 0, source: "game" };
  }
  return { percent: settings.markup_percent, fixed: Number.isFinite(variantFixed) ? variantFixed : 0, source: "global" };
}

/** Harga satu baris (cost 0 → 0, tanpa melempar). */
export function gamesRowMarkupPrice(
  row: { cost?: unknown; markup_percent?: unknown; markup_fixed?: unknown },
  gamePercent: number | null | undefined,
  settings: GamesPricingSettings,
): number {
  const cost = Number(row.cost);
  if (!Number.isSafeInteger(cost) || cost <= 0) return 0;
  const markup = gamesEffectiveMarkup(row, gamePercent, settings);
  return computeGamesMarkupPrice({
    cost,
    markupPercent: markup.percent,
    markupFixed: markup.fixed,
    rounding: settings.rounding,
  });
}

export type GamesRecomputeScope = { all: true } | { slug: string } | { skus: string[] };

/**
 * Hitung ulang `sell_price` baris Sekalipay dengan SATU statement UPDATE
 * (maksimal 3 termasuk baca setting). Rumus integer sama dengan
 * `computeGamesMarkupPrice`; `json_each` untuk daftar SKU agar parameter
 * terikat selalu sedikit (D1 ≤100).
 */
export async function recomputeGamesSkPrices(
  db: DatabaseAccess,
  scope: GamesRecomputeScope,
  settings?: GamesPricingSettings,
): Promise<{ updated: number }> {
  const resolved = settings ?? await readGamesPricingSettings(db);
  const rounding = resolved.rounding;
  const percentParam = resolved.markup_percent;
  const percentSql = `COALESCE(
    (SELECT vm.markup_percent FROM games_variant_markup vm
      WHERE vm.buyer_sku_code = games_products.buyer_sku_code),
    (SELECT m.markup_percent FROM games_meta m WHERE m.slug = games_products.game_slug),
    ?)`;
  const fixedSql = `COALESCE(
    (SELECT vm.markup_fixed FROM games_variant_markup vm
      WHERE vm.buyer_sku_code = games_products.buyer_sku_code), 0)`;
  const priceSql = `(CAST(((cost * (10000 + CAST(ROUND(${percentSql} * 100) AS INTEGER)))
      + (10000 * ?) - 1) / (10000 * ?) AS INTEGER) * ?) + ${fixedSql}`;
  const where = ["supplier='sekalipay'", "cost > 0"];
  const params: unknown[] = [percentParam, rounding, rounding, rounding];
  if ("slug" in scope) {
    where.push("game_slug=?");
    params.push(scope.slug);
  } else if ("skus" in scope) {
    if (scope.skus.length === 0) return { updated: 0 };
    where.push("buyer_sku_code IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(scope.skus));
  }
  const result = await db.execRun(
    `UPDATE games_products SET sell_price = ${priceSql}, updated_at = datetime('now') WHERE ${where.join(" AND ")}`,
    ...params,
  );
  return { updated: Number(result.changes ?? 0) };
}
