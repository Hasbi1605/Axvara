import type { MetadataRoute } from "next";
import { createDatabaseAccess } from "@/lib/db-access";
import { GAMES_REGISTRY, gamesBrandMatches } from "@/lib/games/registry";
import { isGamesNicknameProduct } from "@/lib/games/sellable";
import { SITE } from "@/lib/site";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const rows = await createDatabaseAccess().queryAll(
    "SELECT buyer_sku_code, product_name, game_brand FROM games_products WHERE enabled=1 AND sell_price>0",
  ).catch(() => []);
  const sellable = rows.filter(row => !isGamesNicknameProduct(row));
  return [
    { url: `${SITE.gamesUrl}/`, changeFrequency: "daily", priority: 1 },
    ...GAMES_REGISTRY.filter(game => sellable.some(row => gamesBrandMatches(game, row.game_brand)))
      .map(game => ({ url: `${SITE.gamesUrl}/${game.slug}`, changeFrequency: "daily" as const, priority: 0.8 })),
  ];
}
