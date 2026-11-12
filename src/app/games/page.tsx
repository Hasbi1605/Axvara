import { getGamesCatalog } from "@/lib/games/catalog";
import { gamesOrderingOpen } from "@/lib/games/ordering";
import { GamesHome } from "./home-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const games = await getGamesCatalog();
  // Orbit = empat game pertama dari katalog DB (bukan whitelist registry).
  return <GamesHome games={games} orbitGames={games.slice(0, 4).map(({ slug, name, icon }) => ({ slug, name, icon }))} orderingOpen={gamesOrderingOpen()} />;
}
