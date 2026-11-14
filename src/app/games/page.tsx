import { getGamesCatalog } from "@/lib/games/catalog";
import { gamesOrderingOpen } from "@/lib/games/ordering";
import { selectOrbitGames } from "@/lib/games/popular";
import { GamesHome } from "./home-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const games = await getGamesCatalog();
  // Orbit = 8 game populer tetap yang ada di katalog DB (tanpa Free Fire MAX), diisi game katalog berikutnya bila kurang.
  return <GamesHome games={games} orbitGames={selectOrbitGames(games).map(({ slug, name, icon }) => ({ slug, name, icon }))} orderingOpen={gamesOrderingOpen()} />;
}
