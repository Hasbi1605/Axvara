// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PediaHomeClient } from "@/app/pedia/home-client";
import { PediaNavbar } from "@/components/pedia/PediaNavbar";
import { LinkPasteHero } from "@/components/pedia/LinkPasteHero";
import { usePediaSearch } from "@/stores/pedia-search";
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
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  // jsdom tak punya scrollIntoView (dipakai navbar search ala Market) — stub no-op.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); usePediaSearch.getState().setQ(""); });
// Search Pedia kini di navbar (ala Market) via store — render navbar + home agar terhubung.
// Field desktop selalu di DOM (jsdom abaikan breakpoint); panel mobile dibuka via tombol.
function renderPediaHome(products: PediaCatalogProduct[], ordersEnabled?: boolean) {
  const ui = render(<><PediaNavbar /><PediaHomeClient products={products} ordersEnabled={ordersEnabled} /></>);
  return ui;
}
const NAV_SEARCH = "Cari layanan Pedia";
function navSearchbox() {
  // Desktop + mobile kembar — ambil yang di dalam panel mobile bila terbuka, jika tidak desktop.
  const all = screen.getAllByRole("searchbox", { name: NAV_SEARCH });
  return all[all.length - 1];
}

describe("Pedia catalog-first storefront", () => {
  it("pairs cheapest price with its actual quantity and tier, never other tiers' guarantees", () => {
    expect(catalogCard(product)).toMatchObject({ minPrice: 3300, minQuantity: 100, minTier: "hemat", badges: [], tagline: product.tagline });
    render(<PediaHomeClient products={[product, tiktok]} />);
    const card = screen.getByRole("link", { name: "Followers Instagram — lihat paket" });
    expect(card.textContent).toContain("Mulai Rp3.300");
    // 2026-10-14 rebuild: kartu menjual jumlah layanan + mulai kuantitas,
    // bukan lagi frasa "paket hemat" model peringkat lama.
    expect(card.textContent).toContain("pilihan terkurasi");
    expect(card.textContent).toContain("mulai 100");
    expect(card.textContent).not.toMatch(/Indonesia aktif|Garansi/);
    // 2026-10-12 (owner): tagline AI slop tidak dirender di kartu —
    // judul langsung ke harga.
    expect(card.textContent).not.toContain("Bikin profil terlihat ramai");
    expect(card.textContent).toContain("Tanpa refill");
    expect(card.textContent).not.toContain("Refill 30 hari");
    expect(document.body.textContent).not.toContain("Pemesanan belum tersedia");
  });

  it("keeps absent taglines empty and escapes curated card text", () => {
    expect(catalogCard({ ...product, tagline: "   " }).tagline).toBeNull();
    // 2026-10-12 (owner): tagline tidak dirender di kartu — payload jahat
    // di tagline tidak punya permukaan tampil; deskripsi tetap di-escape
    // di halaman detail.
    render(<PediaHomeClient products={[{ ...product, tagline: '<img src=x onerror="alert(1)">' }]} />);
    expect(document.body.textContent).not.toContain('<img src=x onerror="alert(1)">');
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it("filters by platform and search, and resets an empty result", () => {
    renderPediaHome([product, tiktok], true);
    fireEvent.click(screen.getByRole("button", { name: "TikTok" }));
    expect(screen.queryByRole("link", { name: /Followers Instagram —/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Views TikTok —/ })).toBeTruthy();
    fireEvent.change(navSearchbox(), { target: { value: "nothing" } });
    expect(screen.getByText("Tidak ada layanan yang sesuai pencarian.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset pencarian" }));
    expect(screen.getByRole("link", { name: /Followers Instagram —/ })).toBeTruthy();
  });

  it("puts twin service cards after hero without eyebrow, plus Market-style CTA and trust strip", async () => {
    renderPediaHome([product], true);
    const catalog = screen.getByRole("region", { name: "Pilihan AXVARA" });
    const promo = screen.getByRole("link", { name: /AXVARA Market/ });
    expect(promo.compareDocumentPosition(catalog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 2026-10-12: kartu ganda ala Market — Market + Bot Telegram berdampingan.
    const bot = screen.getByRole("link", { name: /Bot Telegram/ });
    expect(bot.getAttribute("href")).toContain("t.me/Axvara_bot");
    // 2026-10-12: navbar kini lockup "AXVARA PEDIA" penuh (desktop+mobile) —
    // hero tetap tanpa eyebrow.
    expect(screen.getByRole("banner").textContent).toContain("AXVARA PEDIA");
    // 2026-10-12: CTA 1:1 Market + trust strip; kartu Cari lewat link dihapus.
    expect(screen.getByRole("link", { name: "Lihat Layanan" }).getAttribute("href")).toBe("#pedia-catalog");
    expect(screen.getByRole("link", { name: /Hubungi Admin/ }).getAttribute("href")).toContain("/wa?pesan=");
    expect(document.body.textContent).toContain("Garansi reffil");
    expect(screen.queryByText("Cari lewat link")).toBeNull();
    expect(screen.queryByLabelText("Tautan profil atau konten")).toBeNull();
    // 2026-10-12: section Cara pemesanan + Sebelum memesan (FAQ) dihapus —
    // setelah layanan langsung footer.
    expect(screen.queryByText("Cara pemesanan")).toBeNull();
    expect(screen.queryByText("Sebelum memesan")).toBeNull();
    expect(screen.queryByText("Bagaimana cara memesan?")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Paling laris|sisanya beres|Sisa dana kembali otomatis|Mulai ±5 menit/);
  });

  it("starts with featured products, reveals all published services and searches hidden products", () => {
    renderPediaHome([product, tiktok]);
    expect(screen.queryByRole("link", { name: /Views TikTok —/ })).toBeNull();
    fireEvent.change(navSearchbox(), { target: { value: "tiktok" } });
    expect(screen.getByRole("link", { name: /Views TikTok —/ })).toBeTruthy();
    fireEvent.change(navSearchbox(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Tampilkan semua layanan/ }));
    expect(screen.getByRole("link", { name: /Views TikTok —/ })).toBeTruthy();
  });

  it("keeps navbar search pill styled like Market and wired to the catalog", () => {
    renderPediaHome([product, tiktok]);
    const input = navSearchbox();
    expect(input.getAttribute("placeholder")).toContain("Cari Followers Instagram");
    expect(input.className).toContain("rounded-full");
    fireEvent.change(input, { target: { value: "tiktok" } });
    expect(screen.getByRole("link", { name: /Views TikTok —/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Followers Instagram —/ })).toBeNull();
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

  // 2026-10-12: kartu Cari lewat link DIHAPUS dari beranda (owner) —
  // LinkPasteHero tetap hidup sebagai komponen; perilakunya dikunci di sini.
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
