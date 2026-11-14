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
import {
  cleanGamesFieldLabel,
  gamesEffectiveCategory,
  gamesRegionCode,
  gamesTypeLabel,
  type GamesCategory,
} from "@/lib/games/variant-kind";

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
  /** Label tipe untuk pembeli (ejaan Indonesia); null bila tipe kosong/DIGITAL. */
  type_label: string | null;
  /** ISO-2 atau "GLOBAL" bila tipe adalah negara/global; selain itu null. */
  region_code: string | null;
  /** Section Oura-style: override admin, selain itu aturan otomatis. */
  category: GamesCategory;
  /** True hanya bila varian mendukung cek nickname SK (predikat route nickname). */
  validation_available: boolean;
}

export interface GamesDetailGame {
  slug: string;
  name: string;
  publisher: string;
  currency: GamesCurrency;
  icon: string | null;
  banner: string | null;
  fields: GamesField[];
  /** Deskripsi singkat dari admin (`games_meta`); "" bila belum diisi. */
  description: string;
  /** Panduan mencari ID dari admin (`games_meta`); "" bila belum diisi. */
  id_guide: string;
}

export interface GamesCatalogItem {
  slug: string;
  name: string;
  publisher: string;
  currency: GamesCurrency;
  icon: string | null;
  banner: string | null;
  /** Harga terendah dari varian yang BISA DIJUAL; null bila tidak ada. */
  min_price: number | null;
  /** Jumlah varian berharga (kompatibilitas UI lama). */
  sku_count: number;
  /** Jumlah varian yang saat ini benar-benar bisa dibeli. */
  sellable_count: number;
  /** Urutan "Populer sekarang" dari admin (1–99); null = tidak diurutkan. */
  featured_rank: number | null;
}

const CATALOG_COLUMNS = `game_brand, buyer_sku_code, product_name, sell_price, supplier, sk_variant_id,
  sk_product_id, sk_product_name, game_slug, stock, min_order, supplier_active, required_fields_json,
  validation_json, image_url, cost, display_group, display_order, product_type, product_type_name, enabled`;

const DETAIL_COLUMNS = `buyer_sku_code, product_name, sell_price, seller_active, display_group, display_order,
  product_type, product_type_name, supplier, supplier_active, sk_variant_id, sk_product_id, sk_product_name,
  game_slug, stock, min_order, cost, required_fields_json, validation_json, image_url, description, enabled`;

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

export interface GamesMetaRow {
  slug: string;
  display_name: string | null;
  publisher: string | null;
  icon_url: string | null;
  banner_url: string | null;
  description: string | null;
  id_guide: string | null;
  featured_rank: number | null;
  hidden: number;
  markup_percent: number | null;
}

const text = (value: unknown): string => String(value ?? "").trim();

function toMeta(row: Row): GamesMetaRow {
  const rank = Number(row.featured_rank);
  return {
    slug: text(row.slug),
    display_name: text(row.display_name) || null,
    publisher: text(row.publisher) || null,
    icon_url: text(row.icon_url) || null,
    banner_url: text(row.banner_url) || null,
    description: text(row.description) || null,
    id_guide: text(row.id_guide) || null,
    featured_rank: Number.isInteger(rank) && rank > 0 ? rank : null,
    hidden: Number(row.hidden) === 1 ? 1 : 0,
    markup_percent: row.markup_percent === null || row.markup_percent === undefined ? null : Number(row.markup_percent),
  };
}

async function loadGamesMeta(): Promise<Map<string, GamesMetaRow>> {
  const rows = await createDatabaseAccess()
    .queryAll("SELECT * FROM games_meta")
    .catch(() => [] as Row[]);
  const meta = new Map<string, GamesMetaRow>();
  for (const row of rows) {
    const entry = toMeta(row);
    if (entry.slug) meta.set(entry.slug, entry);
  }
  return meta;
}

const registryOrder = new Map<string, number>(GAMES_REGISTRY.map((game, index) => [game.slug, index]));

/** Urutan listing: bisa dijual dulu → popularitas admin → registry → nama. */
const compareGames = (a: GamesCatalogItem, b: GamesCatalogItem): number => {
  const sellableA = a.sellable_count > 0 ? 0 : 1;
  const sellableB = b.sellable_count > 0 ? 0 : 1;
  if (sellableA !== sellableB) return sellableA - sellableB;
  const rankA = a.featured_rank ?? Number.MAX_SAFE_INTEGER;
  const rankB = b.featured_rank ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;
  const orderA = registryOrder.get(a.slug) ?? Number.MAX_SAFE_INTEGER;
  const orderB = registryOrder.get(b.slug) ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  return a.name.localeCompare(b.name);
};

