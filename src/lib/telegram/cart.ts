import { wrNewSaleSql } from "@/lib/warung-rebahan/new-sales";
// src/lib/telegram/cart.ts — Keranjang multi-item Telegram (Fase 2).
// Satu baris per (user_id, variant_id). Checkout gabungan tetap memakai SATU
// order + SATU invoice QRIS: payment_transactions UNIQUE(order_code) tidak
// berubah, fulfillment dibuat per item (satu job per varian via variant_id).

import { execRun, queryAll, queryFirst, isD1Mode } from "@/lib/db";
import { effectiveVariantStock, formatVariantLabel, getActiveVariant, type VariantSummary } from "@/lib/catalog";
import { bulkOwnerFromJoinedRow, resolveBulkPriceForProduct } from "@/lib/bulk-pricing";
import { MAX_UNIQUE_UNITS_PER_ORDER } from "@/lib/fulfillment/units";
import { assertSameBuyerCode, sealPixelverifCartFields, unsealPixelverifCartFields, validateBuyerFields, type BuyerFields } from "@/lib/buyer-fields";
import { TELEGRAM_MAX_QTY } from "./keyboards";

export type CartLine = {
  buyerFields?: BuyerFields;
  buyerFieldKey?: "muse_invite_code" | null;
  pixelverifInput?: boolean;
  maxQty?: number | null;
  productId: number;
  variantId: number;
  qty: number;
  productName: string;
  variantLabel: string;
  /** Harga EFEKTIF per unit (server, sudah termasuk tier agregat varian). */
  price: number;
  /** Harga dasar pv.price saat dibaca (untuk guard atomik + snapshot). */
  basePrice: number;
  /** min_qty tier yang benar-benar dikenakan (bila ada diskon). */
  appliedTierMinQty?: number | null;
  stock: number;
  fulfillmentMode: string;
  /** Minimum pembelian per baris (migrasi 0034, default 1). */
  minQty: number;
  cartId?: number;
  cartUpdatedAt?: string;
};

export type CartSummary = {
  lines: CartLine[];
  subtotal: number;
  totalQty: number;
  issues: string[];
};

const MAX_LINES = 20;

// Advance even for same-millisecond edits, so qty A -> B -> A cannot pass cleanup CAS.
const CART_UPDATED_AT = `strftime('%Y-%m-%d %H:%M:%f',
  CASE WHEN julianday(updated_at)>=julianday('now')
    THEN julianday(updated_at)+0.001/86400 ELSE julianday('now') END)`;

