// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PediaHomeClient } from "@/app/pedia/home-client";
import { PediaNavbar } from "@/components/pedia/PediaNavbar";
import { LinkPasteHero } from "@/components/pedia/LinkPasteHero";
import { usePediaSearch } from "@/stores/pedia-search";
import { catalogCard, ProductCard } from "@/components/pedia/PlatformGrid";
import { PlatformPageClient } from "@/app/pedia/p/[platform]/platform-client";
import { Typewriter } from "@/components/pedia/Typewriter";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";
import { PEDIA_PLATFORM_CONFIG } from "@/lib/pedia/platforms";

const product: PediaCatalogProduct = {
  slug: "followers-instagram", name: "Followers Instagram", platform: "instagram", metric: "followers", target_kind: "profile",
  tagline: "Bikin profil terlihat ramai", packages: [100, 250], step: 10, is_featured: 1, min_price: 3300, checklist: [],
  image: "/r2/products/pedia-platform-instagram.webp",
  tiers: [
    { id: 1, tier: "hemat", label_note: "Global", refill_days: 0, eta_start: "10 menit", eta_finish: null, prices: { "100": 3300, "250": 6900 } },
    { id: 2, tier: "premium", label_note: "Indonesia aktif", refill_days: 30, eta_start: "30 menit", eta_finish: null, prices: { "100": 16000 } },
  ],
};
const tiktok = { ...product, slug: "views-tiktok", name: "Views TikTok", platform: "tiktok", metric: "views", target_kind: "video", is_featured: 0 };
const navigation = vi.hoisted(() => ({ push: vi.fn(), path: "/pedia" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.path, useRouter: () => ({ push: navigation.push }) }));
beforeEach(() => {
  navigation.path = "/pedia"; navigation.push.mockClear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); usePediaSearch.getState().setQ(""); });
function renderPediaHome(products: PediaCatalogProduct[], ordersEnabled?: boolean) {
  return render(<><PediaNavbar /><PediaHomeClient products={products} ordersEnabled={ordersEnabled} /></>);
}
function search(value: string) { fireEvent.change(screen.getByRole("searchbox", { name: "Cari layanan Pedia" }), { target: { value } }); }

