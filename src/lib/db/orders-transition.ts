// Transisi status order (pending → lunas/dibatalkan/kadaluarsa dan varian
// pembayaran QRIS) dipisah dari pembuatan order supaya tiap modul jalur uang
// tetap kecil dan dapat diaudit terpisah. Guard atomik mengikat status,
// deadline order, serta riwayat nominal/waktu penerbitan invoice. State dev
// (getOrderMem/getSharedMem) diimpor dari client.ts sebagai SATU sumber
// tunggal agar tidak ada dua salinan store yang desinkron.

import { DANA_AMOUNT_REUSED_SQL } from "@/lib/payments/dana-history";
import { getD1, getOrderMem, getSharedMem, execRun } from "./client";
import { OrderTransitionError } from "./errors";
import type { D1, D1Statement } from "./types";

export async function transitionPendingOrder(
  code: string,
  status: "lunas" | "dibatalkan" | "kadaluarsa",
  adminNote: string | null,
  rawItems: { product_id: number; variant_id?: number; qty: number }[],
  database?: D1 | null,
): Promise<void> {
  const productQuantities = new Map<number, number>();
  const variantQuantities = new Map<number, number>();
  rawItems.forEach((item) => {
    if (item.variant_id) {
      variantQuantities.set(item.variant_id, (variantQuantities.get(item.variant_id) ?? 0) + item.qty);
    } else {
      productQuantities.set(item.product_id, (productQuantities.get(item.product_id) ?? 0) + item.qty);
    }
  });

  const d1 = database === undefined ? getD1() : database;
  if (d1) {
    if (status === "dibatalkan" || status === "kadaluarsa") {
      // Deterministic loser for the payment-vs-expiry race: the guards
      // require the order to still be pending AND unpaid. A concurrent
      // `transitionPendingPaymentToPaid` flips payment_status to 'paid' in
      // the same batch, so exactly one of the two batches commits.
      const guardId = `${code}:transition:${status}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const statements: D1Statement[] = [
        d1.prepare(
          "INSERT INTO operation_guards (operation_id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM orders WHERE code=? AND status='pending' AND payment_status IN ('unpaid','pending','expired','failed')) THEN 1 ELSE 0 END",
        ).bind(guardId, code),
      ];
      productQuantities.forEach((qty, productId) => {
        statements.push(
          d1.prepare("UPDATE products SET stock=stock+? WHERE id=? AND stock!=-1").bind(qty, productId),
        );
      });
      variantQuantities.forEach((qty, variantId) => {
        statements.push(
          d1.prepare("UPDATE product_variants SET stock=stock+?, updated_at=datetime('now') WHERE id=? AND stock!=-1").bind(qty, variantId),
        );
      });
      statements.push(
        d1.prepare(
          `UPDATE fulfillment_inventory
           SET status='available', order_code=NULL, reserved_at=NULL
           WHERE order_code=? AND status='reserved'`,
        ).bind(code),
        d1.prepare(
          `UPDATE orders
           SET status=?, admin_note=?,
               payment_status=CASE WHEN ?='kadaluarsa' THEN 'expired' ELSE 'failed' END,
               fulfillment_status='not_required', updated_at=datetime('now')
           WHERE code=? AND status='pending'`,
        ).bind(status, adminNote, status, code),
        d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guardId),
      );
      try {
        await d1.batch(statements);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/operation_guards|CHECK constraint/i.test(message)) throw new OrderTransitionError();
        throw error;
      }
    }
    // Manual admin confirmation (non-QRIS rails and WhatsApp proof flow):
    // the lunas flip AND the job row commit in ONE D1 batch (review R6).
    // Before, the UPDATE committed first and the job INSERT ran in a second
    // batch — a crash between them stranded a paid order with zero job rows
    // (no delivery ever). INSERT OR IGNORE keeps double-confirm retries to
    // one row. paid_at is written once (issue #12): COALESCE-guard keeps the
    // first payment time fixed — later fulfillment steps, admin notes, or
    // notification retries must not move revenue to another day/month.
    //
    // Race guard (review R6 lanjutan): INSERT job BERSYARAT pada transisi
    // yang menang — `WHERE EXISTS(SELECT 1 FROM orders WHERE code=? AND
    // status='lunas' AND payment_status='paid')`. Bila cancel/expiry menang
    // duluan, UPDATE lunas 0 row DAN job tidak terbit (tak ada job yatim
    // untuk order dibatalkan). Guard operation_guards di depan batch
    // menggagalkan batch lebih awal bila order sudah tidak pending.
    const transitionGuardId = `${code}:lunas-guard:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const lunasBatch: D1Statement[] = [
      d1.prepare(
        "INSERT INTO operation_guards (operation_id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM orders WHERE code=? AND status='pending') THEN 1 ELSE 0 END",
      ).bind(transitionGuardId, code),
      d1.prepare(
        `UPDATE orders
          SET status=?, admin_note=?, payment_status='paid',
              paid_at=COALESCE(paid_at,datetime('now')), updated_at=datetime('now')
          WHERE code=? AND status='pending'`,
      ).bind(status, adminNote, code),
      d1.prepare(
        `INSERT OR IGNORE INTO fulfillment_jobs
          (order_code, variant_id, inventory_id, sales_channel, status, attempt_count, next_attempt_at)
         SELECT o.code, o.variant_id,
                (SELECT fi.id FROM fulfillment_inventory fi
                  WHERE fi.order_code=o.code AND fi.status='reserved'),
                o.sales_channel, 'queued', 0, datetime('now')
         FROM orders o WHERE o.code=? AND o.status='lunas' AND o.payment_status='paid'`,
      ).bind(code),
      d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(transitionGuardId),
    ];
    const lunasResult = await d1.batch(lunasBatch);
    if (!lunasResult[1]?.meta?.changes) throw new OrderTransitionError();
    // Bila job yatim historis pernah terbit untuk order yang ternyata
    // dibatalkan (bug pra-perbaikan), jangan biarkan queued menunjuk order
    // non-lunas: operasi ini no-op pada jalur normal.
    await d1.batch([
      d1.prepare(
        `UPDATE fulfillment_jobs SET status='failed', last_error='order_no_longer_payable', updated_at=datetime('now')
         WHERE order_code=? AND status IN ('queued','retry')
           AND NOT EXISTS(SELECT 1 FROM orders WHERE code=? AND status='lunas' AND payment_status='paid')`,
      ).bind(code, code),
    ]).catch(() => undefined);
    await incrementSoldCountForOrder(code);
    return;
  }

  const order = getOrderMem().find((row) => String(row.code) === code);
  if (!order || order.status !== "pending") throw new OrderTransitionError();
  if (status === "dibatalkan" || status === "kadaluarsa") {
    productQuantities.forEach((qty, productId) => {
      const product = getSharedMem().find((row) => Number(row.id) === productId);
      if (product && Number(product.stock) !== -1) product.stock = Number(product.stock) + qty;
    });
  }
  order.status = status;
  order.payment_status = status === "lunas" ? "paid" : status === "kadaluarsa" ? "expired" : "failed";
  if (status === "lunas" && !order.paid_at) order.paid_at = new Date().toISOString();
  if (status !== "lunas") order.fulfillment_status = "not_required";
  order.admin_note = adminNote;
  order.updated_at = new Date().toISOString();
}

export async function transitionPendingPaymentOrder(input: {
  orderCode: string;
  expectedTransactionStatus: "initializing" | "pending";
  transactionStatus: "failed" | "expired";
  orderStatus: "dibatalkan" | "kadaluarsa";
  paymentStatus: "failed" | "expired";
  items: { product_id: number; variant_id?: number; qty: number }[];
  lastError?: string | null;
  /** Cron rechecks the deadline inside the same transaction as stock release. */
  expiredOnly?: boolean;
}, database?: D1 | null): Promise<boolean> {
  const productQuantities = new Map<number, number>();
  const variantQuantities = new Map<number, number>();
  input.items.forEach((item) => {
    if (item.variant_id) {
      variantQuantities.set(item.variant_id, (variantQuantities.get(item.variant_id) ?? 0) + item.qty);
    } else {
      productQuantities.set(item.product_id, (productQuantities.get(item.product_id) ?? 0) + item.qty);
    }
  });

  const d1 = database === undefined ? getD1() : database;
  if (d1) {
    // Deterministic loser for the expiry-vs-payment race: the guard only
    // passes while the transaction is still in the expected non-terminal
    // state AND the order is still pending+unpaid. A concurrent paid batch
    // moves both rows atomically, so a late expiry becomes a no-op instead
    // of resurrecting stock or overwriting a paid order.
    const guardId = `${input.orderCode}:payment:${input.transactionStatus}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const statements: D1Statement[] = [
      d1.prepare(
        `INSERT INTO operation_guards (operation_id,valid)
         SELECT ?, CASE WHEN
           EXISTS(SELECT 1 FROM orders WHERE code=? AND status='pending' AND payment_status IN ('unpaid','pending'))
           AND EXISTS(SELECT 1 FROM payment_transactions WHERE order_code=? AND status=?)
           AND (?=0 OR EXISTS (
             SELECT 1 FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code
             WHERE pt.order_code=? AND julianday(COALESCE(
               CASE WHEN pt.provider='dana' THEN o.expires_at END,pt.expires_at
             ))<=julianday('now')
           ))
         THEN 1 ELSE 0 END`,
      ).bind(guardId, input.orderCode, input.orderCode, input.expectedTransactionStatus,
        input.expiredOnly ? 1 : 0, input.orderCode),
    ];

    productQuantities.forEach((qty, productId) => {
      statements.push(
        d1.prepare("UPDATE products SET stock=stock+? WHERE id=? AND stock!=-1").bind(qty, productId),
      );
    });
    variantQuantities.forEach((qty, variantId) => {
      statements.push(
        d1.prepare("UPDATE product_variants SET stock=stock+?, updated_at=datetime('now') WHERE id=? AND stock!=-1")
          .bind(qty, variantId),
      );
    });
    statements.push(
      d1.prepare(
        `UPDATE fulfillment_inventory
         SET status='available', order_code=NULL, reserved_at=NULL
         WHERE order_code=? AND status='reserved'`,
      ).bind(input.orderCode),
      d1.prepare(
        `UPDATE payment_transactions
         SET status=?, last_error=?, updated_at=datetime('now')
         WHERE order_code=? AND status=?`,
      ).bind(
        input.transactionStatus,
        input.lastError ?? null,
        input.orderCode,
        input.expectedTransactionStatus,
      ),
      d1.prepare(
        `UPDATE orders
         SET status=?, payment_status=?, fulfillment_status='not_required', updated_at=datetime('now')
         WHERE code=? AND status='pending'`,
      ).bind(input.orderStatus, input.paymentStatus, input.orderCode),
      d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guardId),
    );

    try {
      await d1.batch(statements);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/operation_guards|CHECK constraint/i.test(message)) return false;
      throw error;
    }
  }

  const order = getOrderMem().find((row) => String(row.code) === input.orderCode);
  if (!order || String(order.status) !== "pending") return false;
  await transitionPendingOrder(input.orderCode, input.orderStatus, null, input.items);
  order.payment_status = input.paymentStatus;
  order.fulfillment_status = "not_required";
  return true;
}

