import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";

export const BROADCAST_QUEUE_NAME = "axvara-broadcast";
export const BROADCAST_DLQ_QUEUE_NAME = "axvara-broadcast-dlq";
export const BROADCAST_QUEUE_MODE_KEY = "broadcast_queue_mode";
export const BROADCAST_QUEUE_MAX_IDS = 50;
/**
 * 20 delivery IDs per queue message stays well under the 50-ID schema cap and
 * finishes cleanly inside a single 38s origin pass (even for 2-chunk Telegram
 * promos with real network latency or 650ms-paced email campaigns).
 */
export const BROADCAST_QUEUE_CHUNK_SIZE = 20;
export const BROADCAST_QUEUE_SEND_BATCH_MAX = 100;
export const BROADCAST_BACKSTOP_GRACE_MS = 120_000;

export type BroadcastQueueMessage = {
  v: 1;
  kind: "broadcast_deliveries";
  campaignId: string;
  deliveryIds: number[];
  enqueuedAt: number;
};

export type BroadcastQueueBatchItem = {
  body: BroadcastQueueMessage;
};

export type BroadcastQueueBinding = {
  send?(message: BroadcastQueueMessage): Promise<void>;
  sendBatch(messages: Iterable<BroadcastQueueBatchItem>): Promise<void>;
};

export type BroadcastQueueEnqueueResult = {
  enqueuedMessages: number;
  enqueuedDeliveries: number;
  skipped?: "mode_off" | "binding_missing" | "no_deliveries" | "query_budget" | "send_failed";
};

export function isBroadcastQueueModeOff(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "off";
}

export async function getBroadcastQueueBinding(): Promise<BroadcastQueueBinding | undefined> {
  try {
    const { getRequestContext } = await import("@cloudflare/next-on-pages");
    const { env } = getRequestContext();
    const binding = (env as unknown as { BROADCAST_QUEUE?: BroadcastQueueBinding } | undefined)?.BROADCAST_QUEUE;
    if (binding && typeof binding.sendBatch === "function") return binding;
  } catch {
    // Outside Cloudflare Pages request context (e.g. unit tests / local node).
  }
  const reqCtx = (
    globalThis as unknown as Record<symbol, { env?: Record<string, unknown> } | undefined>
  )[Symbol.for("__cloudflare-request-context__")];
  const fallback = (
    reqCtx?.env?.BROADCAST_QUEUE ??
    (globalThis as unknown as Record<string, unknown>).BROADCAST_QUEUE
  ) as BroadcastQueueBinding | undefined;
  return fallback && typeof fallback.sendBatch === "function" ? fallback : undefined;
}

/** True iff the Pages queue binding is present AND store_settings.broadcast_queue_mode !== 'off'. */
export async function isBroadcastQueueActive(db: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
  const binding = await getBroadcastQueueBinding();
  if (!binding) return false;
  if (!db.getD1() || !db.canSpend(1)) return false;
  try {
    const row = await db.queryFirst("SELECT value FROM store_settings WHERE key=?", BROADCAST_QUEUE_MODE_KEY);
    return !isBroadcastQueueModeOff(row?.value);
  } catch {
    return true;
  }
}

