// GET /api/games/catalog — buyer-safe games with sellable enabled SKUs.
import { NextRequest, NextResponse } from "next/server";
import { gamesOrderingOpen } from "@/lib/games/ordering";
import { getGamesCatalog } from "@/lib/games/catalog";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export async function GET(_request: NextRequest) {
  return NextResponse.json({ ordering_open: gamesOrderingOpen(), games: await getGamesCatalog() }, { headers: { "Cache-Control": "private, no-store" } });
}
