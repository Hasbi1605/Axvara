// POST /api/cron/operations — Reconciliation cron for payments and fulfillment
// Called by MCP Worker cron every 5 minutes. Handles:
// 1. Stale initializing payments
// 2. Expired payments/orders
// 3. Missed callback recovery via status check
// 4. Due fulfillment jobs
// 5. Stale job locks

import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryFirst, execRun } from "@/lib/db";
import { getPaymentProvider, isPaymentEnabled } from "@/lib/payments/klikqris";
import { releaseInventoryForOrder } from "@/lib/fulfillment/inventory";
import { getDueJobs, processJob, releaseStaleJobs } from "@/lib/fulfillment/deliver";
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
  };

  try {
    // 1. Stale initializing payments (older than 5 minutes)
    const staleInit = await queryAll(
      `SELECT order_code FROM payment_transactions
       WHERE status='initializing' AND created_at < datetime('now', '-5 minutes')
       LIMIT ?`,
      BATCH_LIMIT,
    );
    for (const tx of staleInit) {
      await execRun(
        `UPDATE payment_transactions SET status='failed', last_error='stale_initializing', updated_at=datetime('now')
         WHERE order_code=? AND status='initializing'`,
        String(tx.order_code),
      );
      // Restore stock
      const order = await queryFirst(`SELECT items FROM orders WHERE code=?`, String(tx.order_code));
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
      await releaseInventoryForOrder(String(tx.order_code));
      await execRun(
        `UPDATE orders SET status='dibatalkan', payment_status='failed', updated_at=datetime('now')
         WHERE code=? AND status='pending'`,
        String(tx.order_code),
      );
    }
    results.stale_initializing = staleInit.length;

    // 2. Expired payments
    const expiredPayments = await queryAll(
      `SELECT order_code, provider_order_id, merchant_id FROM payment_transactions
       WHERE status='pending' AND expires_at < datetime('now')
       LIMIT ?`,
      BATCH_LIMIT,
    );
    for (const tx of expiredPayments) {
      await execRun(
        `UPDATE payment_transactions SET status='expired', updated_at=datetime('now')
         WHERE order_code=? AND status='pending'`,
        String(tx.order_code),
      );
      const order = await queryFirst(`SELECT items, telegram_chat_id FROM orders WHERE code=?`, String(tx.order_code));
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
      await releaseInventoryForOrder(String(tx.order_code));
      await execRun(
        `UPDATE orders SET status='kadaluarsa', payment_status='expired', fulfillment_status='not_required',
         updated_at=datetime('now') WHERE code=? AND status='pending'`,
        String(tx.order_code),
      );
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
    results.expired_payments = expiredPayments.length;

    // 3. Missed callback recovery — check pending payments near expiry
    if (isPaymentEnabled()) {
      const pendingNearExpiry = await queryAll(
        `SELECT order_code, provider_order_id, merchant_id FROM payment_transactions
         WHERE status='pending' AND last_checked_at < datetime('now', '-3 minutes')
         ORDER BY expires_at ASC
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
            // Transition to paid (same logic as callback)
            const result = await execRun(
              `UPDATE payment_transactions SET status='paid', paid_at=datetime('now'), updated_at=datetime('now')
               WHERE order_code=? AND status='pending'`,
              String(tx.order_code),
            );
            if (result.changes) {
              await execRun(
                `UPDATE orders SET payment_status='paid', status='lunas', updated_at=datetime('now')
                 WHERE code=? AND status='pending'`,
                String(tx.order_code),
              );
              (results.recovered_payments as number)++;
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

  } catch (error) {
    console.error("Cron operations error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ...results, error: "partial_failure" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...results });
}
