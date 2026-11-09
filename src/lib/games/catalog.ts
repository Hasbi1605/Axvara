import { createDatabaseAccess } from "@/lib/db-access";
import { GAMES_REGISTRY } from "@/lib/games/registry";
import { gamesRegistryGame, publicGamesGame } from "@/lib/games/registry";
import { effectiveGroup } from "@/lib/games/admin";
import { isGamesNicknameProduct } from "@/lib/games/sellable";

export async function getGamesCatalog() {
  const rows = [...await createDatabaseAccess().queryAll(
    `SELECT game_brand, buyer_sku_code, product_name, sell_price
       FROM games_products WHERE enabled=1 AND sell_price>0`,
  ).catch(() => [] as Record<string, unknown>[])];
  // ponytail: local visual QA only; replace with seeded D1 when Next dev exposes its binding.
  if (process.env.NODE_ENV !== "production" && process.env.GAMES_DEV_FIXTURE === "1") {
    rows.push(...["FREE FIRE", "Free Fire Max", "MOBILE LEGENDS", "PUBG MOBILE"].map((game_brand) => ({ game_brand, buyer_sku_code: "fixture", product_name: "Diamond", sell_price: 1000 })));
  }
  const byBrand = new Map<string, { sku_count: number; min_price: number }>();
  for (const row of rows) {
    if (isGamesNicknameProduct(row)) continue;
    const brand = String(row.game_brand ?? "").trim().toLowerCase();
    const current = byBrand.get(brand);
    byBrand.set(brand, { sku_count: (current?.sku_count ?? 0) + 1, min_price: Math.min(current?.min_price ?? Infinity, Number(row.sell_price)) });
  }
  return GAMES_REGISTRY.flatMap((game) => {
    let minPrice: number | null = null;
    let skuCount = 0;
    for (const brand of game.brands) {
      const row = byBrand.get(brand.trim().toLowerCase());
      if (!row) continue;
      const count = Number(row.sku_count) || 0;
      const price = Number(row.min_price) || 0;
      if (count > 0 && price > 0) {
        skuCount += count;
        minPrice = minPrice === null ? price : Math.min(minPrice, price);
      }
    }
    if (skuCount === 0 || minPrice === null) return [];
    return [{ slug: game.slug, name: game.name, publisher: game.publisher, currency: game.currency, icon: game.icon, banner: game.banner, min_price: minPrice, sku_count: skuCount }];
  });
}

export type GamesCatalogGame = Awaited<ReturnType<typeof getGamesCatalog>>[number];

export async function getGamesDetail(slug: string) {
  const game = gamesRegistryGame(slug);
  if (!game) return null;
  const brands = game.brands.map((brand) => brand.trim().toLowerCase());
  const rows = await createDatabaseAccess().queryAll(
    `SELECT buyer_sku_code, product_name, sell_price, seller_active, display_group, display_order, product_type
       FROM games_products WHERE enabled=1 AND lower(trim(game_brand)) IN (${brands.map(() => "?").join(",")})
       ORDER BY display_order IS NULL, display_order, sell_price, id`, ...brands,
  ).catch(() => [] as Record<string, unknown>[]);
  const products = rows.filter((row) => !isGamesNicknameProduct(row)).map((row) => ({ buyer_sku_code: String(row.buyer_sku_code), name: String(row.product_name ?? ""), price: Number(row.sell_price) || 0, group: effectiveGroup(row), display_order: row.display_order == null ? null : Number(row.display_order), available: Number(row.seller_active) === 1 && Number.isSafeInteger(Number(row.sell_price)) && Number(row.sell_price) > 0 }));
  if (process.env.NODE_ENV !== "production" && process.env.GAMES_DEV_FIXTURE === "1") {
    products.push(...[
      { buyer_sku_code: "fixture-special", name: "Weekly Diamond Pass", price: 24000, group: "special" as const, display_order: 1, available: true },
      { buyer_sku_code: "fixture-1", name: "86 Diamond (77+8)", price: 20000, group: "bestseller" as const, display_order: 2, available: true },
      { buyer_sku_code: "fixture-2", name: "172 Diamond", price: 40000, group: "all" as const, display_order: 3, available: true },
      { buyer_sku_code: "fixture-3", name: "257 Diamond", price: 60000, group: "all" as const, display_order: 4, available: false },
    ]);
  }
  return { game: publicGamesGame(game), products };
}

export type GamesDetail = NonNullable<Awaited<ReturnType<typeof getGamesDetail>>>;
