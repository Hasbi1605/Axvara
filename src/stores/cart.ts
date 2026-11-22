"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MAX_UNIQUE_UNITS_PER_ORDER } from "@/lib/fulfillment/units";
import type { Product } from "@/lib/products";
import type { BulkTier } from "@/lib/bulk-pricing";
import { activeTier, bulkUnitEstimate, nextReachableTier, safeBulkTiers } from "@/lib/bulk-display";

/**
 * `price` TETAP harga dasar varian (juga yang dikirim sebagai expected_price ke
 * quote; server membandingkannya dengan harga dasar). `bulkTiers` hanyalah
 * cache tier tervalidasi dari katalog untuk ESTIMASI tampilan; baris lama tanpa
 * field ini (persist pra-grosir) berperilaku persis seperti sebelumnya.
 */
export type CartItem = CartInput & { qty: number };

type CartInput = Product & { variantId?: number; variantLabel?: string; minQty?: number; maxQty?: number | null; buyerFieldKey?: "muse_invite_code" | null; pixelverifInput?: boolean; fulfillmentMode?: string; inventoryAvailable?: number | null; bulkTiers?: BulkTier[] };

type CartStore = {
  items: CartItem[];
  drawerOpen: boolean;
  setDrawer: (open: boolean) => void;
  add: (product: CartInput, qty?: number) => void;
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
  /** Estimasi tampilan (tier per varian bila ada); checkout memakai quote server. */
  subtotal: () => number;
  /** Buang cache tier baris varian ini (mis. setelah pembeli menyetujui harga baru dari server). */
  forgetBulkTiers: (variantIds: number[]) => void;
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
/**
 * Stok EFEKTIF untuk clamp keranjang: varian unique memakai min(kolom stock,
 * inventory_available) — paritas helper server `effectiveVariantStock`.
 * Baris lama tanpa metadata inventory (persist pra-fix) memakai kolom apa
 * adanya, sama seperti perilaku helper saat inventory null.
 */
const effectiveStockOf = (p: { stock?: number | null; fulfillmentMode?: string; inventoryAvailable?: number | null }): number => {
  const stock = p.stock ?? -1;
  if (String(p.fulfillmentMode ?? "manual").trim().toLowerCase() !== "unique") return stock;
  const inv = p.inventoryAvailable == null ? null : Number(p.inventoryAvailable);
  if (inv == null || !Number.isFinite(inv)) return stock;
  if (stock === -1) return Math.max(0, inv);
  return Math.min(Math.max(0, stock), Math.max(0, inv));
};
const isBelowMinimumStock = (p: { stock?: number | null; minQty?: number; fulfillmentMode?: string; inventoryAvailable?: number | null }): boolean => {
  const stock = effectiveStockOf(p);
  if (stock === -1) return false;
  return stock < minOf(p);
};

/** Qty teragregasi untuk varian yang sama (lintas baris alias produk); varian berbeda tidak pernah digabung. */
export function aggregatedVariantQty(items: CartItem[], item: CartItem): number {
  if (item.variantId === undefined) return item.qty;
  return items.filter((other) => other.variantId === item.variantId).reduce((sum, other) => sum + other.qty, 0);
}

/** Harga satuan estimasi: baris alias dari varian yang sama memakai harga satuan yang sama. */
export function estimatedUnitPrice(items: CartItem[], item: CartItem): number {
  return bulkUnitEstimate(item.price, item.bulkTiers, aggregatedVariantQty(items, item));
}

/** Tier berikutnya yang bisa dicapai (batas stok/plafon dari metadata baris), atau null. */
export function cartBulkHint(items: CartItem[], item: CartItem): { need: number; unitPrice: number; threshold: number } | null {
  const tiers = safeBulkTiers(item.price, item.bulkTiers);
  if (tiers.length === 0) return null;
  const cap = String(item.fulfillmentMode ?? "").trim().toLowerCase() === "unique" ? MAX_UNIQUE_UNITS_PER_ORDER : WEB_MAX_QTY;
  const eff = effectiveStockOf(item);
  const max = eff === -1 ? cap : Math.min(cap, eff);
  const qty = aggregatedVariantQty(items, item);
  const next = nextReachableTier(tiers, qty, max);
  return next ? { need: next.min_qty - qty, unitPrice: next.unit_price, threshold: next.min_qty } : null;
}

/** Tier yang sedang berlaku (untuk label "grosir N+"), atau null. */
export function cartActiveTier(items: CartItem[], item: CartItem): BulkTier | null {
  return activeTier(safeBulkTiers(item.price, item.bulkTiers), aggregatedVariantQty(items, item));
}

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
          const maxFor = (p: CartInput) => {
            const cap=Math.min(p.maxQty ?? WEB_MAX_QTY, p.fulfillmentMode === "unique" ? MAX_UNIQUE_UNITS_PER_ORDER : WEB_MAX_QTY);
            const others=s.items.filter(i=>!(i.id===product.id && i.variantId===product.variantId)).reduce((n,i)=>n+(i.fulfillmentMode === "unique" ? i.qty : 0),0);
            const remaining=p.fulfillmentMode === "unique" ? Math.max(0,cap-others) : cap;
            const eff = effectiveStockOf(p);
            return eff === -1 ? remaining : Math.min(remaining,eff);
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
            const lo = product.minQty == null ? minOf(existing) : min;
            // Refresh metadata basi dari katalog terbaru (stok efektif,
            // inventory, min, mode): baris lama yang di-add ulang tidak
            // mempertahankan angka basi — qty lalu di-clamp ke [lo, hi].
            const updated = { ...existing, maxQty: product.maxQty, buyerFieldKey: product.buyerFieldKey, pixelverifInput: product.pixelverifInput ?? existing.pixelverifInput, stock: product.stock ?? existing.stock, inventoryAvailable: product.inventoryAvailable ?? existing.inventoryAvailable, fulfillmentMode: product.fulfillmentMode ?? existing.fulfillmentMode, bulkTiers: product.bulkTiers ?? existing.bulkTiers };
            if (maxFor(updated) < lo) return { items: s.items.filter((i) => itemKey(i) !== matchKey) };
            const hi = maxFor(updated);
            const nextQty = clampQty(existing.qty + qty, lo, hi);
            return { items: s.items.map((i) => (itemKey(i) === matchKey ? { ...updated, qty: nextQty, minQty: lo } : i)) };
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
          const cap=Math.min(it?.maxQty ?? WEB_MAX_QTY,it?.fulfillmentMode === "unique" ? MAX_UNIQUE_UNITS_PER_ORDER : WEB_MAX_QTY);
          const others=s.items.filter(i=>itemKey(i)!==matchKey).reduce((n,i)=>n+(i.fulfillmentMode === "unique" ? i.qty : 0),0);
          const remaining=it?.fulfillmentMode === "unique" ? Math.max(0,cap-others) : cap;
          const eff=it ? effectiveStockOf(it) : -1;
          const max=it && eff !== -1 ? Math.min(remaining,eff) : remaining;
          if (max < min) return { items: s.items.filter((i) => itemKey(i) !== matchKey) };
          const clamped = Math.min(Math.max(min, Math.floor(qty)), Math.max(min, max));
          return { items: s.items.map((i) => (itemKey(i) === matchKey ? { ...i, qty: clamped } : i)) };
        }),
      clear: () => set({ items: [] }),
      count: () => get().items.reduce((a, b) => a + b.qty, 0),
      lineCount: () => get().items.length,
      subtotal: () => get().items.reduce((a, b) => a + estimatedUnitPrice(get().items, b) * b.qty, 0),
      forgetBulkTiers: (variantIds) => set((s) => ({ items: s.items.map((i) => (i.variantId !== undefined && variantIds.includes(i.variantId) && i.bulkTiers !== undefined ? { ...i, bulkTiers: undefined } : i)) })),
    }),
    { name: "axvara-cart" }
  )
);
