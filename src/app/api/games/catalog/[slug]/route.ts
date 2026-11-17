// GET /api/games/catalog/[slug] — nominal per game. SKU dengan seller
// nonaktif tetap tampil (`available:false`) agar pembeli melihat "Sedang
// gangguan", bukan menghilang diam-diam. Tanpa modal/margin/seller/cadangan.
import { NextRequest, NextResponse } from "next/server";
import { getGamesDetail } from "@/lib/games/catalog";
import { gamesOrderingOpen } from "@/lib/games/ordering";
import { pediaApiLocale, pick } from "@/lib/pedia/api-locale";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const locale = pediaApiLocale(request);
  const { slug } = await params;
  const detail = await getGamesDetail(slug, locale);
  if (!detail) {
    return NextResponse.json(
      { error: pick(locale, "Game tidak ditemukan.", "Game not found.") },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return NextResponse.json(
    { game: detail.game, ordering_open: gamesOrderingOpen(), products: detail.products },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