describe("Pedia platform-first storefront", () => {
  it("keeps the X platform accessible without inventing availability", () => {
    render(<PediaHomeClient products={[product, { ...tiktok, platform: "x", slug: "views-x", name: "Views X" }]} />);
    expect(screen.getByRole("link", { name: "Layanan X" }).getAttribute("href")).toBe("/pedia/p/x");
    expect(screen.queryByRole("link", { name: "Layanan GitHub" })).toBeNull();
  });
  it("still pairs preview prices with the matching quantity and refill terms", () => {
    expect(catalogCard(product)).toMatchObject({ minPrice: 3300, minQuantity: 100, minTier: "hemat", refillDays: 0 });
    render(<ProductCard p={catalogCard(product)} />);
    const card = screen.getByRole("link", { name: /Followers Instagram —/ });
    expect(card.textContent).toContain("Tanpa refill");
    expect(card.textContent).not.toContain("Refill 30 hari");
  });
  it("renders exactly one platform image for several services and no misleading platform price", () => {
    render(<PediaHomeClient products={[product, { ...product, slug: "likes-instagram", name: "Likes Instagram", metric: "likes" }]} />);
    const card = screen.getByRole("link", { name: "Layanan Instagram" });
    expect(screen.getAllByRole("link", { name: "Layanan Instagram" })).toHaveLength(1);
    expect(card.querySelector("img")?.getAttribute("src")).toBe("/icons/platforms/instagram.svg");
    expect(card.textContent).not.toContain("Rp");
  });
  it("uses centered platform logos on matching gradients for the whole catalog", () => {
    render(<PediaHomeClient products={PEDIA_PLATFORM_CONFIG.map((p) => ({ ...product, platform: p.id, slug: `service-${p.id}` }))} />);
    for (const platform of PEDIA_PLATFORM_CONFIG) {
      const card = screen.getByRole("link", { name: `Layanan ${platform.label}` });
      const artwork = card.querySelector("img")!;
      expect(artwork.getAttribute("src")).toBe(`/icons/platforms/${platform.id}.svg`);
      expect(artwork.getAttribute("width")).toBe("48");
      expect(artwork.getAttribute("height")).toBe("48");
      expect(artwork.getAttribute("alt")).toBe("");
      expect((card.firstElementChild as HTMLElement).style.background).toContain("linear-gradient");
    }
    expect(screen.queryByText("Buka platform, lalu pilih layanan yang kamu butuhkan.")).toBeNull();
  });
  it("puts Shopee in Marketplace and keeps category icons decorative", () => {
    render(<PediaHomeClient products={[product, { ...product, platform: "shopee", slug: "followers-shopee" }]} />);
    const marketplace = screen.getByRole("button", { name: "Marketplace" });
    const icon = marketplace.querySelector("img")!;
    expect(icon.getAttribute("src")).toBe("/icons/ios11/shopping-bag-32.png");
    expect(icon.closest('[aria-hidden="true"]')).toBeTruthy();
    fireEvent.click(marketplace);
    expect(marketplace.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("link", { name: "Layanan Shopee" }).getAttribute("href")).toBe("/pedia/p/shopee");
    expect(screen.queryByRole("link", { name: "Layanan Instagram" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Media sosial" }));
    expect(screen.getByRole("link", { name: "Layanan Instagram" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Layanan Shopee" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Semua" }));
    expect(screen.getByRole("link", { name: "Layanan Shopee" })).toBeTruthy();
  });
  it("does not offer Marketplace when no marketplace platform is available", () => {
    render(<PediaHomeClient products={[product]} />);
    expect(screen.queryByRole("button", { name: "Marketplace" })).toBeNull();
  });
  it("does not render unsafe or unsaved promotional tagline markup", () => {
    expect(catalogCard({ ...product, tagline: " " }).tagline).toBeNull();
    render(<PediaHomeClient products={[{ ...product, tagline: '<img src=x onerror="alert(1)">' }]} />);
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
  it("filters platform groups, searches service names, and recovers from empty search", () => {
    const github = { ...product, platform: "github", slug: "followers-github", name: "Followers GitHub" };
    renderPediaHome([product, tiktok, github]);
    fireEvent.click(screen.getByRole("button", { name: "Website & developer" }));
    expect(screen.getByRole("link", { name: "Layanan GitHub" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Layanan Instagram" })).toBeNull();
    search("missing");
    expect(screen.getByText(/Belum ada layanan yang cocok/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset pencarian" }));
    fireEvent.click(screen.getByRole("button", { name: "Semua" }));
    expect(screen.getByRole("link", { name: "Layanan Instagram" })).toBeTruthy();
  });
  it("puts both cross-service promotions between the hero and catalog and retains compact hero actions", () => {
    renderPediaHome([product]);
    const hero = screen.getByRole("heading", { level: 1 }).closest("section")!;
    const catalog = screen.getByRole("region", { name: "Pilih platform" });
    for (const name of [/AXVARA Market/, /Bot Telegram/]) {
      const promo = screen.getByRole("link", { name });
      expect(hero.compareDocumentPosition(promo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(promo.compareDocumentPosition(catalog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: "Lihat layanan" }).getAttribute("href")).toBe("#pedia-catalog");
    expect(screen.getByRole("link", { name: /Hubungi admin/ }).getAttribute("href")).toContain("/wa?pesan=");
    expect(document.body.textContent).toContain("Refill mengikuti layanan");
  });
  it("makes non-featured published platforms discoverable immediately and searches all services", () => {
    renderPediaHome([product, tiktok]);
    expect(screen.getByRole("link", { name: "Layanan TikTok" })).toBeTruthy();
    search("tayangan tiktok");
    expect(screen.getByRole("link", { name: /Views TikTok/ }).getAttribute("href")).toBe("/pedia/o/views-tiktok");
    expect(screen.queryByRole("link", { name: /Followers Instagram/ })).toBeNull();
  });
  it("routes navbar search from an order to searchable services", () => {
    navigation.path = "/pedia/o/followers-instagram";
    renderPediaHome([product, tiktok]);
    search("tiktok");
    expect(navigation.push).toHaveBeenCalledWith("/pedia/layanan");
    expect(screen.getByRole("link", { name: /Views TikTok/ })).toBeTruthy();
  });
  it("groups a large service collection into a single platform without sales claims", () => {
    render(<PediaHomeClient products={Array.from({ length: 9 }, (_, i) => ({ ...product, slug: `service-${i}`, name: `Layanan ${i}`, is_featured: 0 }))} />);
    expect(screen.getAllByRole("link", { name: "Layanan Instagram" })).toHaveLength(1);
    expect(document.body.textContent).toContain("1 platform");
    expect(document.body.textContent).not.toMatch(/Terlaris|Paling dipilih/);
  });

  it("handles unmatched and invalid links without suggesting verification", async () => {
    render(<LinkPasteHero suggestionsFor={() => []} />);
    fireEvent.change(screen.getByLabelText("Tautan profil atau konten"), { target: { value: "https://tiktok.com/@customer/video/123456" } });
    expect(await screen.findByText(/Belum ada layanan untuk jenis link ini/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Tautan profil atau konten"), { target: { value: "invalid-link" } });
    expect(await screen.findByText(/Gunakan link lengkap/)).toBeTruthy();
  });

  it("does not suggest reel-only services for post links rejected by the quote contract", async () => {
    render(<LinkPasteHero suggestionsFor={() => []} />);
    fireEvent.change(screen.getByLabelText("Tautan profil atau konten"), { target: { value: "https://instagram.com/p/ABC/" } });
    expect(await screen.findByText(/Belum ada layanan untuk jenis link ini/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Followers Instagram mulai/ })).toBeNull();
  });

  it("selects a service kind directly on the platform page and supports switching", () => {
    render(<PlatformPageClient platform="instagram" name="Instagram" products={[product, { ...product, slug: "likes", name: "Likes Instagram", metric: "likes" }]} />);
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Likes/ }));
    expect(screen.getByLabelText("Jumlah yang dipesan")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /lihat paket/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Followers/ }));
    expect(screen.getByRole("button", { name: /^Followers/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("renders factual static copy for reduced motion without character announcements", () => {
    vi.useFakeTimers();
    render(<Typewriter />);
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByText("Termurah").closest("[aria-hidden=true]")).toBeTruthy();
    expect(screen.getByText("Termurah. Termudah. Terpercaya.").className).toBe("sr-only");
    expect(document.querySelector("[aria-live]")).toBeNull();
  });

  it("types and deletes with stable geometry and pauses while the tab is hidden", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.useFakeTimers();
    render(<Typewriter />);
    act(() => vi.advanceTimersByTime(2200));
    expect(screen.getByText("Termura")).toBeTruthy();
    // 2026-10-12: typewriter cyan ("Satu tempat untuk / Layanan sosial media" putih).
    expect(screen.getByText("Termura").parentElement?.className).toContain("text-[#00E5FF]");
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); vi.advanceTimersByTime(10000); });
    expect(screen.getByText("Termura")).toBeTruthy();
    hidden.mockRestore();
    act(() => { document.dispatchEvent(new Event("visibilitychange")); vi.advanceTimersByTime(2200); });
    expect(screen.getByText("Termur")).toBeTruthy();
  });

  it("provides honest empty-catalog feedback and no fake platform availability", () => {
    render(<PediaHomeClient products={[]} />);
    expect(screen.getByText(/Katalog belum tersedia/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Instagram" })).toBeNull();
  });
});
