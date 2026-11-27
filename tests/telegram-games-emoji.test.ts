import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAME_ITEM_EMOJI, GAME_LOGO_EMOJI, gameItemIcon, gameLogoHtml, gameLogoIcon } from "@/lib/telegram/games-emoji";
import fs from "node:fs";

beforeEach(() => vi.stubEnv("TELEGRAM_CUSTOM_EMOJI", "on"));
afterEach(() => vi.unstubAllEnvs());

describe("AXVARA Games custom emoji packs", () => {
  it("covers every game logo and item icon shipped on the web", () => {
    const logos = fs.readdirSync("public/brand/games").filter((f) => f.endsWith("-icon.webp")).map((f) => f.replace(/-icon\.webp$/, ""));
    const items = fs.readdirSync("public/brand/games/items").filter((f) => f.endsWith(".webp")).map((f) => f.replace(/\.webp$/, ""));
    expect(logos.filter((s) => !GAME_LOGO_EMOJI[s])).toEqual([]);
    expect(items.filter((k) => !GAME_ITEM_EMOJI[k])).toEqual([]);
  });

  it("puts the game logo on buttons and in captions", () => {
    expect(gameLogoIcon("mobile-legends")).toEqual({ icon_custom_emoji_id: GAME_LOGO_EMOJI["mobile-legends"] });
    expect(gameLogoIcon("unknown-game")).toEqual({});
    expect(gameLogoHtml("free-fire")).toBe(`<tg-emoji emoji-id="${GAME_LOGO_EMOJI["free-fire"]}">🎮</tg-emoji>`);
    expect(gameLogoHtml("unknown-game")).toBe("🎮");
  });

  it("picks the same package icon as the web (tier by price rank, named passes)", () => {
    const dm = { name: "5 Diamonds", category: "topup", currency: "diamond" } as never;
    expect(gameItemIcon("mobile-legends", dm, { index: 0, total: 9 })).toEqual({ icon_custom_emoji_id: GAME_ITEM_EMOJI["mlbb-diamond-1"] });
    expect(gameItemIcon("mobile-legends", dm, { index: 8, total: 9 })).toEqual({ icon_custom_emoji_id: GAME_ITEM_EMOJI["mlbb-diamond-3"] });
    const wdp = { name: "Weekly Diamond Pass", category: "pass" } as never;
    expect(gameItemIcon("mobile-legends", wdp)).toEqual({ icon_custom_emoji_id: GAME_ITEM_EMOJI["ml-weekly-diamond-pass"] });
    const uc = { name: "60 UC", category: "topup" } as never;
    expect(gameItemIcon("pubg-mobile", uc)).toEqual({ icon_custom_emoji_id: GAME_ITEM_EMOJI["pubg-uc-1"] });
  });

  it("respects TELEGRAM_CUSTOM_EMOJI=off", () => {
    vi.stubEnv("TELEGRAM_CUSTOM_EMOJI", "off");
    expect(gameLogoIcon("mobile-legends")).toEqual({});
    expect(gameLogoHtml("mobile-legends")).toBe("🎮");
    expect(gameItemIcon("mobile-legends", { name: "5 Diamonds", category: "topup" } as never)).toEqual({});
  });
});
