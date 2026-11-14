import type { GamesCatalogGame } from "./catalog";

export const GAMES_DEFAULT_POPULAR = [
  "mobile-legends", "magic-chess-go-go", "pubg-mobile", "free-fire", "genshin-impact",
  "honor-of-kings", "valorant", "roblox", "honkai-star-rail",
] as const;

export function selectPopularGames(games: readonly GamesCatalogGame[]): GamesCatalogGame[] {
  const featured = games.filter((game) => game.featured_rank != null);
  if (featured.length) return featured.sort((a, b) => a.featured_rank! - b.featured_rank!).slice(0, 9);
  return GAMES_DEFAULT_POPULAR.flatMap((slug) => games.find((game) => game.slug === slug) ?? []);
}
