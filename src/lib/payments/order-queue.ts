import { createDatabaseAccess, unwrapD1, type DatabaseAccess } from "@/lib/db-access";
import type { D1 } from "@/lib/db";

export type OrderKind = "apps" | "pedia" | "games";
export type FulfillmentEvent = "order_paid" | "supplier_settled";
export type OrderQueueMessage = {
  v: 1; kind: FulfillmentEvent; orderCode: string; orderKind: OrderKind;
  source: string; enqueuedAt: number; mode: "shadow" | "active";
};
type Mode = "off" | "shadow" | "active" | `canary:${OrderKind}`;
type QueueBinding = { send(message: OrderQueueMessage): Promise<void> };
const modes = new WeakMap<D1, { until: number; value: Promise<Mode> }>();

/** Missing/invalid setting or a failed read always keeps the existing path. */
async function modeFor(db: DatabaseAccess): Promise<Mode> {
  const key = unwrapD1(db.d1);
  const cached = key && modes.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  const value = Promise.resolve().then(() => db.queryFirst("SELECT value FROM store_settings WHERE key='queue_fulfillment_mode'"))
    .then(row => /^(off|shadow|active|canary:(apps|pedia|games))$/.test(String(row?.value)) ? row!.value as Mode : "off" as const)
    .catch(() => "off" as const);
  if (key) modes.set(key, { until: Date.now() + 30_000, value });
  return value;
}

export async function fulfillmentContext(): Promise<{ queue?: QueueBinding; waitUntil?: (task: Promise<unknown>) => void }> {
  try {
    const { getRequestContext } = await import("@cloudflare/next-on-pages");
    const { env, ctx } = getRequestContext();
    return {
      queue: (env as unknown as { ORDER_FULFILLMENT_QUEUE?: QueueBinding } | undefined)?.ORDER_FULFILLMENT_QUEUE,
      waitUntil: ctx.waitUntil.bind(ctx),
    };
  } catch { return {}; }
}

/** Call only after a durable transition wins. Active replaces, not adds to,
 * the old executor. An ambiguous send error may race it; existing CAS/fences
 * remain authoritative, including when producer mode is later rolled back. */
export async function routeFulfillment(
  event: Omit<OrderQueueMessage, "v" | "enqueuedAt" | "mode">,
  execute: () => Promise<unknown>,
  db = createDatabaseAccess(),
  background = true,
): Promise<void> {
  const context = await fulfillmentContext();
  const mode = await modeFor(db);
  const active = mode === "active" || mode === `canary:${event.orderKind}`;
  const log = (outcome: string) => console.info(JSON.stringify({ event: "order_fulfillment_producer", kind: event.kind,
    orderKind: event.orderKind, source: event.source, mode, outcome }));
  if (active || mode === "shadow") {
    try {
      if (event.kind === "supplier_settled" && !await db.queryFirst("SELECT code FROM orders WHERE code=? AND status='lunas' AND payment_status='paid'", event.orderCode)) {
        log("not_paid"); return;
      }
      if (!context.queue) throw new Error("queue_binding_missing");
      await context.queue.send({ ...event, v: 1, enqueuedAt: Date.now(), mode: active ? "active" : "shadow" });
      log("enqueued");
      if (active) return;
    } catch { log("send_error_fallback"); }
  }
  log("legacy_started");
  const started = Date.now();
  const task = Promise.resolve().then(execute).then(() => {
    console.info(JSON.stringify({ event: "order_fulfillment_legacy", kind: event.kind, orderKind: event.orderKind,
      source: event.source, mode, outcome: "pass_complete", durationMs: Date.now() - started }));
  }).catch(() => { log("cron_backstop"); });
  if (background && context.waitUntil) {
    try { context.waitUntil(task); return; } catch { /* Await this same task. */ }
  }
  await task;
}