export async function getGamesCatalog(): Promise<GamesCatalogItem[]> {
  // Katalog publik SK-only. Baris Digiflazz legacy tidak pernah ditampilkan
  // sebagai game yang bisa dibeli baru.
  const rows = [...await createDatabaseAccess().queryAll(
    `SELECT ${CATALOG_COLUMNS} FROM games_products WHERE supplier='sekalipay' AND enabled=1 AND sell_price>0`,
  ).catch(() => [] as Row[])];
  const meta = await loadGamesMeta();

  const skGames: GamesCatalogItem[] = [];
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
      const overlay = meta.get(slug);
      // Admin menyembunyikan game: hilang dari list, sitemap, dan pencarian.
      if (overlay?.hidden === 1) continue;
      const sellablePrices = group
        .filter((row) => gamesSkAvailability(row).available)
        .map((row) => Number(row.sell_price))
        .filter((price) => Number.isFinite(price) && price > 0);
      const registry = gamesRegistryGame(slug);
      skSlugs.add(slug);
      skGames.push({
        slug,
        name: overlay?.display_name ?? registry?.name ?? (upstreamName || `Game ${productId}`),
        publisher: overlay?.publisher ?? registry?.publisher ?? "",
        currency: registry?.currency ?? "topup",
        icon: overlay?.icon_url ?? registry?.icon ?? sanitizeSkImageUrl(group[0].image_url),
        banner: overlay?.banner_url ?? registry?.banner ?? null,
        min_price: sellablePrices.length > 0 ? Math.min(...sellablePrices) : null,
        sku_count: group.length,
        sellable_count: sellablePrices.length,
        featured_rank: overlay?.featured_rank ?? null,
      });
    }
  }

  return skGames.sort(compareGames);
}

export type GamesCatalogGame = GamesCatalogItem;

export async function getGamesDetail(slug: string): Promise<{ game: GamesDetailGame; products: GamesDetailProduct[] } | null> {
  const normalized = String(slug ?? "").trim().toLowerCase();
  const registry = gamesRegistryGame(normalized);
  const meta = (await loadGamesMeta()).get(normalized);
  // Game yang disembunyikan admin tidak punya halaman publik (404).
  if (meta?.hidden === 1) return null;
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
      name: meta?.display_name ?? registry?.name ?? (upstreamName || String(first.product_name ?? "")),
      publisher: meta?.publisher ?? registry?.publisher ?? "",
      currency: registry?.currency ?? "topup",
      icon: meta?.icon_url ?? registry?.icon ?? sanitizeSkImageUrl(first.image_url),
      banner: meta?.banner_url ?? registry?.banner ?? null,
      // Field bersifat per-varian (product_type berbeda); UI P3 membacanya dari
      // `products[].fields`, bukan dari level game.
      fields: [],
      description: meta?.description ?? "",
      id_guide: meta?.id_guide ?? "",
    };
    const products: GamesDetailProduct[] = skRows.filter((row) => !isGamesNicknameProduct(row)).map((row) => {
      const contract = parseGamesSkContract(row.required_fields_json);
      const availability = gamesSkAvailability(row);
      const typeName = String(row.product_type_name ?? "").trim();
      return {
        buyer_sku_code: String(row.buyer_sku_code),
        name: String(row.product_name ?? ""),
        price: Number(row.sell_price) || 0,
        group: effectiveGroup(row),
        display_order: row.display_order == null ? null : Number(row.display_order),
        available: availability.available,
        availability_reason: availability.reason,
        fields: (contract?.fields ?? []).map((field) => ({ ...field, label: cleanGamesFieldLabel(field.label) })),
        unsupported_reason: contract?.reason ?? (contract ? null : "invalid_contract"),
        description: String(row.description ?? ""),
        product_type_name: typeName || null,
        game_brand: String(row.sk_product_name ?? row.game_brand ?? "").trim() || null,
        type_label: gamesTypeLabel(typeName),
        region_code: gamesRegionCode(typeName),
        category: gamesEffectiveCategory({
          displayGroup: row.display_group,
          productName: row.product_name,
          productTypeName: typeName,
        }),
        validation_available: contract?.validation_available === true,
      };
    });
    return { game, products };
  }

  // Tidak ada SK: game registry lama tetap 200 dengan header dan "nominal
  // segera tersedia", tanpa SKU DGF yang bisa dibeli.
  if (!registry) return null;
  return { game: publicRegistryGame(registry, meta), products: [] };
}

export type GamesDetail = NonNullable<Awaited<ReturnType<typeof getGamesDetail>>>;

function publicRegistryGame(game: (typeof GAMES_REGISTRY)[number], meta?: GamesMetaRow): GamesDetailGame {
  return {
    slug: game.slug,
    name: meta?.display_name ?? game.name,
    publisher: meta?.publisher ?? game.publisher,
    currency: game.currency,
    icon: meta?.icon_url ?? game.icon,
    banner: meta?.banner_url ?? game.banner,
    description: meta?.description ?? "",
    id_guide: meta?.id_guide ?? "",
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