/** Tambah ke keranjang (upsert per varian). Unique fulfillment dibatasi total 10 unit per pesanan. */
export async function addToCart(
  userId: string,
  productId: number,
  variantId: number,
  rawQty: number,
  // Minimum pembelian (migrasi 0034): pemanggil (handler qty) meneruskan
  // min_qty varian agar keranjang menolak qty di bawah minimum SEBELUM
  // invoice; default 1 = perilaku lama.
  minQtyRaw = 1,
  buyerFields?: BuyerFields,
): Promise<{ ok: boolean; reason?: "invalid_variant" | "invalid_quantity" | "out_of_stock" | "cart_full" | "unique_limit" | "below_minimum" | "cart_changed" | "pixelverif_unavailable" }> {
  if (!isD1Mode()) return { ok: false, reason: "invalid_variant" };
  if (!Number.isSafeInteger(rawQty) || rawQty < 1 || rawQty > TELEGRAM_MAX_QTY) return { ok: false, reason: "invalid_quantity" };
  const variant = await getActiveVariant(variantId);
  if (!variant || variant.product_id !== productId) return { ok: false, reason: "invalid_variant" };
  // Pixel variants require the private 3-step credential flow first; a bare
  // add (stale button / direct call) must never create a credential-less line.
  if (variant.pixelverif_input && !(buyerFields?.pv_email && buyerFields?.pv_password && buyerFields?.pv_totp_secret)) {
    return { ok: false, reason: "pixelverif_unavailable" };
  }
  const stock = effectiveVariantStock(variant);
  if (stock === 0) return { ok: false, reason: "out_of_stock" };

  const minQty = Math.max(1, Math.floor(Number(minQtyRaw) || 1), Number(variant.min_qty) || 1);
  const existing = await queryFirst(
    `SELECT qty,buyer_fields FROM telegram_carts WHERE user_id=? AND variant_id=?`,
    userId, variantId,
  );
  if (!existing) {
    const count = await queryFirst(
      `SELECT COUNT(*) as n FROM telegram_carts WHERE user_id=?`,
      userId,
    );
    if (Number(count?.n || 0) >= MAX_LINES) return { ok: false, reason: "cart_full" };
    // Minimum pembelian: baris baru di bawah min langsung ditolak dengan
    // pesan jelas (bukan diam-diam dibulatkan naik — pembeli harus sadar
    // aturan "min. N", mis. GSuite 50).
    if (minQty > 1 && rawQty < minQty) {
      return { ok: false, reason: "below_minimum" };
    }
  }
  const nextQty = Number(existing?.qty || 0) + rawQty;
  let normalizedFields: BuyerFields;
  try {
    normalizedFields = validateBuyerFields(variant,buyerFields,nextQty);
    // Pixel credentials persist ONLY as an AES-GCM sealed blob (never plaintext).
    if (normalizedFields.pv_password) normalizedFields = await sealPixelverifCartFields(normalizedFields);
    const others = await queryAll("SELECT buyer_fields FROM telegram_carts WHERE user_id=?",userId);
    assertSameBuyerCode([...others.map(row => ({ buyer_fields:JSON.parse(String(row.buyer_fields ?? "{}")) as BuyerFields })),{ buyer_fields:buyerFields }]);
  } catch { return { ok:false,reason:"invalid_quantity" }; }
  if (!Number.isSafeInteger(nextQty) || nextQty > TELEGRAM_MAX_QTY) return { ok: false, reason: "invalid_quantity" };
  if (stock !== -1 && nextQty > stock) return { ok: false, reason: "out_of_stock" };
  if (variant.fulfillment_mode === "unique") {
    const other = await queryFirst(`SELECT COALESCE(SUM(c.qty),0) AS n FROM telegram_carts c JOIN product_variants pv ON pv.id=c.variant_id WHERE c.user_id=? AND c.variant_id!=? AND pv.fulfillment_mode='unique'`, userId, variantId);
    if (Number(other?.n || 0) + nextQty > MAX_UNIQUE_UNITS_PER_ORDER) return { ok: false, reason: "unique_limit" };
  }
  const result = await execRun(
    `WITH candidate AS (
       SELECT pv.id, pv.product_id, pv.stock, pv.fulfillment_mode, pv.min_qty,pv.max_qty,pv.buyer_field_key,
               COALESCE(c.qty,0)+? AS next_qty, c.id AS cart_id,
               (SELECT COUNT(*) FROM fulfillment_inventory fi
                WHERE fi.product_id=pv.product_id AND fi.variant_id=pv.id AND fi.status='available') AS inventory_available
        FROM product_variants pv JOIN products p ON p.id=pv.product_id AND p.is_active=1 AND p.telegram_enabled=1
       LEFT JOIN telegram_carts c ON c.user_id=? AND c.variant_id=pv.id
       WHERE pv.id=? AND pv.product_id=? AND pv.is_active=1 AND ${wrNewSaleSql("pv")}
     )
      INSERT INTO telegram_carts (user_id, product_id, variant_id, qty, buyer_fields, updated_at)
       SELECT ?, product_id, id, next_qty, ?, strftime('%Y-%m-%d %H:%M:%f','now') FROM candidate
       WHERE next_qty=CAST(next_qty AS INTEGER) AND next_qty>=MAX(1,min_qty,?) AND next_qty<=? AND (stock=-1 OR next_qty<=stock)
         AND (max_qty IS NULL OR next_qty<=max_qty) AND buyer_field_key IS ?
          AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM telegram_carts WHERE user_id=? AND json_extract(buyer_fields,'$.muse_invite_code') IS NOT NULL AND json_extract(buyer_fields,'$.muse_invite_code') IS NOT ?))
        AND (fulfillment_mode!='unique' OR next_qty<=inventory_available)
       AND (cart_id IS NOT NULL OR (SELECT COUNT(*) FROM telegram_carts WHERE user_id=?)<?)
       AND (fulfillment_mode!='unique' OR next_qty+(
         SELECT COALESCE(SUM(c.qty),0) FROM telegram_carts c
         JOIN product_variants pv ON pv.id=c.variant_id
         WHERE c.user_id=? AND c.variant_id!=candidate.id AND pv.fulfillment_mode='unique'
       )<=?)
      ON CONFLICT(user_id, variant_id) DO UPDATE SET product_id=excluded.product_id, qty=excluded.qty, updated_at=${CART_UPDATED_AT}`,
     rawQty, userId, variantId, productId,
       userId, JSON.stringify(normalizedFields), minQty, TELEGRAM_MAX_QTY,variant.buyer_field_key ?? null,normalizedFields.muse_invite_code ?? null,userId,normalizedFields.muse_invite_code ?? null, userId, MAX_LINES, userId, MAX_UNIQUE_UNITS_PER_ORDER,
  );
  return Number(result.changes || 0) > 0 ? { ok: true } : { ok: false, reason: "cart_changed" };
}

