// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { GamesHome } from "@/app/games/home-client";
import { GamesNavbar } from "@/components/games/GamesNavbar";
import { DisplayPreferencesProvider } from "@/hooks/useDisplayPrices";
import { getGamesCatalog, getGamesDetail } from "@/lib/games/catalog";
import { GAMES_REGISTRY } from "@/lib/games/registry";

const db = vi.hoisted(() => ({ queryAll: vi.fn() }));
vi.mock("@/lib/db-access", () => ({ createDatabaseAccess: () => db }));
vi.mock("@/components/storefront/PreferenceControls", () => ({ PreferenceControls: () => null }));
vi.mock("@/components/shared/ServicesMenu", () => ({ ServicesMenu: () => null }));
const game = { slug: "free-fire", name: "Free Fire", publisher: "Garena", currency: "diamond" as const, icon: "/brand/games/free-fire-icon.webp", banner: null, min_price: 1000, sku_count: 1 };
beforeEach(() => { vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} })); vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.cookie = "axv_locale=; max-age=0; path=/"; });

describe("Games homepage", () => {
  it("uses only enabled, priced SKU aggregates and ignores unknown brands", async () => {
    vi.stubEnv("GAMES_DEV_FIXTURE", "");
    db.queryAll.mockResolvedValue([{ game_brand: "FREE FIRE", buyer_sku_code: "ff140", product_name: "140 Diamond", sell_price: 1000 }, { game_brand: "MOBILE LEGENDS", buyer_sku_code: "mlcekusername", product_name: "Cek Username", sell_price: 100 }, { game_brand: "other", buyer_sku_code: "other", product_name: "other", sell_price: 1000 }]);
    expect((await getGamesCatalog()).map((g) => g.slug)).toEqual(["free-fire"]);
    expect(db.queryAll.mock.calls[0][0]).toContain("enabled=1 AND sell_price>0");
  });
  it("never uses visual fixtures without opt-in or in production", async () => {
    db.queryAll.mockResolvedValue([]);
    vi.stubEnv("GAMES_DEV_FIXTURE", "");
    expect(await getGamesCatalog()).toEqual([]);
    vi.stubEnv("GAMES_DEV_FIXTURE", "1");
    expect(await getGamesCatalog()).toHaveLength(4);
    vi.stubEnv("NODE_ENV", "production");
    expect(await getGamesCatalog()).toEqual([]);
    vi.unstubAllEnvs();
  });
  it("never exposes a paid nickname SKU on game detail", async () => {
    vi.stubEnv("GAMES_DEV_FIXTURE", "");
    db.queryAll.mockResolvedValue([{ buyer_sku_code: "mlcekusername", product_name: "Cek Username", sell_price: 100, seller_active: 1 }, { buyer_sku_code: "ml86", product_name: "86 Diamond", sell_price: 10000, seller_active: 1 }]);
    expect((await getGamesDetail("mobile-legends"))?.products.map((p) => p.buyer_sku_code)).toEqual(["ml86"]);
    db.queryAll.mockResolvedValue([{ buyer_sku_code: "mlcekusername", product_name: "Cek Username", sell_price: 100, seller_active: 1 }]);
    expect((await getGamesDetail("mobile-legends"))?.products).toEqual([]);
    expect(await getGamesDetail("unknown-game")).toBeNull();
    vi.unstubAllEnvs();
  });
  it("shows preview, linked planets, and no invented ratings", () => {
    render(<GamesHome games={[game]} orbitGames={GAMES_REGISTRY} orderingOpen={false} />);
    expect(screen.getByRole("status").textContent).toContain("Pemesanan AXVARA Games segera dibuka");
    const hero = screen.getByRole("heading", { level: 1 }).closest("section")!;
    expect(within(hero).getByRole("link", { name: "Free Fire" }).getAttribute("href")).toBe("/games/free-fire");
    expect(document.body.textContent).not.toMatch(/rating|ulasan|\d+[.,]\d+\s*\//i);
  });
  it("shows an honest empty state", () => {
    render(<GamesHome games={[]} orbitGames={GAMES_REGISTRY} orderingOpen />);
    expect(screen.getByText("Katalog sedang disiapkan")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    const hero = screen.getByRole("heading", { level: 1 }).closest("section")!;
    for (const game of GAMES_REGISTRY) expect(within(hero).getByRole("link", { name: game.name }).getAttribute("href")).toBe(`/games/${game.slug}`);
    expect(within(hero).queryByText("AXVARA GAMES")).toBeNull();
    expect(within(hero).getByLabelText("AXVARA Games").querySelector('img[src="/brand/games-mark.svg"]')).toBeTruthy();
    expect(screen.getByRole("link", { name: /AXVARA Market/ }).getAttribute("href")).toBe("https://axvara.tech/?utm_source=games&utm_medium=cross_promo");
    expect(screen.getByRole("link", { name: /AXVARA Pedia/ }).getAttribute("href")).toBe("https://pedia.axvara.tech/?utm_source=games&utm_medium=cross_promo");
  });
  it("supplies all registry planets from the server even when enabled catalog rows are empty", async () => {
    vi.stubEnv("GAMES_DEV_FIXTURE", ""); db.queryAll.mockResolvedValue([]);
    const { default: page } = await import("@/app/games/page");
    const element = await page();
    expect(element.props.games).toEqual([]);
    expect(element.props.orbitGames.map((game: { slug: string }) => game.slug)).toEqual(GAMES_REGISTRY.map(game => game.slug));
    vi.unstubAllEnvs();
  });
  it("hides popular when it would duplicate the whole catalog", () => {
    const { rerender } = render(<GamesHome games={[game]} orbitGames={GAMES_REGISTRY} orderingOpen />);
    expect(screen.queryByRole("heading", { name: "Populer sekarang" })).toBeNull();
    rerender(<GamesHome games={Array.from({ length: 9 }, (_, i) => ({ ...game, slug: `game-${i}` }))} orbitGames={GAMES_REGISTRY} orderingOpen />);
    expect(screen.getByRole("heading", { name: "Populer sekarang" })).toBeTruthy();
  });
  it("uses the English cookie and filters navbar search", async () => {
    document.cookie = "axv_locale=en; path=/";
    render(<DisplayPreferencesProvider><GamesNavbar games={[game]} /><GamesHome games={[game]} orbitGames={GAMES_REGISTRY} orderingOpen={false} /></DisplayPreferencesProvider>);
    expect(await screen.findByText("AXVARA Games ordering opens soon")).toBeTruthy();
    const input = screen.getByRole("searchbox", { name: "Search games on AXVARA Games" });
    fireEvent.change(input, { target: { value: "free" } });
    expect(within(input.parentElement!).getByRole("link", { name: "Free Fire" }).getAttribute("href")).toBe("/games/free-fire");
    fireEvent.change(input, { target: { value: "missing" } });
    expect(within(input.parentElement!).getByText("No games found")).toBeTruthy();
  });
});
