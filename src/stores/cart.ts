"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MAX_UNIQUE_UNITS_PER_ORDER } from "@/lib/fulfillment/units";
import type { Product } from "@/lib/products";

export type CartItem = Product & { qty: number; variantId?: number; variantLabel?: string; minQty?: number; fulfillmentMode?: string };

type CartStore = {
  items: CartItem[];
  drawerOpen: boolean;
  setDrawer: (open: boolean) => void;
  add: (product: Product & { variantId?: number; variantLabel?: string; minQty?: number; fulfillmentMode?: string }, qty?: number) => void;
  remove: (id: string, variantId?: number) => void;
  setQty: (id: string, qty: number, variantId?: number) => void;
  clear: () => void;
  count: () => number;
  /**
   * Jumlah BARIS varian (items.length) — untuk badge Navbar + judul Drawer.
   * Pola marketplace: badge = jenis barang, bukan sum qty (GSuite min 50
   * dalam 1 baris harus tampil "1", bukan "50"). count() tetap sum qty
   * untuk logika subtotal/qty — jangan tukar pemakaiannya.
   */
  lineCount: () => number;
  subtotal: () => number;
};

/**
 * Batas atas web = 100/baris (paritas Telegram TELEGRAM_MAX_QTY) agar
 * varian min-besar (mis. GSuite min 50) tetap bisa dibeli dari web.
 * Minimum per baris ikut dari minQty produk (migrasi 0034, default 1).
 *
 * Varian yang stoknya di bawah minimum (stock < min, stock !== -1) TIDAK
 * BISA dibeli dalam jumlah berapa pun: qty berapa pun pasti gagal di quote
 * (insufficient_stock bila >= min, below_minimum bila < min). Tolak sejak
 * keranjang agar tidak jadi dead-end di checkout.
 */
const WEB_MAX_QTY = 100;
const minOf = (p: { minQty?: number; fulfillmentMode?: string }): number => Math.max(1, Math.floor(Number(p.minQty ?? 1) || 1));
const isBelowMinimumStock = (p: { stock?: number | null; minQty?: number; fulfillmentMode?: string }): boolean => {
  const stock = p.stock;
  if (stock == null || stock === -1) return false;
  return stock < minOf(p);
};

export const useCart = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      drawerOpen: false,
      setDrawer: (open) => set({ drawerOpen: open }),
      add: (product, qty = 1) =>
        set((s) => {
          if (product.isActive === false) return s;
          // Stok di bawah minimum (mis. stok 3, min 50): qty berapa pun
          // pasti gagal di quote — tolak di sini, bukan di checkout.
          if (isBelowMinimumStock(product)) return s;
          // Baris baru dibuka LANGSUNG di minimum (bukan 1) agar pembeli
          // GSuite (min 50) tidak mulai dari 1 lalu ditolak saat checkout.
          const min = minOf(product);
          const maxFor = (p: Product & {fulfillmentMode?:string}) => {
            const cap=p.fulfillmentMode === "unique" ? MAX_UNIQUE_UNITS_PER_ORDER : WEB_MAX_QTY;
            const others=s.items.filter(i=>!(i.id===product.id && i.variantId===product.variantId)).reduce((n,i)=>n+(i.fulfillmentMode === "unique" ? i.qty : 0),0);
            const remaining=p.fulfillmentMode === "unique" ? Math.max(0,cap-others) : cap;
            return p.stock === -1 || p.stock == null ? remaining : Math.min(remaining,p.stock);
          };
          // Don't add if stock is 0 — cek SEBELUM max dipaksa >= min agar
          // stok habis tidak lolos lewat Math.max(min, 0).
          if (maxFor(product) < min) return s;
          const max = Math.max(min, maxFor(product));
          const clampQty = (n: number, lo: number, hi: number) => Math.min(Math.max(lo, Math.floor(n)), hi);
          const matchKey = product.variantId ? `${product.id}:${product.variantId}` : product.id;
          const itemKey = (i: CartItem) => i.variantId ? `${i.id}:${i.variantId}` : i.id;
          const existing = s.items.find((i) => itemKey(i) === matchKey);
          if (existing) {
            const lo = Math.max(min, minOf(existing));
            const updated = { ...existing, fulfillmentMode: product.fulfillmentMode ?? existing.fulfillmentMode };
            if (maxFor(updated) < lo) return s;
            const hi = maxFor(updated);
            const nextQty = clampQty(existing.qty + qty, lo, hi);
            return { items: s.items.map((i) => (itemKey(i) === matchKey ? { ...i, qty: nextQty, minQty: Math.max(minOf(i), min), fulfillmentMode: updated.fulfillmentMode } : i)) };
          }
          return { items: [...s.items, { ...product, qty: clampQty(Math.max(qty, min), min, max) }] };
        }),
      remove: (id, variantId) => set((s) => {
          const matchKey = variantId ? `${id}:${variantId}` : id;
          const itemKey = (i: CartItem) => i.variantId ? `${i.id}:${i.variantId}` : i.id;
          return { items: s.items.filter((i) => itemKey(i) !== matchKey) };
        }),
      setQty: (id, qty, variantId) =>
        set((s) => {
          const matchKey = variantId ? `${id}:${variantId}` : id;
          const itemKey = (i: CartItem) => i.variantId ? `${i.id}:${i.variantId}` : i.id;
          if (qty <= 0) return { items: s.items.filter((i) => itemKey(i) !== matchKey) };
          const it = s.items.find((i) => itemKey(i) === matchKey);
          const min = it ? minOf(it) : 1;
          // Baris lama yang stoknya kini di bawah minimum (stok turun setelah
          // masuk keranjang): keluarkan, jangan pertahankan qty mustahil.
          if (it && isBelowMinimumStock(it)) return { items: s.items.filter((i) => itemKey(i) !== matchKey) };
          // Tombol kurang tidak boleh turun di bawah minimum (quote server
          // tetap menjadi sumber kebenaran; ini hanya cermin UX).
          if (qty < min) qty = min;
          const cap=it?.fulfillmentMode === "unique" ? MAX_UNIQUE_UNITS_PER_ORDER : WEB_MAX_QTY;
          const others=s.items.filter(i=>itemKey(i)!==matchKey).reduce((n,i)=>n+(i.fulfillmentMode === "unique" ? i.qty : 0),0);
          const remaining=it?.fulfillmentMode === "unique" ? Math.max(0,cap-others) : cap;
          const max=it && it.stock !== -1 && it.stock != null ? Math.min(remaining,it.stock) : remaining;
          if (max < min) return { items: s.items.filter((i) => itemKey(i) !== matchKey) };
          const clamped = Math.min(Math.max(min, Math.floor(qty)), Math.max(min, max));
          return { items: s.items.map((i) => (itemKey(i) === matchKey ? { ...i, qty: clamped } : i)) };
        }),
      clear: () => set({ items: [] }),
      count: () => get().items.reduce((a, b) => a + b.qty, 0),
      lineCount: () => get().items.length,
      subtotal: () => get().items.reduce((a, b) => a + b.price * b.qty, 0),
    }),
    { name: "axvara-cart" }
  )
);
