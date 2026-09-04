// src/lib/commerce.ts — Channel-agnostic commerce operations
// Shared between web, Telegram, and WhatsApp for order creation,
// stock reservation, and payment management.

import { queryFirst, queryAll, execRun, isD1Mode } from "@/lib/db";
import { getActiveVariant, type VariantSummary, formatDuration, formatWarranty } from "@/lib/catalog";
import { generateOrderCode } from "@/lib/security";

export type ChannelOrderInput = {
  salesChannel: "web" | "telegram" | "whatsapp";
  productId: number;
  productName: string;
  variantId: number;
  variant: VariantSummary;
  customerId: string; // member_id for WA, user_id for TG, customer_name for web
  customerName: string;
  customerWa?: string;
  customerEmail?: string;
  conversationId?: string; // group/chat ID
  idempotencyKey?: string;
};

export type PendingOrder = {
  code: string;
  orderId: number;
  subtotal: number;
};

export async function createPendingChannelOrder(input: ChannelOrderInput): Promise<PendingOrder> {
  // Check for existing pending order with same selection for idempotency
  if (input.idempotencyKey && isD1Mode()) {
    const existing = await queryFirst(
      `SELECT id, code, subtotal FROM orders WHERE quote_id=? AND status='pending'`,
      input.idempotencyKey
    );
    if (existing) {
      return {
        code: String(existing.code),
        orderId: Number(existing.id),
        subtotal: Number(existing.subtotal),
      };
    }
  }

  // Re-validate variant
  const variant = await getActiveVariant(input.variantId);
  if (!variant) throw new Error("variant_unavailable");
  if (variant.stock === 0) throw new Error("out_of_stock");
  if (variant.price !== input.variant.price) throw new Error("price_changed");

  const orderCode = generateOrderCode();
  const items = [{
    product_id: input.productId,
    variant_id: input.variantId,
    name: input.productName,
    variant_label: input.variant.label,
    price: variant.price,
    qty: 1,
  }];

  // Variant snapshot for order history
  const variantSnapshot = JSON.stringify({
    variant_id: input.variantId,
    sku: variant.sku,
    label: variant.label,
    duration_value: variant.duration_value,
    duration_unit: variant.duration_unit,
    duration_label: formatDuration(variant),
    warranty_type: variant.warranty_type,
    warranty_value: variant.warranty_value,
    warranty_unit: variant.warranty_unit,
    warranty_label: formatWarranty(variant),
    price: variant.price,
    fulfillment_mode: variant.fulfillment_mode,
  });

  if (isD1Mode()) {
    // Decrement variant stock
    if (variant.stock !== -1) {
      const stockResult = await execRun(
        `UPDATE product_variants SET stock = stock - 1, updated_at = datetime('now')
         WHERE id=? AND is_active=1 AND stock >= 1`,
        input.variantId
      );
      if (!stockResult.changes) throw new Error("out_of_stock");
    }

    // Insert order
    const result = await execRun(
      `INSERT INTO orders (code, customer_name, customer_wa, customer_email, items, subtotal,
         payment_method, payment_account, proof_url, status, sales_channel,
         telegram_chat_id, telegram_user_id, payment_status, fulfillment_status,
         variant_id, variant_snapshot, quote_id, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','+24 hours'))`,
      orderCode,
      input.customerName,
      input.customerWa || "",
      input.customerEmail || null,
      JSON.stringify(items),
      variant.price,
      "pending", // payment_method set after payment
      "",
      null,
      "pending",
      input.salesChannel,
      input.conversationId || null,
      input.customerId,
      "pending",
      "not_required",
      input.variantId,
      variantSnapshot,
      input.idempotencyKey || orderCode,
    );

    return {
      code: orderCode,
      orderId: Number(result.lastInsertRowid),
      subtotal: variant.price,
    };
  }

  throw new Error("D1 required for order creation");
}

// Fetch active payment methods for WhatsApp display
export async function getActivePaymentMethods(): Promise<{
  qris: { url: string; name: string } | null;
  seabank: { account: string; name: string } | null;
  ewallet: { account: string; name: string } | null;
}> {
  const methods = await queryAll(`SELECT * FROM payment_methods WHERE is_active=1`);

  const qris = methods.find(m => String(m.id) === "qris");
  const seabank = methods.find(m => String(m.id) === "seabank");
  const ewallet = methods.find(m => String(m.id) === "ewallet");

  return {
    qris: qris?.qris_url ? { url: String(qris.qris_url), name: String(qris.account_name || "AXVARA") } : null,
    seabank: seabank?.account_number ? { account: String(seabank.account_number), name: String(seabank.account_name || "") } : null,
    ewallet: ewallet?.account_number ? { account: String(ewallet.account_number), name: String(ewallet.account_name || "") } : null,
  };
}