export function chunkDeliveryIds(
  ids: readonly number[],
  chunkSize = BROADCAST_QUEUE_CHUNK_SIZE,
): number[][] {
  const size = Math.max(1, Math.min(BROADCAST_QUEUE_MAX_IDS, Math.floor(chunkSize)));
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

/**
 * Push pending telegram/email deliveries for a newly created campaign to
 * BROADCAST_QUEUE in chunks (<=50 IDs per message, <=100 messages per sendBatch).
 * Never throws: if binding is absent, mode is 'off', or sendBatch fails, logs
 * only and lets the cron backstop deliver leftovers safely.
 */
export async function enqueueCampaignDeliveriesToQueue(
  campaignId: string,
  db: DatabaseAccess = createDatabaseAccess(),
  options: { modeValue?: unknown; chunkSize?: number } = {},
): Promise<BroadcastQueueEnqueueResult> {
  if (options.modeValue !== undefined && isBroadcastQueueModeOff(options.modeValue)) {
    console.info(JSON.stringify({ event: "broadcast_queue_producer", campaignId, outcome: "mode_off" }));
    return { enqueuedMessages: 0, enqueuedDeliveries: 0, skipped: "mode_off" };
  }

  const binding = await getBroadcastQueueBinding();
  if (!binding) {
    console.info(JSON.stringify({ event: "broadcast_queue_producer", campaignId, outcome: "binding_missing" }));
    return { enqueuedMessages: 0, enqueuedDeliveries: 0, skipped: "binding_missing" };
  }

  if (options.modeValue === undefined) {
    if (!db.canSpend(1)) {
      console.info(JSON.stringify({ event: "broadcast_queue_producer", campaignId, outcome: "query_budget" }));
      return { enqueuedMessages: 0, enqueuedDeliveries: 0, skipped: "query_budget" };
    }
    try {
      const row = await db.queryFirst("SELECT value FROM store_settings WHERE key=?", BROADCAST_QUEUE_MODE_KEY);
      if (isBroadcastQueueModeOff(row?.value)) {
        console.info(JSON.stringify({ event: "broadcast_queue_producer", campaignId, outcome: "mode_off" }));
        return { enqueuedMessages: 0, enqueuedDeliveries: 0, skipped: "mode_off" };
      }
    } catch {
      // Missing/unreadable setting defaults to active; proceed to enqueue.
    }
  }

  if (!db.canSpend(1)) {
    console.info(JSON.stringify({ event: "broadcast_queue_producer", campaignId, outcome: "query_budget" }));
    return { enqueuedMessages: 0, enqueuedDeliveries: 0, skipped: "query_budget" };
  }

  let enqueuedMessages = 0;
  let enqueuedDeliveries = 0;
  try {
    const rows = await db.queryAll(
      `SELECT id, channel FROM broadcast_deliveries
       WHERE campaign_id=? AND channel IN ('telegram','telegram_channel','email') AND status='pending'
       ORDER BY channel, id`,
      campaignId,
    );
    if (!rows.length) {
      return { enqueuedMessages: 0, enqueuedDeliveries: 0, skipped: "no_deliveries" };
    }

    // Group IDs by channel so a rate limit on Telegram never stalls Email chunks.
    const byChannel = new Map<string, number[]>();
    for (const row of rows) {
      const id = Number(row.id);
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      const channel = String(row.channel);
      const list = byChannel.get(channel);
      if (list) list.push(id);
      else byChannel.set(channel, [id]);
    }

    const enqueuedAt = Date.now();
    const chunkSize = options.chunkSize ?? BROADCAST_QUEUE_CHUNK_SIZE;
    const messages: BroadcastQueueBatchItem[] = [];
    for (const ids of byChannel.values()) {
      for (const deliveryIds of chunkDeliveryIds(ids, chunkSize)) {
        messages.push({
          body: {
            v: 1,
            kind: "broadcast_deliveries",
            campaignId,
            deliveryIds,
            enqueuedAt,
          },
        });
      }
    }
    if (!messages.length) {
      return { enqueuedMessages: 0, enqueuedDeliveries: 0, skipped: "no_deliveries" };
    }

    for (let i = 0; i < messages.length; i += BROADCAST_QUEUE_SEND_BATCH_MAX) {
      const slice = messages.slice(i, i + BROADCAST_QUEUE_SEND_BATCH_MAX);
      await binding.sendBatch(slice);
      enqueuedMessages += slice.length;
      for (const item of slice) enqueuedDeliveries += item.body.deliveryIds.length;
    }

    console.info(
      JSON.stringify({
        event: "broadcast_queue_producer",
        campaignId,
        outcome: "enqueued",
        messages: enqueuedMessages,
        deliveries: enqueuedDeliveries,
      }),
    );
    return { enqueuedMessages, enqueuedDeliveries };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "broadcast_queue_producer",
        campaignId,
        outcome: "send_error",
        messages: enqueuedMessages,
        deliveries: enqueuedDeliveries,
        error: error instanceof Error ? error.message.slice(0, 120) : "queue_send_failed",
      }),
    );
    return { enqueuedMessages, enqueuedDeliveries, skipped: "send_failed" };
  }
}
