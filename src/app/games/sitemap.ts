import type { MetadataRoute } from "next";
import { createDatabaseAccess } from "@/lib/db-access";
import { isGamesNicknameProduct } from "@/lib/games/sellable";
import { SITE } from "@/lib/site";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Sitemap publik hanya slug dari katalog SK yang enabled/berharga. Baris
  // Digiflazz legacy tidak pernah dipublikasikan sebagai game baru.
  const rows = await createDatabaseAccess().queryAll(
    "SELECT buyer_sku_code, product_name, game_slug FROM games_products WHERE supplier='sekalipay' AND enabled=1 AND sell_price>0",
  ).catch(() => []);
  const sellable = rows.filter(row => !isGamesNicknameProduct(row));
  const slugs = new Set<string>();
  for (const row of sellable) {
    const slug = String(row.game_slug ?? "").trim();
    if (/^[a-z0-9-]{1,64}$/.test(slug)) slugs.add(slug);
  }
  return [
    { url: `${SITE.gamesUrl}/`, changeFrequency: "daily", priority: 1 },
    ...[...slugs].sort().map(slug => ({ url: `${SITE.gamesUrl}/${slug}`, changeFrequency: "daily" as const, priority: 0.8 })),
  ];
}
