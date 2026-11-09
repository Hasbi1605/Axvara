// src/lib/games/admin.ts — helper murni + query admin AXVARA Games
// (docs/GAMES.md §12.7 P1–P3). Aturan:
//  * `games_reference_prices` adalah sumber kebenaran harga pembanding (Oura);
//    `games_products.reference_price` hanya cermin.
//  * Grup tampilan: override admin (`display_group`) menang; NULL jatuh ke
//    heuristik produk (Membership/WDP/Twilight → `special`, selain itu `all`).
//  * Sehat untuk aktivasi massal = seller aktif, modal > 0, harga jual tidak di
//    bawah batas bawah modal+3%, dan tidak lebih mahal dari referensi.
// Query di sini hanya dipakai route admin (edge). Impor tipe tidak menarik
// modul server ke bundle klien.

import { computeGamesSellPrice, gamesPriceFloor } from "./pricing";
import { GAMES_CATALOG_SETTING_KEY } from "./catalog-sync";
import type { DatabaseAccess } from "@/lib/db-access";
import { isGamesNicknameProduct } from "./sellable";

export type GamesDisplayGroup = "special" | "bestseller" | "all";
export const GAMES_DISPLAY_GROUPS = ["special", "bestseller"] as const;

/** Brand Digiflazz persis (snapshot 9 November 2026) untuk gelombang 1.
 * Perbandingan tetap case-insensitive + trim agar varian kapitalisasi akun
 * (mis. "FREE FIRE MAX") tetap cocok. "PUBG Mobile Lite" TIDAK termasuk. */
export const GAMES_WAVE1_BRANDS = ["FREE FIRE", "Free Fire Max", "MOBILE LEGENDS", "PUBG MOBILE"] as const;
const WAVE1 = new Set(GAMES_WAVE1_BRANDS.map((brand) => brand.trim().toLowerCase()));

/** Batas item per halaman admin (spesifikasi: maksimal 200). */
export const GAMES_ADMIN_MAX_LIMIT = 200;

const SPECIAL_NAME = /weekly diamond pass|\bwdp\b|twilight|membership/i;

export const normalizeBrand = (brand: unknown): string => String(brand ?? "").trim().toLowerCase();
export const isWave1Brand = (brand: unknown): boolean => WAVE1.has(normalizeBrand(brand));

const amount = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

export interface GamesGroupInput {
  display_group?: unknown;
  product_type?: unknown;
  product_name?: unknown;
}

/** Grup nominal efektif untuk katalog pembeli (§5.3 grup Spesial/Terlaris/Semua). */
export function effectiveGroup(row: GamesGroupInput): GamesDisplayGroup {
  const stored = String(row.display_group ?? "").trim().toLowerCase();
  if (stored === "special" || stored === "bestseller") return stored;
  const type = String(row.product_type ?? "").trim().toLowerCase();
  const name = String(row.product_name ?? "");
  if (type === "membership" || SPECIAL_NAME.test(name)) return "special";
  return "all";
}

export interface GamesMarginRow {
  cost?: unknown;
  sell_price?: unknown;
  reference_price?: unknown;
}

export interface GamesMargin {
  cost: number;
  sell: number;
  /** Batas bawah modal + margin minimum 3% (biaya kanal 0). */
  floor: number;
  margin_rp: number;
  margin_pct: number;
  source: "reference" | "floor";
  /** true bila harga jual tidak lebih mahal dari referensi; null tanpa referensi. */
  competitive: boolean | null;
}

export function gamesMargin(row: GamesMarginRow): GamesMargin {
  const cost = amount(row.cost);
  const sell = amount(row.sell_price);
  const reference = row.reference_price === null || row.reference_price === undefined ? null : amount(row.reference_price) || null;
  const floor = cost > 0 ? gamesPriceFloor(cost) : 0;
  const source = cost > 0 ? computeGamesSellPrice({ cost, referencePrice: reference }).source : "floor";
  const margin_rp = sell - cost;
  return {
    cost,
    sell,
    floor,
    margin_rp,
    margin_pct: cost > 0 ? Math.round((margin_rp / cost) * 1000) / 10 : 0,
    source,
    competitive: reference === null ? null : sell <= reference,
  };
}

/** P3: syarat aktivasi massal (tidak pernah memaksa `enabled`). */
export function isHealthyForWave(row: GamesMarginRow & { seller_active?: unknown; buyer_sku_code?: unknown; product_name?: unknown }): boolean {
  const margin = gamesMargin(row);
  const reference = row.reference_price === null || row.reference_price === undefined ? null : amount(row.reference_price) || null;
  return !isGamesNicknameProduct(row) && amount(row.seller_active) === 1
    && margin.cost > 0
    && margin.sell >= margin.floor
    && (reference === null || margin.sell <= reference);
}

