// POST /api/cron/operations — Reconciliation cron for payments and fulfillment
// Called by MCP Worker cron every 5 minutes. Handles:
// 1. Stale initializing payments
// 2. Expired payments/orders
// 3. Due fulfillment jobs
// 4. Stale job locks

import { NextRequest, NextResponse } from "next/server";
import {
  queryAll,
  queryFirst,
  execRun,
  transitionPendingOrder,
  transitionPendingPaymentOrder,
} from "@/lib/db";
import {
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
    due_jobs_processed: 0,
    stale_locks_released: 0,
    expired_manual_whatsapp_orders: 0,
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

    // 2b. Manual WhatsApp rails have no transaction ledger but still reserve
    // variant stock. Expire them from the order TTL as well.
    const expiredManualWhatsApp = await queryAll(
      `SELECT o.code, o.items
       FROM orders o
       WHERE o.sales_channel='whatsapp' AND o.status='pending'
         AND o.expires_at < datetime('now')
         AND NOT EXISTS(SELECT 1 FROM payment_transactions pt WHERE pt.order_code=o.code)
       LIMIT ?`,
      BATCH_LIMIT,
    );
    let expiredStaticCount = 0;
    for (const order of expiredManualWhatsApp) {
      try {
        const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];
        await transitionPendingOrder(String(order.code), "kadaluarsa", null, items);
        expiredStaticCount++;
      } catch { /* another worker may have transitioned it */ }
    }
    results.expired_manual_whatsapp_orders = expiredStaticCount;

    // 3. Process due fulfillment jobs
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

    // 4. Release stale job locks
    results.stale_locks_released = await releaseStaleJobs();

    // 6. Keep transient WhatsApp state bounded. Proof metadata and orders are
    // retained; only expired sessions and old dedup events are removed.
    const expiredSessions = await execRun(
      `DELETE FROM whatsapp_sessions WHERE expires_at<datetime('now','-1 day')`,
    );
    const oldInboxEvents = await execRun(
      `DELETE FROM whatsapp_inbox_events WHERE created_at<datetime('now','-7 days')`,
    );
    await execRun(`DELETE FROM dana_webhook_events WHERE created_at<datetime('now','-30 days')`);
    results.whatsapp_rows_cleaned = Number(expiredSessions.changes || 0)
      + Number(oldInboxEvents.changes || 0);

  } catch (error) {
    console.error("Cron operations error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ...results, error: "partial_failure" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...results });
}