/** Absolute qty<=0 removes a line; relative changes use the durable qty in SQL. */
export async function setCartLineQty(userId: string, variantId: number, rawQty: number, relative = false): Promise<boolean> {
  if (!isD1Mode()) return false;
  if (!Number.isSafeInteger(rawQty) || (relative && rawQty !== -1 && rawQty !== 1)) return false;
  if (!relative && rawQty <= 0) {
    await execRun(`DELETE FROM telegram_carts WHERE user_id=? AND variant_id=?`, userId, variantId);
    return true;
  }
  const result = await execRun(
    `WITH candidate AS (
       SELECT id, product_id, ${relative ? "qty+?" : "?"} AS next_qty
       FROM telegram_carts WHERE user_id=? AND variant_id=?
     )
     UPDATE telegram_carts SET qty=(SELECT next_qty FROM candidate), updated_at=${CART_UPDATED_AT}
     WHERE id IN (
       SELECT c.id FROM candidate c JOIN product_variants pv ON pv.id=? AND pv.product_id=c.product_id AND pv.is_active=1 AND ${wrNewSaleSql("pv")}
       JOIN products p ON p.id=c.product_id AND p.is_active=1 AND p.telegram_enabled=1
        WHERE 1=1
          AND c.next_qty=CAST(c.next_qty AS INTEGER) AND c.next_qty>=MAX(1,pv.min_qty) AND c.next_qty<=? AND (pv.stock=-1 OR c.next_qty<=pv.stock)
          AND (pv.max_qty IS NULL OR c.next_qty<=pv.max_qty)
         AND (pv.fulfillment_mode!='unique' OR c.next_qty<=(
           SELECT COUNT(*) FROM fulfillment_inventory fi
           WHERE fi.product_id=pv.product_id AND fi.variant_id=pv.id AND fi.status='available'
         ))
         AND (pv.fulfillment_mode!='unique' OR c.next_qty+(
           SELECT COALESCE(SUM(other.qty),0) FROM telegram_carts other
           JOIN product_variants ov ON ov.id=other.variant_id
           WHERE other.user_id=? AND other.variant_id!=pv.id AND ov.fulfillment_mode='unique'
         )<=?)
     )`,
     rawQty, userId, variantId,
     variantId, TELEGRAM_MAX_QTY, userId, MAX_UNIQUE_UNITS_PER_ORDER,
  );
  return Number(result.changes || 0) > 0;
}

export async function removeFromCart(userId: string, variantId: number): Promise<void> {
  if (!isD1Mode()) return;
  await execRun(`DELETE FROM telegram_carts WHERE user_id=? AND variant_id=?`, userId, variantId).catch(() => {});
}

export async function clearCart(userId: string, purchased?: CartLine[]): Promise<void> {
  if (!isD1Mode()) return;
  if (purchased) {
    const snapshot = purchased.filter(line => line.cartId != null && line.cartUpdatedAt != null);
    if (!snapshot.length) return;
    await execRun(
      `DELETE FROM telegram_carts WHERE user_id=? AND (${snapshot.map(() =>
        "(id=? AND qty=? AND updated_at=?)").join(" OR ")})`,
      userId, ...snapshot.flatMap(line => [line.cartId!, line.qty, line.cartUpdatedAt!]),
    );
    return;
  }
  await execRun(`DELETE FROM telegram_carts WHERE user_id=?`, userId).catch(() => {});
}

/**
 * Baca keranjang + validasi harga/stok/varian terkini. Baris basi (varian
 * nonaktif/habis) dibersihkan otomatis agar checkout tidak pernah memakai
 * snapshot basi.
 *
 * Satu JOIN (issue #14): varian ikut diambil bersama baris keranjang agar
 * tidak ada N query getActiveVariant per baris (keranjang 20 baris = 21
 * query sebelumnya, kini 1 query).
 */
