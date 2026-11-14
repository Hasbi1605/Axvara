// src/lib/games/admin-games.ts — daftar per GAME untuk tab admin "Game"
// (docs/GAMES.md §14, packet G-BE B5). Terpisah dari `admin.ts` karena butuh
// overlay registry (nama/publisher/ikon 4 game legacy) dan `registry.ts`
// mengimpor `admin.ts`; menaruhnya di sini menghindari import melingkar.
import type { DatabaseAccess } from "@/lib/db-access";
import { gamesRegistryGame, sanitizeSkImageUrl } from "./registry";
import { gamesAdminPricingContext } from "./admin";
import type { GamesPricingSettings } from "./markup";

export interface GamesAdminGameRow {
  slug: string;
  name: string;
  publisher: string;
  icon: string | null;
  banner: string | null;
  description: string;
  id_guide: string;
  featured_rank: number | null;
  hidden: boolean;
  /** Override khusus game (null = ikut default global). */
  markup_percent: number | null;
  effective_markup_percent: number;
  variants_total: number;
  sellable_count: number;
  supplier_off_count: number;
  /** Harga terendah dari varian yang bisa dijual; null bila tidak ada. */
  min_price: number | null;
}

const contractSupported = (value: unknown): boolean => {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return parsed?.version === 1 && parsed?.supported === true;
  } catch {
    return false;
  }
};

const isSellable = (row: Record<string, unknown>): boolean => {
  if (Number(row.enabled) !== 1 || Number(row.supplier_active) !== 1) return false;
  const stock = Number(row.stock);
  if (!(stock === -1 || stock > 0)) return false;
  if (Number(row.min_order) !== 1) return false;
  if (!(Number(row.cost) > 0) || !(Number(row.sell_price) > 0)) return false;
  return contractSupported(row.required_fields_json);
};

const optionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Semua slug SK (termasuk yang disembunyikan) + statistik varian. `min_price`
 * hanya menghitung varian yang saat ini benar-benar bisa dibeli.
 */
export async function gamesAdminGames(
  db: DatabaseAccess,
): Promise<{ games: GamesAdminGameRow[]; settings: GamesPricingSettings; count: number }> {
  const { settings, gamePercent } = await gamesAdminPricingContext(db);
  const metaRows = await db.queryAll("SELECT * FROM games_meta");
  const meta = new Map(metaRows.map((row) => [String(row.slug ?? "").trim(), row]));
  const rows = await db.queryAll(
    `SELECT game_slug, sk_product_name, image_url, enabled, supplier_active, stock, min_order,
            cost, sell_price, required_fields_json
       FROM games_products WHERE supplier='sekalipay'`,
  );
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const slug = String(row.game_slug ?? "").trim();
    if (!slug) continue;
    const group = groups.get(slug);
    if (group) group.push(row);
    else groups.set(slug, [row]);
  }
  const games: GamesAdminGameRow[] = [];
  for (const [slug, group] of groups) {
    const first = group[0];
    const overlay = meta.get(slug);
    const registry = gamesRegistryGame(slug);
    const upstreamName = String(first.sk_product_name ?? "").trim();
    const sellablePrices = group
      .filter(isSellable)
      .map((row) => Number(row.sell_price))
      .filter((price) => Number.isFinite(price) && price > 0);
    const overlayPercent = optionalNumber(overlay?.markup_percent);
    const override = overlayPercent ?? gamePercent.get(slug) ?? null;
    games.push({
      slug,
      name: String(overlay?.display_name ?? registry?.name ?? (upstreamName || slug)),
      publisher: String(overlay?.publisher ?? registry?.publisher ?? ""),
      icon: (overlay?.icon_url ? String(overlay.icon_url) : null) ?? registry?.icon ?? sanitizeSkImageUrl(first.image_url),
      banner: (overlay?.banner_url ? String(overlay.banner_url) : null) ?? registry?.banner ?? null,
      description: String(overlay?.description ?? ""),
      id_guide: String(overlay?.id_guide ?? ""),
      featured_rank: optionalNumber(overlay?.featured_rank),
      hidden: Number(overlay?.hidden ?? 0) === 1,
      markup_percent: override,
      effective_markup_percent: override ?? settings.markup_percent,
      variants_total: group.length,
      sellable_count: sellablePrices.length,
      supplier_off_count: group.filter((row) => Number(row.supplier_active) === 0).length,
      min_price: sellablePrices.length > 0 ? Math.min(...sellablePrices) : null,
    });
  }
  games.sort((a, b) => a.slug.localeCompare(b.slug));
  return { games, settings, count: games.length };
}

/** Upsert metadata game dari PATCH admin (satu statement). */
export const GAMES_META_UPSERT_SQL = `INSERT INTO games_meta
  (slug, display_name, publisher, icon_url, banner_url, description, id_guide, featured_rank, hidden, markup_percent, updated_at, updated_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(slug) DO UPDATE SET
    display_name = excluded.display_name,
    publisher = excluded.publisher,
    icon_url = excluded.icon_url,
    banner_url = excluded.banner_url,
    description = excluded.description,
    id_guide = excluded.id_guide,
    featured_rank = excluded.featured_rank,
    hidden = excluded.hidden,
    markup_percent = excluded.markup_percent,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by`;
