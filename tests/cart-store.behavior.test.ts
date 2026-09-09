// @vitest-environment jsdom
//
// tests/cart-store.behavior.test.ts — Keranjang adalah jalur uang paling
// sering disentuh di storefront dan sebelumnya TIDAK punya satu test pun
// (semua 538 test berjalan di environment node dengan include `.test.ts`
// saja, dan store ini butuh localStorage untuk middleware persist).
//
// Kontrak yang dijaga: identitas baris per varian, clamp stok/batas 20,
// penolakan produk nonaktif/habis, dan aritmetika subtotal.

import { describe, it, expect, beforeEach } from "vitest";
import { useCart } from "@/stores/cart";
import type { Product } from "@/lib/products";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-1",
    name: "Netflix Premium",
    slug: "netflix-premium",
    price: 25_000,
    category: "streaming",
    stock: 10,
    isActive: true,
    ...overrides,
  } as Product;
}

beforeEach(() => {
  useCart.setState({ items: [], drawerOpen: false });
});

describe("cart store — identitas baris per varian", () => {
  it("dua varian dari produk yang sama menjadi dua baris terpisah", () => {
    const { add } = useCart.getState();
    add({ ...makeProduct(), variantId: 1, variantLabel: "1 Bulan" });
    add({ ...makeProduct(), variantId: 2, variantLabel: "3 Bulan" });
    const { items } = useCart.getState();
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.variantId)).toEqual([1, 2]);
  });

  it("varian yang sama ditambah dua kali menggabung qty, bukan menduplikasi baris", () => {
    const { add } = useCart.getState();
    add({ ...makeProduct(), variantId: 1 });
    add({ ...makeProduct(), variantId: 1 });
    const { items } = useCart.getState();
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(2);
  });

  it("produk tanpa varian tidak bertabrakan dengan baris bervarian dari produk sama", () => {
    const { add } = useCart.getState();
    add(makeProduct());
    add({ ...makeProduct(), variantId: 7 });
    expect(useCart.getState().items).toHaveLength(2);
  });

  it("remove hanya menghapus baris varian yang dituju", () => {
    const { add, remove } = useCart.getState();
    add({ ...makeProduct(), variantId: 1 });
    add({ ...makeProduct(), variantId: 2 });
    remove("prod-1", 1);
    const { items } = useCart.getState();
    expect(items).toHaveLength(1);
    expect(items[0].variantId).toBe(2);
  });
});

describe("cart store — batas stok dan validasi", () => {
  it("qty tidak boleh melewati stok tersedia", () => {
    const { add } = useCart.getState();
    add({ ...makeProduct({ stock: 3 }), variantId: 1 }, 10);
    expect(useCart.getState().items[0].qty).toBe(3);
  });

  it("stok unlimited (-1) tetap dibatasi 20 per baris", () => {
    const { add } = useCart.getState();
    add({ ...makeProduct({ stock: -1 }), variantId: 1 }, 999);
    expect(useCart.getState().items[0].qty).toBe(20);
  });

  it("produk dengan stok 0 tidak masuk keranjang", () => {
    const { add } = useCart.getState();
    add({ ...makeProduct({ stock: 0 }), variantId: 1 });
    expect(useCart.getState().items).toHaveLength(0);
  });

  it("produk nonaktif tidak masuk keranjang", () => {
    const { add } = useCart.getState();
    add({ ...makeProduct({ isActive: false }), variantId: 1 });
    expect(useCart.getState().items).toHaveLength(0);
  });

  it("setQty 0 atau negatif menghapus baris", () => {
    const { add, setQty } = useCart.getState();
    add({ ...makeProduct(), variantId: 1 });
    setQty("prod-1", 0, 1);
    expect(useCart.getState().items).toHaveLength(0);
  });

  it("setQty melebihi stok ikut di-clamp, bukan diterima apa adanya", () => {
    const { add, setQty } = useCart.getState();
    add({ ...makeProduct({ stock: 4 }), variantId: 1 });
    setQty("prod-1", 99, 1);
    expect(useCart.getState().items[0].qty).toBe(4);
  });

  it("qty pecahan dibulatkan ke bawah dan minimal 1", () => {
    const { add } = useCart.getState();
    add({ ...makeProduct(), variantId: 1 }, 2.9);
    expect(useCart.getState().items[0].qty).toBe(2);
  });
});

describe("cart store — aritmetika total", () => {
  it("subtotal dan count menjumlahkan seluruh baris", () => {
    const { add } = useCart.getState();
    add({ ...makeProduct({ price: 25_000 }), variantId: 1 }, 2);
    add({ ...makeProduct({ id: "prod-2", price: 40_000 }), variantId: 5 }, 3);
    const state = useCart.getState();
    expect(state.count()).toBe(5);
    expect(state.subtotal()).toBe(25_000 * 2 + 40_000 * 3);
  });

  it("subtotal tetap integer rupiah (tanpa pembulatan float)", () => {
    const { add } = useCart.getState();
    add({ ...makeProduct({ price: 33_333 }), variantId: 1 }, 3);
    const total = useCart.getState().subtotal();
    expect(total).toBe(99_999);
    expect(Number.isInteger(total)).toBe(true);
  });

  it("clear mengosongkan seluruh baris", () => {
    const { add, clear } = useCart.getState();
    add({ ...makeProduct(), variantId: 1 });
    clear();
    expect(useCart.getState().items).toHaveLength(0);
  });
});

describe("cart store — persist", () => {
  it("memakai kunci localStorage axvara-cart yang stabil", () => {
    const { add } = useCart.getState();
    add({ ...makeProduct(), variantId: 1 });
    const raw = window.localStorage.getItem("axvara-cart");
    expect(raw).toBeTruthy();
    // Mengganti nama kunci ini akan mengosongkan keranjang semua pembeli lama.
    expect(JSON.parse(String(raw)).state.items[0].variantId).toBe(1);
  });
});
