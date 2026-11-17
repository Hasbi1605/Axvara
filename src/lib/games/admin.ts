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
import {
  gamesEffectiveMarkup,
  readGamesPricingSettings,
  type GamesPricingSettings,
} from "./markup";
import { gamesRegionTypeNames } from "./variant-kind";
import type { DatabaseAccess } from "@/lib/db-access";
import { readSyncTimestampSetting } from "@/lib/sync-status";
import { isGamesNicknameProduct } from "./sellable";

export type GamesDisplayGroup = "special" | "bestseller" | "all";
export const GAMES_DISPLAY_GROUPS = ["special", "bestseller"] as const;

/** Brand Digiflazz persis (snapshot 9 November 2026) untuk gelombang 1.
 * Perbandingan tetap case-insensitive + trim agar varian kapitalisasi akun
 * (mis. "FREE FIRE MAX") tetap cocok. "PUBG Mobile Lite" TIDAK termasuk. */
export const GAMES_WAVE1_BRANDS = ["FREE FIRE", "Free Fire Max", "MOBILE LEGENDS", "PUBG MOBILE"] as const;

/** Batas item per halaman admin (spesifikasi: maksimal 200). */
export const GAMES_ADMIN_MAX_LIMIT = 200;
/** Sama dengan `sk-catalog-sync`; literal menghindari siklus import admin↔registry. */
const GAMES_SK_CATALOG_SYNC_KEY = "games_sk_catalog_sync_at";

const SPECIAL_NAME = /weekly diamond pass|\bwdp\b|twilight|membership/i;

export function effectiveGroup(row: GamesGroupInput): GamesDisplayGroup {
  const stored = String(row.display_group ?? "").trim().toLowerCase();
  if (stored === "special" || stored === "bestseller") return stored;
  const type = String(row.product_type ?? row.product_type_name ?? "").trim().toLowerCase();
  const name = String(row.product_name ?? "");
  if (type === "membership" || SPECIAL_NAME.test(name)) return "special";
  return "all";
}

export interface GamesGroupInput {
  display_group?: unknown;
  product_type?: unknown;
  product_type_name?: unknown;
  product_name?: unknown;
}

export interface GamesMarginRow {
  cost?: unknown;
  sell_price?: unknown;
  reference_price?: unknown;
}

