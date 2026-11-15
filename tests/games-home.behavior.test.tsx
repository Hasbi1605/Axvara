// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { GamesHome } from "@/app/games/home-client";
import { GamesNavbar } from "@/components/games/GamesNavbar";
import { DisplayPreferencesProvider } from "@/hooks/useDisplayPrices";
import { getGamesCatalog, getGamesDetail } from "@/lib/games/catalog";
import { GAMES_REGISTRY } from "@/lib/games/registry";
import { GAMES_LOCAL_ASSETS } from "@/lib/games/assets";
import { GameCard } from "@/components/games/storefront";
import { gamesCopy } from "@/lib/games/copy";

const db = vi.hoisted(() => ({ queryAll: vi.fn() }));
vi.mock("@/lib/db-access", () => ({ createDatabaseAccess: () => db }));
vi.mock("@/components/storefront/PreferenceControls", () => ({ PreferenceControls: () => null }));
vi.mock("@/components/shared/ServicesMenu", () => ({ ServicesMenu: () => null }));
const game = { slug: "free-fire", name: "Free Fire", publisher: "Garena", currency: "diamond" as const, icon: "/brand/games/free-fire-icon.webp", banner: null, portrait: null, min_price: 1000, sku_count: 1, sellable_count: 1, featured_rank: null };
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
    const catalog = await getGamesCatalog();
    expect(catalog.map((g) => g.slug)).toEqual(["free-fire", "mobile-legends"]);
    expect(catalog[0].portrait).toBe(GAMES_LOCAL_ASSETS["free-fire"].portrait);
    expect(catalog[0].publisher).toBe("Garena");
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
  it("mobile layout mirrors Oura: popular 2 columns (odd last hidden on mobile), catalog 3 columns, chip row fades until scrolled to the end", () => {
    const games = Array.from({ length: 12 }, (_, i) => ({ ...game, slug: ["mobile-legends", "magic-chess-go-go", "pubg-mobile", "free-fire", "genshin-impact", "honor-of-kings", "valorant", "roblox", "honkai-star-rail", "a", "b", "c"][i], name: `Game ${i}` }));
    render(<GamesHome games={games} orbitGames={games} orderingOpen />);
    const popular = screen.getByRole("region", { name: "Populer sekarang" });
    const grid = popular.querySelector(".grid")!;
    expect(grid.className).toContain("grid-cols-2");
    const cards = within(popular).getAllByRole("link");
    expect(cards).toHaveLength(9);
    expect(cards[8].className).toContain("max-sm:hidden");
    expect(cards[7].className).not.toContain("max-sm:hidden");
    const catalogGrid = document.querySelector("#games-catalog .grid")!;
    expect(catalogGrid.className).toMatch(/(^|\s)grid-cols-3(\s|$)/);
    const chips = document.querySelector<HTMLElement>("[data-genre-chips]")!;
    expect(chips.className).toContain("[mask-image:linear-gradient(to_right,black_78%,transparent)]");
    Object.defineProperties(chips, { scrollLeft: { value: 200, configurable: true }, clientWidth: { value: 300, configurable: true }, scrollWidth: { value: 500, configurable: true } });
    fireEvent.scroll(chips);
    expect(chips.getAttribute("data-at-end")).toBe("true");
    expect(chips.className).not.toContain("black_78%");
  });

  it("home drops how-to/trust/FAQ sections and the catalog subtitle; chips follow the Pedia style; popular has the 3D flame", () => {
    render(<GamesHome games={[game]} orbitGames={[game]} orderingOpen />);
    for (const text of ["Cara top up", "Siap kapan pun kamu bermain", "Pertanyaan umum", "Temukan game yang ingin kamu isi."]) expect(screen.queryByText(text)).toBeNull();
    const active = screen.getByRole("button", { name: "Semua" });
    expect(active.getAttribute("aria-pressed")).toBe("true");
    expect(active.className).toContain("bg-white");
    expect(document.querySelector('img[src="/brand/games/ui/fire-3d.webp"]')).toBeTruthy();
  });
  it("orbit uses the 8 curated popular games, never Free Fire MAX, and fills gaps from the catalog", async () => {
    const { selectOrbitGames, GAMES_ORBIT } = await import("@/lib/games/popular");
    const slugs = ["free-fire-max", "aniimo", ...GAMES_ORBIT].map((slug) => ({ slug }));
    expect(selectOrbitGames(slugs).map((g) => g.slug)).toEqual([...GAMES_ORBIT]);
    expect(selectOrbitGames([{ slug: "free-fire-max" }, { slug: "aniimo" }, { slug: "pubg-mobile" }]).map((g) => g.slug)).toEqual(["pubg-mobile", "aniimo"]);
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
    // Tanpa slug orbit kurasi di katalog: orbit diisi game katalog berurutan sampai 8.
    expect(element.props.orbitGames.map((game: { slug: string }) => game.slug)).toEqual(["game-0", "game-1", "game-2", "game-3", "game-4", "game-5"]);
    db.queryAll.mockResolvedValue([]);
    expect((await page()).props.orbitGames).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("renders every DB game immediately without show-more or a wave/whitelist limit", () => {
    const games = Array.from({ length: 14 }, (_, i) => ({ ...game, slug: `game-${i}`, name: `Game ${i}` }));
    render(<GamesHome games={games} orbitGames={games.slice(0, 4)} orderingOpen />);
    const catalog = screen.getByRole("region", { name: "Semua game" });
    expect(within(catalog).getAllByRole("link")).toHaveLength(14);
    expect(within(catalog).getByRole("link", { name: /Game 13/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tampilkan lainnya" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/gelombang|wave/i);
  });
  it("renders initials placeholders instead of empty img sources", () => {
    const noImage = { ...game, slug: "no-image", name: "No Image", icon: null, banner: null };
    render(<GamesHome games={[noImage]} orbitGames={[noImage]} orderingOpen />);
    expect(document.querySelectorAll('img[src=""]').length).toBe(0);
    expect(screen.getAllByText("NI").length).toBeGreaterThan(0);
  });

  it("hides popular only when no featured/default game exists, and includes a single unsellable game", () => {
    const { rerender } = render(<GamesHome games={[{ ...game, slug: "unknown-game" }]} orbitGames={GAMES_REGISTRY} orderingOpen />);
    expect(screen.queryByRole("heading", { name: "Populer sekarang" })).toBeNull();
    rerender(<GamesHome games={[{ ...game, sellable_count: 0, min_price: null }]} orbitGames={GAMES_REGISTRY} orderingOpen />);
    const popular = screen.getByRole("region", { name: "Populer sekarang" });
    expect(within(popular).getAllByRole("link")).toHaveLength(1);
    expect(within(popular).getByRole("link", { name: "Free Fire Garena" }).getAttribute("href")).toBe("/games/free-fire");
  });
  it("uses the curated default popular order filtered by catalog, regardless of sellable status", () => {
    const slugs = ["mobile-legends", "magic-chess-go-go", "pubg-mobile", "free-fire", "genshin-impact", "honor-of-kings", "valorant", "roblox", "honkai-star-rail"];
    const games = [...slugs].reverse().map((slug) => ({ ...game, slug, sellable_count: 0, min_price: null }));
    const { rerender } = render(<GamesHome games={[{ ...game, slug: "unknown-game" }, ...games]} orbitGames={[]} orderingOpen />);
    const popularLinks = () => within(screen.getByRole("region", { name: "Populer sekarang" })).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(popularLinks()).toEqual(slugs.map((slug) => `/games/${slug}`));
    rerender(<GamesHome games={games.filter((g) => ["roblox", "mobile-legends", "free-fire"].includes(g.slug))} orbitGames={[]} orderingOpen />);
    expect(popularLinks()).toEqual(["/games/mobile-legends", "/games/free-fire", "/games/roblox"]);
  });
  it("caps ranked popular games at nine and does not fill missing ranks with defaults", () => {
    const games = Array.from({ length: 11 }, (_, i) => ({ ...game, slug: `ranked-${i}`, featured_rank: 11 - i, sellable_count: 0 }));
    const { rerender } = render(<GamesHome games={[game, ...games]} orbitGames={[]} orderingOpen />);
    const popularLinks = () => within(screen.getByRole("region", { name: "Populer sekarang" })).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(popularLinks()).toEqual(Array.from({ length: 9 }, (_, i) => `/games/ranked-${10 - i}`));
    rerender(<GamesHome games={[game, games[0]]} orbitGames={[]} orderingOpen />);
    expect(popularLinks()).toEqual(["/games/ranked-0"]);
  });
  it("filters every mapped genre, updates count and pressed state, hides empty chips, and keeps unknown games only in All", () => {
    const games = [game, { ...game, slug: "mobile-legends" }, { ...game, slug: "genshin-impact" }, { ...game, slug: "magic-chess-go-go" }, { ...game, slug: "roblox" }, { ...game, slug: "new-db-game" }];
    render(<GamesHome games={games} orbitGames={[]} orderingOpen />);
    const catalog = screen.getByRole("region", { name: "Semua game" });
    const chips = within(catalog).getByRole("group", { name: "Kategori game" });
    const all = within(chips).getByRole("button", { name: "Semua" });
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(within(catalog).getByText("6 game")).toBeTruthy();
    expect(within(chips).queryByRole("button", { name: "Olahraga & Balap" })).toBeNull();
    const labels = ["MOBA", "Shooter & Battle Royale", "RPG & Petualangan", "Strategi", "Kasual & Sosial"];
    const slugs = ["mobile-legends", "free-fire", "genshin-impact", "magic-chess-go-go", "roblox"];
    for (const [i, label] of labels.entries()) {
      const chip = within(chips).getByRole("button", { name: label });
      fireEvent.click(chip);
      expect(chip.getAttribute("aria-pressed")).toBe("true");
      expect(all.getAttribute("aria-pressed")).toBe("false");
      expect(within(chips).getAllByRole("button", { pressed: true })).toEqual([chip]);
      expect(within(catalog).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([`/games/${slugs[i]}`]);
      expect(within(catalog).getByText("1 game")).toBeTruthy();
    }
    fireEvent.click(all);
    expect(within(catalog).getAllByRole("link")).toHaveLength(6);
    expect(within(catalog).getByText("6 game")).toBeTruthy();
    expect(within(catalog).getAllByRole("link").some((a) => a.getAttribute("href") === "/games/new-db-game")).toBe(true);
    // Filtering the catalog must not filter the independently curated popular block.
    expect(within(screen.getByRole("region", { name: "Populer sekarang" })).getAllByRole("link")).toHaveLength(5);
  });
  it("honors featured ranks, shows honest availability, and counts the whole catalog", () => {
    const games = Array.from({ length: 10 }, (_, i) => ({ ...game, slug: `game-${i}`, name: `Game ${i}`, featured_rank: i < 4 ? 4 - i : null, sellable_count: i === 9 ? 0 : 1 }));
    render(<GamesHome games={games} orbitGames={games.slice(0, 4)} orderingOpen />);
    expect(within(screen.getByRole("region", { name: "Populer sekarang" })).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/games/game-3", "/games/game-2", "/games/game-1", "/games/game-0"]);
    expect(screen.getByText("10 game")).toBeTruthy();
    const unavailable = screen.getByRole("link", { name: /Game 9/ });
    expect(unavailable.textContent).toContain("Segera tersedia");
    expect(within(unavailable).getByText("Segera tersedia").className).toContain("rounded-full");
    expect(unavailable.className).not.toContain("opacity-70");
    expect(screen.getAllByText(/Mulai/)[0].textContent).toContain("Rp1.000");
    // Hero statis dua baris tanpa typewriter (keputusan owner 15 Nov 2026: tidak bersaing dengan orbit).
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Satu tempat untuktop up game favorit.");
    expect(h1.querySelectorAll(":scope > span")).toHaveLength(2);
    expect(h1.textContent).not.toMatch(/Termurah|Terpercaya/);
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
    const card = within(screen.getByRole("region", { name: "Semua game" })).getByRole("link", { name: "Free Fire Mulai Rp1.000" });
    for (const img of card.querySelectorAll("img")) {
      expect(img.getAttribute("loading")).toBe("lazy");
      fireEvent.error(img);
    }
    expect(card.querySelector("img")).toBeNull();
    expect(within(card).getAllByText("FF")).toHaveLength(2);
  });
  it("uses full-bleed portrait art when available, keeps overlay metadata in the DOM, and names the link even at rest", () => {
    render(<GameCard game={{ ...game, portrait: "/brand/games/free-fire-portrait.webp" }} t={gamesCopy("id")} />);
    const card = screen.getByRole("link", { name: "Free Fire Mulai Rp1.000" });
    expect(card.className).toContain("aspect-[2/3]");
    expect(card.querySelectorAll("img")).toHaveLength(1);
    const image = card.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("/brand/games/free-fire-portrait.webp");
    expect(image.getAttribute("class")).toContain("object-cover");
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image.getAttribute("decoding")).toBe("async");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(within(card).getByText("Free Fire")).toBeTruthy();
    expect(within(card).getByText("Garena")).toBeTruthy();
    expect(within(card).getByText("Mulai Rp1.000")).toBeTruthy();
  });
  it("uses square-icon plus blur fallback when no portrait exists and includes unavailable status in its accessible name", () => {
    render(<GameCard game={{ ...game, portrait: null, sellable_count: 0, min_price: null }} t={gamesCopy("id")} />);
    const card = screen.getByRole("link", { name: "Free Fire Segera tersedia" });
    expect(Array.from(card.querySelectorAll("img")).map((img) => img.getAttribute("src"))).toEqual([game.icon, game.icon]);
    expect(within(card).getByText("Segera tersedia")).toBeTruthy();
    expect(card.className).not.toContain("opacity-70");
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
    expect(screen.getByRole("heading", { name: "Popular now" })).toBeTruthy();
    const categories = screen.getByRole("group", { name: "Game categories" });
    expect(within(categories).getByRole("button", { name: "All", pressed: true })).toBeTruthy();
    expect(within(categories).getByRole("button", { name: "Shooter & Battle Royale" })).toBeTruthy();
    const input = screen.getByRole("searchbox", { name: "Search games on AXVARA Games" });
    fireEvent.change(input, { target: { value: "free" } });
    expect(within(input.parentElement!).getByRole("link", { name: "Free Fire" }).getAttribute("href")).toBe("/games/free-fire");
    fireEvent.change(input, { target: { value: "missing" } });
    expect(within(input.parentElement!).getByText("No games found")).toBeTruthy();
  });
});
