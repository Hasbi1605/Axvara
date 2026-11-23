// @vitest-environment jsdom
// Keranjang + CartDrawer: harga dasar tidak dimutasi, estimasi tier per varian,
// alias/baris duplikat varian sama diagregasi, varian berbeda tidak, kompatibel
// dengan keranjang lama (persist pra-grosir).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { aggregatedVariantQty, cartBulkHint, estimatedUnitPrice, useCart, type CartItem } from "@/stores/cart";
import { CartDrawer } from "@/components/storefront/CartDrawer";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));

const tiers = [{ min_qty: 10, unit_price: 9000 }, { min_qty: 50, unit_price: 8000 }];
const base = (extra: Record<string, unknown> = {}): CartItem => ({
  id: "p1", slug: "gpt", name: "GPT Plus", description: "", categorySlug: "ai", image: "/x.png",
  price: 10_000, stock: -1, isActive: true, variantId: 11, variantLabel: "1 Bulan", minQty: 1, fulfillmentMode: "manual",
  bulkTiers: tiers, qty: 1, ...extra,
}) as unknown as CartItem;
const text = (el: Element) => (el.textContent ?? "").replace(/\s/g, " ");

beforeEach(() => { localStorage.clear(); useCart.setState({ items: [], drawerOpen: false }); });
afterEach(() => cleanup());

describe("store", () => {
  it("qty naik/turun melewati ambang tidak memutasi harga dasar; estimasi mengikuti qty", () => {
    const { add, setQty } = useCart.getState();
    add(base(), 9);
    const line = () => useCart.getState().items[0];
    expect(line().price).toBe(10_000);
    expect(estimatedUnitPrice(useCart.getState().items, line())).toBe(10_000);
    setQty("p1", 10, 11);
    expect(line().price).toBe(10_000);
    expect(estimatedUnitPrice(useCart.getState().items, line())).toBe(9000);
    expect(useCart.getState().subtotal()).toBe(90_000);
    setQty("p1", 50, 11);
    expect(useCart.getState().subtotal()).toBe(400_000);
    setQty("p1", 9, 11);
    expect(line().price).toBe(10_000);
    expect(estimatedUnitPrice(useCart.getState().items, line())).toBe(10_000);
    expect(useCart.getState().subtotal()).toBe(90_000);
  });

  it("baris alias varian sama diagregasi dengan satuan sama tetapi total baris memakai qty sendiri; varian berbeda tidak digabung", () => {
    useCart.setState({ items: [
      { ...base(), id: "p1", qty: 6 }, { ...base({ id: "alias-1" }), qty: 6 },
      { ...base({ variantId: 12, variantLabel: "3 Bulan", price: 10_000 }), qty: 6 },
    ] as CartItem[] });
    const items = useCart.getState().items;
    expect(aggregatedVariantQty(items, items[0])).toBe(12);
    expect(estimatedUnitPrice(items, items[0])).toBe(9000);
    expect(estimatedUnitPrice(items, items[1])).toBe(9000);
    expect(aggregatedVariantQty(items, items[2])).toBe(6);
    // Varian 12 hanya 6 pcs: tidak ikut tergabung dengan 12 pcs varian 11, jadi tetap harga dasar.
    expect(estimatedUnitPrice(items, items[2])).toBe(10_000);
    expect(useCart.getState().subtotal()).toBe(9000 * 6 + 9000 * 6 + 10_000 * 6);
  });

  it("keranjang lama tanpa bulkTiers berperilaku seperti sebelumnya; cache korup/basi diabaikan", () => {
    useCart.setState({ items: [{ ...base({ bulkTiers: undefined }), qty: 60 }] as CartItem[] });
    expect(useCart.getState().subtotal()).toBe(600_000);
    useCart.setState({ items: [{ ...base({ bulkTiers: [{ min_qty: 10, unit_price: 11_000 }] }), qty: 60 }] as CartItem[] });
    expect(useCart.getState().subtotal()).toBe(600_000);
    useCart.setState({ items: [{ ...base({ bulkTiers: "rusak" }), qty: 60 }] as CartItem[] });
    expect(useCart.getState().subtotal()).toBe(600_000);
    // persist lama (JSON) dimuat lalu ditambah qty tanpa error
    localStorage.setItem("axvara-cart", JSON.stringify({ state: { items: [{ id: "p1", slug: "gpt", name: "GPT", price: 10_000, qty: 3, variantId: 11 }] }, version: 0 }));
    void useCart.persist.rehydrate();
    expect(useCart.getState().subtotal()).toBe(30_000);
  });

  it("petunjuk tier berikutnya menghormati stok dan plafon unik", () => {
    useCart.setState({ items: [{ ...base({ stock: 30 }), qty: 8 }] as CartItem[] });
    expect(cartBulkHint(useCart.getState().items, useCart.getState().items[0])).toMatchObject({ need: 2, unitPrice: 9000 });
    useCart.setState({ items: [{ ...base({ stock: 30 }), qty: 10 }] as CartItem[] });
    expect(cartBulkHint(useCart.getState().items, useCart.getState().items[0])).toBeNull(); // 50 > stok 30
    useCart.setState({ items: [{ ...base({ fulfillmentMode: "unique", stock: -1 }), qty: 8 }] as CartItem[] });
    expect(cartBulkHint(useCart.getState().items, useCart.getState().items[0])).toMatchObject({ need: 2, threshold: 10 }); // plafon unik 10 masih mencapai tier 10
    useCart.setState({ items: [{ ...base({ fulfillmentMode: "unique", stock: -1 }), qty: 10 }] as CartItem[] });
    expect(cartBulkHint(useCart.getState().items, useCart.getState().items[0])).toBeNull(); // tier 50 melampaui plafon unik 10
  });

  it("add ulang menyegarkan cache tier tanpa mengubah harga dasar baris", () => {
    const { add } = useCart.getState();
    add(base({ bulkTiers: undefined }), 2);
    add(base({ bulkTiers: tiers }), 1);
    expect(useCart.getState().items[0]).toMatchObject({ price: 10_000, qty: 3, bulkTiers: tiers });
  });

  it("forgetBulkTiers hanya membuang cache varian yang diminta", () => {
    useCart.setState({ items: [{ ...base(), qty: 10 }, { ...base({ variantId: 12 }), qty: 10 }] as CartItem[] });
    useCart.getState().forgetBulkTiers([11]);
    const [a, b] = useCart.getState().items;
    expect(a.bulkTiers).toBeUndefined();
    expect(b.bulkTiers).toEqual(tiers);
  });
});

