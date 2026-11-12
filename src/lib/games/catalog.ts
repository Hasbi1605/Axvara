import { createDatabaseAccess } from "@/lib/db-access";
import { GAMES_REGISTRY } from "@/lib/games/registry";
import {
  gamesRegistryGame,
  gamesSlugify,
  parseGamesSkContract,
  sanitizeSkImageUrl,
  type GamesCurrency,
  type GamesField,
  type GamesSkContractField,
} from "@/lib/games/registry";
import { effectiveGroup, type GamesDisplayGroup } from "@/lib/games/admin";
import { isGamesNicknameProduct } from "@/lib/games/sellable";

type Row = Record<string, unknown>;

export interface GamesDetailProduct {
  buyer_sku_code: string;
  name: string;
  price: number;
  group: GamesDisplayGroup;
  display_order: number | null;
  available: boolean;
  /** Kontrak field varian SK (teks); kosong untuk baris Digiflazz legacy. */
  fields?: GamesSkContractField[];
  unsupported_reason?: string | null;
  /** Teks polos supplier (termasuk batasan region); tidak di-sanitize agresif. */
  description?: string;
  product_type_name?: string | null;
  /** Alasan jujur bila `available:false` (SK). */
  availability_reason?: string | null;
  /** Nama game upstream untuk grup/identitas. */
  game_brand?: string | null;
}

export interface GamesDetailGame {
  slug: string;
  name: string;
  publisher: string;
  currency: GamesCurrency;
  icon: string | null;
  banner: string | null;
  fields: GamesField[];
}

const CATALOG_COLUMNS = `game_brand, buyer_sku_code, product_name, sell_price, supplier, sk_variant_id,
  sk_product_id, sk_product_name, game_slug, stock, min_order, supplier_active, required_fields_json,
  validation_json, image_url, cost, display_group, display_order, product_type, product_type_name`;

const isSkRow = (row: Row): boolean => {
  const productId = Number(row.sk_product_id);
  return String(row.supplier ?? "") === "sekalipay" && Number.isInteger(productId) && productId > 0;
};

/** Status kelola SK untuk admin/pembeli: alasan jujur bila tidak bisa dibeli. */
export function gamesSkAvailability(row: Row): { available: boolean; reason: string | null } {
  const contract = parseGamesSkContract(row.required_fields_json);
  if (Number(row.enabled) !== 1) return { available: false, reason: "admin_disabled" };
  if (Number(row.supplier_active) !== 1) return { available: false, reason: "supplier_off" };
  const stock = Number(row.stock);
  // SK memakai -1 = stok tak terbatas (kontrak premium/live); nilai negatif lain ditolak.
  if (!(stock === -1 || stock > 0)) return { available: false, reason: "stock_empty" };
  if (Number(row.min_order) !== 1) return { available: false, reason: "min_order" };
  if (!contract?.supported) return { available: false, reason: contract?.reason ?? "invalid_contract" };
  if (!(Number(row.cost) > 0) || !(Number(row.sell_price) > 0)) return { available: false, reason: "no_price" };
  return { available: true, reason: null };
}

export function gamesSkContractSupported(row: Row): boolean {
  return parseGamesSkContract(row.required_fields_json)?.supported === true;
}

const registryOrder = new Map<string, number>(GAMES_REGISTRY.map((game, index) => [game.slug, index]));

/** Urutan stabil: empat game legacy dulu, lalu nama. */
const compareGames = (a: { slug: string; name: string }, b: { slug: string; name: string }): number => {
  const orderA = registryOrder.get(a.slug) ?? Number.MAX_SAFE_INTEGER;
  const orderB = registryOrder.get(b.slug) ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  return a.name.localeCompare(b.name);
};

export async function getGamesCatalog() {
  // Katalog publik SK-only. Baris Digiflazz legacy tidak pernah ditampilkan
  // sebagai game yang bisa dibeli baru.
  const rows = [...await createDatabaseAccess().queryAll(
    `SELECT ${CATALOG_COLUMNS} FROM games_products WHERE supplier='sekalipay' AND enabled=1 AND sell_price>0`,
  ).catch(() => [] as Row[])];

  const skGames: {
    slug: string; name: string; publisher: string; currency: GamesCurrency;
    icon: string | null; banner: string | null; min_price: number; sku_count: number;
  }[] = [];
  const skSlugs = new Set<string>();
  const skRows = rows.filter((row) => isSkRow(row) && !isGamesNicknameProduct(row));
  if (skRows.length > 0) {
    const byProduct = new Map<number, Row[]>();
    for (const row of skRows) {
      const productId = Number(row.sk_product_id);
      const group = byProduct.get(productId);
      if (group) group.push(row);
      else byProduct.set(productId, [row]);
    }
    for (const [productId, group] of byProduct) {
      const upstreamName = String(group[0].sk_product_name ?? "").trim();
      const slug = String(group[0].game_slug ?? "").trim() || gamesSlugify(upstreamName) || `game-${productId}`;
      if (skSlugs.has(slug)) continue;
      const prices = group.map((row) => Number(row.sell_price)).filter((price) => Number.isFinite(price) && price > 0);
      if (prices.length === 0) continue;
      const registry = gamesRegistryGame(slug);
      skSlugs.add(slug);
      skGames.push({
        slug,
        name: registry?.name ?? (upstreamName || `Game ${productId}`),
        publisher: registry?.publisher ?? "",
        currency: registry?.currency ?? "topup",
        icon: registry?.icon ?? sanitizeSkImageUrl(group[0].image_url),
        banner: registry?.banner ?? null,
        min_price: Math.min(...prices),
        sku_count: group.length,
      });
    }
  }

  return skGames.sort(compareGames);
}

