// @vitest-environment jsdom
//
// tests/pdp-mobile-variant.behavior.test.tsx — Pilih varian di PDP mobile
// (laporan owner 2026-09-25). Dulu baris "Tersedia N varian" membuka panel yang
// langsung ke checkout dan pilihannya hilang saat ditutup, sehingga S&K mobile
// selalu milik varian pertama. Kini baris varian membuka panel PILIH: ketukan
// menjadi pilihan halaman (harga, badge, S&K, tombol beli ikut berganti).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Product } from "@/lib/products";
import { resolveVariantCopy } from "@/lib/product-copy/resolve";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "claude-pro" }),
  usePathname: () => "/produk/claude-pro",
  useRouter: () => ({ push: nav.push, replace: vi.fn(), back: vi.fn() }),
}));

import ProductDetailClient from "@/app/produk/[slug]/product-detail-client";

const product = {
  id: "1", slug: "claude-pro", name: "Claude Pro", description: "Claude Pro untuk penalaran kompleks.", price: 24_000,
  categorySlug: "tools-pro", image: "/brand/axvara-mark.svg", images: [], stock: 4, variantCount: 3,
} as unknown as Product;

function variant(id: number, label: string, price: number, extra: Record<string, unknown> = {}) {
  return {
    id, label, price, compare_price: null, stock: 5, min_qty: 1, is_active: 1, warranty_type: "none",
    fulfillment_mode: "manual", wr_variant_id: `wr-${id}`, wr_delivery_class: "made_by_order", ...extra,
  };
}

const differing = [
  variant(21, "25 - 27 September", 24_000, { copy: resolveVariantCopy("Masa aktif 3 hari mengikuti jadwal 25 - 27 September", "Akses login dikirim H-1 jadwal") }),
  variant(22, "28 - 30 September", 24_000, { copy: resolveVariantCopy("Masa aktif 3 hari mengikuti jadwal 28 - 30 September", "Akses login dikirim H-1 jadwal") }),
  variant(23, "Bulanan", 60_000, { wr_delivery_class: "restock", copy: resolveVariantCopy("Akun private selama 30 hari", "Login di website claude.ai") }),
];

let catalogFetches = 0;
function renderPdp(variants = differing) {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input);
    if (url.startsWith("/api/catalog")) catalogFetches++;
    return { ok: true, status: 200, json: async () => ({ products: [] }) };
  }));
  const catalog = { slug: "claude-pro", product: { id: 1, slug: "claude-pro", name: "Claude Pro", variants }, variantsEnabled: true };
  render(<ProductDetailClient slug="claude-pro" initialProducts={[product]} initialCatalog={catalog as never} />);
}

// formatRupiah memakai spasi tak-putus (NBSP) setelah "Rp".
const norm = (text: string | null | undefined) => String(text ?? "").replace(/\s/g, " ");
const variantRow = () => screen.getByRole("button", { name: /^(Pilih varian|Varian:)/ });
const stickyBuy = () => screen.getAllByRole("button").find((b) => b.textContent?.includes("Beli Sekarang") && !b.closest("[role=dialog]"))!;
const termsToggle = () => within(screen.getByTestId("pdp-mobile-copy")).getByRole("button", { name: /^Syarat & Ketentuan/ });

beforeEach(() => { nav.push.mockClear(); catalogFetches = 0; localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("PDP mobile: panel pilih varian", () => {
  it("baris varian mengajak memilih; panel pilih tanpa pilihan otomatis dan tanpa tombol beli", () => {
    renderPdp();
    expect(variantRow().getAttribute("aria-label")).toBe("Pilih varian, 3 pilihan");
    fireEvent.click(variantRow());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("radio").map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false", "false"]);
    expect(within(dialog).queryByRole("button", { name: /Beli Sekarang|Tambah ke Keranjang/ })).toBeNull();
    expect(within(dialog).queryByText("Jumlah")).toBeNull();
    // Varian dari halaman dipakai langsung: tidak ada fetch katalog ulang.
    expect(catalogFetches).toBe(0);
  });

  it("ketuk varian → panel menutup, harga/badge/S&K/tombol beli ikut varian, Beli Sekarang langsung ke checkout", async () => {
    renderPdp();
    fireEvent.click(variantRow());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /^Bulanan/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(norm(variantRow().getAttribute("aria-label"))).toBe("Varian: Bulanan, Rp 60.000. Ganti varian");
    expect(variantRow().textContent).toContain("Kirim otomatis");
    expect(termsToggle().textContent).toContain("Bulanan");
    fireEvent.click(termsToggle());
    expect(screen.getByRole("region", { name: /Syarat & Ketentuan/ }).textContent).toContain("Akun private selama 30 hari");
    expect(norm(stickyBuy().textContent)).toContain("Rp 60.000");
    fireEvent.click(stickyBuy());
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/checkout?buy=claude-pro&variant=23&qty=1"));
  });

  it("'Ganti varian' di judul S&K membuka panel dengan pilihan saat ini; Tutup tidak membuang pilihan", async () => {
    renderPdp();
    fireEvent.click(variantRow());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /^28 - 30 September/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(within(screen.getByTestId("pdp-mobile-copy")).getByRole("button", { name: "Ganti varian" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: /^28 - 30 September/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tutup pilihan varian" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(termsToggle().textContent).toContain("28 - 30 September");
  });

  it("belum memilih: Beli Sekarang membuka beli cepat; varian yang diketuk di sana tetap terpilih setelah ditutup", async () => {
    renderPdp();
    fireEvent.click(stickyBuy());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /Beli Sekarang/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("radio", { name: /^28 - 30 September/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Tutup pilihan varian" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(variantRow().getAttribute("aria-label")).toContain("Varian: 28 - 30 September");
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("'Ganti varian' tidak tampil bila S&K semua varian sama", () => {
    const same = resolveVariantCopy("Garansi 7 hari", "Login di website");
    renderPdp([variant(31, "1 Bulan", 20_000, { copy: same }), variant(32, "3 Bulan", 50_000, { copy: same })]);
    expect(within(screen.getByTestId("pdp-mobile-copy")).queryByRole("button", { name: "Ganti varian" })).toBeNull();
  });
});
