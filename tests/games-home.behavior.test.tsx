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
const game = { slug: "free-fire", name: "Free Fire", publisher: "Garena", currency: "diamond" as const, icon: "/brand/games/free-fire-icon.webp", banner: null, min_price: 1000, sku_count: 1, sellable_count: 1, featured_rank: null };
beforeEach(() => { vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} })); vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.cookie = "axv_locale=; max-age=0; path=/"; });

describe("Games homepage", () => {
  it("lists only enabled, priced SK games and ignores utilities/DGF rows", async () => {
    db.queryAll.mockResolvedValue([
      { supplier: "sekalipay", sk_product_id: 34, sk_product_name: "Free Fire", game_slug: "free-fire", sell_price: 1000, image_url: null },
      { supplier: "sekalipay", sk_product_id: 33, sk_product_name: "Mobile Legends", game_slug: "mobile-legends", sell_price: 100 },
      { supplier: "digiflazz", game_brand: "FREE FIRE", buyer_sku_code: "ff140", product_name: "140 Diamond", sell_price: 900 },
      { supplier: "sekalipay", sk_product_id: 35, sk_product_name: "Utility", game_slug: "utility", buyer_sku_code: "mlcekusername", product_name: "Cek Username", sell_price: 10 },
    ]);
    expect((await getGamesCatalog()).map((g) => g.slug)).toEqual(["free-fire", "mobile-legends"]);
    expect(db.queryAll.mock.calls[0][0]).toContain("supplier='sekalipay'");
    expect(db.queryAll.mock.calls[0][0]).toContain("enabled=1 AND sell_price>0");
  });
  it("never invents a visual catalog when D1 is empty (no DGF fixture)", async () => {
    db.queryAll.mockResolvedValue([]);
    vi.stubEnv("GAMES_DEV_FIXTURE", "1");
    expect(await getGamesCatalog()).toEqual([]);
    vi.stubEnv("NODE_ENV", "production");
    expect(await getGamesCatalog()).toEqual([]);
    vi.unstubAllEnvs();
  });
  it("never exposes utility rows and never renders legacy DGF products as purchasable", async () => {
    db.queryAll.mockResolvedValue([
      { buyer_sku_code: "sk:101", supplier: "sekalipay", sk_product_id: 33, sk_variant_id: 101, product_name: "86 Diamond", sell_price: 10000, enabled: 1, supplier_active: 1, stock: 100, min_order: 1, cost: 9000, required_fields_json: JSON.stringify({ version: 1, fields: [{ key: "note", label: "User ID", required: true, input: "text", min: 1, max: 50 }], requires_zone_id: false, validation_available: false, open_denom: false, supported: true, reason: null }) },
      { buyer_sku_code: "mlcekusername", supplier: "sekalipay", sk_product_id: 33, sk_variant_id: 102, product_name: "Cek Username", sell_price: 100, enabled: 1, supplier_active: 1, stock: 100, min_order: 1, cost: 10, required_fields_json: "{}" },
    ]);
    expect((await getGamesDetail("mobile-legends"))?.products.map((p) => p.buyer_sku_code)).toEqual(["sk:101"]);
    // DGF-only slug: header registry boleh 200, tetapi tanpa produk DGF.
    db.queryAll.mockResolvedValue([{ buyer_sku_code: "ml86", supplier: "digiflazz", product_name: "86 Diamond", sell_price: 10000, enabled: 1, seller_active: 1 }]);
    const legacy = await getGamesDetail("mobile-legends");
    expect(legacy?.products).toEqual([]);
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
  it("supplies orbit planets from the DB catalog, not a registry whitelist", async () => {
    vi.stubEnv("GAMES_DEV_FIXTURE", "");
    db.queryAll.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({
      supplier: "sekalipay", sk_product_id: 100 + i, sk_product_name: `Game ${i}`, game_slug: `game-${i}`,
      image_url: null, sell_price: 1000 + i,
    })));
    const { default: page } = await import("@/app/games/page");
    const element = await page();
    expect(element.props.games.map((game: { slug: string }) => game.slug)).toEqual(["game-0", "game-1", "game-2", "game-3", "game-4", "game-5"]);
    expect(element.props.orbitGames.map((game: { slug: string }) => game.slug)).toEqual(["game-0", "game-1", "game-2", "game-3"]);
    db.queryAll.mockResolvedValue([]);
    expect((await page()).props.orbitGames).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("renders every DB game through 'show more' without a wave/whitelist limit", () => {
    const games = Array.from({ length: 14 }, (_, i) => ({ ...game, slug: `game-${i}`, name: `Game ${i}` }));
    render(<GamesHome games={games} orbitGames={games.slice(0, 4)} orderingOpen />);
    expect(screen.getAllByRole("link", { name: /Game \d/ }).length).toBeGreaterThanOrEqual(12);
    fireEvent.click(screen.getByRole("button", { name: "Tampilkan lainnya" }));
    expect(screen.getByRole("link", { name: /Game 13/ })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/gelombang|wave/i);
  });
  it("renders initials placeholders instead of empty img sources", () => {
    const noImage = { ...game, slug: "no-image", name: "No Image", icon: null, banner: null };
    render(<GamesHome games={[noImage]} orbitGames={[noImage]} orderingOpen />);
    expect(document.querySelectorAll('img[src=""]').length).toBe(0);
    expect(screen.getAllByText("NI").length).toBeGreaterThan(0);
  });

  it("hides popular below four qualifying games and otherwise uses six sellable games", () => {
    const { rerender } = render(<GamesHome games={[game]} orbitGames={GAMES_REGISTRY} orderingOpen />);
    expect(screen.queryByRole("heading", { name: "Populer sekarang" })).toBeNull();
    rerender(<GamesHome games={Array.from({ length: 9 }, (_, i) => ({ ...game, slug: `game-${i}` }))} orbitGames={GAMES_REGISTRY} orderingOpen />);
    expect(screen.getByRole("heading", { name: "Populer sekarang" })).toBeTruthy();
    const popular = screen.getByRole("region", { name: "Populer sekarang" });
    expect(within(popular).getAllByRole("link")).toHaveLength(6);
  });
  it("honors featured ranks, shows honest availability, and counts the whole catalog", () => {
    const games = Array.from({ length: 10 }, (_, i) => ({ ...game, slug: `game-${i}`, name: `Game ${i}`, featured_rank: i < 4 ? 4 - i : null, sellable_count: i === 9 ? 0 : 1 }));
    render(<GamesHome games={games} orbitGames={games.slice(0, 4)} orderingOpen />);
    expect(within(screen.getByRole("region", { name: "Populer sekarang" })).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/games/game-3", "/games/game-2", "/games/game-1", "/games/game-0"]);
    expect(screen.getByText("10 game")).toBeTruthy();
    const unavailable = screen.getByRole("link", { name: /Game 9/ });
    expect(unavailable.textContent).toContain("Segera tersedia");
    expect(unavailable.className).toContain("opacity-70");
    expect(screen.getAllByText(/Mulai/)[0].textContent).toContain("Rp1.000");
    // Hero disetujui GAMES §4.1 (pola Pedia): headline dua baris + typewriter cyan.
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toContain("Satu tempat untuk");
    expect(h1.textContent).toContain("Top up game");
    expect(h1.textContent).toMatch(/Termurah/);
    const cta = screen.getByRole("link", { name: "Top Up Game" });
    expect(cta.getAttribute("href")).toBe("#games-catalog");
    expect(cta.className).toContain("bg-white");
    expect(screen.getAllByRole("link", { name: "Bantuan WhatsApp" })[0].className).toContain("border-white/15");
    expect(screen.getByText("Top up Free Fire, Mobile Legends, dan PUBG Mobile. Pilih game, lihat nominal, lalu pesan tanpa login.")).toBeTruthy();
  });
  it("sends no Referer for every image and replaces failed game art with initials", () => {
    render(<GamesHome games={[game]} orbitGames={[game]} orderingOpen />);
    // Cross-service promos are shared brand chrome, not Games-owned catalog art.
    for (const img of document.querySelectorAll("section img")) {
      expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
      expect(img.getAttribute("decoding")).toBe("async");
    }
    const card = screen.getByRole("link", { name: /Free Fire Mulai/ });
    const img = card.querySelector("img")!;
    expect(img.getAttribute("loading")).toBe("lazy");
    fireEvent.error(img);
    expect(card.querySelector("img")).toBeNull();
    expect(within(card).getByText("FF")).toBeTruthy();
  });
  it("keeps the animated orbit hero with game art planets (regression: static quadrants froze the hero)", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const games = Array.from({ length: 4 }, (_, i) => ({ ...game, slug: `game-${i}`, name: `Game ${i}` }));
    render(<GamesHome games={games} orbitGames={games} orderingOpen />);
    const orbit = screen.getByRole("group", { name: "Orbit AXVARA Games" });
    const planets = within(orbit).getAllByRole("link");
    expect(planets.map((a) => a.getAttribute("href"))).toEqual(["/games/game-0", "/games/game-1", "/games/game-2", "/games/game-3"]);
    expect(planets[0].querySelector("img")?.getAttribute("src")).toBe(game.icon);
    expect(planets[0].style.transform).toContain("px");
    expect(frames.length).toBeGreaterThan(0);
    expect(document.querySelector("[data-games-orbit]")).toBeNull();
    vi.unstubAllGlobals();
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
