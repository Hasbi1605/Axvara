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

/**
 * Planet orbit hero (14 Nov 2026, koreksi owner): 8 game populer tetap, sesuai
 * kapasitas PediaOrbit (4 ring: 1/3/2/2). Free Fire MAX sengaja tidak masuk —
 * sudah terwakili Free Fire. Slug yang belum ada di katalog dilewati lalu diisi
 * game katalog berikutnya agar orbit tetap penuh.
 */
export const GAMES_ORBIT = [
  "mobile-legends", "pubg-mobile", "free-fire", "genshin-impact",
  "honor-of-kings", "valorant", "roblox", "call-of-duty-mobile",
] as const;
export const GAMES_ORBIT_EXCLUDED = new Set(["free-fire-max"]);
/** Ring PediaOrbit per urutan planet: inti 1, lalu 3, 2, 2. */
export const GAMES_ORBIT_RINGS = [0, 1, 1, 1, 2, 2, 3, 3] as const;
/** Sudut awal per ring agar 8 planet tersebar (sudut 20/50/110/140/200/230/260/290°), tidak menumpuk saat load. */
export const GAMES_ORBIT_PHASE = [200, 20, 50, 110] as const;

export function selectOrbitGames<T extends Pick<GamesCatalogGame, "slug">>(games: readonly T[]): T[] {
  const picked = GAMES_ORBIT.flatMap((slug) => games.find((game) => game.slug === slug) ?? []);
  for (const game of games) {
    if (picked.length >= GAMES_ORBIT.length) break;
    if (!GAMES_ORBIT_EXCLUDED.has(game.slug) && !picked.includes(game)) picked.push(game);
  }
  return picked;
}
