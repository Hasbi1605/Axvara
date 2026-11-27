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

describe("Games screens copy (owner 28 Nov 2026)", () => {
  it("shows region flag + currency on the game detail caption", async () => {
    const { gamesDetailMessage } = await import("@/lib/telegram/messages/games");
    const msg = gamesDetailMessage({ gameName: "Mobile Legends", activeTypeLabel: "Indonesia", regionFlag: "🇮🇩", currencyLabel: "💎 Diamond", shownCount: 10, totalInScope: 20, page: 0, totalPages: 2, orderingOpen: true, locale: "id" });
    expect(msg).toContain("🇮🇩 Indonesia · 💎 Diamond");
  });

  it("puts the game logo on input/review titles and shows the full ID guide", async () => {
    const { gamesAccountInputPromptMessage, gamesReviewMessage } = await import("@/lib/telegram/messages/games");
    const guide = "Buka profil di pojok kiri atas. ".repeat(10).trim();
    const input = gamesAccountInputPromptMessage({ gameName: "Mobile Legends", gameSlug: "mobile-legends", packageName: "5 Diamonds", price: 2000, requiresZone: true, noteLabel: "User ID", zoneLabel: "Zone ID", idGuide: guide });
    expect(input).toContain(`<b><tg-emoji emoji-id="${GAME_LOGO_EMOJI["mobile-legends"]}">🎮</tg-emoji> Mobile Legends</b>`);
    expect(input).toContain("💡 <b>Cara cek ID:</b>");
    expect(input).toContain(guide);
    const review = gamesReviewMessage({ gameName: "Mobile Legends", gameSlug: "mobile-legends", packageName: "5 Diamonds", accountDisplay: "123 (45)", total: 2000 });
    expect(review).toContain(`Game     : <tg-emoji emoji-id="${GAME_LOGO_EMOJI["mobile-legends"]}">🎮</tg-emoji> <b>Mobile Legends</b>`);
  });

  it("keeps the wide-banner experiment limited to Mobile Legends", async () => {
    const { GAMES_WIDE_BANNER_SLUGS } = await import("@/lib/telegram/handlers/games");
    expect([...GAMES_WIDE_BANNER_SLUGS]).toEqual(["mobile-legends"]);
  });
});