export interface GamesMargin {
  cost: number;
  sell: number;
  floor: number;
  margin_rp: number;
  margin_pct: number;
  source: "reference" | "floor";
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

/** Syarat aktivasi massal legacy (tetap diekspor untuk kompatibilitas tes;
 * endpoint aktivasi sudah pensiun). */
export function isHealthyForWave(row: GamesMarginRow & { seller_active?: unknown; buyer_sku_code?: unknown; product_name?: unknown }): boolean {
  const margin = gamesMargin(row);
  const reference = row.reference_price === null || row.reference_price === undefined ? null : amount(row.reference_price) || null;
  return !isGamesNicknameProduct(row) && amount(row.seller_active) === 1
    && margin.cost > 0
    && margin.sell >= margin.floor
    && (reference === null || margin.sell <= reference);
}

const amount = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

const skContractSupported = (row: Record<string, unknown>): boolean => {
  try {
    const parsed = JSON.parse(String(row.required_fields_json ?? ""));
    return parsed?.version === 1 && parsed?.supported === true;
  } catch {
    return false;
  }
};

export const normalizeBrand = (brand: unknown): string => String(brand ?? "").trim().toLowerCase();

export interface GamesListFilters {
  brand?: string | null;
  enabled?: boolean | null;
  q?: string | null;
  /** Hanya SKU yang benar-benar bisa dijual (admin aktif + supplier aktif + ada stok/unlimited). */
  sellable?: boolean | null;
  /** "sellable" = SKU bisa dijual tampil lebih dulu, sisanya urutan lama. */
  sort?: "default" | "sellable" | null;
  /** Kode region B6 (ID/MY/SG/PH/BR/RU/TR/GLOBAL/…) — dicocokkan pada tipe supplier. */
  region?: string | null;
  limit?: number;
  offset?: number;
}

/** Ekspresi SQL: SKU bisa dijual pembeli saat ini. */
export const GAMES_SELLABLE_SQL = `(enabled=1 AND supplier_active=1 AND (unlimited_stock=1 OR stock>0))`;

export interface GamesListPage {
  items: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
  brands: string[];
}

/** Daftar SKU admin: filter brand (case-insensitive), enabled, cari kode/nama. */
export async function listGamesProducts(db: DatabaseAccess, filters: GamesListFilters = {}): Promise<GamesListPage> {
  const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 50) || 50, 1), GAMES_ADMIN_MAX_LIMIT);
  const offset = Math.max(Math.trunc(filters.offset ?? 0) || 0, 0);
  // Katalog admin = supplier SK saja; baris Digiflazz tetap ada untuk histori
  // order lama tetapi tidak dikelola/diaktifkan lewat panel ini.
  const where: string[] = ["supplier='sekalipay'"];
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
    where.push("(INSTR(LOWER(COALESCE(buyer_sku_code,'')), ?) > 0 OR INSTR(LOWER(COALESCE(product_name,'')), ?) > 0)");
    const needle = query.toLowerCase();
    params.push(needle, needle);
  }
  if (filters.sellable === true) where.push(GAMES_SELLABLE_SQL);
  if (filters.region) {
    const typeNames = gamesRegionTypeNames(filters.region);
    if (!typeNames) where.push("0");
    else {
      where.push(`lower(trim(product_type_name)) IN (${typeNames.map(() => "?").join(",")})`);
      params.push(...typeNames);
    }
  }
  const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  // Default: urutan katalog lama. `sort=sellable` menaruh SKU yang benar-benar
  // bisa dijual di atas, sisanya tetap urutan lama (stabil, tanpa ORDER BY baru
  // di tabel).
  const orderBy = filters.sort === "sellable"
    ? `CASE WHEN ${GAMES_SELLABLE_SQL} THEN 0 ELSE 1 END, game_brand, display_order IS NULL, display_order, product_name, id`
    : `game_brand, display_order IS NULL, display_order, product_name, id`;
  const totalRow = await db.queryFirst(`SELECT COUNT(*) AS n FROM games_products${clause}`, ...params);
  const items = await db.queryAll(
    `SELECT * FROM games_products${clause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  const brandRows = await db.queryAll(
    `SELECT COALESCE(NULLIF(sk_product_name,''), game_brand) AS brand FROM games_products
      WHERE supplier='sekalipay' AND COALESCE(NULLIF(sk_product_name,''), game_brand)<>''
      GROUP BY brand ORDER BY brand`,
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
  counts: { total: number; enabled: number; supplier_active: number; seller_active: number; with_reference: number; contract_supported: number; sellable: number; supplier_off: number };
}

/** Status header admin: waktu sinkron katalog terakhir + hitungan katalog. */
export async function gamesAdminSyncStatus(db: DatabaseAccess): Promise<GamesSyncStatus> {
  const raw = (await readSyncTimestampSetting(db, "games_sk_catalog", GAMES_SK_CATALOG_SYNC_KEY)) ?? "";
  const timestamp = raw === "" ? NaN : Number(raw);
  const rows = await db.queryAll("SELECT supplier_active, enabled, reference_price, required_fields_json, unlimited_stock, stock FROM games_products WHERE supplier='sekalipay'");
  const counts = {
    total: rows.length,
    enabled: rows.filter((row) => Number(row.enabled) === 1).length,
    supplier_active: rows.filter((row) => Number(row.supplier_active) === 1).length,
    seller_active: rows.filter((row) => Number(row.supplier_active) === 1).length,
    with_reference: rows.filter((row) => row.reference_price !== null && row.reference_price !== undefined).length,
    contract_supported: rows.filter((row) => skContractSupported(row)).length,
    // "Aktif dijual" yang JUJUR: admin mengaktifkan, supplier aktif, dan ada
    // stok (atau stok tak terbatas). Angka ini yang dipakai UI, bukan `enabled`.
    sellable: rows.filter((row) => Number(row.enabled) === 1 && Number(row.supplier_active) === 1
      && (Number(row.unlimited_stock) === 1 || Number(row.stock) > 0)).length,
    // Varian yang dinonaktifkan supplier (mis. status "off" massal Sekalipay):
    // satu angka agregat untuk alert, bukan ribuan peringatan per baris.
    supplier_off: rows.filter((row) => Number(row.supplier_active) === 0).length,
  };
  return {
    last_sync_at: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : (raw || null),
    counts,
  };
}

export interface GamesAdminPricingContext {
  settings: GamesPricingSettings;
  /** slug → markup khusus game (null = ikut default). */
  gamePercent: Map<string, number | null>;
}

/** Setting harga global + markup per game (2 statement, dipakai GET/PATCH admin). */
export async function gamesAdminPricingContext(db: DatabaseAccess): Promise<GamesAdminPricingContext> {
  const settings = await readGamesPricingSettings(db);
  const rows = await db.queryAll("SELECT slug, markup_percent FROM games_meta");
  const gamePercent = new Map<string, number | null>();
  for (const row of rows) {
    const slug = String(row.slug ?? "").trim();
    if (!slug) continue;
    const value = row.markup_percent === null || row.markup_percent === undefined ? null : Number(row.markup_percent);
    gamePercent.set(slug, value !== null && Number.isFinite(value) ? value : null);
  }
  return { settings, gamePercent };
}
