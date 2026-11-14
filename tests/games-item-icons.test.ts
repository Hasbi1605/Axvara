import { describe, expect, it } from "vitest";
import { gamesItemIcon } from "@/lib/games/item-icons";
import type { GamesDetailProduct } from "@/lib/games/catalog";

const topup = { name: "100 credits", category: "topup" as const };

describe("Games item artwork", () => {
  it.each([
    ["mobile-legends", "mlbb-diamond"], ["magic-chess-go-go", "mlbb-diamond"], ["mobile-legends-adventure", "mlbb-diamond"],
    ["free-fire", "ff-diamond"], ["free-fire-max", "ff-diamond"], ["pubg-mobile", "pubg-uc"],
    ["genshin-impact", "genshin-crystal"], ["honkai-star-rail", "hsr-shard"], ["zenless-zone-zero", "zzz-monochrome"],
    ["valorant", "valorant-points"], ["call-of-duty-mobile", "codm-cp"], ["roblox", "robux"], ["honor-of-kings", "hok-token"],
  ])("maps %s to its currency set", (slug, set) => {
    expect(gamesItemIcon(slug, topup)).toBe(`/brand/games/items/${set}-1.webp`);
  });

  it("uses gems only for unmapped diamond games, otherwise coins", () => {
    expect(gamesItemIcon("new-game", { ...topup, currency: "diamond" })).toContain("/gem-1.webp");
    expect(gamesItemIcon("new-game", { ...topup, currency: "uc" })).toContain("/coin-1.webp");
    expect(gamesItemIcon("new-game", topup)).toContain("/coin-1.webp");
  });

  it.each(["Monthly Member", "MEMBERSHIP 30 days", "Langganan bulanan", "Starlight Member", "starlight"])('uses a membership icon for "%s"', (name) => {
    expect(gamesItemIcon("mobile-legends", { name, category: "pass" })).toContain("/member.webp");
  });

  it.each([
    ["pass", "pass"], ["first_topup", "gift"], ["pack", "pack"], ["promo", "promo"], ["special", "special"],
  ] as [GamesDetailProduct["category"], string][])("uses category artwork for %s regardless of currency/tier", (category, file) => {
    expect(gamesItemIcon("mobile-legends", { name: "Weekly Pass", category }, { index: 8, total: 9 })).toBe(`/brand/games/items/${file}.webp`);
  });

  it.each(["topup", "bestseller", "other"] as const)("uses low/middle/high price thirds for %s", (category) => {
    const paths = Array.from({ length: 6 }, (_, index) => gamesItemIcon("mobile-legends", { ...topup, category }, { index, total: 6 }));
    expect(paths.map((path) => path.match(/-(\d)\.webp$/)![1])).toEqual(["1", "1", "2", "2", "3", "3"]);
    expect(gamesItemIcon("mobile-legends", { ...topup, category }, { index: 0, total: 1 })).toContain("-1.webp");
    expect(gamesItemIcon("mobile-legends", { ...topup, category }, { index: 3, total: 4 })).toContain("-3.webp");
  });
});
