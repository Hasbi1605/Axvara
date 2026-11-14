import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGamesCatalog, getGamesDetail } from "@/lib/games/catalog";
import { gamesOrderingOpen } from "@/lib/games/ordering";
import { requestLocale } from "@/lib/i18n/server-locale";
import { gamesCopy } from "@/lib/games/copy";
import { gamesMetadata } from "@/lib/games/metadata";
import { GameClient } from "./game-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const [{ slug }, locale] = await Promise.all([params, requestLocale()]);
  const detail = await getGamesDetail(slug);
  return detail ? { ...gamesMetadata(`/${detail.game.slug}`, `${detail.game.name} — AXVARA Games`, `${gamesCopy(locale).catalog}: ${detail.game.name}`), ...(!detail.products.length ? { robots: { index: false, follow: true } } : {}) } : {};
}

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const detail = await getGamesDetail((await params).slug);
  if (!detail) notFound();
  const games = await getGamesCatalog();
  return <GameClient detail={detail} otherGames={games} orderingOpen={gamesOrderingOpen()} />;
}
