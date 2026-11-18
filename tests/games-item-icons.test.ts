import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { gamesItemIcon, gamesItemIconScale } from "@/lib/games/item-icons";
import type { GamesDetailProduct } from "@/lib/games/catalog";

const topup = { name: "100 credits", category: "topup" as const };

const namedCases = [
  ["mobile-legends", "Weekly Diamond Pass (Indonesia)", "pass", "ml-weekly-diamond-pass"],
  ["mobile-legends", "Weekly Diamond Pass 2x", "pass", "ml-weekly-diamond-pass"],
  ["mobile-legends", "Weekly Diamond Pass 3X (Indonesia)", "pass", "ml-weekly-diamond-pass"],
  ["mobile-legends", "Weekly Diamond Pass 4x (Indonesia)", "pass", "ml-weekly-diamond-pass"],
  ["mobile-legends", "Weekly Diamond Pass 5x", "pass", "ml-weekly-diamond-pass"],
  ["mobile-legends", "Twilight Pass (Global)", "pass", "ml-twilight-pass"],
  ["mobile-legends", "Startlight Member", "pass", "ml-starlight"],
  ["mobile-legends", "Startlight Member Plus", "pass", "ml-starlight"],
  ["mobile-legends", "Starlight Membership", "promo", "ml-starlight"],
  ["free-fire", "Europe Weekly Lite", "pass", "ff-weekly-lite"],
  ["free-fire", "Weekly Membership Lite", "pass", "ff-weekly-lite"],
  ["free-fire", "Weekly Membership (Global)", "pass", "ff-weekly-membership"],
  ["free-fire", "Membership Mingguan X3", "pass", "ff-weekly-membership"],
  ["free-fire", "Europe Monthly Membership", "pass", "ff-monthly-membership"],
  ["free-fire", "Membership Bulanan X5", "pass", "ff-monthly-membership"],
  ["free-fire-max", "Membership Mingguan", "pass", "ff-weekly-membership"],
  ["free-fire-max", "Membership Bulanan", "pass", "ff-monthly-membership"],
  ["pubg-mobile", "PUBG Royale Pass", "pass", "pubg-royale-pass"],
  ["pubg-mobile", "PUBG Elite Pass Plus", "pass", "pubg-royale-pass"],
  ["genshin-impact", "Blessing Of The Welkin Moon (ID)", "other", "genshin-welkin-moon"],
  ["genshin-impact", "Blessing Of The Welkin Moon 5x", "other", "genshin-welkin-moon"],
  ["honkai-star-rail", "Express Supply Pass (MY)", "pass", "hsr-express-supply-pass"],
  ["honkai-star-rail", "Express Supply Pass 3x", "pass", "hsr-express-supply-pass"],
  ["roblox", "Gift Card (IDR) 50.000", "other", "roblox-gift-card"],
] as const;

describe("Games item artwork", () => {
  it.each(namedCases)("%s selects named artwork for %s in category %s", (slug, name, category, file) => {
    expect(gamesItemIcon(slug, { name, category }, { index: 8, total: 9 })).toBe(`/brand/games/items/${file}.webp`);
  });

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

  it.each(["Monthly Member", "MEMBERSHIP 30 days", "Langganan bulanan", "starlight"])('uses a membership icon for "%s"', (name) => {
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

  it("uses Wild Core tiers for Wild Rift top-ups classified under other", () => {
    for (const index of [0, 1, 2]) {
      expect(gamesItemIcon("league-of-legends-wild-rift", { name: "425 Wild Cores", category: "other" }, { index, total: 3 }))
        .toBe(`/brand/games/items/wild-rift-core-${index + 1}.webp`);
    }
  });

  it.each([
    ["other-game", "Weekly Diamond Pass", "pass", "pass"],
    ["free-fire", "Level Up Pass", "pass", "pass"],
    ["magic-chess-go-go", "Go Go Weekly Card 3x", "pass", "pass"],
    ["zenless-zone-zero", "Inter-knot Membership", "pass", "member"],
    ["honkai-star-rail", "All Pack Oneiric Shard", "pack", "pack"],
    ["roblox", "Vcr Robux 100", "topup", "robux-1"],
  ] as const)("%s keeps the old icon for %s", (slug, name, category, file) => {
    expect(gamesItemIcon(slug, { name, category })).toBe(`/brand/games/items/${file}.webp`);
  });
});

it.each([...new Set(namedCases.map(([, , , file]) => file)), "wild-rift-core-1", "wild-rift-core-2", "wild-rift-core-3"])(
  "%s is a transparent 512px WebP with bbox-normalized scale", async (file) => {
    const src = `/brand/games/items/${file}.webp`;
    const image = sharp(resolve(`public${src}`));
    expect(await image.metadata()).toMatchObject({ format: "webp", width: 512, height: 512, hasAlpha: true });
    const alpha = await image.extractChannel(3).raw().toBuffer();
    let left = 512, right = -1, top = 512, bottom = -1;
    for (let i = 0; i < alpha.length; i++) {
      if (!alpha[i]) continue;
      const x = i % 512, y = Math.floor(i / 512);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    expect(right).toBeGreaterThan(left);
    expect(bottom).toBeGreaterThan(top);
    expect(Math.min(left, top, 511 - right, 511 - bottom)).toBeGreaterThan(0);
    const area = (right - left + 1) * (bottom - top + 1) / 512 ** 2;
    expect(gamesItemIconScale(src)).toBe(Number(Math.max(0.7, Math.min(1.08, Math.sqrt(0.42 / area))).toFixed(2)));
  },
);

describe("item icon visual scale (owner correction 14 Nov 2026)", () => {
  it("shrinks single-item icons relative to flat stacks so sizes look even", async () => {
    const { gamesItemIconScale, GAMES_ITEM_ICON_SCALE } = await import("@/lib/games/item-icons");
    for (const set of ["pubg-uc", "mlbb-diamond", "ff-diamond", "robux", "valorant-points"]) {
      expect(gamesItemIconScale(`/brand/games/items/${set}-1.webp`)).toBeLessThan(gamesItemIconScale(`/brand/games/items/${set}-2.webp`));
    }
    for (const v of Object.values(GAMES_ITEM_ICON_SCALE)) { expect(v).toBeGreaterThanOrEqual(0.7); expect(v).toBeLessThanOrEqual(1.08); }
    expect(gamesItemIconScale("/brand/games/items/unknown.webp")).toBe(1);
  });
});
