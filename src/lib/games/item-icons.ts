import type { GamesDetailGame, GamesDetailProduct } from "./catalog";

const currencySets: Record<string, string> = {
  "mobile-legends": "mlbb-diamond", "magic-chess-go-go": "mlbb-diamond", "mobile-legends-adventure": "mlbb-diamond",
  "free-fire": "ff-diamond", "free-fire-max": "ff-diamond", "pubg-mobile": "pubg-uc",
  "genshin-impact": "genshin-crystal", "honkai-star-rail": "hsr-shard", "zenless-zone-zero": "zzz-monochrome",
  valorant: "valorant-points", "call-of-duty-mobile": "codm-cp", roblox: "robux", "honor-of-kings": "hok-token",
};

/** Rank is zero-based, ascending by price within the current category list. */
export function gamesItemIcon(slug: string, product: Pick<GamesDetailProduct, "name" | "category"> & { currency?: GamesDetailGame["currency"] }, rank = { index: 0, total: 1 }): string {
  let file: string;
  if (product.category === "pass") file = /member|membership|langganan|starlight/i.test(product.name) ? "member" : "pass";
  else if (product.category === "first_topup") file = "gift";
  else if (["pack", "promo", "special"].includes(product.category)) file = product.category;
  else {
    const set = currencySets[slug] ?? (product.currency === "diamond" ? "gem" : "coin");
    const tier = rank.total <= 1 ? 1 : Math.min(3, Math.max(1, Math.floor(rank.index * 3 / rank.total) + 1));
    file = `${set}-${tier}`;
  }
  return `/brand/games/items/${file}.webp`;
}

/**
 * Skala visual per ikon (14 Nov 2026, koreksi owner): ikon satuan memenuhi kanvas sedangkan
 * tumpukan pipih tidak, sehingga satuan terlihat jauh lebih besar. Skala = sqrt(0.42 / luas
 * bbox alfa), dibatasi 0.7–1.08, dihitung dari public/brand/games/items/*.webp.
 */
export const GAMES_ITEM_ICON_SCALE: Readonly<Record<string, number>> = Object.freeze({
  "codm-cp-1": 0.78,
  "codm-cp-2": 1.01,
  "codm-cp-3": 0.8,
  "coin-1": 0.8,
  "coin-2": 0.94,
  "coin-3": 0.77,
  "ff-diamond-1": 0.79,
  "ff-diamond-2": 0.92,
  "ff-diamond-3": 0.78,
  "gem-1": 1.08,
  "gem-2": 0.83,
  "gem-3": 0.78,
  "genshin-crystal-1": 0.8,
  "genshin-crystal-2": 0.86,
  "genshin-crystal-3": 0.85,
  "gift": 0.91,
  "hok-token-1": 0.82,
  "hok-token-2": 1,
  "hok-token-3": 0.8,
  "hsr-shard-1": 0.77,
  "hsr-shard-2": 0.9,
  "hsr-shard-3": 0.89,
  "member": 0.8,
  "mlbb-diamond-1": 0.79,
  "mlbb-diamond-2": 1.04,
  "mlbb-diamond-3": 0.85,
  "pack": 0.85,
  "pass": 0.89,
  "promo": 1,
  "pubg-uc-1": 0.8,
  "pubg-uc-2": 1.04,
  "pubg-uc-3": 0.79,
  "robux-1": 0.79,
  "robux-2": 1.01,
  "robux-3": 0.77,
  "special": 0.78,
  "valorant-points-1": 0.79,
  "valorant-points-2": 1.05,
  "valorant-points-3": 0.82,
  "zzz-monochrome-1": 0.83,
  "zzz-monochrome-2": 0.87,
  "zzz-monochrome-3": 0.79,
});

export function gamesItemIconScale(src: string): number {
  const key = src.split("/").pop()?.replace(/\.webp$/, "") ?? "";
  return GAMES_ITEM_ICON_SCALE[key] ?? 1;
}
