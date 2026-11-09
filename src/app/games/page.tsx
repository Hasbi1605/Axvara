import { getGamesCatalog } from "@/lib/games/catalog";
import { gamesOrderingOpen } from "@/lib/games/ordering";
import { GAMES_REGISTRY } from "@/lib/games/registry";
import { GamesHome } from "./home-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function GamesPage() {
  return <GamesHome games={await getGamesCatalog()} orbitGames={GAMES_REGISTRY.map(({ slug, name, icon }) => ({ slug, name, icon }))} orderingOpen={gamesOrderingOpen()} />;
}
