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
  paymentMethod?: string;
  paymentAccount?: string;
};

export type PendingOrder = {
  code: string;
  orderId: number;
  subtotal: number;
  isExisting?: boolean;
};

type PendingOrderState = {
  status?: unknown;
  payment_status?: unknown;
  expires_at?: unknown;
};

export type PaymentDisplaySnapshot = {
  productName: string;
  variantLabel: string;
  duration: string;
  warranty: string;
};

/** Read immutable buyer-facing labels captured when the order was created. */
export function parsePaymentDisplaySnapshot(raw: unknown): PaymentDisplaySnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    const variantLabel = String(parsed.label || "").trim();
    if (!variantLabel) return null;
    return {
      productName: String(parsed.product_name || "").trim(),
      variantLabel,
      duration: String(parsed.duration_label || "").trim(),
      warranty: String(parsed.warranty_label || "").trim(),
    };
  } catch {
    return null;
  }
}

/**
 * One gateway inbox event maps to one order attempt. A later payment-method
 * message gets a different inbox id, so the same member can buy it again.
 */
export function buildWhatsAppOrderIdempotencyKey(
  conversationId: string,
  memberId: string,
  inboxId: string,
  variantId: number,
): string {
  const eventId = inboxId.trim();
  if (!eventId) throw new Error("missing_whatsapp_inbox_id");
  return ["wa", "order", conversationId, memberId, eventId, String(variantId)]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

export function isReusablePendingOrder(order: PendingOrderState, now = Date.now()): boolean {
  if (String(order.status || "") !== "pending") return false;
  if (!["unpaid", "pending"].includes(String(order.payment_status || ""))) return false;
  if (!order.expires_at) return true;
  const expiresAt = Date.parse(String(order.expires_at));
  return Number.isFinite(expiresAt) && expiresAt > now;
}

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
    product_name: input.productName,
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
    const needsUniqueInventory = variant.fulfillment_mode === "unique";
    const statements: D1Statement[] = [
      // 1. Guard check: variant stock and, for unique delivery, one matching
      // encrypted inventory item must both be available.
      d1.prepare(
        `INSERT INTO operation_guards (operation_id, valid)
         SELECT ?, CASE WHEN EXISTS(
           SELECT 1 FROM product_variants
           WHERE id=? AND is_active=1 AND (stock=-1 OR stock>=1)
             AND (
               fulfillment_mode!='shared'
               OR (shared_secret_ciphertext IS NOT NULL AND shared_secret_iv IS NOT NULL)
             )
         ) AND (
           ? != 'unique' OR EXISTS(
             SELECT 1 FROM fulfillment_inventory
             WHERE product_id=? AND status='available' AND (variant_id=? OR variant_id IS NULL)
           )
         ) THEN 1 ELSE 0 END`,
      ).bind(guardId, input.variantId, variant.fulfillment_mode, input.productId, input.variantId),

      // 2. Decrement variant stock
      d1.prepare(
        `UPDATE product_variants
         SET stock = CASE WHEN stock=-1 THEN -1 ELSE stock-1 END,
             updated_at = datetime('now')
         WHERE id=?`,
      ).bind(input.variantId),

    ];

    if (needsUniqueInventory) {
      statements.push(
        d1.prepare(
          `UPDATE fulfillment_inventory
           SET status='reserved', order_code=?, reserved_at=datetime('now')
           WHERE id=(
             SELECT id FROM fulfillment_inventory
             WHERE product_id=? AND status='available' AND (variant_id=? OR variant_id IS NULL)
             ORDER BY CASE WHEN variant_id=? THEN 0 ELSE 1 END, id ASC
             LIMIT 1
           ) AND status='available'`,
        ).bind(orderCode, input.productId, input.variantId, input.variantId),
      );
    }

    const orderInsertIndex = statements.length;
    statements.push(
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
        input.paymentMethod || "pending",
        input.paymentAccount || "",
        null,
        "pending",
        input.salesChannel,
        input.conversationId || null,
        input.customerId,
        input.salesChannel === "telegram" ? input.conversationId || null : null,
        input.salesChannel === "telegram" ? input.customerId : null,
        "pending",
        needsUniqueInventory ? "reserved" : "not_required",
        input.variantId,
        variantSnapshot,
        input.idempotencyKey,
      ),
      // 4. Cleanup guard
      d1.prepare(`DELETE FROM operation_guards WHERE operation_id=?`).bind(guardId),
    );

    try {
      const results = await d1.batch(statements);
      const orderInsertResult = results[orderInsertIndex];
      const orderId = orderInsertResult?.meta?.last_row_id ?? 0;

      return {
        code: orderCode,
        orderId,
        subtotal: variant.price,
        isExisting: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A concurrent retry can collide on either the order quote or the stock
      // guard. Check for its committed winner before classifying the error.
      if (/UNIQUE|operation_guards|CHECK constraint/i.test(message)) {
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
      if (/operation_guards|CHECK constraint/i.test(message)) {
        throw new StockReservationError();
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
  qris: { name: string } | null;
  seabank: { account: string; name: string } | null;
  ewallet: { account: string; name: string } | null;
}> {
  const methods = await queryAll(`SELECT * FROM payment_methods WHERE is_active=1 ORDER BY sort_order ASC`);

  const qris = methods.find((m) => String(m.id) === "qris");
  const seabank = methods.find((m) => String(m.id) === "seabank");
  const ewallet = methods.find((m) => String(m.id) === "ewallet");

  return {
    qris: qris ? { name: String(qris.account_name || "DANA Business") } : null,
    seabank: seabank?.account_number ? { account: String(seabank.account_number), name: String(seabank.account_name || "") } : null,
    ewallet: ewallet?.account_number ? { account: String(ewallet.account_number), name: String(ewallet.account_name || "") } : null,
  };
}
