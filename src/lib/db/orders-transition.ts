// Transisi status order (pending → lunas/dibatalkan/kadaluarsa dan varian
// pembayaran QRIS) dipisah dari pembuatan order supaya tiap modul jalur uang
// tetap kecil dan dapat diaudit terpisah. Guard atomik mengikat status,
// deadline order, serta riwayat nominal/waktu penerbitan invoice. State dev
// (getOrderMem/getSharedMem) diimpor dari client.ts sebagai SATU sumber
// tunggal agar tidak ada dua salinan store yang desinkron.

import { DANA_AMOUNT_REUSED_SQL } from "@/lib/payments/dana-history";
import { PAID_ORDER_COST_SNAPSHOT_SQL } from "@/lib/orders/cost-snapshot";
import { getD1, getOrderMem, getSharedMem, execRun } from "./client";
import { OrderTransitionError } from "./errors";
import type { D1, D1Statement } from "./types";
import { parseFxTimestamp } from "@/lib/payments/fx";

export type CatalogRevisionTransitionOptions = {
  skipRevisionBump?: boolean;
  onMarketChanged?: () => void;
};

async function finishMarketMutationRevision(
  d1: D1,
  options?: CatalogRevisionTransitionOptions,
): Promise<void> {
  if (options?.onMarketChanged) {
    options.onMarketChanged();
    return;
  }
  if (options?.skipRevisionBump) return;
  const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
  await bumpCatalogRevision("market", d1);
}