export async function getCartSummary(userId: string): Promise<CartSummary> {
  const lines: CartLine[] = [];
  const issues: string[] = [];
  if (!isD1Mode()) return { lines, subtotal: 0, totalQty: 0, issues };
    const rows = await queryAll(
    `SELECT c.id, c.updated_at, c.product_id, c.variant_id, c.qty,c.buyer_fields,pv.buyer_field_key,pv.max_qty, p.name as product_name,
            p.is_active AS product_active, p.telegram_enabled, p.pixelverif_family, pv.pixelverif_flow_type,
            pv.product_id AS v_product_id, pv.label AS v_label, pv.price AS v_price,
            pv.bulk_pricing_enabled AS v_bulk_enabled, pv.bulk_pricing_tiers AS v_bulk_tiers,
            p.source AS p_source, p.wr_product_id AS p_wr_product_id, p.wr_auto_managed AS p_wr_auto_managed,
            p.sk_product_id AS p_sk_product_id, p.sk_auto_managed AS p_sk_auto_managed,
            pv.stock AS v_stock, pv.fulfillment_mode AS v_mode, pv.is_active AS v_active,
            pv.min_qty AS v_min_qty, pv.wr_variant_id, pv.sk_variant_id, sp.sk_description AS sk_description,
            pv.duration_label, pv.duration_value, pv.duration_unit,
            (SELECT COUNT(*) FROM fulfillment_inventory fi
             WHERE fi.product_id=pv.product_id AND fi.variant_id=pv.id AND fi.status='available') AS inventory_available
     FROM telegram_carts c
     LEFT JOIN products p ON p.id=c.product_id
     LEFT JOIN product_variants pv ON pv.id=c.variant_id AND pv.is_active=1 AND ${wrNewSaleSql("pv")}
     LEFT JOIN sk_products sp ON sp.sk_variant_id = pv.sk_variant_id
     WHERE c.user_id=?
     ORDER BY c.updated_at ASC, c.id ASC
     LIMIT ?`,
    userId, MAX_LINES + 1,
  );
  if (rows.length > MAX_LINES) issues.push(`Keranjang berisi lebih dari ${MAX_LINES} varian. Hapus varian sebelum melanjutkan.`);
  const staleRows: typeof rows = [];
  // TG2b: tier dihitung dari AGREGAT qty per varian (satu varian = satu
  // harga, alias ikut), bukan per baris keranjang.
  const aggregateQty = new Map<number, number>();
  for (const row of rows) {
    const variantId = Number(row.variant_id);
    aggregateQty.set(variantId, (aggregateQty.get(variantId) ?? 0) + Number(row.qty || 0));
  }
  for (const row of rows) {
    const variantId = Number(row.variant_id);
    const variantActive = Number(row.v_active ?? 0) === 1;
    const fulfillmentMode = String(row.v_mode || "manual");
    const variantStock = row.v_stock == null ? null : effectiveVariantStock({
      stock: Number(row.v_stock), fulfillment_mode: fulfillmentMode,
      inventory_available: Number(row.inventory_available),
    });
    const productName = String(row.product_name || "Produk");
    const variantLabel = formatVariantLabel({
      label: String(row.v_label || ""), wr_variant_id: row.wr_variant_id,
      sk_variant_id: row.sk_variant_id,
      sk_description: row.sk_description == null ? null : String(row.sk_description),
      duration_label: row.duration_label == null ? null : String(row.duration_label),
      duration_value: row.duration_value == null ? null : Number(row.duration_value),
      duration_unit: row.duration_unit as VariantSummary["duration_unit"],
    });
    const label = `${productName} / ${variantLabel}`;
    if (!variantActive || Number(row.product_active) !== 1 || Number(row.telegram_enabled) !== 1
      || variantStock == null || Number(row.v_product_id) !== Number(row.product_id) || variantStock === 0) {
      staleRows.push(row);
      issues.push(`${label} tidak tersedia. Periksa keranjang sebelum melanjutkan.`);
      continue;
    }
    const minQty = Math.max(1, Number(row.v_min_qty ?? 1) || 1);
    const qty = Number(row.qty);
    let fields: BuyerFields = {};
    try {
      const stored = validateBuyerFields(row,JSON.parse(String(row.buyer_fields ?? "{}")),qty);
      // Sealed blob -> plaintext only in memory for checkout approval/sealing.
      fields = stored.pv_sealed_ciphertext ? await unsealPixelverifCartFields(stored) : stored;
      if (fields.pv_email) {
        const { isPixelverifEmailBlocked, PIXELVERIF_BLOCKED_EMAIL_MESSAGE } = await import("@/lib/pixelverif/blocklist");
        if (await isPixelverifEmailBlocked(fields.pv_email, Number(row.pixelverif_validity) || 3)) issues.push(`${label}: ${PIXELVERIF_BLOCKED_EMAIL_MESSAGE} Hapus baris ini lalu ulangi dari katalog.`);
      }
    }
    catch { issues.push(row.pixelverif_flow_type != null ? `${label}: data akun Google tidak terbaca. Hapus baris ini lalu ulangi dari katalog.` : `${label}: periksa jumlah dan Kode Invite Muse melalui chat pribadi.`); }
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > TELEGRAM_MAX_QTY) {
      issues.push(`${label}: jumlah tidak valid. Pilih jumlah bulat 1 sampai ${TELEGRAM_MAX_QTY}.`);
    }
    if (qty < minQty) issues.push(`${label} minimal ${minQty}, jumlah saat ini ${qty}. Ubah jumlah di keranjang.`);
    if (variantStock !== -1 && qty > variantStock) issues.push(`${label}: stok tersedia ${variantStock}, jumlah saat ini ${qty}. Kurangi jumlah di keranjang.`);
    // TG2b: harga efektif dari bulk config aktif; enabled=0 mengabaikan
    // tiers basi; config rusak gagal tertutup (baris basi, checkout ditolak).
    const basePrice = Number(row.v_price);
    let effectivePrice = basePrice;
    let appliedTier: number | null = null;
    try {
      const resolved = resolveBulkPriceForProduct(basePrice, aggregateQty.get(variantId) ?? qty, row.v_bulk_enabled, String(row.v_bulk_tiers ?? "[]"), bulkOwnerFromJoinedRow(row));
      effectivePrice = resolved.price;
      appliedTier = resolved.tier ?? null;
    } catch {
      staleRows.push(row);
      issues.push(`${label} tidak tersedia. Periksa keranjang sebelum melanjutkan.`);
      continue;
    }
    lines.push({
      buyerFields:fields,
      buyerFieldKey:row.buyer_field_key === "muse_invite_code" ? "muse_invite_code" : null,
      pixelverifInput: row.pixelverif_flow_type != null,
      maxQty:row.max_qty == null ? null : Number(row.max_qty),
      productId: Number(row.product_id),
      variantId,
      qty,
      productName,
      variantLabel,
      price: effectivePrice,
      basePrice,
      appliedTierMinQty: appliedTier,
      stock: variantStock,
      fulfillmentMode,
      minQty,
      cartId: Number(row.id),
      cartUpdatedAt: String(row.updated_at),
    });
  }
  // Hapus baris basi dalam 1 query (bukan N DELETE per baris).
  if (staleRows.length > 0) {
    await execRun(
      `DELETE FROM telegram_carts WHERE user_id=? AND (${staleRows.map(() => "(id=? AND qty=? AND updated_at=?)").join(" OR ")})
       AND NOT EXISTS (
        SELECT 1 FROM product_variants pv JOIN products p ON p.id=pv.product_id AND p.is_active=1 AND p.telegram_enabled=1
         WHERE pv.id=telegram_carts.variant_id AND pv.product_id=telegram_carts.product_id
          AND pv.is_active=1 AND pv.stock!=0 AND ${wrNewSaleSql("pv")}
          AND (pv.fulfillment_mode!='unique' OR EXISTS (
            SELECT 1 FROM fulfillment_inventory fi
            WHERE fi.product_id=pv.product_id AND fi.variant_id=pv.id AND fi.status='available'
          ))
       )`,
      userId, ...staleRows.flatMap(row => [row.id, row.qty, row.updated_at]),
    ).catch(() => {});
  }
  if (lines.filter(line => line.fulfillmentMode === "unique").reduce((sum, line) => sum + line.qty, 0) > MAX_UNIQUE_UNITS_PER_ORDER) {
    issues.push(`Maksimal ${MAX_UNIQUE_UNITS_PER_ORDER} akun stok unik per pesanan. Kurangi jumlah di keranjang.`);
  }
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  try { assertSameBuyerCode(lines.map(line => ({ buyer_fields:line.buyerFields }))); } catch { issues.push("Gunakan satu Kode Invite Muse per checkout."); }
  const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);
  return { lines, subtotal, totalQty, issues };
}