describe("CartDrawer", () => {
  function open(items: unknown[]) {
    useCart.setState({ items: items as CartItem[], drawerOpen: true });
    render(<CartDrawer />);
  }
  it("satuan tier + coret dasar + 'grosir 10+', total baris, catatan kaki, dan petunjuk 'varian ini'", () => {
    open([{ ...base(), qty: 12 }]);
    const dialog = screen.getByRole("dialog", { name: "Keranjang belanja" });
    const t = text(dialog);
    expect(t).toContain("Rp 9.000");
    expect(dialog.querySelector(".line-through")?.textContent).toMatch(/10\.000/);
    expect(t).toContain("grosir 10+");
    expect(t).toContain("Rp 108.000");
    expect(t).toContain("Tambah 38 pcs varian ini untuk Rp 8.000/pcs");
    expect(t).toContain("Total final dikonfirmasi di checkout.");
    expect(t).not.toContain("Pilih metode pembayaran di checkout");
  });
  it("di bawah ambang: harga dasar, tanpa coret, petunjuk menuju tier pertama, tanpa catatan kaki", () => {
    open([{ ...base(), qty: 8 }]);
    const t = text(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog").querySelector(".line-through")).toBeNull();
    expect(t).toContain("Tambah 2 pcs varian ini untuk Rp 9.000/pcs");
    expect(t).not.toContain("Harga grosir per varian");
  });
  it("alias varian sama: satuan sama, total baris qty sendiri, catatan agregasi; keranjang lama tetap polos", () => {
    open([{ ...base(), qty: 6 }, { ...base({ id: "alias-1" }), qty: 6 }]);
    const t = text(screen.getByRole("dialog"));
    expect(t.match(/Rp 9\.000/g)?.length).toBeGreaterThanOrEqual(2);
    expect(t).toContain("Rp 54.000");
    expect(t).toContain("Grosir dihitung dari total 12 pcs varian ini");
    cleanup();
    useCart.setState({ items: [{ ...base({ bulkTiers: undefined }), qty: 12 }] as CartItem[], drawerOpen: true });
    render(<CartDrawer />);
    const legacy = text(screen.getByRole("dialog"));
    expect(legacy).toContain("Rp 120.000");
    expect(legacy).not.toMatch(/grosir|Tambah \d+ pcs/);
  });
  it("tombol +/- tetap bekerja, harga dasar tidak berubah, dan judul item menaut ke halaman produk", () => {
    open([{ ...base(), qty: 9 }]);
    const link = screen.getByRole("link", { name: "GPT Plus" });
    expect(link.getAttribute("href")).toBe("/produk/gpt");
    fireEvent.click(screen.getByRole("button", { name: /Tambah jumlah GPT Plus/ }));
    expect(useCart.getState().items[0]).toMatchObject({ qty: 10, price: 10_000 });
    expect(text(screen.getByRole("dialog"))).toContain("Rp 90.000");
  });
});