export async function transitionPendingOrder(
  code: string,
  status: "lunas" | "dibatalkan" | "kadaluarsa",
  adminNote: string | null,
  rawItems: { product_id: number; variant_id?: number; qty: number }[],
  database?: D1 | null,
  options?: CatalogRevisionTransitionOptions,
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
          `INSERT INTO operation_guards (operation_id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM orders WHERE code=? AND status='pending' AND payment_status IN ('unpaid','pending','expired','failed')
            ${adminNote === "buyer_cancel" ? `AND NOT EXISTS (SELECT 1 FROM payment_transactions pt WHERE pt.order_code=orders.code AND ((pt.provider='nowpayments' AND (COALESCE(pt.provider_status_text,'') NOT IN ('','waiting','expired') OR COALESCE(pt.last_error,'')!='' OR trim(COALESCE(pt.actually_paid_text,''),'0. ')!='')) OR (pt.provider='sekalipay_gateway' AND (COALESCE(pt.last_error,'')!='' OR COALESCE(pt.provider_status_text,'') IN ('paid','completed') OR pt.paid_at IS NOT NULL))))` : ""}) THEN 1 ELSE 0 END`,
        ).bind(guardId, code),
      ];
      // Pedia and Games orders NEVER reserve Market stock (their claim INSERT
      // only writes orders + their own item tables), so their cancel/expiry
      // must never restock `products`/`product_variants` by
      // `orders.items[].product_id` (ids that can collide numerically with
      // Market ids). Guard in SQL so shared callers (admin/cron/webhooks) are
      // safe too.
      const restockMarket = `EXISTS(SELECT 1 FROM orders o WHERE o.code=? AND COALESCE(o.order_kind,'apps')='apps')`;
      productQuantities.forEach((qty, productId) => {
        statements.push(
          d1.prepare(`UPDATE products SET stock=stock+? WHERE id=? AND stock!=-1 AND ${restockMarket}`).bind(qty, productId, code),
        );
      });
      variantQuantities.forEach((qty, variantId) => {
        statements.push(
          d1.prepare(`UPDATE product_variants SET stock=stock+?, updated_at=datetime('now') WHERE id=? AND stock!=-1 AND ${restockMarket}`).bind(qty, variantId, code),
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
        const batchResults = await d1.batch(statements);
        const restocked = batchResults.slice(1, -2).some((res) => Number(res?.meta?.changes ?? 0) > 0);
        if (restocked) await finishMarketMutationRevision(d1, options);
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
      d1.prepare(PAID_ORDER_COST_SNAPSHOT_SQL).bind(code),
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
    await incrementSoldCountForOrder(code, d1, options);
    return;
  }

  const order = getOrderMem().find((row) => String(row.code) === code);
  if (!order || order.status !== "pending") throw new OrderTransitionError();
  const restockMarket = String((order as { order_kind?: unknown }).order_kind ?? "apps") === "apps";
  if (restockMarket && (status === "dibatalkan" || status === "kadaluarsa")) {
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
}, database?: D1 | null, options?: CatalogRevisionTransitionOptions): Promise<boolean> {
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
                CASE WHEN pt.provider IN ('dana','gopay') THEN o.expires_at END,pt.expires_at
              ))<=julianday('now')
            ))
         THEN 1 ELSE 0 END`,
      ).bind(guardId, input.orderCode, input.orderCode, input.expectedTransactionStatus,
        input.expiredOnly ? 1 : 0, input.orderCode),
    ];

    // Other catalogs never reserved Market stock; numeric item IDs can collide.
    const restockMarket = `EXISTS(SELECT 1 FROM orders o WHERE o.code=? AND COALESCE(o.order_kind,'apps')='apps')`;
    productQuantities.forEach((qty, productId) => {
      statements.push(
        d1.prepare(`UPDATE products SET stock=stock+? WHERE id=? AND stock!=-1 AND ${restockMarket}`).bind(qty, productId, input.orderCode),
      );
    });
    variantQuantities.forEach((qty, variantId) => {
      statements.push(
        d1.prepare(`UPDATE product_variants SET stock=stock+?, updated_at=datetime('now') WHERE id=? AND stock!=-1 AND ${restockMarket}`)
          .bind(qty, variantId, input.orderCode),
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
      const batchResults = await d1.batch(statements);
      const restocked = batchResults.slice(1, -3).some((res) => Number(res?.meta?.changes ?? 0) > 0);
      if (restocked) await finishMarketMutationRevision(d1, options);
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

/** Paid atomik satu batch: guard + tx paid + order lunas + event matched + outbox + snapshot modal. */
export type PaidPaymentMethod = "qris" | "crypto" | "sekalipay_gateway";
export async function transitionPendingPaymentToPaid(
  orderCode: string,
  providerPaidAt?: string | null,
  fulfillment?: {
    variantId: number | null;
    inventoryId: number | null;
    salesChannel: string;
  } | null,
  event?: { id: number; reviewedBy?: string; reviewNote?: string },
  options?: { paymentMethod?: PaidPaymentMethod; eventMode?: "payable" | "received_text" | "gateway" } & CatalogRevisionTransitionOptions,
  database?: D1 | null,
): Promise<boolean> {
  if ((options?.paymentMethod === "sekalipay_gateway" || options?.eventMode === "gateway")
    && (options?.paymentMethod !== "sekalipay_gateway" || options?.eventMode !== "gateway" || !event)) return false;
  if (options?.eventMode === "gateway" && (!providerPaidAt || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(providerPaidAt)
    || !parseFxTimestamp(providerPaidAt) || Date.parse(providerPaidAt) > Date.now())) return false;
  const d1 = database === undefined ? getD1() : database;
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
            AND EXISTS(SELECT 1 FROM payment_transactions WHERE order_code=? AND status IN ('initializing','pending'))
            AND ${options?.paymentMethod === "sekalipay_gateway" ? "EXISTS" : "NOT EXISTS"}(SELECT 1 FROM payment_transactions WHERE order_code=? AND provider='sekalipay_gateway')
         THEN 1 ELSE 0 END`,
      ).bind(guardId, orderCode, orderCode, orderCode),
      d1.prepare(
        `UPDATE payment_transactions
         SET status='paid', paid_at=COALESCE(paid_at,?,datetime('now')),
             last_checked_at=datetime('now'), last_error=NULL, updated_at=datetime('now')
         WHERE order_code=? AND status IN ('initializing','pending')`,
      ).bind(providerPaidAt ?? null, orderCode),
      d1.prepare(
        `UPDATE orders
          SET payment_status='paid', payment_method=?, status='lunas',
              paid_at=COALESCE(paid_at,?,datetime('now')), updated_at=datetime('now')
          WHERE code=? AND status='pending' AND payment_status IN ('unpaid','pending')`,
      ).bind(options?.paymentMethod ?? "qris", providerPaidAt ?? null, orderCode),
    ];
    if (event) {
      // Review must remain terminal even if it wins after the caller's pre-read.
      // eventMode 'received_text' (crypto): nominal sudah divalidasi desimal
      // eksak di adapter sebelum klaim ini — di sini guard hanya mengikat event
      // ke (provider, order, payment id, expiry) agar event asing tak bisa paid.
      const eventGuard = options?.eventMode === "gateway"
        ? `INSERT INTO operation_guards(operation_id,valid)
           SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM dana_webhook_events e
             JOIN payment_transactions pt ON pt.order_code=e.order_code
             JOIN orders o ON o.code=pt.order_code
             WHERE pt.order_code=? AND e.id=? AND e.order_code=? AND e.provider='sekalipay_gateway'
               AND pt.provider='sekalipay_gateway' AND pt.provider_payment_id IS NOT NULL
               AND (e.event_key='sekalipaygw:' || pt.provider_payment_id || ':paid'
                 OR (pt.gateway_is_sandbox=1 AND e.event_key='sekalipaygw:' || pt.provider_payment_id || ':completed'))
               AND e.status IN ('received','ignored','failed') AND e.reviewed_by IS NULL AND e.amount=pt.payable_amount
               AND pt.requested_amount+pt.gateway_fee=pt.payable_amount AND pt.gateway_fee>=0
               AND o.subtotal=pt.requested_amount AND o.payment_method='sekalipay_gateway:' || pt.gateway_channel
               AND pt.last_error IS NULL AND pt.gateway_fee_consented_at IS NOT NULL
               AND julianday(pt.expires_at)>julianday('now') AND julianday(o.expires_at)>julianday('now')
               AND julianday(?)<=julianday(pt.expires_at) AND julianday(?)<=julianday(o.expires_at)
           ) THEN 1 ELSE 0 END`
        : options?.eventMode === "received_text"
        ? `INSERT INTO operation_guards(operation_id,valid)
           SELECT ?,CASE WHEN EXISTS(
             SELECT 1 FROM dana_webhook_events e
             JOIN payment_transactions pt ON pt.order_code=e.order_code AND pt.order_code=?
             WHERE e.id=? AND e.order_code=? AND e.provider=pt.provider AND pt.provider='nowpayments'
               AND e.event_key='nowpayments:' || pt.provider_payment_id || ':finished'
               AND e.status IN ('received','ignored','failed') AND e.reviewed_by IS NULL
                AND pt.provider_payment_id IS NOT NULL
                AND pt.requested_amount=e.amount
                AND (pt.last_error IS NULL OR (pt.last_error='nowpayments_finalize_failed_manual_review'
                  AND pt.price_amount_text IS NOT NULL AND pt.price_currency IS NOT NULL AND pt.pay_amount_text IS NOT NULL
                  AND pt.pay_currency IS NOT NULL AND pt.pay_address IS NOT NULL))
                AND datetime(pt.expires_at)>datetime('now')
           ) THEN 1 ELSE 0 END`
        : `INSERT INTO operation_guards(operation_id,valid)
         SELECT ?,CASE WHEN EXISTS(
           SELECT 1 FROM dana_webhook_events e
           JOIN payment_transactions pt ON pt.order_code=?
           WHERE e.id=? AND e.status IN ('received','ignored','failed') AND e.reviewed_by IS NULL
             AND e.amount=pt.payable_amount
             AND julianday(e.created_at)>=julianday(COALESCE(pt.invoice_issued_at,pt.created_at))
             AND datetime(pt.expires_at)>datetime('now')
             AND (?=1 OR NOT ${DANA_AMOUNT_REUSED_SQL})
         ) THEN 1 ELSE 0 END`;
      const binds = options?.eventMode === "gateway"
        ? [`${guardId}:event`, orderCode, event.id, orderCode, providerPaidAt, providerPaidAt]
        : options?.eventMode === "received_text"
        ? [`${guardId}:event`, orderCode, event.id, orderCode]
        : [`${guardId}:event`, orderCode, event.id, event.reviewedBy && event.reviewNote ? 1 : 0];
      statements.unshift(d1.prepare(eventGuard).bind(...binds));
      statements.push(d1.prepare(
        `UPDATE dana_webhook_events
         SET status='matched',order_code=?,last_error=NULL,processed_at=datetime('now'),
             reviewed_by=?,review_note=?
         WHERE id=? AND status IN ('received','ignored','failed') AND reviewed_by IS NULL`,
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
      d1.prepare(PAID_ORDER_COST_SNAPSHOT_SQL).bind(orderCode),
      d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guardId),
    );

    try {
      await d1.batch(statements);
      await incrementSoldCountForOrder(orderCode, d1, options);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/operation_guards|CHECK constraint|UNIQUE/i.test(message)) return false;
      throw error;
    }
  }

  if (options?.paymentMethod === "sekalipay_gateway") return false;
  const order = getOrderMem().find((row) => String(row.code) === orderCode);
  if (!order || String(order.status) !== "pending") return false;
  const txResult = await execRun(
    `UPDATE payment_transactions SET status='paid', paid_at=?, updated_at=datetime('now')
     WHERE order_code=? AND status IN ('initializing','pending')`,
    providerPaidAt ?? new Date().toISOString(),
    orderCode,
  );
  if (!txResult.changes) return false;
  order.status = "lunas";
  order.payment_status = "paid";
  order.payment_method = options?.paymentMethod ?? "qris";
  if (!order.paid_at) order.paid_at = String(providerPaidAt ?? new Date().toISOString());
  order.updated_at = new Date().toISOString();
  return true;
}

