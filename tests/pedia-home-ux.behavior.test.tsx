// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PediaHomeClient } from "@/app/pedia/home-client";
import { catalogCard } from "@/components/pedia/PlatformGrid";
import { PlatformPageClient } from "@/app/pedia/p/[platform]/platform-client";
import { Typewriter } from "@/components/pedia/Typewriter";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

const product: PediaCatalogProduct = {
  slug: "followers-instagram", name: "Followers Instagram", platform: "instagram", metric: "followers", target_kind: "profile",
  tagline: "Bikin profil terlihat ramai", packages: [100, 250], step: 10, is_featured: 1, min_price: 3300, checklist: [],
  tiers: [
    { id: 1, tier: "hemat", label_note: "Global", refill_days: 0, eta_start: "10 menit", eta_finish: null, prices: { "100": 3300, "250": 6900 } },
    { id: 2, tier: "premium", label_note: "Indonesia aktif", refill_days: 30, eta_start: "30 menit", eta_finish: null, prices: { "100": 16000 } },
  ],
};
const tiktok = { ...product, slug: "views-tiktok", name: "Views TikTok", platform: "tiktok", metric: "views", target_kind: "video", is_featured: 0 };
beforeEach(() => vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Pedia catalog-first storefront", () => {
  it("pairs cheapest price with its actual quantity and tier, never other tiers' guarantees", () => {
    expect(catalogCard(product)).toMatchObject({ minPrice: 3300, minQuantity: 100, minTier: "hemat", badges: [], tagline: product.tagline });
    render(<PediaHomeClient products={[product, tiktok]} />);
    const card = screen.getByRole("link", { name: "Followers Instagram — lihat paket" });
    expect(card.textContent).toContain("Mulai Rp3.300");
    expect(card.textContent).toContain("Untuk 100 · paket hemat");
    expect(card.textContent).not.toMatch(/Indonesia aktif|Garansi/);
    expect(card.textContent).toContain(product.tagline);
    expect(screen.getByText(product.tagline!).className).toContain("line-clamp-2");
    expect(card.textContent).toContain("Tanpa refill");
    expect(card.textContent).not.toContain("Refill 30 hari");
    expect(document.body.textContent).not.toContain("Pemesanan belum tersedia");
  });

  it("keeps absent taglines empty and escapes curated card text", () => {
    expect(catalogCard({ ...product, tagline: "   " }).tagline).toBeNull();
    const tagline = '<img src=x onerror="alert(1)">';
    render(<PediaHomeClient products={[{ ...product, tagline }]} />);
    expect(screen.getByText(tagline)).toBeTruthy();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it("filters by platform and search, and resets an empty result", () => {
    render(<PediaHomeClient products={[product, tiktok]} ordersEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "TikTok" }));
    expect(screen.queryByRole("link", { name: /Followers Instagram —/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Views TikTok —/ })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Cari layanan" }), { target: { value: "nothing" } });
    expect(screen.getByText("Tidak ada layanan yang sesuai pencarian.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset pencarian" }));
    expect(screen.getByRole("link", { name: /Followers Instagram —/ })).toBeTruthy();
  });

  it("puts twin service cards after hero without eyebrow, and link shortcut near search", async () => {
    render(<PediaHomeClient products={[product]} ordersEnabled />);
    const catalog = screen.getByRole("region", { name: "Pilihan AXVARA" });
    const promo = screen.getByRole("link", { name: /AXVARA Market/ });
    expect(promo.compareDocumentPosition(catalog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 2026-10-12: kartu ganda ala Market — Market + Bot Telegram berdampingan.
    const bot = screen.getByRole("link", { name: /Bot Telegram/ });
    expect(bot.getAttribute("href")).toContain("t.me/Axvara_bot");
    expect(document.body.textContent).not.toContain("AXVARA PEDIA");
    const shortcut = screen.getByText("Cari lewat link").closest("details")!;
    expect(shortcut.open).toBe(false);
    fireEvent.click(screen.getByText("Cari lewat link"));
    fireEvent.change(screen.getByLabelText("Tautan profil atau konten"), { target: { value: "https://instagram.com/customer" } });
    const suggestion = await screen.findByRole("link", { name: /Followers Instagram mulai/ });
    expect(suggestion.getAttribute("href")).toContain("?t=https%3A%2F%2Fwww.instagram.com%2Fcustomer");
    expect(document.body.textContent).toContain("bukan pengembalian tunai");
    expect(document.body.textContent).not.toMatch(/Paling laris|sisanya beres|Sisa dana kembali otomatis|Mulai ±5 menit/);
  });

  it("starts with featured products, reveals all published services and searches hidden products", () => {
    render(<PediaHomeClient products={[product, tiktok]} />);
    expect(screen.queryByRole("link", { name: /Views TikTok —/ })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Cari layanan" }), { target: { value: "tiktok" } });
    expect(screen.getByRole("link", { name: /Views TikTok —/ })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Cari layanan" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Tampilkan semua layanan/ }));
    expect(screen.getByRole("link", { name: /Views TikTok —/ })).toBeTruthy();
  });

  it("uses a small honest fallback without inventing featured or sales claims", () => {
    const products = Array.from({ length: 9 }, (_, i) => ({ ...product, slug: `service-${i}`, name: `Layanan ${i}`, is_featured: 0 }));
    render(<PediaHomeClient products={products} />);
    expect(screen.getByRole("heading", { name: "Jelajahi layanan" })).toBeTruthy();
    // 2026-10-12: sub-teks fallback dihapus — hanya judul yang tampil.
    expect(document.body.textContent).not.toContain("Beberapa layanan untuk mulai menjelajah");
    expect(screen.getAllByRole("link", { name: /lihat paket/ })).toHaveLength(6);
    expect(document.body.textContent).not.toMatch(/Terlaris|Direkomendasikan|Pilihan AXVARA/);
    fireEvent.click(screen.getByRole("button", { name: /Tampilkan semua layanan/ }));
    expect(screen.getAllByRole("link", { name: /lihat paket/ })).toHaveLength(9);
  });

  it("handles unmatched and invalid links without suggesting verification", async () => {
    render(<PediaHomeClient products={[product]} />);
    fireEvent.change(screen.getByLabelText("Tautan profil atau konten"), { target: { value: "https://tiktok.com/@customer/video/123456" } });
    expect(await screen.findByText(/Belum ada layanan untuk jenis link ini/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Tautan profil atau konten"), { target: { value: "invalid-link" } });
    expect(await screen.findByText(/Gunakan link lengkap/)).toBeTruthy();
  });

  it("does not suggest reel-only services for post links rejected by the quote contract", async () => {
    render(<PediaHomeClient products={[{ ...product, target_kind: "reel" }]} />);
    fireEvent.change(screen.getByLabelText("Tautan profil atau konten"), { target: { value: "https://instagram.com/p/ABC/" } });
    expect(await screen.findByText(/Belum ada layanan untuk jenis link ini/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Followers Instagram mulai/ })).toBeNull();
  });

  it("filters the platform catalog by search and metric with empty-state recovery", () => {
    render(<PlatformPageClient platform="instagram" name="Instagram" products={[product, { ...product, slug: "likes", name: "Likes Instagram", metric: "likes" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Likes" }));
    expect(screen.queryByRole("link", { name: /Followers Instagram —/ })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset pencarian" }));
    expect(screen.getByRole("link", { name: /Followers Instagram —/ })).toBeTruthy();
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
    expect(screen.getByText(/Layanan belum tersedia/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Instagram" })).toBeNull();
  });
});
