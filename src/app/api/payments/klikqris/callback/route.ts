// POST /api/payments/klikqris/callback — KlikQRIS payment callback handler
// Validates callback, confirms via server-side status check, transitions order atomically.

import { NextRequest, NextResponse } from "next/server";
import {
  queryFirst,
  transitionPendingPaymentOrder,
  transitionPendingPaymentToPaid,
} from "@/lib/db";
import { getPaymentProvider, isPaymentEnabled } from "@/lib/payments/klikqris";
import { ensureFulfillmentForPaidOrder } from "@/lib/fulfillment/deliver";
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
      // Older deployments updated the transaction and order separately. Repair
      // that split-brain state only after re-confirming it with the provider.
      const orderState = await queryFirst(
        `SELECT status, payment_status FROM orders WHERE code=?`,
        orderCode,
      );
      const legacyOrderStillPending = String(orderState?.status) === "pending"
        && ["unpaid", "pending"].includes(String(orderState?.payment_status));
      let repaired = false;
      if (legacyOrderStillPending) {
        let confirmedPaidAt = callback.paidAt ?? null;
        try {
          const statusCheck = await provider.checkStatus(
            callback.providerOrderId,
            String(tx.merchant_id),
          );
          if (!statusCheck.success || statusCheck.status !== "paid") {
            return NextResponse.json({ error: "status_not_confirmed" }, { status: 422 });
          }
          if (statusCheck.amountPaid !== undefined && Number(tx.payable_amount) !== statusCheck.amountPaid) {
            return NextResponse.json({ error: "amount_mismatch" }, { status: 422 });
          }
          confirmedPaidAt = statusCheck.paidAt ?? confirmedPaidAt;
        } catch {
          return NextResponse.json({ error: "status_confirmation_unavailable" }, { status: 503 });
        }
        repaired = await transitionPendingPaymentToPaid(orderCode, confirmedPaidAt);
      }
      try {
        await ensureFulfillmentForPaidOrder(orderCode);
      } catch { /* Retry remains safe and idempotent. */ }
      return NextResponse.json({ ok: true, status: repaired ? "paid_order_repaired" : "already_processed" });
    }
    if (currentStatus !== "pending") {
      return NextResponse.json({ error: "invalid_transition" }, { status: 409 });
    }

    // Validate amount
    if (callback.amountPaid !== undefined && Number(tx.payable_amount) !== callback.amountPaid) {
      return NextResponse.json({ error: "amount_mismatch" }, { status: 400 });
    }

    // Server-side status confirmation
    let confirmedPaidAt: string | null = callback.paidAt ?? null;
    try {
      const statusCheck = await provider.checkStatus(
        callback.providerOrderId,
        String(tx.merchant_id),
      );
      if (!statusCheck.success || statusCheck.status !== "paid") {
        return NextResponse.json({ error: "status_not_confirmed" }, { status: 422 });
      }
      if (statusCheck.amountPaid !== undefined && Number(tx.payable_amount) !== statusCheck.amountPaid) {
        return NextResponse.json({ error: "amount_mismatch" }, { status: 422 });
      }
      confirmedPaidAt = statusCheck.paidAt ?? confirmedPaidAt;
    } catch {
      // A callback alone is not sufficient payment authority. Returning 503
      // lets the provider retry while reconciliation independently rechecks it.
      return NextResponse.json({ error: "status_confirmation_unavailable" }, { status: 503 });
    }

    const transitioned = await transitionPendingPaymentToPaid(orderCode, confirmedPaidAt);
    if (!transitioned) {
      return NextResponse.json({ ok: true, status: "already_processed" });
    }

    try {
      await ensureFulfillmentForPaidOrder(orderCode);
    } catch { /* Durable job/reconciliation will retry fulfillment. */ }

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

    const order = await queryFirst(`SELECT items, telegram_chat_id FROM orders WHERE code=?`, orderCode);
    if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });
    let items: { product_id: number; variant_id?: number; qty: number }[];
    try {
      items = JSON.parse(String(order.items ?? "[]"));
    } catch {
      return NextResponse.json({ error: "invalid_order_snapshot" }, { status: 500 });
    }
    const transitioned = await transitionPendingPaymentOrder({
      orderCode,
      expectedTransactionStatus: "pending",
      transactionStatus: "expired",
      orderStatus: "kadaluarsa",
      paymentStatus: "expired",
      items,
    });
    if (!transitioned) {
      return NextResponse.json({ ok: true, status: "already_expired" });
    }

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
    const order = await queryFirst(`SELECT items FROM orders WHERE code=?`, orderCode);
    if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });
    let items: { product_id: number; variant_id?: number; qty: number }[];
    try {
      items = JSON.parse(String(order.items ?? "[]"));
    } catch {
      return NextResponse.json({ error: "invalid_order_snapshot" }, { status: 500 });
    }
    await transitionPendingPaymentOrder({
      orderCode,
      expectedTransactionStatus: "pending",
      transactionStatus: "failed",
      orderStatus: "dibatalkan",
      paymentStatus: "failed",
      items,
      lastError: "provider_failed",
    });
    return NextResponse.json({ ok: true, status: "failed" });
  }

  return NextResponse.json({ ok: true, status: "unhandled" });
}
