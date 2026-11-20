// src/lib/fulfillment/delivery/reconcile.ts — Pemulihan orphan/stale/split historis.
//
// MENGAPA dipisah: fungsi-fungsi cron ini menyembuhkan celah antara "pembayaran
// tersimpan" dan "job/item/agregat konsisten" tanpa mengirim ulang kredensial.
// Mereka berbagi disiplin fence (order yang sudah settled tidak dibangkitkan
// ulang) dan budget request-scoped. Mengumpulkannya memisahkan jalur pemulihan
// batch dari jalur pembayaran langsung, sehingga aturan idempotensi/fence mudah
// ditinjau.

import { queryFirst, queryAll } from "@/lib/db";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import type { Row } from "./types";
import { allItemsDelivered, fulfillmentLineMismatches, parseOrderItems } from "./manifest";
import { DELIVERY_LINE_COUNT_SQL } from "../units";
import { createFulfillmentJob } from "./claim";
import { ensureFulfillmentItems } from "./inventory-binding";
import { ensureFulfillmentForPaidOrder } from "./ensure";

/** Create/read an orphan's durable job in three statements. Item materialization
 * and delivery are separate bounded steps in processJobItems on subsequent work. */
export async function reconcileOrphanLight(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
  // Create the durable queue entry FIRST. Materialization resumes in small
  // units via processJobItems; it must never happen under a flat orphan cost.
  const order = await database.queryFirst(`SELECT * FROM orders WHERE code=? AND status='lunas' AND payment_status='paid'`, orderCode);
  if (!order) return false;
  // Pedia/Games never heal into the Market outbox: existing false rows are ignored
  // safely by readers, and no new rows are created here.
  if (["pedia", "games"].includes(String(order.order_kind))) return false;
  const items = parseOrderItems(order.items);
  if (!items.length) return false;
  await createFulfillmentJob(orderCode, null, "queued", Number(order.variant_id || items[0].variant_id || 0) || null,
    String(order.sales_channel || "telegram"), database);
  return Boolean(await database.queryFirst(`SELECT id FROM fulfillment_jobs WHERE order_code=?`, orderCode));
}

/** Repair historical job/order splits without sending credentials again. */
export async function reconcileSettledJobs(limit = 2, database: DatabaseAccess = createDatabaseAccess()): Promise<number> {
  const d1 = database.d1;
  if (!d1 || !database.canSpend(1)) return 0;
  const deliveredItems = `NOT EXISTS(SELECT 1 FROM fulfillment_items fi WHERE fi.order_code=o.code AND fi.status<>'delivered')`;
  const orders = await database.queryAll(
    `SELECT o.code,o.items,o.fulfillment_status,fj.id AS job_id,fj.status AS job_status
     FROM orders o JOIN fulfillment_jobs fj ON fj.order_code=o.code
     WHERE o.status='lunas' AND o.payment_status='paid' AND fj.status IN ('delivered','manual_required','failed')
       AND COALESCE(o.order_kind,'apps') NOT IN ('pedia','games')
       AND (o.fulfillment_status IS NOT 'delivered' OR fj.status<>'delivered')
       AND ${deliveredItems}
       AND (SELECT COUNT(*) FROM fulfillment_items fi WHERE fi.order_code=o.code) = ${DELIVERY_LINE_COUNT_SQL}
       AND EXISTS(SELECT 1 FROM fulfillment_items fi WHERE fi.order_code=o.code)
     LIMIT ?`, limit,
  );
  let repaired = 0;
  for (const order of orders) {
    if (!database.canSpend(5)) break;
    const rows = await database.queryAll(`SELECT item_index,product_id,variant_id,qty,status FROM fulfillment_items WHERE order_code=?`, order.code);
    if (!allItemsDelivered(rows) || fulfillmentLineMismatches(order.items, rows).length) continue;
    const manifest = JSON.stringify(rows);
    const guardId = `${order.code}:fulfillment-settlement:${crypto.randomUUID()}`;
    // D1 rolls the whole batch back on a CAS loss, including both aggregates.
    try {
      await d1.batch([
        d1.prepare(`INSERT INTO operation_guards (operation_id,valid) SELECT ?, EXISTS(
          SELECT 1 FROM orders o JOIN fulfillment_jobs fj ON fj.order_code=o.code
          WHERE o.code=? AND o.status='lunas' AND o.payment_status='paid'
            AND COALESCE(o.order_kind,'apps') NOT IN ('pedia','games')
            AND o.fulfillment_status IS ? AND o.items IS ? AND fj.id=? AND fj.status=?
            AND ${deliveredItems}
            AND (SELECT COUNT(*) FROM fulfillment_items fi WHERE fi.order_code=o.code)=?
            AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(
              SELECT 1 FROM fulfillment_items fi
              WHERE fi.order_code=o.code AND fi.item_index=expected.value->>'item_index'
                AND fi.product_id=expected.value->>'product_id' AND fi.variant_id IS (expected.value->>'variant_id')
                AND fi.qty=expected.value->>'qty'
            )))`).bind(guardId, order.code, order.fulfillment_status, order.items, order.job_id, order.job_status, rows.length, manifest),
        d1.prepare(`UPDATE orders SET fulfillment_status='delivered',updated_at=datetime('now') WHERE code=?`).bind(order.code),
        d1.prepare(`UPDATE fulfillment_jobs SET status='delivered',last_error=NULL,locked_until=NULL,next_attempt_at=NULL,
          item_cursor=NULL,updated_at=datetime('now') WHERE id=?`).bind(order.job_id),
        d1.prepare(`DELETE FROM operation_guards WHERE operation_id=?`).bind(guardId),
      ]);
      repaired++;
    } catch (error) {
      if (!(error instanceof Error) || !/operation_guards|CHECK constraint failed: valid/i.test(error.message)) throw error;
    }
  }
  return repaired;
}

