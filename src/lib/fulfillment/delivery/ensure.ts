// src/lib/fulfillment/delivery/ensure.ts — Gerbang idempoten pembayaran → outbox.
//
// MENGAPA dipisah: ensureFulfillmentForPaidOrder adalah SATU titik masuk yang
// dipakai semua jalur pembayaran otoritatif (callback QRIS, approve bukti,
// konfirmasi admin, rekonsiliasi). Ia menggabungkan ack pembayaran, materialisasi
// per-item, penentuan agregat, dan gate AUTO_FULFILLMENT_ENABLED menjadi satu
// prosedur idempoten. Dipisah dari mesin processJob (process.ts) agar "kontrak
// jalur masuk" mudah ditinjau dan agar process.ts tetap di bawah ~450 baris.
// NOL perubahan perilaku: urutan, SQL, dan gate identik dengan versi monolit.

import { queryFirst, queryAll, execRun, isD1Mode } from "@/lib/db";
import { notifyTelegramBuyerPaid } from "@/lib/telegram/order-notifications";
import type { Row } from "./types";
import {
  allItemsDelivered,
  allItemsSettled,
  fulfillmentModeFromOrderSnapshot,
  parseOrderItems,
} from "./manifest";
import { ensureFulfillmentItems } from "./inventory-binding";
import { createFulfillmentJob } from "./claim";
import { processJob } from "./process";

/**
 * Idempotently create and immediately attempt fulfillment for a paid order.
 * Used by callbacks, reconciliation, and manual proof approval so every
 * authoritative payment path reaches the same channel/variant-aware outbox.
 */
export async function ensureFulfillmentForPaidOrder(orderCode: string): Promise<boolean> {
  const autoFulfillmentEnabled = process.env.AUTO_FULFILLMENT_ENABLED === "true";

  const order = await queryFirst(
    `SELECT * FROM orders WHERE code=? AND status='lunas' AND payment_status='paid'`,
    orderCode,
  );
  if (!order) return false;

  // Buyer payment acknowledgement must not depend on AUTO_FULFILLMENT_ENABLED.
  // It is durable/idempotent and retried by the operations cron when Telegram
  // is temporarily unavailable.
  if (String(order.sales_channel) === "telegram") {
    try {
      await notifyTelegramBuyerPaid(orderCode);
    } catch { /* Payment remains durable; notification cron retries it. */ }
  }

  let items: { product_id: number; variant_id?: number }[];
  try {
    items = JSON.parse(String(order.items ?? "[]"));
  } catch {
    return false;
  }
  if (!items.length) return false;

  const product = await queryFirst(`SELECT * FROM products WHERE id=?`, items[0].product_id);
  if (!product) return false;

  // Materialize per-item rows FIRST (issue #4): every item gets its own
  // status row with its own mode + recipient, so delivery below never
  // drops items[1..n]. Idempotent (UNIQUE order_code+item_index); legacy
  // rows keep their progress. A materialization failure is NOT success:
  // without one row per ordered line the order must not proceed to
  // delivered, so bail out and let the next run retry (review R2).
  try {
    await ensureFulfillmentItems(order);
  } catch {
    return false;
  }
  const materialized = await queryAll(
    `SELECT product_id, variant_id FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`,
    orderCode,
  ).catch(() => [] as Row[]);
  const orderedLines = parseOrderItems(order.items);
  const materializationComplete =
    materialized.length === orderedLines.length
    && orderedLines.every((line, index) =>
      Number(materialized[index]?.product_id) === Number(line.product_id)
      && Number(materialized[index]?.variant_id ?? 0) === Number(line.variant_id ?? 0),
    );
  if (!materializationComplete) return false;

  const variantId = Number(order.variant_id || items[0].variant_id || 0) || null;
  const variant = variantId && isD1Mode()
    ? await queryFirst(`SELECT fulfillment_mode FROM product_variants WHERE id=? AND product_id=?`, variantId, items[0].product_id)
    : null;
  const inventory = await queryFirst(
    `SELECT id FROM fulfillment_inventory WHERE order_code=? AND status='reserved'`,
    orderCode,
  );
  // Aggregate order status stays informative: delivered/manual_required only
  // when every item row settled (processJob enforces this); otherwise the
  // order mirrors the job/item aggregate instead of items[0].
  const itemRows = await queryAll(
    `SELECT status FROM fulfillment_items WHERE order_code=?`,
    orderCode,
  ).catch(() => [] as Row[]);
  const fulfillmentMode = itemRows.length
    ? allItemsSettled(itemRows)
      ? (allItemsDelivered(itemRows) ? "delivered" : "manual_required")
      : String(order.fulfillment_status || "queued")
    : String(
        inventory
          ? "unique"
          : fulfillmentModeFromOrderSnapshot(order)
            || variant?.fulfillment_mode
            || product.fulfillment_mode
            || "manual",
      );

  await createFulfillmentJob(
    orderCode,
    inventory ? Number(inventory.id) : null,
    fulfillmentMode,
    variantId,
    String(order.sales_channel || "telegram"),
  );

  // Older manual jobs were inserted as manual_required before payment. Requeue
  // only when the order itself has not yet entered manual fulfillment.
  if (String(order.fulfillment_status || "") !== "manual_required") {
    await execRun(
      `UPDATE fulfillment_jobs
       SET status='queued', next_attempt_at=datetime('now'), locked_until=NULL, updated_at=datetime('now')
       WHERE order_code=? AND status='manual_required'`,
      orderCode,
    );
  }

  const job = await queryFirst(`SELECT id FROM fulfillment_jobs WHERE order_code=?`, orderCode);
  if (!job) return false;
  // When AUTO_FULFILLMENT_ENABLED is off, the durable part is done: the
  // queued outbox row plus the Telegram paid ack above. Delivery itself
  // waits for the flag (or the admin .d path) — the order is never lost,
  // and recovery below never sends credentials twice (claimed exactly
  // once via claimJob, settled via markJobDelivered idempotency below).
  if (!autoFulfillmentEnabled) return false;
  return processJob(Number(job.id), order, product);
}
