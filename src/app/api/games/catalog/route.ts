// GET /api/games/catalog — buyer-safe games with sellable enabled SKUs.
import { NextRequest, NextResponse } from "next/server";
import { gamesOrderingOpen } from "@/lib/games/ordering";
import { getGamesCatalog } from "@/lib/games/catalog";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export async function GET(_request?: NextRequest) {
  void _request;
  const orderingOpen = gamesOrderingOpen();
  const { cachePublicCatalog } = await import("@/lib/catalog-cache");
  return cachePublicCatalog(
    `games:list:open=${orderingOpen}`,
    300,
    async () => NextResponse.json(
      { ordering_open: orderingOpen, games: await getGamesCatalog() },
      { headers: { "Cache-Control": "public, max-age=5, s-maxage=10, stale-while-revalidate=30" } },
    ),
    "games",
  );
}