/**
 * Increment sold_count on products for a paid order.
 * Best-effort: failures are logged but don't block the payment flow.
 */
export async function incrementSoldCountForOrder(
  orderCode: string,
  database?: D1 | null,
  options?: CatalogRevisionTransitionOptions,
): Promise<void> {
  const d1 = database === undefined ? getD1() : database;
  if (d1) {
    try {
      const order = await d1.prepare("SELECT items FROM orders WHERE code=? AND COALESCE(order_kind,'apps')='apps'").bind(orderCode).first() as { items: string } | null;
      if (!order?.items) return;
      const items = JSON.parse(order.items) as { product_id: number; qty: number }[];
      if (!items.length) return;
      const agg = new Map<number, number>();
      items.forEach((i) => agg.set(i.product_id, (agg.get(i.product_id) ?? 0) + (i.qty || 1)));
      const stmts: D1Statement[] = [];
      agg.forEach((qty, pid) => {
        stmts.push(d1.prepare("UPDATE products SET sold_count=COALESCE(sold_count,0)+? WHERE id=?").bind(qty, pid));
      });
      const batchResults = await d1.batch(stmts);
      if (batchResults.some((res) => Number(res?.meta?.changes ?? 0) > 0)) {
        await finishMarketMutationRevision(d1, options);
      }
    } catch { /* best-effort */ }
    return;
  }
  // Dev in-memory fallback — order_items not tracked in mem; skip.
}