export interface GamesListFilters {
  brand?: string | null;
  enabled?: boolean | null;
  q?: string | null;
  limit?: number;
  offset?: number;
}

export interface GamesListPage {
  items: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
  brands: string[];
}

const likeEscape = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Daftar SKU admin: filter brand (case-insensitive), enabled, cari kode/nama. */
export async function listGamesProducts(db: DatabaseAccess, filters: GamesListFilters = {}): Promise<GamesListPage> {
  const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 50) || 50, 1), GAMES_ADMIN_MAX_LIMIT);
  const offset = Math.max(Math.trunc(filters.offset ?? 0) || 0, 0);
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.brand) {
    where.push("lower(trim(game_brand))=?");
    params.push(normalizeBrand(filters.brand));
  }
  if (filters.enabled === true || filters.enabled === false) {
    where.push("enabled=?");
    params.push(filters.enabled ? 1 : 0);
  }
  const query = String(filters.q ?? "").trim();
  if (query) {
    where.push("(lower(buyer_sku_code) LIKE ? ESCAPE '\\' OR lower(product_name) LIKE ? ESCAPE '\\')");
    const pattern = `%${likeEscape(query.toLowerCase())}%`;
    params.push(pattern, pattern);
  }
  const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const totalRow = await db.queryFirst(`SELECT COUNT(*) AS n FROM games_products${clause}`, ...params);
  const items = await db.queryAll(
    `SELECT * FROM games_products${clause}
      ORDER BY game_brand, display_order IS NULL, display_order, product_name, id
      LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  const brandRows = await db.queryAll(
    `SELECT game_brand AS brand, COUNT(*) AS n FROM games_products
      WHERE game_brand<>'' GROUP BY game_brand ORDER BY game_brand`,
  );
  return {
    items,
    total: Number(totalRow?.n ?? 0),
    limit,
    offset,
    brands: brandRows.map((row) => String(row.brand)).filter(Boolean),
  };
}

export interface GamesSyncStatus {
  last_sync_at: string | null;
  counts: { total: number; enabled: number; seller_active: number; with_reference: number };
}

/** Status header admin: waktu sinkron katalog terakhir + hitungan katalog. */
export async function gamesAdminSyncStatus(db: DatabaseAccess): Promise<GamesSyncStatus> {
  const setting = await db.queryFirst("SELECT value FROM store_settings WHERE key=?", GAMES_CATALOG_SETTING_KEY);
  const raw = setting ? String(setting.value ?? "").trim() : "";
  const timestamp = raw === "" ? NaN : Number(raw);
  const counts = await db.queryFirst(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN enabled=1 THEN 1 ELSE 0 END),0) AS enabled,
            COALESCE(SUM(CASE WHEN seller_active=1 THEN 1 ELSE 0 END),0) AS seller_active,
            COALESCE(SUM(CASE WHEN reference_price IS NOT NULL THEN 1 ELSE 0 END),0) AS with_reference
       FROM games_products`,
  );
  return {
    last_sync_at: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : (raw || null),
    counts: {
      total: Number(counts?.total ?? 0),
      enabled: Number(counts?.enabled ?? 0),
      seller_active: Number(counts?.seller_active ?? 0),
      with_reference: Number(counts?.with_reference ?? 0),
    },
  };
}

export interface GamesWaveResult {
  eligible: number;
  enabled_now: number;
  skipped_unhealthy: number;
}

/** Aktifkan gelombang 1 yang sehat. Tidak pernah menonaktifkan SKU. */
export async function enableGamesWave1(db: DatabaseAccess, options: { dryRun?: boolean } = {}): Promise<GamesWaveResult> {
  const placeholders = GAMES_WAVE1_BRANDS.map(() => "?").join(",");
  const rows = await db.queryAll(
    `SELECT id, buyer_sku_code, product_name, cost, sell_price, reference_price, seller_active, enabled
       FROM games_products WHERE lower(trim(game_brand)) IN (${placeholders}) ORDER BY id`,
    ...GAMES_WAVE1_BRANDS.map(normalizeBrand),
  );
  const eligible = rows.filter((row) => Number(row.enabled) !== 1 && isHealthyForWave(row));
  const skipped_unhealthy = rows.filter((row) => !isHealthyForWave(row)).length;
  if (options.dryRun || eligible.length === 0) {
    return { eligible: eligible.length, enabled_now: 0, skipped_unhealthy };
  }
  const ids = eligible.map((row) => Number(row.id));
  const updated = await db.execRun(
    `UPDATE games_products SET enabled=1, updated_at=datetime('now')
      WHERE enabled=0 AND id IN (${ids.map(() => "?").join(",")})`,
    ...ids,
  );
  return { eligible: eligible.length, enabled_now: Number(updated.changes ?? 0), skipped_unhealthy };
}