/** Atomically make the dynamic QRIS ledger authoritative for its order. */
export async function transitionPendingPaymentToPaid(
  orderCode: string,
  providerPaidAt?: string | null,
  fulfillment?: {
    variantId: number | null;
    inventoryId: number | null;
    salesChannel: string;
  } | null,
  event?: { id: number; reviewedBy?: string; reviewNote?: string },
): Promise<boolean> {
  const d1 = getD1();
  if (d1) {
    // Mirror image of the expiry guard: paid wins only while the order is
    // still pending+unpaid and the ledger is still pending. A concurrent
    // expiry batch moves both rows first, so a late payment becomes a
    // no-op (returns false) instead of double-spending stock or reviving
    // a kadaluarsa order.
    //
    // The fulfillment outbox row is inserted in the SAME batch (issue #3):
    // a crash between "payment stored" and "job created" can no longer
    // strand a paid order with no job. INSERT OR IGNORE keeps concurrent
    // paid attempts idempotent — exactly one job row per order.
    const guardId = `${orderCode}:payment:paid:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const statements: D1Statement[] = [
      d1.prepare(
        `INSERT INTO operation_guards (operation_id,valid)
         SELECT ?, CASE WHEN
           EXISTS(SELECT 1 FROM orders WHERE code=? AND status='pending' AND payment_status IN ('unpaid','pending')
             AND (expires_at IS NULL OR julianday(expires_at)>julianday('now')))
           AND EXISTS(SELECT 1 FROM payment_transactions WHERE order_code=? AND status='pending')
         THEN 1 ELSE 0 END`,
      ).bind(guardId, orderCode, orderCode),
      d1.prepare(
        `UPDATE payment_transactions
         SET status='paid', paid_at=COALESCE(paid_at,?,datetime('now')),
             last_checked_at=datetime('now'), last_error=NULL, updated_at=datetime('now')
         WHERE order_code=? AND status='pending'`,
      ).bind(providerPaidAt ?? null, orderCode),
      d1.prepare(
        `UPDATE orders
          SET payment_status='paid', payment_method='qris', status='lunas',
              paid_at=COALESCE(paid_at,?,datetime('now')), updated_at=datetime('now')
          WHERE code=? AND status='pending' AND payment_status IN ('unpaid','pending')`,
      ).bind(providerPaidAt ?? null, orderCode),
    ];
    if (event) {
      // Claim the event in the same transaction as payment and outbox.
      statements.unshift(d1.prepare(
        `INSERT INTO operation_guards(operation_id,valid)
         SELECT ?,CASE WHEN EXISTS(
           SELECT 1 FROM dana_webhook_events e
           JOIN payment_transactions pt ON pt.order_code=?
           WHERE e.id=? AND e.status IN ('received','ignored','failed')
             AND e.amount=pt.payable_amount
             AND julianday(e.created_at)>=julianday(COALESCE(pt.invoice_issued_at,pt.created_at))
             AND datetime(pt.expires_at)>datetime('now')
             AND (?=1 OR NOT ${DANA_AMOUNT_REUSED_SQL})
         ) THEN 1 ELSE 0 END`,
      ).bind(`${guardId}:event`, orderCode, event.id, event.reviewedBy && event.reviewNote ? 1 : 0));
      statements.push(d1.prepare(
        `UPDATE dana_webhook_events
         SET status='matched',order_code=?,last_error=NULL,processed_at=datetime('now'),
             reviewed_by=?,review_note=?
         WHERE id=? AND status IN ('received','ignored','failed')`,
      ).bind(orderCode, event.reviewedBy ?? null, event.reviewNote ?? null, event.id));
      statements.push(d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(`${guardId}:event`));
    }
    if (fulfillment) {
      statements.push(
        d1.prepare(
          `INSERT OR IGNORE INTO fulfillment_jobs
            (order_code, variant_id, inventory_id, sales_channel, status, attempt_count, next_attempt_at)
           SELECT ?,?,?,?, 'queued', 0, datetime('now')
           WHERE EXISTS(SELECT 1 FROM orders WHERE code=?)`,
        ).bind(
          orderCode,
          fulfillment.variantId,
          fulfillment.inventoryId,
          fulfillment.salesChannel,
          orderCode,
        ),
      );
    }
    statements.push(
      d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guardId),
    );

    try {
      await d1.batch(statements);
      await incrementSoldCountForOrder(orderCode);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/operation_guards|CHECK constraint|UNIQUE/i.test(message)) return false;
      throw error;
    }
  }

  const order = getOrderMem().find((row) => String(row.code) === orderCode);
  if (!order || String(order.status) !== "pending") return false;
  const txResult = await execRun(
    `UPDATE payment_transactions SET status='paid', paid_at=?, updated_at=datetime('now')
     WHERE order_code=? AND status='pending'`,
    providerPaidAt ?? new Date().toISOString(),
    orderCode,
  );
  if (!txResult.changes) return false;
  order.status = "lunas";
  order.payment_status = "paid";
  order.payment_method = "qris";
  if (!order.paid_at) order.paid_at = String(providerPaidAt ?? new Date().toISOString());
  order.updated_at = new Date().toISOString();
  return true;
}

/**
 * Increment sold_count on products for a paid order.
 * Best-effort: failures are logged but don't block the payment flow.
 */
export async function incrementSoldCountForOrder(orderCode: string): Promise<void> {
  const d1 = getD1();
  if (d1) {
    try {
      const order = await d1.prepare("SELECT items FROM orders WHERE code=?").bind(orderCode).first() as { items: string } | null;
      if (!order?.items) return;
      const items = JSON.parse(order.items) as { product_id: number; qty: number }[];
      if (!items.length) return;
      const agg = new Map<number, number>();
      items.forEach((i) => agg.set(i.product_id, (agg.get(i.product_id) ?? 0) + (i.qty || 1)));
      const stmts: D1Statement[] = [];
      agg.forEach((qty, pid) => {
        stmts.push(d1.prepare("UPDATE products SET sold_count=COALESCE(sold_count,0)+? WHERE id=?").bind(qty, pid));
      });
      await d1.batch(stmts);
    } catch { /* best-effort */ }
    return;
  }
  // Dev in-memory fallback — order_items not tracked in mem; skip.
}
