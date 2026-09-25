// @vitest-environment jsdom
//
// tests/quick-variant-select.behavior.test.tsx — Mode `select`, varian dari
// halaman, dan daftar panjang di QuickVariantModal (2026-09-25).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { COMPACT_VARIANTS_AFTER, QuickVariantModal, SEARCH_VARIANTS_AFTER } from "@/components/storefront/QuickVariantModal";
import type { VariantOption } from "@/components/storefront/QuickVariantModal";
import type { Product } from "@/lib/products";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));

const product = { id: "p", name: "Akun GSuite", slug: "akun-gsuite", price: 2_000, minPrice: 2_000, image: "/brand/axvara-mark.svg", isActive: true } as unknown as Product;
const mk = (n: number): VariantOption[] => Array.from({ length: n }, (_, i) => ({
  id: 100 + i, label: `${i + 1} Hari`, price: 2_000 + i * 500, compare_price: null, stock: -1, min_qty: 1, is_active: 1, warranty_type: "none", fulfillment_mode: "manual",
})) as unknown as VariantOption[];
const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ product: { variants: mk(3) } }) }));
beforeEach(() => { fetchSpy.mockClear(); vi.stubGlobal("fetch", fetchSpy); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const radios = () => within(screen.getByRole("radiogroup")).getAllByRole("radio");
const group = () => screen.getByRole("radiogroup");
const variantRadio = (label: string) => radios().find((r) => r.getAttribute("aria-label")?.startsWith(`${label} —`))!;
const checkedLabels = () => radios().filter((r) => r.getAttribute("aria-checked") === "true").map((r) => r.getAttribute("aria-label")?.split(" —")[0]);
// Baris ringkas (>6 varian) hanya dikenali dari susunan gridnya: satu kolom rapat.
const isCompact = () => group().className.includes("gap-1.5") && !group().className.includes("sm:grid-cols-2");
const searchBox = () => screen.queryByRole("searchbox", { name: "Cari varian" });

describe("QuickVariantModal mode select", () => {
  it("varian halaman dipakai tanpa fetch; ketuk → callback + tutup, tanpa stepper/CTA", () => {
    const onClose = vi.fn();
    const onVariantChange = vi.fn();
    render(<QuickVariantModal product={product} mode="select" onClose={onClose} variants={mk(3)} onVariantChange={onVariantChange} />);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(checkedLabels()).toEqual([]);
    expect(screen.queryByRole("button", { name: /Beli Sekarang|Tambah ke Keranjang/ })).toBeNull();
    fireEvent.click(variantRadio("2 Hari"));
    expect(onVariantChange).toHaveBeenCalledWith(101);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pilihan halaman ditandai saat panel dibuka", () => {
    render(<QuickVariantModal product={product} mode="select" onClose={vi.fn()} variants={mk(3)} initialVariantId={102} />);
    expect(checkedLabels()).toEqual(["3 Hari"]);
  });

  it("mode checkout: pilihan halaman dipakai; pilihan otomatis TIDAK memanggil callback", async () => {
    const onVariantChange = vi.fn();
    render(<QuickVariantModal product={product} mode="checkout" onClose={vi.fn()} variants={mk(3)} initialVariantId={101} onVariantChange={onVariantChange} />);
    expect(checkedLabels()).toEqual(["2 Hari"]);
    expect(onVariantChange).not.toHaveBeenCalled();
    fireEvent.click(variantRadio("3 Hari"));
    expect(onVariantChange).toHaveBeenCalledWith(102);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("tanpa varian dari halaman tetap fetch seperti biasa (kartu katalog)", async () => {
    render(<QuickVariantModal product={product} mode="cart" onClose={vi.fn()} />);
    await waitFor(() => expect(radios()).toHaveLength(3));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(checkedLabels()).toEqual(["1 Hari"]);
  });
});

describe("QuickVariantModal daftar panjang", () => {
  it(`sampai ${COMPACT_VARIANTS_AFTER} varian: kartu biasa, tanpa kotak cari`, () => {
    render(<QuickVariantModal product={product} mode="select" onClose={vi.fn()} variants={mk(COMPACT_VARIANTS_AFTER)} />);
    expect(isCompact()).toBe(false);
    expect(searchBox()).toBeNull();
  });

  it(`${COMPACT_VARIANTS_AFTER + 1}–${SEARCH_VARIANTS_AFTER} varian: baris ringkas satu kolom, tanpa kotak cari`, () => {
    render(<QuickVariantModal product={product} mode="select" onClose={vi.fn()} variants={mk(7)} />);
    expect(isCompact()).toBe(true);
    expect(radios()).toHaveLength(7);
    expect(searchBox()).toBeNull();
  });

  it(`lebih dari ${SEARCH_VARIANTS_AFTER} varian: kotak cari menyaring daftar`, () => {
    render(<QuickVariantModal product={product} mode="select" onClose={vi.fn()} variants={mk(14)} />);
    fireEvent.change(searchBox()!, { target: { value: "1" } });
    expect(radios().map((r) => r.getAttribute("aria-label")?.split(" —")[0])).toEqual(["1 Hari", "10 Hari", "11 Hari", "12 Hari", "13 Hari", "14 Hari"]);
    fireEvent.change(searchBox()!, { target: { value: "99" } });
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText(/Tidak ada varian yang cocok/)).toBeTruthy();
  });
});
