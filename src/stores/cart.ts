"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Product } from "@/lib/products";

export type CartItem = Product & { qty: number; variantId?: number; variantLabel?: string };

type CartStore = {
  items: CartItem[];
  drawerOpen: boolean;
  setDrawer: (open: boolean) => void;
  add: (product: Product & { variantId?: number; variantLabel?: string }, qty?: number) => void;
  remove: (id: string, variantId?: number) => void;
  setQty: (id: string, qty: number, variantId?: number) => void;
  clear: () => void;
  count: () => number;
  subtotal: () => number;
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
          const maxFor = (p: Product) => (p.stock === -1 || p.stock == null ? 20 : Math.min(20, p.stock));
          const max = maxFor(product);
          // Don't add if stock is 0
          if (max <= 0) return s;
          const clampQty = (n: number, max: number) => Math.max(1, Math.min(max, Math.floor(n)));
          const matchKey = product.variantId ? `${product.id}:${product.variantId}` : product.id;
          const itemKey = (i: CartItem) => i.variantId ? `${i.id}:${i.variantId}` : i.id;
          const existing = s.items.find((i) => itemKey(i) === matchKey);
          if (existing) {
            const nextQty = clampQty(existing.qty + qty, max);
            return { items: s.items.map((i) => (itemKey(i) === matchKey ? { ...i, qty: nextQty } : i)) };
          }
          return { items: [...s.items, { ...product, qty: clampQty(qty, max) }] };
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
          const max = it ? (it.stock === -1 || it.stock == null ? 20 : Math.min(20, it.stock)) : 20;
          if (max <= 0) return { items: s.items.filter((i) => itemKey(i) !== matchKey) };
          const clamped = Math.max(1, Math.min(max, Math.floor(qty)));
          return { items: s.items.map((i) => (itemKey(i) === matchKey ? { ...i, qty: clamped } : i)) };
        }),
      clear: () => set({ items: [] }),
      count: () => get().items.reduce((a, b) => a + b.qty, 0),
      subtotal: () => get().items.reduce((a, b) => a + b.price * b.qty, 0),
    }),
    { name: "axvara-cart" }
  )
);