/**
 * Reconcile paid orders that have no fulfillment job (issue #3).
 *
 * Covers every gap between "payment stored" and "job created": crashes in
 * legacy code paths, jobs deleted manually, and pre-fix rows. For each paid
 * order without a job row, reuses ensureFulfillmentForPaidOrder so routing,
 * idempotency, and the AUTO_FULFILLMENT_ENABLED gate stay identical to the
 * live payment paths. Returns the number of orders healed.
 *
 * Fence (review R4): orders whose fulfillment already settled (delivered /
 * manual_required AND every item row delivered) are SKIPPED — a deleted job
 * row is history, not work. Without this fence the reconciler would mint a
 * fresh job and the requeue path could resend secrets already handed out.
 *
 * Idempotency: ensureFulfillmentForPaidOrder inserts exactly one job row
 * (UNIQUE order_code); already-delivered orders are skipped by callers that
 * check fulfillment_status, and processJob claims each job via CAS, so a
 * retry or a recovered worker reuses progress instead of resending what
 * already shipped. Push also consults the per-item send ledger: sent is not
 * replayed and sending waits 600s before bounded takeover. No singular-delivery
 * promise is made about an ambiguous provider result (see releaseStaleJobs).
 */
export async function reconcileMissingFulfillmentJobs(limit = 8): Promise<number> {
  const orphans = await queryAll(
    `SELECT o.code FROM orders o
     LEFT JOIN fulfillment_jobs fj ON fj.order_code=o.code
     WHERE o.status='lunas' AND o.payment_status='paid'
       AND COALESCE(o.order_kind,'apps') NOT IN ('pedia','games')
       AND fj.order_code IS NULL
     ORDER BY o.updated_at ASC LIMIT ?`,
    limit,
  );
  let healed = 0;
  for (const orphan of orphans) {
    try {
      // Fence: settled orders (delivered/manually handed over, all items
      // delivered) need NO job — skip instead of resurrecting work that
      // could resend. Deliberately separate queries (not JOIN) so a read
      // failure fails OPEN toward healing rather than silently skipping.
      const settled = await queryFirst(
        `SELECT fulfillment_status FROM orders WHERE code=?`, String(orphan.code),
      ).catch(() => null);
      const agg = String(settled?.fulfillment_status ?? "");
      if (agg === "delivered" || agg === "manual_required") {
        const open = await queryFirst(
          `SELECT id FROM fulfillment_items WHERE order_code=? AND status NOT IN ('delivered','failed','manual_required')`,
          String(orphan.code),
        ).catch(() => ({ id: 1 }));
        if (!open) continue; // truly settled — leave history alone
      }
      if (await ensureFulfillmentForPaidOrder(String(orphan.code))) healed++;
      else {
        // ensure returns false when auto-fulfillment is off yet still
        // creates the queued job — count it as healed if the row exists.
        const job = await queryFirst(
          `SELECT id FROM fulfillment_jobs WHERE order_code=?`,
          String(orphan.code),
        );
        if (job) healed++;
      }
    } catch { /* next cron run retries */ }
  }
  return healed;
}

/**
 * Backfill per-item rows for paid orders that have a job but no item rows
 * (pre-migration-0015 data, issue #4). Bounded and idempotent; each order
 * reuses ensureFulfillmentItems so mode/recipient resolution stays single.
 */
export async function backfillMissingFulfillmentItems(limit = 8): Promise<number> {
  const rows = await queryAll(
    `SELECT o.* FROM orders o
     JOIN fulfillment_jobs fj ON fj.order_code=o.code
     LEFT JOIN fulfillment_items fi ON fi.order_code=o.code
     WHERE o.status='lunas' AND o.payment_status='paid'
       AND COALESCE(o.order_kind,'apps') NOT IN ('pedia','games')
       AND fi.order_code IS NULL
     ORDER BY o.updated_at ASC LIMIT ?`,
    limit,
  ).catch(() => [] as Row[]);
  let backfilled = 0;
  for (const order of rows) {
    try {
      const created = await ensureFulfillmentItems(order);
      if (created.length > 0) backfilled++;
    } catch { /* next cron run retries */ }
  }
  return backfilled;
}
