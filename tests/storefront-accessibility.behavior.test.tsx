// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Navbar } from "@/components/storefront/Navbar";
import { CartDrawer } from "@/components/storefront/CartDrawer";
import { useSearch } from "@/stores/search";
import { useCart } from "@/stores/cart";

const navigation = vi.hoisted(() => ({ pathname: "/checkout", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname, useRouter: () => ({ push: navigation.push }) }));
vi.mock("@/hooks/useStoreSettings", () => ({ useStoreSettings: () => ({ name: "AXVARA" }) }));
const scroll = vi.fn();
beforeEach(() => {
  navigation.pathname = "/checkout";
  navigation.push.mockReset(); scroll.mockReset();
  useSearch.setState({ q: "" });
  useCart.setState({ items: [], drawerOpen: false });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("submits a non-home search to the catalog and keeps its query", () => {
  render(<Navbar />);
  const input = screen.getByRole("searchbox", { name: "Cari produk Market" });
  fireEvent.change(input, { target: { value: "Canva" } });
  expect(navigation.push).not.toHaveBeenCalled();
  fireEvent.submit(input.closest("form")!);
  expect(navigation.push).toHaveBeenCalledWith("/#katalog");
  expect(useSearch.getState().q).toBe("Canva");
  expect(scroll).not.toHaveBeenCalled();
});

it("offers mobile search submission without navigating for empty queries or clearing", () => {
  render(<Navbar />);
  fireEvent.click(screen.getByRole("button", { name: "Cari produk" }));
  const input = screen.getAllByRole("searchbox", { name: "Cari produk Market" })[1];
  fireEvent.submit(input.closest("form")!);
  expect(navigation.push).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "Canva" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Hapus pencarian" })[1]);
  expect(useSearch.getState().q).toBe("");
  expect(navigation.push).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "ChatGPT" } });
  fireEvent.submit(input.closest("form")!);
  expect(navigation.push).toHaveBeenCalledWith("/#katalog");
});

it.each([false, true])("filters home search without repeated scrolling; reduced motion=%s", (reduced) => {
  navigation.pathname = "/";
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced })));
  const { container } = render(<><Navbar /><section id="katalog" /></>);
  const input = screen.getByRole("searchbox", { name: "Cari produk Market" });
  fireEvent.change(input, { target: { value: "C" } });
  fireEvent.change(input, { target: { value: "Canva" } });
  expect(scroll).toHaveBeenCalledOnce();
  expect(scroll).toHaveBeenCalledWith({ behavior: reduced ? "instant" : "smooth", block: "start" });
  expect(container.querySelector("#katalog")).toBeTruthy();
  expect(navigation.push).not.toHaveBeenCalled();
});

it("keeps cart actions contextual, keyboard focus visible and touch targets at 44px", () => {
  useCart.setState({ drawerOpen: true, items: [{ id: "1", slug: "canva", description: "Fixture", categorySlug: "tools", name: "Canva Pro", variantId: 2, variantLabel: "Invite 1 Bulan", image: "/fixture.webp", price: 2000, qty: 1, stock: 5 }] });
  render(<CartDrawer />);
  const close = screen.getByRole("button", { name: "Tutup keranjang" });
  const add = screen.getByRole("button", { name: "Tambah jumlah Canva Pro, Invite 1 Bulan" });
  const subtract = screen.getByRole("button", { name: "Kurangi jumlah Canva Pro, Invite 1 Bulan" });
  const remove = screen.getByRole("button", { name: "Hapus Canva Pro, Invite 1 Bulan dari keranjang" });
  for (const button of [close, add, subtract, remove]) {
    // 2026-11-08: visual 32px, area tap tetap 44px lewat pseudo-elemen.
    expect(button.classList.contains("w-8")).toBe(true);
    expect(button.classList.contains("h-8")).toBe(true);
    expect(button.className).toContain("before:-inset-1.5");
    expect(button.className).toContain("focus-visible:outline");
  }
  // Jumlah di antara stepper punya lebar minimum agar hit area tidak menutupinya.
  expect(document.querySelector("span.min-w-7")?.className).toContain("text-center");
  fireEvent.click(add); expect(useCart.getState().items[0].qty).toBe(2);
  fireEvent.click(subtract); expect(useCart.getState().items[0].qty).toBe(1);
  fireEvent.click(remove); expect(useCart.getState().items).toEqual([]);
  expect(screen.getByText("Keranjang masih kosong")).toBeTruthy();
  fireEvent.click(close); expect(useCart.getState().drawerOpen).toBe(false);
});

it("guards modal/drawer motion, offsets the catalog and raises informative card contrast", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  expect(read("src/components/storefront/CartDrawer.tsx")).toContain("motion-safe:animate-[slideInRight_0.26s_");
  expect(read("src/components/storefront/QuickVariantModal.tsx")).toContain("motion-safe:animate-[fadeInUp_");
  expect(read("src/app/(shop)/home-client.tsx")).toMatch(/id="katalog" className="scroll-mt-36/);
  expect(read("src/app/globals.css")).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*html \{ scroll-behavior: auto; \}/);
  expect(read("src/app/globals.css")).toContain('header input[type="search"]::-webkit-search-cancel-button { -webkit-appearance: none; }');
  const card = read("src/components/storefront/ProductCard.tsx");
  expect(card).toContain('text-[11px] text-white/65 font-medium tracking-wide');
  expect(card).not.toContain("text-white/35");
});
