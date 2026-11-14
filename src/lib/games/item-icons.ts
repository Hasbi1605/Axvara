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
