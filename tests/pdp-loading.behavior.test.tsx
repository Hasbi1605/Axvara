// @vitest-environment jsdom
//
// tests/pdp-loading.behavior.test.tsx — PDP di jaringan lambat:
// - data dari server (page.tsx) dipakai langsung, tanpa dua fetch klien +
//   skeleton kedua;
// - sticky bar mobile nonaktif selama varian dimuat (dulu klik cepat
//   membawa ke checkout TANPA varian → buntu);
// - varian gagal dimuat: ada Coba lagi, dan Beli membuka modal, bukan checkout.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Product } from "@/lib/products";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "netflix-premium" }),
  usePathname: () => "/produk/netflix-premium",
  useRouter: () => ({ push: nav.push, replace: vi.fn(), back: vi.fn() }),
}));

import ProductDetailClient from "@/app/produk/[slug]/product-detail-client";

const product = {
  id: "1", slug: "netflix-premium", name: "Netflix Premium", description: "Streaming premium.", price: 25_000,
  categorySlug: "streaming", image: "/brand/axvara-mark.svg", images: [], stock: 5, variantCount: 2,
} as unknown as Product;
const variants = [
  { id: 11, label: "1 Bulan", price: 25_000, compare_price: null, stock: 5, min_qty: 1, is_active: 1, warranty_type: "none", wr_delivery_class: "restock" },
  { id: 12, label: "3 Bulan", price: 65_000, compare_price: null, stock: 5, min_qty: 1, is_active: 1, warranty_type: "none", wr_delivery_class: "restock" },
];
const catalog = { slug: "netflix-premium", product: { id: 1, slug: "netflix-premium", name: "Netflix Premium", variants }, variantsEnabled: true };

beforeEach(() => { nav.push.mockClear(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("PDP loading", () => {
  it("data server dipakai langsung: tanpa fetch produk/varian di klien", () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ products: [] }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProductDetailClient slug="netflix-premium" initialProducts={[product]} initialCatalog={catalog as never} />);
    expect(screen.getAllByText("Netflix Premium").length).toBeGreaterThan(0);
    expect(screen.queryByText("Memuat detail produk…")).toBeNull();
    const urls = fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(urls.some((u) => u.startsWith("/api/catalog"))).toBe(false);
    expect(urls.some((u) => u.includes("slug="))).toBe(false);
    // Hanya "Produk Serupa" yang masih diambil klien.
    expect(urls.every((u) => u.includes("cat=streaming"))).toBe(true);
  });

  it("sticky bar mobile nonaktif + spinner selama varian dimuat", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string) => {
      const url = String(input);
      if (url.startsWith("/api/catalog")) return new Promise(() => undefined);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ products: url.includes("slug=") ? [product] : [] }) });
    }));
    render(<ProductDetailClient slug="netflix-premium" />);
    const buy = await screen.findByRole("button", { name: /Memuat varian/ });
    expect((buy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(buy);
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByText("Memuat pilihan varian…")).toBeTruthy();
  });

  it("varian gagal dimuat: Coba lagi memuat ulang; Beli membuka pilih varian, bukan checkout", async () => {
    let catalogCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = String(input);
      if (url.startsWith("/api/catalog")) {
        catalogCalls += 1;
        return { ok: false, status: 503, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({ products: url.includes("slug=") ? [product] : [] }) };
    }));
    render(<ProductDetailClient slug="netflix-premium" />);
    fireEvent.click(await screen.findByRole("button", { name: "Coba lagi" }));
    await waitFor(() => expect(catalogCalls).toBe(2));
    fireEvent.click(await screen.findByRole("button", { name: /Beli Sekarang/ }));
    expect(nav.push).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("Beli Langsung berputar sampai checkout tampil", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ products: [] }) })));
    const single = { ...catalog, product: { ...catalog.product, variants: [variants[0]] } };
    render(<ProductDetailClient slug="netflix-premium" initialProducts={[product]} initialCatalog={single as never} />);
    fireEvent.click(screen.getByRole("button", { name: /Beli Langsung/ }));
    expect(nav.push).toHaveBeenCalledWith("/checkout?buy=netflix-premium&variant=11&qty=1");
    const pending = screen.getAllByRole("button", { name: /Membuka checkout/ });
    expect(pending.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});