export type GamesCatalogGame = Awaited<ReturnType<typeof getGamesCatalog>>[number];

const DETAIL_COLUMNS = `buyer_sku_code, product_name, sell_price, seller_active, display_group, display_order,
  product_type, product_type_name, supplier, supplier_active, sk_variant_id, sk_product_id, sk_product_name,
  game_slug, stock, min_order, cost, required_fields_json, validation_json, image_url, description, enabled`;

export async function getGamesDetail(slug: string): Promise<{ game: GamesDetailGame; products: GamesDetailProduct[] } | null> {
  const normalized = String(slug ?? "").trim().toLowerCase();
  const registry = gamesRegistryGame(normalized);
  // Detail publik juga SK-only. Admin-disabled tetap dikirim agar terlihat
  // dengan alasan, tetapi baris Digiflazz legacy tidak pernah dirender.
  const rows = await createDatabaseAccess().queryAll(
    `SELECT ${DETAIL_COLUMNS} FROM games_products WHERE supplier='sekalipay' AND game_slug=?
      ORDER BY display_order IS NULL, display_order, sell_price, id`,
    normalized,
  ).catch(() => [] as Row[]);

  const skRows = rows.filter((row) => isSkRow(row) && !isGamesNicknameProduct(row));
  if (skRows.length > 0) {
    const first = skRows[0];
    const upstreamName = String(first.sk_product_name ?? "").trim();
    const gameSlug = String(first.game_slug ?? "").trim() || normalized || gamesSlugify(upstreamName);
    const game: GamesDetailGame = {
      slug: gameSlug,
      name: registry?.name ?? (upstreamName || String(first.product_name ?? "")),
      publisher: registry?.publisher ?? "",
      currency: registry?.currency ?? "topup",
      icon: registry?.icon ?? sanitizeSkImageUrl(first.image_url),
      banner: registry?.banner ?? null,
      // Field bersifat per-varian (product_type berbeda); UI P3 membacanya dari
      // `products[].fields`, bukan dari level game.
      fields: [],
    };
    const products: GamesDetailProduct[] = skRows.filter((row) => !isGamesNicknameProduct(row)).map((row) => {
      const contract = parseGamesSkContract(row.required_fields_json);
      const availability = gamesSkAvailability(row);
      return {
        buyer_sku_code: String(row.buyer_sku_code),
        name: String(row.product_name ?? ""),
        price: Number(row.sell_price) || 0,
        group: effectiveGroup(row),
        display_order: row.display_order == null ? null : Number(row.display_order),
        available: availability.available,
        availability_reason: availability.reason,
        fields: contract?.fields ?? [],
        unsupported_reason: contract?.reason ?? (contract ? null : "invalid_contract"),
        description: String(row.description ?? ""),
        product_type_name: String(row.product_type_name ?? "").trim() || null,
        game_brand: String(row.sk_product_name ?? row.game_brand ?? "").trim() || null,
      };
    });
    return { game, products };
  }

  // Tidak ada SK: game registry lama tetap 200 dengan header dan "nominal
  // segera tersedia", tanpa SKU DGF yang bisa dibeli.
  if (!registry) return null;
  return { game: publicRegistryGame(registry), products: [] };
}

export type GamesDetail = NonNullable<Awaited<ReturnType<typeof getGamesDetail>>>;

function publicRegistryGame(game: (typeof GAMES_REGISTRY)[number]): GamesDetailGame {
  return {
    slug: game.slug,
    name: game.name,
    publisher: game.publisher,
    currency: game.currency,
    icon: game.icon,
    banner: game.banner,
    fields: game.fields.map((field) => ({
      key: field.key,
      label: field.label,
      inputMode: field.inputMode,
      pattern: field.pattern,
      min: field.min,
      max: field.max,
      hint: field.hint,
    })),
  };
}
