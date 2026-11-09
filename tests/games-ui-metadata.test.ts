import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server-locale", () => ({ requestLocale: async () => "en" }));
vi.mock("@/lib/games/catalog", () => ({ getGamesDetail: async (slug: string) => slug === "free-fire" ? { game: { slug, name: "Free Fire" } } : null, getGamesCatalog: async () => [] }));
import { generateMetadata as home } from "@/app/games/layout";
import { generateMetadata as game } from "@/app/games/[slug]/page";
import { generateMetadata as status } from "@/app/games/pesanan/[code]/page";
import { generateMetadata as track } from "@/app/games/lacak/page";
import { generateMetadata as help } from "@/app/games/bantuan/page";
import { generateMetadata as terms } from "@/app/games/ketentuan/page";

describe("Games UI metadata", () => {
  it("uses canonical Games URLs and English descriptions", async () => {
    const results = [await home(), await game({ params: Promise.resolve({ slug: "free-fire" }) }), await status({ params: Promise.resolve({ code: "AXG-20261109-ABCDEFGH" }) }), await track(), await help(), await terms()];
    expect(results.map((item) => item.alternates?.canonical)).toEqual(["https://games.axvara.tech/", "https://games.axvara.tech/free-fire", "https://games.axvara.tech/pesanan/AXG-20261109-ABCDEFGH", "https://games.axvara.tech/lacak", "https://games.axvara.tech/bantuan", "https://games.axvara.tech/ketentuan"]);
    for (const item of results) expect(item.description).toBeTruthy();
  });
});
