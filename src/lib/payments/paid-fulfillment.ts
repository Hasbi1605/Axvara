import { queryFirst } from "@/lib/db";

/** Payment is already durable. Keep network dispatch alive after the browser
 * disconnects; cron remains the recovery path if background work is interrupted.
 * Resolve the request context before starting work so registration cannot race
 * a slow supplier call. Dev/tests without a Pages context await the same task.
 */
export async function schedulePaidFulfillment(orderCode: string, orderKind: unknown): Promise<void> {
  let waitUntil: ((task: Promise<unknown>) => void) | undefined;
  try {
    const { getRequestContext } = await import("@cloudflare/next-on-pages");
    const ctx = getRequestContext().ctx;
    waitUntil = ctx.waitUntil.bind(ctx);
  } catch { /* Dev/test has no Pages execution context. */ }
  const task = fulfillPaidOrder(orderCode, orderKind).catch(() => {
    console.error("Paid fulfillment deferred to existing cron", orderCode);
  });
  if (waitUntil) {
    try { waitUntil(task); return; } catch { /* Await the same task, never start twice. */ }
  }
  await task;
}

async function fulfillPaidOrder(orderCode: string, orderKind: unknown): Promise<void> {
  if (orderKind === "pedia") {
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    await processPediaPaidOrders();
    return;
  }
  if (orderKind === "games") {
    const { processGamesPaidOrders } = await import("@/lib/games/dispatch");
    await processGamesPaidOrders();
    return;
  }
  const order = await queryFirst("SELECT * FROM orders WHERE code=? AND status='lunas' AND payment_status='paid'", orderCode);
  if (!order) return;
  const { createTunvnOrderLinks,processTunvnOrders } = await import("@/lib/tunvn/orders");
  await createTunvnOrderLinks(orderCode);
  // Bind supplier ownership before generic fulfillment can mark a manual-mode
  // supplier variant as requiring admin handover or send misleading notices.
  const { ensureFulfillmentItems } = await import("@/lib/fulfillment/delivery/inventory-binding");
  await ensureFulfillmentItems(order);
  const work: (() => Promise<unknown>)[] = [];
  work.push(() => processTunvnOrders(undefined,{ orderCode }));
  try {
    const { createWrOrderLinksForOrder, processWrPendingOrders } = await import("@/lib/warung-rebahan/order");
    const { isWrAutoOrderEnabled } = await import("@/lib/warung-rebahan/client");
    if (isWrAutoOrderEnabled() && (await createWrOrderLinksForOrder(orderCode)) > 0) {
      work.push(() => processWrPendingOrders(undefined, { skipOrphanProbe: true, orderCode, limit: 1 }));
    }
  } catch { /* Existing cron repairs and dispatches missing links. */ }
  try {
    const { createSkOrderLinksForOrder, processSkPendingOrders } = await import("@/lib/sekalipay/order");
    const { isSkAutoOrderEnabled } = await import("@/lib/sekalipay/client");
    if (isSkAutoOrderEnabled() && (await createSkOrderLinksForOrder(orderCode)) > 0) {
      work.push(() => processSkPendingOrders(undefined, { skipOrphanProbe: true, orderCode, limit: 1 }));
    }
  } catch { /* Existing cron repairs and dispatches missing links. */ }
  const { ensureFulfillmentForPaidOrder } = await import("@/lib/fulfillment/deliver");
  work.push(() => ensureFulfillmentForPaidOrder(orderCode));
  // One immediate purchase per supplier, scoped to THIS order. Additional
  // links stay durable for cron instead of exceeding waitUntil's time window.
  await Promise.allSettled(work.map(run => Promise.resolve().then(run)));
}
