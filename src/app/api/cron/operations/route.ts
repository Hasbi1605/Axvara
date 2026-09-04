// POST /api/cron/operations — Reconciliation cron for payments and fulfillment
// Called by MCP Worker cron every 5 minutes. Handles:
// 1. Stale initializing payments
// 2. Expired payments/orders
// 3. Missed callback recovery via status check
// 4. Due fulfillment jobs
// 5. Stale job locks

import { NextRequest, NextResponse } from "next/server";
import {
  queryAll,
  queryFirst,
  execRun,
  transitionPendingOrder,
  transitionPendingPaymentOrder,
  transitionPendingPaymentToPaid,
} from "@/lib/db";
import { getPaymentProvider, isPaymentEnabled } from "@/lib/payments/klikqris";
import {
  ensureFulfillmentForPaidOrder,
  getDueJobs,
  processJob,
  releaseStaleJobs,
} from "@/lib/fulfillment/deliver";
import { sendMessage } from "@/lib/telegram/api";
import { orderExpiredMessage } from "@/lib/telegram/messages";

export const runtime = "edge";

const BATCH_LIMIT = 25;

export async function POST(request: NextRequest) {
  // Auth: cron secret
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {
    stale_initializing: 0,
    expired_payments: 0,
    recovered_payments: 0,
    due_jobs_processed: 0,
    stale_locks_released: 0,
    expired_static_whatsapp_orders: 0,
    whatsapp_rows_cleaned: 0,
  };

  try {
    // 1. Stale initializing payments (older than 5 minutes)
    const staleInit = await queryAll(
      `SELECT order_code FROM payment_transactions
       WHERE status='initializing' AND created_at < datetime('now', '-5 minutes')
       LIMIT ?`,
      BATCH_LIMIT,
    );
    let staleTransitions = 0;
    for (const tx of staleInit) {
      const order = await queryFirst(`SELECT items FROM orders WHERE code=?`, String(tx.order_code));
      if (order) {
        try {
          const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];
          const changed = await transitionPendingPaymentOrder({
            orderCode: String(tx.order_code),
            expectedTransactionStatus: "initializing",
            transactionStatus: "failed",
            orderStatus: "dibatalkan",
            paymentStatus: "failed",
            items,
            lastError: "stale_initializing",
          });
          if (changed) staleTransitions++;
        } catch { /* ok */ }
      }
    }
    results.stale_initializing = staleTransitions;

    // 2. Expired payments
    const expiredPayments = await queryAll(
      `SELECT order_code, provider_order_id, merchant_id FROM payment_transactions
       WHERE status='pending' AND expires_at < datetime('now')
       LIMIT ?`,
      BATCH_LIMIT,
    );
    let expiredTransitions = 0;
    for (const tx of expiredPayments) {
      const order = await queryFirst(`SELECT items, telegram_chat_id FROM orders WHERE code=?`, String(tx.order_code));
      if (order) {
        try {
          const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];
          const changed = await transitionPendingPaymentOrder({
            orderCode: String(tx.order_code),
            expectedTransactionStatus: "pending",
            transactionStatus: "expired",
            orderStatus: "kadaluarsa",
            paymentStatus: "expired",
            items,
          });
          if (!changed) continue;
          expiredTransitions++;
        } catch { /* ok */ }
      }
      // Notify buyer
      if (order?.telegram_chat_id) {
        try {
          await sendMessage({
            chat_id: String(order.telegram_chat_id),
            text: orderExpiredMessage(String(tx.order_code)),
            parse_mode: "HTML",
          });
        } catch { /* best-effort */ }
      }
    }
    results.expired_payments = expiredTransitions;

    // 2b. Static WhatsApp payments have no provider transaction but still
    // reserve variant stock. Expire them from the order TTL as well.
    const expiredStaticWhatsApp = await queryAll(
      `SELECT o.code, o.items
       FROM orders o
       WHERE o.sales_channel='whatsapp' AND o.status='pending'
         AND o.expires_at < datetime('now')
         AND NOT EXISTS(SELECT 1 FROM payment_transactions pt WHERE pt.order_code=o.code)
       LIMIT ?`,
      BATCH_LIMIT,
    );
    let expiredStaticCount = 0;
    for (const order of expiredStaticWhatsApp) {
      try {
        const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];
        await transitionPendingOrder(String(order.code), "kadaluarsa", null, items);
        expiredStaticCount++;
      } catch { /* another worker may have transitioned it */ }
    }
    results.expired_static_whatsapp_orders = expiredStaticCount;

    // 3. Missed callback recovery — check pending payments near expiry
    if (isPaymentEnabled()) {
      const pendingNearExpiry = await queryAll(
        `SELECT pt.order_code, pt.provider_order_id, pt.merchant_id,
                pt.payable_amount, pt.status
         FROM payment_transactions pt
         JOIN orders o ON o.code=pt.order_code
         WHERE (
           pt.status='pending'
           AND COALESCE(pt.last_checked_at,pt.created_at) < datetime('now','-3 minutes')
         ) OR (
           pt.status='paid' AND o.status='pending'
           AND o.payment_status IN ('unpaid','pending')
         )
         ORDER BY pt.expires_at ASC
         LIMIT ?`,
        Math.min(10, BATCH_LIMIT),
      );
      const provider = getPaymentProvider();
      for (const tx of pendingNearExpiry) {
        try {
          const statusCheck = await provider.checkStatus(
            String(tx.provider_order_id),
            String(tx.merchant_id),
          );
          await execRun(
            `UPDATE payment_transactions SET last_checked_at=datetime('now'), updated_at=datetime('now')
             WHERE order_code=?`,
            String(tx.order_code),
          );
          if (statusCheck.status === "paid") {
            if (
              statusCheck.amountPaid !== undefined
              && Number(tx.payable_amount) !== statusCheck.amountPaid
            ) {
              continue;
            }
            const transitioned = await transitionPendingPaymentToPaid(
              String(tx.order_code),
              statusCheck.paidAt ?? null,
            );
            if (transitioned) {
              (results.recovered_payments as number)++;
              try {
                await ensureFulfillmentForPaidOrder(String(tx.order_code));
              } catch { /* due-job reconciliation will retry */ }
            }
          }
        } catch { /* status check failures are non-fatal */ }
      }
    }

    // 4. Process due fulfillment jobs
    if (process.env.AUTO_FULFILLMENT_ENABLED === "true") {
      const dueJobs = await getDueJobs(BATCH_LIMIT);
      for (const job of dueJobs) {
        const order = await queryFirst(`SELECT * FROM orders WHERE code=?`, String(job.order_code));
        if (!order) continue;
        const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number }[];
        if (!items.length) continue;
        const product = await queryFirst(`SELECT * FROM products WHERE id=?`, items[0].product_id);
        if (!product) continue;
        try {
          await processJob(Number(job.id), order, product);
        } catch { /* individual job failure doesn't stop batch */ }
      }
      results.due_jobs_processed = dueJobs.length;
    }

    // 5. Release stale job locks
    results.stale_locks_released = await releaseStaleJobs();

    // 6. Keep transient WhatsApp state bounded. Proof metadata and orders are
    // retained; only expired sessions and old dedup events are removed.
    const expiredSessions = await execRun(
      `DELETE FROM whatsapp_sessions WHERE expires_at<datetime('now','-1 day')`,
    );
    const oldInboxEvents = await execRun(
      `DELETE FROM whatsapp_inbox_events WHERE created_at<datetime('now','-7 days')`,
    );
    results.whatsapp_rows_cleaned = Number(expiredSessions.changes || 0)
      + Number(oldInboxEvents.changes || 0);

  } catch (error) {
    console.error("Cron operations error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ...results, error: "partial_failure" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...results });
}
