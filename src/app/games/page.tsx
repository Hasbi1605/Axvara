import { getGamesCatalog } from "@/lib/games/catalog";
import { gamesOrderingOpen } from "@/lib/games/ordering";
import { GamesHome } from "./home-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function GamesPage() {
  return <GamesHome games={await getGamesCatalog()} orderingOpen={gamesOrderingOpen()} />;
}
