// GET /api/games/catalog/[slug] — nominal per game. SKU dengan seller
// nonaktif tetap tampil (`available:false`) agar pembeli melihat "Sedang
// gangguan", bukan menghilang diam-diam. Tanpa modal/margin/seller/cadangan.
import { NextRequest, NextResponse } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import { effectiveGroup } from "@/lib/games/admin";
import { gamesOrderingOpen } from "@/lib/games/ordering";
import { gamesRegistryGame, publicGamesGame } from "@/lib/games/registry";
import { pediaApiLocale, pick } from "@/lib/pedia/api-locale";
import { isGamesNicknameProduct } from "@/lib/games/sellable";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const locale = pediaApiLocale(request);
  const { slug } = await params;
  const game = gamesRegistryGame(slug);
  if (!game) {
    return NextResponse.json(
      { error: pick(locale, "Game tidak ditemukan.", "Game not found.") },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const db = createDatabaseAccess();
  const brands = game.brands.map((brand) => brand.trim().toLowerCase());
  const rows = await db.queryAll(
    `SELECT buyer_sku_code, product_name, sell_price, seller_active, display_group, display_order, product_type
       FROM games_products
      WHERE enabled=1 AND lower(trim(game_brand)) IN (${brands.map(() => "?").join(",")})
      ORDER BY display_order IS NULL, display_order, sell_price, id`,
    ...brands,
  ).catch(() => [] as Record<string, unknown>[]);
  const products = rows.filter(row => !isGamesNicknameProduct(row)).map((row) => ({
    buyer_sku_code: String(row.buyer_sku_code),
    name: String(row.product_name ?? ""),
    price: Number(row.sell_price) || 0,
    group: effectiveGroup(row),
    display_order: row.display_order == null ? null : Number(row.display_order),
    available: Number(row.seller_active) === 1 && Number.isSafeInteger(Number(row.sell_price)) && Number(row.sell_price) > 0,
  }));
  return NextResponse.json(
    { game: publicGamesGame(game), ordering_open: gamesOrderingOpen(), products },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
