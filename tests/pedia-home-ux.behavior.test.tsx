// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PediaHomeClient } from "@/app/pedia/home-client";
import { catalogCard } from "@/components/pedia/PlatformGrid";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

const product: PediaCatalogProduct = {
  slug: "followers-instagram", name: "Followers Instagram", platform: "instagram", metric: "followers", target_kind: "profile",
  tagline: "Bikin profil terlihat ramai", packages: [100, 250], step: 10, is_featured: 1, min_price: 3300, checklist: [],
  tiers: [
    { id: 1, tier: "hemat", label_note: "Global", refill_days: 0, eta_start: "10 menit", eta_finish: null, prices: { "100": 3300, "250": 6900 } },
    { id: 2, tier: "premium", label_note: "Indonesia aktif", refill_days: 30, eta_start: "30 menit", eta_finish: null, prices: { "100": 16000 } },
  ],
};
const tiktok = { ...product, slug: "views-tiktok", name: "Views TikTok", platform: "tiktok", metric: "views" };
afterEach(cleanup);

describe("Pedia catalog-first storefront", () => {
  it("pairs cheapest price with its actual quantity and tier, never other tiers' guarantees", () => {
    expect(catalogCard(product)).toMatchObject({ minPrice: 3300, minQuantity: 100, minTier: "hemat", badges: [], tagline: null });
    render(<PediaHomeClient products={[product, tiktok]} />);
    const card = screen.getByRole("link", { name: "Followers Instagram — lihat paket" });
    expect(card.textContent).toContain("Mulai Rp3.300");
    expect(card.textContent).toContain("Untuk 100 · paket hemat");
    expect(card.textContent).not.toMatch(/Indonesia aktif|Garansi|terlihat ramai/);
    expect(screen.getAllByRole("status").some((s) => s.textContent?.includes("Pemesanan belum tersedia"))).toBe(true);
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

  it("puts catalog before link shortcut and explains credits instead of claiming cash refunds", () => {
    render(<PediaHomeClient products={[product]} ordersEnabled />);
    const catalog = screen.getByRole("region", { name: "Pilih layanan" });
    const shortcut = screen.getByRole("region", { name: "Sudah punya tautan?" });
    expect(catalog.compareDocumentPosition(shortcut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(shortcut).getByLabelText("Tautan profil atau konten")).toBeTruthy();
    expect(document.body.textContent).toContain("bukan pengembalian tunai");
    expect(document.body.textContent).not.toMatch(/Paling laris|sisanya beres|Sisa dana kembali otomatis|Mulai ±5 menit/);
  });

  it("provides honest empty-catalog feedback and no fake platform availability", () => {
    render(<PediaHomeClient products={[]} />);
    expect(screen.getByText(/Layanan belum tersedia/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Instagram" })).toBeNull();
  });
});
