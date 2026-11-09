// GET /api/games/catalog — daftar game gelombang 1 yang punya ≥1 SKU enabled.
// Tidak pernah membocorkan modal, margin, seller, atau kode cadangan.
import { NextRequest, NextResponse } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import { gamesOrderingOpen } from "@/lib/games/ordering";
import { GAMES_REGISTRY } from "@/lib/games/registry";
import { isGamesNicknameProduct } from "@/lib/games/sellable";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  const db = createDatabaseAccess();
  const rows = await db.queryAll(
    `SELECT game_brand, buyer_sku_code, product_name, sell_price
       FROM games_products WHERE enabled=1 AND sell_price>0`,
  ).catch(() => [] as Record<string, unknown>[]);
  const byBrand = new Map<string, { sku_count: number; min_price: number }>();
  for (const row of rows) {
    if (isGamesNicknameProduct(row)) continue;
    const brand = String(row.game_brand ?? "").trim().toLowerCase();
    const current = byBrand.get(brand);
    byBrand.set(brand, { sku_count: (current?.sku_count ?? 0) + 1, min_price: Math.min(current?.min_price ?? Infinity, Number(row.sell_price)) });
  }
  const games = GAMES_REGISTRY.flatMap((game) => {
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
    return [{
      slug: game.slug,
      name: game.name,
      publisher: game.publisher,
      currency: game.currency,
      icon: game.icon,
      banner: game.banner,
      min_price: minPrice,
      sku_count: skuCount,
    }];
  });
  return NextResponse.json(
    { ordering_open: gamesOrderingOpen(), games },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
