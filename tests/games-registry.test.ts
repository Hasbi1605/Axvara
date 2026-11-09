// tests/games-registry.test.ts — registry gelombang 1, validasi field server,
// brand mapping, gate P9, dan aturan max_price P6.
import { describe, expect, it } from "vitest";
import {
  GAMES_REGISTRY, gamesGameForBrand, gamesRegistryGame, publicGamesGame, validateGamesFields,
} from "@/lib/games/registry";
import { gamesOrderingOpen } from "@/lib/games/ordering";
import { gamesMaxPrice } from "@/lib/games/checkout";

describe("games registry", () => {
  it("has exactly the four wave-1 games with their Digiflazz brands", () => {
    expect(GAMES_REGISTRY.map((game) => game.slug)).toEqual([
      "free-fire", "free-fire-max", "mobile-legends", "pubg-mobile",
    ]);
    expect(gamesRegistryGame("MOBILE-LEGENDS")?.name).toBe("Mobile Legends");
    expect(gamesGameForBrand("free fire max")?.slug).toBe("free-fire-max");
    expect(gamesGameForBrand("  MOBILE LEGENDS ")?.slug).toBe("mobile-legends");
    // Brand Free Fire tidak boleh menyerap Free Fire MAX.
    expect(gamesGameForBrand("FREE FIRE")?.slug).toBe("free-fire");
    expect(gamesGameForBrand("CODM")).toBeNull();
    expect(gamesRegistryGame("valorant")).toBeNull();
  });

  it("keeps nickname/icon/banner empty for the later packages", () => {
    for (const game of GAMES_REGISTRY) {
      expect(game.nicknameSku).toBeNull();
      expect(game.icon).toBeNull();
      expect(game.banner).toBeNull();
    }
  });

  it("joins Mobile Legends User ID + Zone ID without a separator", () => {
    const ml = gamesRegistryGame("mobile-legends")!;
    expect(validateGamesFields(ml, { userId: "12345", zoneId: "6789" }))
      .toMatchObject({ ok: true, customerNo: "123456789" });
    // Zone satu digit tetap sah.
    expect(validateGamesFields(ml, { userId: "1", zoneId: "9" }))
      .toMatchObject({ ok: true, customerNo: "19" });
  });

  it("validates per-game digit ranges and rejects bad input", () => {
    const ff = gamesRegistryGame("free-fire")!;
    expect(validateGamesFields(ff, { playerId: "123456" })).toMatchObject({ ok: true, customerNo: "123456" });
    expect(validateGamesFields(ff, { playerId: "12345" }).ok).toBe(false);
    expect(validateGamesFields(ff, { playerId: "123456789012345" }).ok).toBe(false);
    expect(validateGamesFields(ff, { playerId: "12ab45" }).ok).toBe(false);

    const ml = gamesRegistryGame("mobile-legends")!;
    expect(validateGamesFields(ml, { userId: "", zoneId: "1" }).ok).toBe(false);
    expect(validateGamesFields(ml, { userId: "1234567890123", zoneId: "1" }).ok).toBe(false);

    const pubg = gamesRegistryGame("pubg-mobile")!;
    expect(validateGamesFields(pubg, { playerId: "123456789012345" })).toMatchObject({ ok: true });
    expect(validateGamesFields(pubg, { playerId: "1234567890123456" }).ok).toBe(false);
    expect(validateGamesFields(pubg, { playerId: "12345" }).ok).toBe(false);

    expect(validateGamesFields(ff, null).ok).toBe(false);
    expect(validateGamesFields(ff, ["123456"]).ok).toBe(false);
    expect(validateGamesFields(ff, {}).ok).toBe(false);
  });

  it("publishes game metadata without the customer_no builder", () => {
    const game = gamesRegistryGame("mobile-legends")!;
    const published = publicGamesGame(game) as unknown as Record<string, unknown>;
    expect(published).toMatchObject({ slug: "mobile-legends", name: "Mobile Legends", currency: "diamond" });
    expect(published.buildCustomerNo).toBeUndefined();
    expect(Array.isArray(published.fields)).toBe(true);
  });
});

describe("gamesOrderingOpen (P9)", () => {
  const base = { DIGIFLAZZ_USERNAME: "user", DIGIFLAZZ_API_KEY: "key", DIGIFLAZZ_TESTING: "" };
  it("closes while DIGIFLAZZ_TESTING=true even with credentials", () => {
    expect(gamesOrderingOpen({ ...base, DIGIFLAZZ_TESTING: "true" })).toBe(false);
  });
  it("closes when either credential is missing or blank", () => {
    expect(gamesOrderingOpen({ DIGIFLAZZ_USERNAME: "", DIGIFLAZZ_API_KEY: "key" })).toBe(false);
    expect(gamesOrderingOpen({ DIGIFLAZZ_USERNAME: "user", DIGIFLAZZ_API_KEY: "  " })).toBe(false);
    expect(gamesOrderingOpen({})).toBe(false);
  });
  it("opens only with both credentials and testing disabled", () => {
    expect(gamesOrderingOpen(base)).toBe(true);
  });
});

describe("gamesMaxPrice (P6)", () => {
  it("caps at 5% above cost and never above the sell price", () => {
    expect(gamesMaxPrice(11000, 10000)).toBe(10500);
    expect(gamesMaxPrice(10300, 10000)).toBe(10300);
    expect(gamesMaxPrice(20000, 19001)).toBe(19952);
  });
});
