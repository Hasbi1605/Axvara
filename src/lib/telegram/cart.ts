// src/lib/telegram/cart.ts — Keranjang multi-item Telegram (Fase 2).
// Satu baris per (user_id, variant_id). Checkout gabungan tetap memakai SATU
// order + SATU invoice QRIS: payment_transactions UNIQUE(order_code) tidak
// berubah, fulfillment dibuat per item (satu job per varian via variant_id).

import { execRun, queryAll, queryFirst, isD1Mode } from "@/lib/db";
import { getActiveVariant } from "@/lib/catalog";
import { TELEGRAM_MAX_QTY } from "./keyboards";

export type CartLine = {
  productId: number;
  variantId: number;
  qty: number;
  productName: string;
  variantLabel: string;
  price: number;
  stock: number;
  fulfillmentMode: string;
};

export type CartSummary = {
  lines: CartLine[];
  subtotal: number;
  totalQty: number;
};

const MAX_LINES = 20;

function clampLineQty(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(TELEGRAM_MAX_QTY, Math.floor(raw)));
}

/** Tambah ke keranjang (upsert per varian). Unique fulfillment selalu qty 1. */
export async function addToCart(
  userId: string,
  productId: number,
  variantId: number,
  rawQty: number,
): Promise<{ ok: boolean; reason?: "invalid_variant" | "out_of_stock" | "cart_full" | "unique_conflict" }> {
  if (!isD1Mode()) return { ok: false, reason: "invalid_variant" };
  const variant = await getActiveVariant(variantId);
  if (!variant || variant.product_id !== productId) return { ok: false, reason: "invalid_variant" };
  if (variant.stock === 0) return { ok: false, reason: "out_of_stock" };

  const cappedQty = variant.fulfillment_mode === "unique" ? 1 : clampLineQty(rawQty);
  const existing = await queryFirst(
    `SELECT qty FROM telegram_carts WHERE user_id=? AND variant_id=?`,
    userId, variantId,
  );
  if (!existing) {
    const count = await queryFirst(
      `SELECT COUNT(*) as n FROM telegram_carts WHERE user_id=?`,
      userId,
    );
    if (Number(count?.n || 0) >= MAX_LINES) return { ok: false, reason: "cart_full" };
    // Satu order_code = satu inventory unique (findReservedForOrder memakai
    // order_code), jadi keranjang hanya boleh memuat 1 baris unique.
    if (variant.fulfillment_mode === "unique") {
      const uniqueCount = await queryFirst(
        `SELECT c.variant_id, pv.fulfillment_mode
         FROM telegram_carts c
         JOIN product_variants pv ON pv.id=c.variant_id
         WHERE c.user_id=? AND pv.fulfillment_mode='unique'`,
        userId,
      );
      if (uniqueCount) return { ok: false, reason: "unique_conflict" };
    }
  }
  const nextQty = variant.fulfillment_mode === "unique"
    ? 1
    : clampLineQty(Number(existing?.qty || 0) + cappedQty);
  await execRun(
    `INSERT INTO telegram_carts (user_id, product_id, variant_id, qty, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, variant_id) DO UPDATE SET qty=?, updated_at=datetime('now')`,
    userId, productId, variantId, nextQty, nextQty,
  );
  return { ok: true };
}

/** Ubah qty satu baris (qty<=0 = hapus baris). */
export async function setCartLineQty(userId: string, variantId: number, rawQty: number): Promise<boolean> {
  if (!isD1Mode()) return false;
  if (rawQty <= 0) {
    await execRun(`DELETE FROM telegram_carts WHERE user_id=? AND variant_id=?`, userId, variantId);
    return true;
  }
  const variant = await getActiveVariant(variantId);
  if (!variant) {
    await execRun(`DELETE FROM telegram_carts WHERE user_id=? AND variant_id=?`, userId, variantId);
    return false;
  }
  const qty = variant.fulfillment_mode === "unique" ? 1 : clampLineQty(rawQty);
  const result = await execRun(
    `UPDATE telegram_carts SET qty=?, updated_at=datetime('now') WHERE user_id=? AND variant_id=?`,
    qty, userId, variantId,
  );
  return Number(result.changes || 0) > 0;
}

export async function removeFromCart(userId: string, variantId: number): Promise<void> {
  if (!isD1Mode()) return;
  await execRun(`DELETE FROM telegram_carts WHERE user_id=? AND variant_id=?`, userId, variantId).catch(() => {});
}

export async function clearCart(userId: string): Promise<void> {
  if (!isD1Mode()) return;
  await execRun(`DELETE FROM telegram_carts WHERE user_id=?`, userId).catch(() => {});
}

/**
 * Baca keranjang + validasi harga/stok/varian terkini. Baris basi (varian
 * nonaktif/habis) dibersihkan otomatis agar checkout tidak pernah memakai
 * snapshot basi.
 */
export async function getCartSummary(userId: string): Promise<CartSummary> {
  const lines: CartLine[] = [];
  if (!isD1Mode()) return { lines, subtotal: 0, totalQty: 0 };
  const rows = await queryAll(
    `SELECT c.product_id, c.variant_id, c.qty, p.name as product_name
     FROM telegram_carts c
     JOIN products p ON p.id=c.product_id AND p.is_active=1
     WHERE c.user_id=?
     ORDER BY c.updated_at ASC
     LIMIT ?`,
    userId, MAX_LINES,
  );
  for (const row of rows) {
    const variantId = Number(row.variant_id);
    const variant = await getActiveVariant(variantId);
    if (!variant || variant.product_id !== Number(row.product_id) || variant.stock === 0) {
      await execRun(`DELETE FROM telegram_carts WHERE user_id=? AND variant_id=?`, userId, variantId).catch(() => {});
      continue;
    }
    let qty = clampLineQty(Number(row.qty || 1));
    if (variant.fulfillment_mode === "unique") qty = 1;
    else if (variant.stock !== -1) qty = Math.min(qty, Math.max(1, variant.stock));
    lines.push({
      productId: Number(row.product_id),
      variantId,
      qty,
      productName: String(row.product_name || "Produk"),
      variantLabel: variant.label,
      price: Number(variant.price),
      stock: Number(variant.stock),
      fulfillmentMode: String(variant.fulfillment_mode || "manual"),
    });
  }
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);
  return { lines, subtotal, totalQty };
}
