import { queryFirst } from "@/lib/db";
import { routeFulfillment, type FulfillmentEvent } from "./order-queue";
import { unwrapD1, type DatabaseAccess } from "@/lib/db-access";

/** Payment is already durable. Keep network dispatch alive after the browser
 * disconnects; cron remains the recovery path if background work is interrupted.
 * Resolve the request context before starting work so registration cannot race
 * a slow supplier call. Dev/tests without a Pages context await the same task.
 */
export async function schedulePaidFulfillment(
  orderCode: string, orderKind: unknown, source = "payment", kind: FulfillmentEvent = "order_paid",
  execute?: () => Promise<unknown>,
  database?: DatabaseAccess,
): Promise<void> {
  const normalized = orderKind === "pedia" || orderKind === "games" ? orderKind : "apps";
  const metered = database?.d1 && unwrapD1(database.d1) !== database.d1;
  // Payment cron already committed the durable outbox. Never start an
  // unmetered call tree inside its 40-statement invocation; active can enqueue,
  // off/shadow/send-error retain the dedicated fulfillment cron backstop.
  const legacy = execute ?? (metered ? async () => {
    console.info(JSON.stringify({ event: "order_fulfillment_producer", kind, orderKind: normalized, source, outcome: "cron_deferred" }));
  } : () => fulfillPaidOrder(orderCode, normalized));
  await routeFulfillment({ kind, orderCode, orderKind: normalized, source }, legacy, database, !metered);
}

