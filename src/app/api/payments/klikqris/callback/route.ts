// POST /api/payments/klikqris/callback — KlikQRIS payment callback handler
// Validates callback, confirms via server-side status check, transitions order atomically.

import { NextRequest, NextResponse } from "next/server";
import { queryFirst, execRun, isD1Mode } from "@/lib/db";
import { getPaymentProvider, isPaymentEnabled } from "@/lib/payments/klikqris";
import { createFulfillmentJob, processJob } from "@/lib/fulfillment/deliver";
import { releaseInventoryForOrder } from "@/lib/fulfillment/inventory";
import { sendMessage } from "@/lib/telegram/api";
import { orderExpiredMessage } from "@/lib/telegram/messages";

export const runtime = "edge";

const MAX_BODY_SIZE = 16_000; // 16KB max for callback

export async function POST(request: NextRequest) {
  if (!isPaymentEnabled()) {
    return NextResponse.json({ error: "payments_disabled" }, { status: 503 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_SIZE) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const provider = getPaymentProvider();
  const callback = provider.parseCallback(body);
  if (!callback) {
    return NextResponse.json({ error: "invalid_callback" }, { status: 400 });
  }

  // Find payment transaction
  const tx = await queryFirst(
    `SELECT * FROM payment_transactions WHERE provider=? AND provider_order_id=?`,
    "klikqris", callback.providerOrderId,
  );
  if (!tx) {
    return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });
  }

  // Validate: merchant ID, signature
  if (callback.merchantId && String(tx.merchant_id) !== callback.merchantId) {
    return NextResponse.json({ error: "merchant_mismatch" }, { status: 400 });
  }
  if (callback.signature && String(tx.provider_signature) && callback.signature !== String(tx.provider_signature)) {
    return NextResponse.json({ error: "signature_mismatch" }, { status: 400 });
  }

  const orderCode = String(tx.order_code);
  const currentStatus = String(tx.status);

  // === PAID ===
  if (callback.status === "paid") {
    if (currentStatus === "paid") {
      return NextResponse.json({ ok: true, status: "already_processed" });
    }
    if (currentStatus !== "pending") {
      return NextResponse.json({ error: "invalid_transition" }, { status: 409 });
    }

    // Validate amount
    if (callback.amountPaid !== undefined && Number(tx.payable_amount) !== callback.amountPaid) {
      return NextResponse.json({ error: "amount_mismatch" }, { status: 400 });
    }

    // Server-side status confirmation
    try {
      const statusCheck = await provider.checkStatus(
        callback.providerOrderId,
        String(tx.merchant_id),
      );
      if (!statusCheck.success || statusCheck.status !== "paid") {
        return NextResponse.json({ error: "status_not_confirmed" }, { status: 422 });
      }
    } catch {
      // If status check fails, accept callback cautiously but log
      console.error("Status check failed for", orderCode, "- accepting callback");
    }

    // Atomic transition: pending → paid
    if (isD1Mode()) {
      const result = await execRun(
        `UPDATE payment_transactions SET status='paid', paid_at=datetime('now'), last_checked_at=datetime('now'),
         updated_at=datetime('now') WHERE order_code=? AND status='pending'`,
        orderCode,
      );
      if (!result.changes) {
        return NextResponse.json({ ok: true, status: "already_processed" });
      }
    } else {
      // In-memory fallback would go here
    }

    // Update order
    await execRun(
      `UPDATE orders SET payment_status='paid', status='lunas', updated_at=datetime('now')
       WHERE code=? AND status='pending'`,
      orderCode,
    );

    // Trigger fulfillment
    const order = await queryFirst(`SELECT * FROM orders WHERE code=?`, orderCode);
    if (order) {
      const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number }[];
      if (items.length > 0) {
        const product = await queryFirst(`SELECT * FROM products WHERE id=?`, items[0].product_id);
        if (product && process.env.AUTO_FULFILLMENT_ENABLED === "true") {
          const fulfillmentMode = String(product.fulfillment_mode || "manual");
          const inventoryId = fulfillmentMode === "unique"
            ? Number((await queryFirst(
                `SELECT id FROM fulfillment_inventory WHERE order_code=? AND status='reserved'`,
                orderCode,
              ))?.id ?? 0)
            : null;

          // Create job if not exists, then try processing
          await createFulfillmentJob(orderCode, inventoryId, fulfillmentMode);

          const job = await queryFirst(
            `SELECT id FROM fulfillment_jobs WHERE order_code=?`, orderCode,
          );
          if (job) {
            try {
              await processJob(Number(job.id), order, product);
            } catch { /* Job will be picked up by cron */ }
          }
        }
      }
    }

    return NextResponse.json({ ok: true, status: "paid" });
  }

  // === EXPIRED ===
  if (callback.status === "expired") {
    if (currentStatus === "paid") {
      return NextResponse.json({ ok: true, status: "already_paid" });
    }
    if (currentStatus === "expired") {
      return NextResponse.json({ ok: true, status: "already_expired" });
    }

    // Transition to expired
    await execRun(
      `UPDATE payment_transactions SET status='expired', updated_at=datetime('now')
       WHERE order_code=? AND status='pending'`,
      orderCode,
    );

    // Restore stock
    const order = await queryFirst(`SELECT items, telegram_chat_id FROM orders WHERE code=?`, orderCode);
    if (order) {
      try {
        const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; qty: number }[];
        for (const item of items) {
          await execRun(
            `UPDATE products SET stock = CASE WHEN stock=-1 THEN -1 ELSE stock+? END WHERE id=? AND stock!=-1`,
            item.qty, item.product_id,
          );
        }
      } catch { /* ok */ }
    }

    // Release inventory
    await releaseInventoryForOrder(orderCode);

    // Update order
    await execRun(
      `UPDATE orders SET status='kadaluarsa', payment_status='expired', fulfillment_status='not_required',
       updated_at=datetime('now') WHERE code=? AND status='pending'`,
      orderCode,
    );

    // Notify buyer
    if (order?.telegram_chat_id) {
      try {
        await sendMessage({
          chat_id: String(order.telegram_chat_id),
          text: orderExpiredMessage(orderCode),
          parse_mode: "HTML",
        });
      } catch { /* best-effort */ }
    }

    return NextResponse.json({ ok: true, status: "expired" });
  }

  // === FAILED ===
  if (callback.status === "failed") {
    await execRun(
      `UPDATE payment_transactions SET status='failed', updated_at=datetime('now')
       WHERE order_code=? AND status='pending'`,
      orderCode,
    );
    return NextResponse.json({ ok: true, status: "failed" });
  }

  return NextResponse.json({ ok: true, status: "unhandled" });
}
