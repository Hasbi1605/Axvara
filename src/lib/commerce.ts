// src/lib/commerce.ts — Channel-agnostic commerce operations
// Shared between web, Telegram, and WhatsApp for order creation,
// stock reservation, and payment management.

import {
  queryFirst,
  queryAll,
  isD1Mode,
  getD1,
  StockReservationError,
  D1Statement,
} from "@/lib/db";
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
  idempotencyKey: string; // deterministic key, e.g. wa:pay:<conversationId>:<memberId>:<variantId>
};

export type PendingOrder = {
  code: string;
  orderId: number;
  subtotal: number;
  isExisting?: boolean;
};

/**
 * Creates a pending channel order with atomic stock reservation.
 * If an order already exists with the same idempotency key (stored in quote_id),
 * it returns the existing order idempotently without re-decrementing stock.
 */
export async function createPendingChannelOrder(input: ChannelOrderInput): Promise<PendingOrder> {
  // 1. Idempotency check: look for existing pending or active order with this key
  if (isD1Mode()) {
    const existing = await queryFirst(
      `SELECT id, code, subtotal, status FROM orders WHERE quote_id=?`,
      input.idempotencyKey,
    );
    if (existing) {
      return {
        code: String(existing.code),
        orderId: Number(existing.id),
        subtotal: Number(existing.subtotal),
        isExisting: true,
      };
    }
  }

  // 2. Re-validate variant against D1
  const variant = await getActiveVariant(input.variantId);
  if (!variant) throw new Error("variant_unavailable");
  if (variant.stock === 0) throw new Error("out_of_stock");
  if (variant.price !== input.variant.price) throw new Error("price_changed");
  if (variant.product_id !== input.productId) throw new Error("variant_product_mismatch");

  const orderCode = generateOrderCode();
  const items = [
    {
      product_id: input.productId,
      variant_id: input.variantId,
      name: `${input.productName} — ${variant.label}`,
      variant_label: variant.label,
      price: variant.price,
      qty: 1,
    },
  ];

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

  const d1 = getD1();
  if (d1) {
    const guardId = `${input.idempotencyKey}:stock:${input.variantId}`;
    const statements: D1Statement[] = [
      // 1. Guard check: ensures variant is active and has stock
      d1.prepare(
        `INSERT INTO operation_guards (operation_id, valid)
         SELECT ?, CASE WHEN EXISTS(
           SELECT 1 FROM product_variants WHERE id=? AND is_active=1 AND (stock=-1 OR stock>=1)
         ) THEN 1 ELSE 0 END`,
      ).bind(guardId, input.variantId),

      // 2. Decrement variant stock
      d1.prepare(
        `UPDATE product_variants
         SET stock = CASE WHEN stock=-1 THEN -1 ELSE stock-1 END,
             updated_at = datetime('now')
         WHERE id=?`,
      ).bind(input.variantId),

      // 3. Insert order
      d1.prepare(
        `INSERT INTO orders (
           code, customer_name, customer_wa, customer_email, items, subtotal,
           payment_method, payment_account, proof_url, status, sales_channel,
           channel_conversation_id, channel_member_id, telegram_chat_id, telegram_user_id,
           payment_status, fulfillment_status, variant_id, variant_snapshot,
           quote_id, expires_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','+24 hours'))`,
      ).bind(
        orderCode,
        input.customerName,
        input.customerWa || "",
        input.customerEmail || null,
        JSON.stringify(items),
        variant.price,
        "pending",
        "",
        null,
        "pending",
        input.salesChannel,
        input.conversationId || null,
        input.customerId,
        input.salesChannel === "telegram" ? input.conversationId || null : null,
        input.salesChannel === "telegram" ? input.customerId : null,
        "pending",
        "not_required",
        input.variantId,
        variantSnapshot,
        input.idempotencyKey,
      ),

      // 4. Cleanup guard
      d1.prepare(`DELETE FROM operation_guards WHERE operation_id=?`).bind(guardId),
    ];

    try {
      const results = await d1.batch(statements);
      // Find the lastInsertRowid from insert statement (index 2)
      const orderInsertResult = results[2];
      const orderId = orderInsertResult?.meta?.last_row_id ?? 0;

      return {
        code: orderCode,
        orderId,
        subtotal: variant.price,
        isExisting: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/operation_guards|CHECK constraint/i.test(message)) {
        throw new StockReservationError();
      }
      // If quote_id UNIQUE constraint conflict occurred due to concurrent call:
      if (/UNIQUE constraint failed: orders\.quote_id/i.test(message)) {
        const raceWinner = await queryFirst(
          `SELECT id, code, subtotal FROM orders WHERE quote_id=?`,
          input.idempotencyKey,
        );
        if (raceWinner) {
          return {
            code: String(raceWinner.code),
            orderId: Number(raceWinner.id),
            subtotal: Number(raceWinner.subtotal),
            isExisting: true,
          };
        }
      }
      throw error;
    }
  }

  // In-memory fallback (development without D1)
  return {
    code: orderCode,
    orderId: 1,
    subtotal: variant.price,
    isExisting: false,
  };
}

// Fetch active payment methods for WhatsApp / Web display
export async function getActivePaymentMethods(): Promise<{
  qris: { url: string; name: string } | null;
  seabank: { account: string; name: string } | null;
  ewallet: { account: string; name: string } | null;
}> {
  const methods = await queryAll(`SELECT * FROM payment_methods WHERE is_active=1 ORDER BY sort_order ASC`);

  const qris = methods.find((m) => String(m.id) === "qris");
  const seabank = methods.find((m) => String(m.id) === "seabank");
  const ewallet = methods.find((m) => String(m.id) === "ewallet");

  return {
    qris: qris?.qris_url ? { url: String(qris.qris_url), name: String(qris.account_name || "AXVARA") } : null,
    seabank: seabank?.account_number ? { account: String(seabank.account_number), name: String(seabank.account_name || "") } : null,
    ewallet: ewallet?.account_number ? { account: String(ewallet.account_number), name: String(ewallet.account_name || "") } : null,
  };
}