export async function fulfillPaidOrder(orderCode: string, orderKind: unknown, deadlineMs = Infinity): Promise<void> {
  // Only the Queue executor supplies a finite deadline; keep legacy waitUntil unchanged.
  const queuePass = Number.isFinite(deadlineMs);
  const remaining = () => Date.now() < deadlineMs;
  if (!remaining()) return;
  if (orderKind === "pedia") {
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    await processPediaPaidOrders(undefined, undefined, { orderCode, deadlineMs });
    return;
  }
  if (orderKind === "games") {
    try {
      const { notifyGamesPaid } = await import("@/lib/games/notify");
      const { createDatabaseAccess } = await import("@/lib/db-access");
      await notifyGamesPaid(createDatabaseAccess(), orderCode);
    } catch { /* Email failure never blocks fulfillment on any payment rail. */ }
    const { processGamesPaidOrders } = await import("@/lib/games/dispatch");
    if (remaining()) await processGamesPaidOrders(undefined, undefined, { orderCode, deadlineMs });
    if (remaining()) {
      const { notifyGamesCompleted } = await import("@/lib/games/notify");
      const { createDatabaseAccess } = await import("@/lib/db-access");
      await notifyGamesCompleted(createDatabaseAccess(), orderCode).catch(() => undefined);
    }
    return;
  }
  const order = await queryFirst("SELECT * FROM orders WHERE code=? AND status='lunas' AND payment_status='paid'", orderCode);
  if (!order) return;
  const { createTunvnOrderLinks,processTunvnOrders } = await import("@/lib/tunvn/orders");
  if (!remaining()) return;
  await createTunvnOrderLinks(orderCode);
  const { createAivaultOrderLinks, processAivaultOrders } = await import("@/lib/aivault/orders");
  if (!remaining()) return;
  await createAivaultOrderLinks(orderCode);
  const { createStorebatOrderLinks, processStorebatOrders } = await import("@/lib/storebat/orders");
  if (!remaining()) return;
  await createStorebatOrderLinks(orderCode);
  const { createMiraiOrderLinks, processMiraiOrders } = await import("@/lib/mirai/orders");
  if (!remaining()) return;
  await createMiraiOrderLinks(orderCode);
  const { createPixelverifOrderLinks, processPixelverifOrders } = await import("@/lib/pixelverif/orders");
  if (!remaining()) return;
  await createPixelverifOrderLinks(orderCode);
  // Bind supplier ownership before generic fulfillment can mark a manual-mode
  // supplier variant as requiring admin handover or send misleading notices.
  const { ensureFulfillmentItems } = await import("@/lib/fulfillment/delivery/inventory-binding");
  if (!remaining()) return;
  await ensureFulfillmentItems(order);
  const work: (() => Promise<unknown>)[] = [];
  // The concurrent generic pass may run before supplier credentials arrive.
  // Attempt delivery again after supplier purchases settle; cron stays the backstop.
  for (const processOrders of [processTunvnOrders, processAivaultOrders, processStorebatOrders, processMiraiOrders, processPixelverifOrders]) {
    work.push(async () => {
      if (remaining() && await processOrders(undefined, { orderCode, deadlineMs })) {
        const { ensureFulfillmentForPaidOrder } = await import("@/lib/fulfillment/deliver");
        if (remaining()) await (Number.isFinite(deadlineMs) ? ensureFulfillmentForPaidOrder(orderCode, deadlineMs) : ensureFulfillmentForPaidOrder(orderCode));
      }
    });
  }
  try {
    const { createWrOrderLinksForOrder, processWrPendingOrders } = await import("@/lib/warung-rebahan/order");
    const { isWrAutoOrderEnabled } = await import("@/lib/warung-rebahan/client");
    if (remaining() && isWrAutoOrderEnabled()) {
      if ((await createWrOrderLinksForOrder(orderCode)) > 0 || queuePass) {
        work.push(() => processWrPendingOrders(undefined, { skipOrphanProbe: true, orderCode, limit: 1 }));
      }
    }
  } catch { /* Existing cron repairs and dispatches missing links. */ }
  try {
    const { createSkOrderLinksForOrder, processSkPendingOrders } = await import("@/lib/sekalipay/order");
    const { isSkAutoOrderEnabled } = await import("@/lib/sekalipay/client");
    if (remaining() && isSkAutoOrderEnabled()) {
      if ((await createSkOrderLinksForOrder(orderCode)) > 0 || queuePass) {
        work.push(() => processSkPendingOrders(undefined, { skipOrphanProbe: true, orderCode, limit: 1 }));
      }
    }
  } catch { /* Existing cron repairs and dispatches missing links. */ }
  const { ensureFulfillmentForPaidOrder } = await import("@/lib/fulfillment/deliver");
  work.unshift(() => Number.isFinite(deadlineMs) ? ensureFulfillmentForPaidOrder(orderCode, deadlineMs) : ensureFulfillmentForPaidOrder(orderCode));
  // Supplier completion messages can arrive after the purchase pass. Resume
  // their existing channel ledgers, never purchase again to repair delivery.
  work.push(async () => {
    const { queryAll } = await import("@/lib/db");
    const links = await queryAll("SELECT id FROM wr_order_links WHERE order_code=? AND status='completed' AND delivery_status IN ('queued','failed') LIMIT 1", orderCode);
    const { processCredentialDelivery } = await import("@/lib/warung-rebahan/deliver");
    for (const link of links) if (remaining()) await processCredentialDelivery(Number(link.id));
    if (!remaining()) return;
    const sk = await queryAll(`SELECT fulfillment_item_id FROM sk_order_links WHERE order_code=? AND status='completed'${queuePass ? " ORDER BY id" : " LIMIT 1"}`, orderCode);
    const { deliverSkCredentialToBuyer } = await import("@/lib/sekalipay/deliver");
    for (const link of sk) if (remaining()) await deliverSkCredentialToBuyer(orderCode, Number(link.fulfillment_item_id));
  });
  // One immediate purchase per supplier, scoped to THIS order. Additional
  // links stay durable for cron instead of exceeding waitUntil's time window.
  if (!queuePass) {
    await Promise.allSettled(work.map(run => Promise.resolve().then(run)));
    return;
  }
  for (const run of work) {
    if (!remaining()) break;
    await run().catch(() => undefined);
  }
}
