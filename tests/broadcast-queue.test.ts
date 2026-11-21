import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import { enqueueDueTelegramPromo, promoCampaignId, TELEGRAM_PROMO_SETTINGS_KEY } from "@/lib/telegram/promo-broadcast";
import {
  BROADCAST_BACKSTOP_GRACE_MS,
  BROADCAST_QUEUE_MAX_IDS,
  BROADCAST_QUEUE_MODE_KEY,
  BROADCAST_QUEUE_SEND_BATCH_MAX,
  enqueueCampaignDeliveriesToQueue,
  type BroadcastQueueBatchItem,
  type BroadcastQueueMessage,
} from "@/lib/broadcasts/queue";
import { launchBroadcast } from "@/lib/broadcasts/store";
import {
  EMAIL_RECIPIENT_PACE_MS,
  processBroadcasts,
  TELEGRAM_RECIPIENT_PACE_MS,
} from "@/lib/broadcasts/worker";
import { POST as broadcastOriginPost } from "@/app/api/internal/queue/broadcast/route";
import { POST as cronLitePost } from "@/app/api/cron/lite/route";
import {
  BROADCAST_DLQ_QUEUE_NAME,
  BROADCAST_QUEUE_NAME,
  handleQueueBatch,
  type QueueEnv,
  type QueueMessage,
} from "../mcp-worker/src/queue";
import { createD1Fixture } from "./helpers/d1-fixture";

const queueMock = vi.hoisted(() => ({
  enabled: true,
  batches: [] as BroadcastQueueBatchItem[][],
  sendBatch: vi.fn(async (items: Iterable<BroadcastQueueBatchItem>) => {
    queueMock.batches.push(Array.from(items));
  }),
}));

vi.mock("@cloudflare/next-on-pages", () => ({
  getRequestContext: () => ({
    env: queueMock.enabled ? { BROADCAST_QUEUE: { sendBatch: queueMock.sendBatch } } : {},
    ctx: { waitUntil: vi.fn() },
  }),
}));

vi.mock("@/lib/whatsapp/gateway", async (original) => ({
  ...(await original<object>()),
  salesGatewayControl: vi.fn(async () => ({
    connected: true,
    botNumber: "6283181632507",
    botRevision: "initial",
    groupId: "120363123456789012@g.us",
    groupName: "AXVARA'S",
  })),
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "wa-fixture-1" })),
}));

let fx: ReturnType<typeof createD1Fixture>;

function seedPromoProducts(count = 3) {
  for (let i = 1; i <= count; i++) {
    fx.sql
      .prepare("INSERT INTO products(id,name,slug,price,stock,is_active) VALUES(?,?,?,?,5,1)")
      .run(i, `Produk ${i}`, `produk-${i}`, i * 10_000);
    fx.sql
      .prepare("INSERT INTO product_variants(product_id,sku,label,price,stock,is_active) VALUES(?,?,?, ?,5,1)")
      .run(i, `SKU-${i}`, "1 Bulan", i * 10_000);
  }
}

function seedTelegramUsers(count: number, startId = 100_001) {
  const stmt = fx.sql.prepare(
    "INSERT INTO telegram_users(user_id,chat_id,is_blocked,broadcast_opt_out) VALUES(?,?,0,0)",
  );
  for (let i = 0; i < count; i++) {
    const id = String(startId + i);
    stmt.run(id, id);
  }
}

function postOrigin(body: unknown, secret = "cron-secret") {
  return broadcastOriginPost(
    new NextRequest("https://axvara.tech/api/internal/queue/broadcast", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}

it("records a DLQ chunk once across redelivery without dispatching it and counts it in overview", async () => {
  const payload = { v: 1, kind: "broadcast_deliveries", campaignId: "00000000-0000-4000-8000-202611190001", deliveryIds: [10, 11], enqueuedAt: Date.now() };
  const ack = vi.fn();
  const retry = vi.fn();
  const msg = { id: "dlq-fixture", timestamp: new Date(), attempts: 1, body: payload, ack, retry };
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("https://origin.test/api/cron/broadcast-dlq");
    expect(ack.mock.calls.length).toBe(fetchFn.mock.calls.length - 1);
    const { POST } = await import("@/app/api/cron/broadcast-dlq/route");
    return POST(new Request(url, init));
  });
  const batch = { queue: BROADCAST_DLQ_QUEUE_NAME, messages: [msg], ackAll: vi.fn(), retryAll: vi.fn() };
  for (let i = 0; i < 2; i++) await handleQueueBatch(batch, { AXVARA_API_ORIGIN: "https://origin.test", AXVARA_CRON_SECRET: "cron-secret" }, { fetchFn, logFn: () => {} });
  expect(fetchFn).toHaveBeenCalledTimes(2);
  expect(ack).toHaveBeenCalledTimes(2);
  expect(retry).not.toHaveBeenCalled();
  expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key GLOB 'broadcast_dlq:*'").all()).toEqual([
    { value: JSON.stringify({ campaignId: payload.campaignId, deliveryIds: [10, 11] }) },
  ]);
  vi.stubEnv("ADMIN_EMAIL", "admin@axvara.tech");
  vi.stubEnv("ADMIN_JWT_SECRET", "dlq-fixture-admin-secret");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "a".repeat(64));
  const { createAdminToken, createIdleToken } = await import("@/lib/auth");
  const { token, sid } = await createAdminToken("admin@axvara.tech");
  const { GET } = await import("@/app/api/admin/overview/route");
  const res = await GET(new NextRequest("https://axvara.tech/api/admin/overview", {
    headers: { cookie: `axvara_admin_token=${token}; axvara_idle=${await createIdleToken(sid)}` },
  }));
  expect(await res.json()).toMatchObject({ broadcast_dlq_chunks: 1 });
});

async function flushTimersUntilSettled<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  promise.finally(() => {
    done = true;
  });
  while (!done) {
    if (vi.getTimerCount() > 0) {
      await vi.advanceTimersToNextTimerAsync();
    } else {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return promise;
}

beforeEach(() => {
  fx = createD1Fixture();
  queueMock.enabled = true;
  queueMock.batches = [];
  queueMock.sendBatch.mockReset().mockImplementation(async (items: Iterable<BroadcastQueueBatchItem>) => {
    queueMock.batches.push(Array.from(items));
  });
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token");
  vi.stubEnv("SITE_URL", "https://axvara.tech");
  vi.stubEnv("RESEND_API_KEY", "resend-key");
  vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@axvara.tech");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fx.close();
});

describe("Broadcast Cloudflare Queue end-to-end", () => {
  it("throughput + pacing + dedupe: 388 eligible Telegram recipients complete within <= 5 minutes with no double-sends even on duplicates or concurrent backstop", async () => {
    vi.useFakeTimers();
    const startMs = Date.parse("2026-11-19T02:05:00.000Z"); // 09:05 WIB
    vi.setSystemTime(startMs);

    seedPromoProducts(3);
    seedTelegramUsers(388);
    // Add ineligible rows that must never receive promo
    fx.sql.exec(
      "INSERT INTO telegram_users(user_id,chat_id,is_blocked,broadcast_opt_out) VALUES('9991','9991',1,0),('9992','9992',0,1),('-10088','-10088',0,0)",
    );

    const db = createDatabaseAccess(fx.db);
    const enq = await enqueueDueTelegramPromo(db, new Date(startMs));
    expect(enq.enqueued).toBe(388);
    expect(enq.campaignId).toBe(promoCampaignId("2026-11-19", "morning"));
    expect(queueMock.sendBatch).toHaveBeenCalled();

    // Validate chunking constraints: <= 50 IDs/message, <= 100 messages/sendBatch
    const allMessages: BroadcastQueueMessage[] = [];
    for (const batch of queueMock.batches) {
      expect(batch.length).toBeGreaterThan(0);
      expect(batch.length).toBeLessThanOrEqual(BROADCAST_QUEUE_SEND_BATCH_MAX);
      for (const item of batch) {
        expect(item.body.v).toBe(1);
        expect(item.body.kind).toBe("broadcast_deliveries");
        expect(item.body.campaignId).toBe(enq.campaignId);
        expect(item.body.deliveryIds.length).toBeGreaterThan(0);
        expect(item.body.deliveryIds.length).toBeLessThanOrEqual(BROADCAST_QUEUE_MAX_IDS);
        allMessages.push(item.body);
      }
    }
    const enqueuedIds = allMessages.flatMap((m) => m.deliveryIds);
    expect(enqueuedIds).toHaveLength(388);
    expect(new Set(enqueuedIds).size).toBe(388);

    // Mock Telegram Bot API recording exact simulated timestamps
    const events: Array<{ chatId: string; method: string; atMs: number }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const u = String(url);
        if (!u.includes("api.telegram.org")) throw new Error(`Unexpected fetch: ${u}`);
        const method = u.split("/").pop() || "";
        const body = JSON.parse(String(init?.body ?? "{}")) as { chat_id: string };
        events.push({ chatId: String(body.chat_id), method, atMs: Date.now() });
        return Response.json({ ok: true, result: { message_id: events.length } });
      }),
    );

    const consumerEnv: QueueEnv = {
      AXVARA_API_ORIGIN: "https://axvara.tech",
      AXVARA_CRON_SECRET: "cron-secret",
      QUEUE_CONSUMER_MODE: "active",
    };

    // Process all enqueued messages through mcp-worker in max_batch_size=10 batches
    // while periodically firing a concurrent cron backstop mid-flight.
    const consumerFetch = async (_url: string, init?: RequestInit) =>
      broadcastOriginPost(
        new NextRequest("https://axvara.tech/api/internal/queue/broadcast", {
          method: "POST",
          headers: init?.headers as Record<string, string>,
          body: String(init?.body ?? ""),
        }),
      );

    // Process all enqueued messages through mcp-worker in max_batch_size=10 batches
    // while firing a concurrent cron backstop on every batch (re-queuing any retried messages
    // exactly as Cloudflare Queues does if backstop ever grabs the lease past 2m).
    const queuePending: Array<{ body: BroadcastQueueMessage; attempts: number }> = allMessages.map((body) => ({
      body,
      attempts: 1,
    }));
    let batchNum = 0;
    while (queuePending.length > 0) {
      batchNum++;
      const slice = queuePending.splice(0, 10);
      const retried: Array<{ body: BroadcastQueueMessage; attempts: number; delaySeconds: number }> = [];
      const acks = slice.map(() => vi.fn());
      const batchMsgs: QueueMessage<unknown>[] = slice.map((item, idx) => ({
        id: `m-${batchNum}-${idx}`,
        timestamp: new Date(),
        body: item.body,
        attempts: item.attempts,
        ack: acks[idx],
        retry: (opts) => {
          retried.push({
            body: item.body,
            attempts: item.attempts + 1,
            delaySeconds: opts?.delaySeconds ?? 5,
          });
        },
      }));

      const batchRun = handleQueueBatch(
        {
          queue: BROADCAST_QUEUE_NAME,
          messages: batchMsgs,
          ackAll: vi.fn(),
          retryAll: vi.fn(),
        },
        consumerEnv,
        { fetchFn: consumerFetch, logFn: () => {} },
      );

      // Fire a concurrent cron backstop tick (production 2-min grace) alongside the queue batch
      const concurrentBackstop = processBroadcasts(db, 150, 40_000, {
        queueGraceMs: BROADCAST_BACKSTOP_GRACE_MS,
      });
      await vi.runAllTimersAsync();
      await Promise.all([batchRun, concurrentBackstop]);

      for (const r of retried) {
        expect(r.attempts).toBeLessThanOrEqual(4);
        queuePending.push({ body: r.body, attempts: r.attempts });
      }
      if (retried.length > 0) {
        vi.setSystemTime(Date.now() + Math.max(...retried.map((r) => r.delaySeconds)) * 1000);
      }
    }

    // Verify all 388 delivered exactly once: ONE sendMessage per recipient
    // (banner rides as link preview above the text, no separate sendPhoto)
    const photos = events.filter((e) => e.method === "sendPhoto");
    const texts = events.filter((e) => e.method === "sendMessage");
    expect(photos).toHaveLength(0);
    expect(texts).toHaveLength(388);
    expect(new Set(texts.map((e) => e.chatId)).size).toBe(388);

    // Verify pacing: >=250ms between consecutive recipients
    for (let i = 1; i < 388; i++) {
      expect(events[i].atMs - events[i - 1].atMs).toBeGreaterThanOrEqual(TELEGRAM_RECIPIENT_PACE_MS);
    }

    // Verify total simulated duration <= 5 minutes (300,000 ms)
    const elapsedMs = events[events.length - 1].atMs - startMs;
    expect(elapsedMs).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(elapsedMs).toBeGreaterThanOrEqual(387 * TELEGRAM_RECIPIENT_PACE_MS);

    // Campaign completed
    expect(
      (fx.sql.prepare("SELECT status FROM broadcast_campaigns WHERE id=?").get(enq.campaignId) as { status: string })
        .status,
    ).toBe("completed");

    // Replaying duplicate queue message (exact same deliveryIds) sends NOTHING
    const dupRes = await postOrigin({
      v: 1,
      kind: "broadcast_deliveries",
      campaignId: enq.campaignId,
      deliveryIds: allMessages[0].deliveryIds,
      attempt: 1,
    });
    expect(dupRes.status).toBe(200);
    expect(await dupRes.json()).toMatchObject({ ok: true, settled: true, sent: 0 });
    expect(events).toHaveLength(388);
  });

  it("never double-sends when duplicate queue messages or cron backstop overlap mid-send", async () => {
    seedPromoProducts(3);
    seedTelegramUsers(3);
    const slotTime = new Date("2026-11-19T02:05:00Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(slotTime);

    const db = createDatabaseAccess(fx.db);
    const enq = await enqueueDueTelegramPromo(db, slotTime);
    const ids = queueMock.batches[0][0].body.deliveryIds;

    let releaseFirstPhoto!: () => void;
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const method = String(url).split("/").pop() || "";
        const body = JSON.parse(String(init?.body ?? "{}")) as { chat_id: string };
        calls.push(`${body.chat_id}:${method}`);
        if (calls.length === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstPhoto = resolve;
          });
        }
        return Response.json({ ok: true, result: { message_id: calls.length } });
      }),
    );

    // Start first origin batch (blocks on user 1 sendMessage while holding global lease + row 1 'sending')
    const first = postOrigin({
      v: 1,
      kind: "broadcast_deliveries",
      campaignId: enq.campaignId,
      deliveryIds: [ids[0], ids[0], ids[1], ids[2]], // duplicate ID inside payload too
      attempt: 1,
    });
    await vi.waitFor(() => expect(releaseFirstPhoto).toBeTypeOf("function"));

    // Concurrent duplicate queue call while first holds lease -> lease_busy (0 sends)
    const dupConcurrent = await postOrigin({
      v: 1,
      kind: "broadcast_deliveries",
      campaignId: enq.campaignId,
      deliveryIds: ids,
      attempt: 1,
    });
    expect(await dupConcurrent.json()).toMatchObject({ ok: true, settled: false, state: "lease_busy" });

    // Concurrent cron backstop while first holds lease -> yields (0 sends)
    const backstopConcurrent = await processBroadcasts(db, 150, 40_000);
    expect(backstopConcurrent).toMatchObject({ sent: 0, skipped: 0, deferred: 0 });
    expect(calls).toHaveLength(1);

    // Release first batch -> completes all 3 users exactly once
    releaseFirstPhoto();
    const firstJson = await (await first).json();
    expect(firstJson).toMatchObject({ ok: true, settled: true, state: "done", sent: 3 });
    expect(calls.filter((c) => c.endsWith(":sendPhoto"))).toHaveLength(0);
    expect(calls.filter((c) => c.endsWith(":sendMessage"))).toHaveLength(3);
  }, 15_000);

  it("429 mid-batch stops immediately, returns settled:false with retrySec, and retry resends only the deferred recipient", async () => {
    vi.useFakeTimers();
    const t0 = Date.parse("2026-11-19T02:05:00.000Z");
    vi.setSystemTime(t0);

    seedPromoProducts(3);
    seedTelegramUsers(4);
    const db = createDatabaseAccess(fx.db);
    const enq = await enqueueDueTelegramPromo(db, new Date(t0));
    const ids = queueMock.batches[0][0].body.deliveryIds;
    expect(ids).toHaveLength(4);

    const calls: string[] = [];
    let triggered429 = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const method = String(url).split("/").pop() || "";
        const body = JSON.parse(String(init?.body ?? "{}")) as { chat_id: string };
        calls.push(`${body.chat_id}:${method}`);
        // User 100001 succeeds (msg #1); user 100002 hits 429 retry_after=17 (#2) once
        if (!triggered429 && calls.length === 2) {
          triggered429 = true;
          return Response.json({ ok: false, error_code: 429, parameters: { retry_after: 17 } });
        }
        return Response.json({ ok: true, result: { message_id: calls.length } });
      }),
    );

    const pass1Promise = postOrigin({
      v: 1,
      kind: "broadcast_deliveries",
      campaignId: enq.campaignId,
      deliveryIds: ids,
      attempt: 1,
    });
    await vi.runAllTimersAsync();
    const pass1 = await (await pass1Promise).json();

    expect(pass1).toMatchObject({
      ok: true,
      settled: false,
      state: "rate_limited",
      retrySec: 17,
      sent: 1,
      deferred: 1,
    });
    // Users 100003 and 100004 were NEVER touched after 429!
    expect(calls).toEqual([
      "100001:sendMessage",
      "100002:sendMessage",
    ]);

    // User 100002 stays pending without progress and did not burn attempts
    const row2 = fx.sql
      .prepare("SELECT status, attempts, provider_id FROM broadcast_deliveries WHERE recipient_id='100002'")
      .get() as { status: string; attempts: number; provider_id: string | null };
    expect(row2.status).toBe("pending");
    expect(row2.attempts).toBe(0);
    expect(row2.provider_id).toBeNull();

    // Calling again during cooldown does not hit Telegram
    calls.length = 0;
    const earlyRetry = await (
      await postOrigin({
        v: 1,
        kind: "broadcast_deliveries",
        campaignId: enq.campaignId,
        deliveryIds: ids,
        attempt: 2,
      })
    ).json();
    expect(earlyRetry).toMatchObject({ ok: true, settled: false, state: "rate_limited" });
    expect(calls).toEqual([]);

    // Advance past 17s cooldown and retry same message -> each remaining user gets exactly one sendMessage
    vi.setSystemTime(Date.now() + 18_000);
    const pass2Promise = postOrigin({
      v: 1,
      kind: "broadcast_deliveries",
      campaignId: enq.campaignId,
      deliveryIds: ids,
      attempt: 2,
    });
    await vi.runAllTimersAsync();
    const pass2 = await (await pass2Promise).json();

    expect(pass2).toMatchObject({ ok: true, settled: true, state: "done", sent: 3, deferred: 0 });
    expect(calls).toEqual([
      "100002:sendMessage",
      "100003:sendMessage",
      "100004:sendMessage",
    ]);
  });

  it("handles 403 is_blocked, opt-out skip, expired slot skip, and never resends unknown or sending rows", async () => {
    vi.useFakeTimers();
    const t0 = Date.parse("2026-11-19T02:05:00.000Z");
    vi.setSystemTime(t0);

    seedPromoProducts(3);
    seedTelegramUsers(5);
    const db = createDatabaseAccess(fx.db);
    const enq = await enqueueDueTelegramPromo(db, new Date(t0));
    const ids = queueMock.batches[0][0].body.deliveryIds;
    expect(ids).toHaveLength(5);

    // User 100002 opts out after enqueue; 100003 already 'unknown'; 100004 actively 'sending'
    fx.sql.exec("UPDATE telegram_users SET broadcast_opt_out=1 WHERE user_id='100002'");
    fx.sql.exec("UPDATE broadcast_deliveries SET status='unknown' WHERE recipient_id='100003'");
    fx.sql
      .prepare("UPDATE broadcast_deliveries SET status='sending', lease_until=? WHERE recipient_id='100004'")
      .run(new Date(t0 + 90_000).toISOString());

    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const method = String(url).split("/").pop() || "";
        const body = JSON.parse(String(init?.body ?? "{}")) as { chat_id: string };
        calls.push(`${body.chat_id}:${method}`);
        // User 100001 returns 403 blocked
        if (String(body.chat_id) === "100001") {
          return Response.json({ ok: false, error_code: 403, description: "Forbidden: bot was blocked" });
        }
        return Response.json({ ok: true, result: { message_id: calls.length } });
      }),
    );

    const runPromise = postOrigin({
      v: 1,
      kind: "broadcast_deliveries",
      campaignId: enq.campaignId,
      deliveryIds: ids,
      attempt: 1,
    });
    await vi.runAllTimersAsync();
    const res = await (await runPromise).json();

    expect(res).toMatchObject({ ok: true, settled: true, state: "done", sent: 1, skipped: 2 });
    expect(calls).toEqual(["100001:sendMessage", "100005:sendMessage"]);
    expect(
      (fx.sql.prepare("SELECT is_blocked FROM telegram_users WHERE user_id='100001'").get() as { is_blocked: number })
        .is_blocked,
    ).toBe(1);
    expect(
      (fx.sql.prepare("SELECT status, last_error FROM broadcast_deliveries WHERE recipient_id='100002'").get() as {
        status: string;
        last_error: string;
      }),
    ).toEqual({ status: "skipped", last_error: "recipient_unsubscribed" });
    expect(
      (fx.sql.prepare("SELECT status FROM broadcast_deliveries WHERE recipient_id='100003'").get() as { status: string })
        .status,
    ).toBe("unknown");
    expect(
      (fx.sql.prepare("SELECT status FROM broadcast_deliveries WHERE recipient_id='100004'").get() as { status: string })
        .status,
    ).toBe("sending");

    // Replaying batch containing only 'unknown' and active 'sending' rows never resends them
    calls.length = 0;
    const replay = await (
      await postOrigin({
        v: 1,
        kind: "broadcast_deliveries",
        campaignId: enq.campaignId,
        deliveryIds: [ids[2], ids[3]],
        attempt: 2,
      })
    ).json();
    expect(replay).toMatchObject({ ok: true, settled: true, state: "already_claimed", sent: 0 });
    expect(calls).toEqual([]);

    // Expired slot: create evening campaign at 19:55 WIB, advance past 20:00 WIB -> skipped without fetch
    const eveningStart = Date.parse("2026-11-19T12:55:00.000Z"); // 19:55 WIB
    vi.setSystemTime(eveningStart);
    queueMock.batches = [];
    const eveningEnq = await enqueueDueTelegramPromo(db, new Date(eveningStart));
    const eveningIds = queueMock.batches[0][0].body.deliveryIds;
    expect(eveningIds.length).toBeGreaterThan(0);

    vi.setSystemTime(Date.parse("2026-11-19T13:00:01.000Z")); // 20:00:01 WIB (expired)
    calls.length = 0;
    const expRes = await (
      await postOrigin({
        v: 1,
        kind: "broadcast_deliveries",
        campaignId: eveningEnq.campaignId,
        deliveryIds: eveningIds,
        attempt: 1,
      })
    ).json();
    expect(expRes).toMatchObject({
      ok: true,
      settled: true,
      state: "promo_expired",
      sent: 0,
      skipped: eveningIds.length,
    });
    expect(calls).toEqual([]);
    expect(
      (fx.sql.prepare("SELECT status FROM broadcast_campaigns WHERE id=?").get(eveningEnq.campaignId) as {
        status: string;
      }).status,
    ).toBe("completed");
  });

  it("enforces strict auth (401) and schema validation (400) before touching D1", async () => {
    const valid = {
      v: 1,
      kind: "broadcast_deliveries",
      campaignId: "00000000-0000-4000-8000-202611190001",
      deliveryIds: [1],
      attempt: 1,
    };
    fx.control.queries = 0;
    expect((await postOrigin(valid, "wrong")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await postOrigin(valid, "cron-secret")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "cron-secret");

    for (const bad of [
      { ...valid, v: 2 },
      { ...valid, kind: "other" },
      { ...valid, campaignId: "not-a-uuid" },
      { ...valid, deliveryIds: [] },
      { ...valid, deliveryIds: Array.from({ length: 51 }, (_, i) => i + 1) },
      { ...valid, deliveryIds: [0] },
      { ...valid, deliveryIds: [-5] },
      { ...valid, attempt: 0 },
      { ...valid, extra: true },
    ]) {
      expect((await postOrigin(bad)).status).toBe(400);
    }
    expect(fx.control.queries).toBe(0);
  });

  it("manual Siaran enqueues telegram/email in separate channel chunks, leaves WhatsApp out, keeps email 650ms spacing, and chunks sendBatch <= 100", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-11-19T02:05:00.000Z"));

    const templateId = "11111111-1111-4111-8111-111111111111";
    const campaignId = "22222222-2222-4222-8222-222222222222";
    fx.sql
      .prepare("INSERT INTO broadcast_templates(id,name,title,body,cta_label,cta_url) VALUES(?,?,?,?,?,?)")
      .run(templateId, "Promo Manual", "Judul", "Isi pesan", "Buka", "https://axvara.tech/");
    fx.sql
      .prepare("INSERT INTO newsletter_subscribers(id,email,status,unsubscribe_token) VALUES(1,?,?,?),(2,?,?,?)")
      .run("a@example.test", "active", "a".repeat(64), "b@example.test", "active", "b".repeat(64));
    seedTelegramUsers(2, 501);

    const db = createDatabaseAccess(fx.db);
    const launchRes = await launchBroadcast(
      {
        id: campaignId,
        templateId,
        revision: 1,
        channels: ["email", "telegram", "whatsapp"],
        waIdentity: { botNumber: "6283181632507", botRevision: "initial", groupId: "120363123456789012@g.us" },
      },
      "admin@axvara.tech",
      db,
    );
    expect(launchRes).toEqual({ id: campaignId, replayed: false });
    expect(queueMock.batches).toHaveLength(1);
    // 2 messages: 1 for email (2 IDs), 1 for telegram (2 IDs); WhatsApp NOT queued
    expect(queueMock.batches[0]).toHaveLength(2);
    const queuedDeliveryIds = queueMock.batches[0].flatMap((m) => m.body.deliveryIds);
    const queuedChannels = fx.sql
      .prepare(`SELECT DISTINCT channel FROM broadcast_deliveries WHERE id IN (${queuedDeliveryIds.join(",")}) ORDER BY channel`)
      .all();
    expect(queuedChannels).toEqual([{ channel: "email" }, { channel: "telegram" }]);

    // Idempotent replay does NOT push to BROADCAST_QUEUE again
    queueMock.sendBatch.mockClear();
    const replay = await launchBroadcast(
      {
        id: campaignId,
        templateId,
        revision: 1,
        channels: ["email", "telegram", "whatsapp"],
        waIdentity: { botNumber: "6283181632507", botRevision: "initial", groupId: "120363123456789012@g.us" },
      },
      "admin@axvara.tech",
      db,
    );
    expect(replay).toEqual({ id: campaignId, replayed: true });
    expect(queueMock.sendBatch).not.toHaveBeenCalled();

    // Verify email per-send spacing (>= 650ms) via origin endpoint
    const emailTimes: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (!String(url).includes("api.resend.com")) throw new Error(`Unexpected fetch: ${String(url)}`);
        emailTimes.push(Date.now());
        return Response.json({ id: `resend-${emailTimes.length}` });
      }),
    );
    const emailMsg = queueMock.batches[0][0].body;
    const emailRun = postOrigin({
      v: 1,
      kind: "broadcast_deliveries",
      campaignId,
      deliveryIds: emailMsg.deliveryIds,
      attempt: 1,
    });
    await vi.runAllTimersAsync();
    expect(await (await emailRun).json()).toMatchObject({ ok: true, settled: true, state: "done", sent: 2 });
    expect(emailTimes).toHaveLength(2);
    expect(emailTimes[1] - emailTimes[0]).toBeGreaterThanOrEqual(EMAIL_RECIPIENT_PACE_MS);

    // Verify sendBatch slices at <= 100 messages per call when > 100 messages are produced
    const bigCampaign = "33333333-3333-4333-8333-333333333333";
    seedTelegramUsers(125, 200_001);
    queueMock.batches = [];
    queueMock.sendBatch.mockClear();
    // Create campaign manually to test enqueueCampaignDeliveriesToQueue with chunkSize=1 (127 messages -> 100 + 27)
    fx.sql
      .prepare(
        "INSERT INTO broadcast_campaigns(id,fingerprint,template_id,template_revision,snapshot_json,channels_json,status,created_by) VALUES(?,'fp2',?,1,'{}','[\"telegram\"]','queued','admin')",
      )
      .run(bigCampaign, templateId);
    fx.sql
      .prepare(
        "INSERT INTO broadcast_deliveries(campaign_id,channel,recipient_id,destination) SELECT ?,'telegram',user_id,chat_id FROM telegram_users",
      )
      .run(bigCampaign);
    const bigRes = await enqueueCampaignDeliveriesToQueue(bigCampaign, db, { chunkSize: 1 });
    expect(bigRes.enqueuedMessages).toBe(127);
    expect(queueMock.sendBatch).toHaveBeenCalledTimes(2);
    expect(queueMock.batches[0]).toHaveLength(100);
    expect(queueMock.batches[1]).toHaveLength(27);
  });

  it("respects broadcast_queue_mode='off', telegram_promo_broadcast_enabled='false', and falls back cleanly on absent binding or sendBatch error", async () => {
    const slotTime = new Date("2026-11-19T02:05:00Z");
    seedPromoProducts(3);
    seedTelegramUsers(3);
    const db = createDatabaseAccess(fx.db);

    // 1. telegram_promo_broadcast_enabled='false' stays unchanged
    fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES(?,'false')").run(TELEGRAM_PROMO_SETTINGS_KEY);
    expect(await enqueueDueTelegramPromo(db, slotTime)).toMatchObject({ skipped: "disabled", enqueued: 0 });
    expect(queueMock.sendBatch).not.toHaveBeenCalled();

    // 2. broadcast_queue_mode='off' disables producing AND makes origin ack with queue_disabled
    fx.sql.prepare("UPDATE store_settings SET value='true' WHERE key=?").run(TELEGRAM_PROMO_SETTINGS_KEY);
    fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES(?,'off')").run(BROADCAST_QUEUE_MODE_KEY);
    const enqOff = await enqueueDueTelegramPromo(db, slotTime);
    expect(enqOff.enqueued).toBe(3);
    expect(queueMock.sendBatch).not.toHaveBeenCalled();

    const originOff = await postOrigin({
      v: 1,
      kind: "broadcast_deliveries",
      campaignId: enqOff.campaignId,
      deliveryIds: [1, 2, 3],
      attempt: 1,
    });
    expect(await originOff.json()).toEqual({
      ok: true,
      settled: true,
      state: "queue_disabled",
      sent: 0,
      unknown: 0,
      failed: 0,
      skipped: 0,
      deferred: 0,
    });

    // 3. sendBatch failure does not abort enqueue; cron backstop delivers leftovers
    fx.sql.prepare("DELETE FROM store_settings WHERE key=?").run(BROADCAST_QUEUE_MODE_KEY);
    queueMock.sendBatch.mockRejectedValueOnce(new Error("queue temporarily unavailable"));
    const eveTime = new Date("2026-11-19T10:05:00Z"); // 17:05 WIB
    const enqFail = await enqueueDueTelegramPromo(db, eveTime);
    expect(enqFail.enqueued).toBe(3);
    expect(enqFail.queuedMessages).toBeUndefined();

    // 4. Absent binding logs only and succeeds cleanly
    queueMock.enabled = false;
    const nextDay = new Date("2026-11-20T02:05:00Z");
    const enqNoBind = await enqueueDueTelegramPromo(db, nextDay);
    expect(enqNoBind.enqueued).toBe(3);
  });

  it("cron/lite?job=promo uses dedicated 400-statement budget, respects 2-minute queue grace for telegram/email while delivering WA immediately, and sweeps aged/off-mode rows > 8 in one tick", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const startMs = Date.parse("2026-11-19T02:05:00.000Z"); // 09:05 WIB
    vi.setSystemTime(startMs);
    // Mark daily admin summary already sent so runPromo isolates promo + broadcast backstop
    fx.sql
      .prepare("INSERT INTO store_settings(key,value) VALUES('admin_daily_summary_state',?)")
      .run(JSON.stringify({ sent_date: "2026-11-19", sent_at: "2026-11-19T00:00:00.000Z" }));

    seedPromoProducts(3);
    seedTelegramUsers(22);

    const tgSent: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const u = String(url);
        if (!u.includes("api.telegram.org")) throw new Error(`Unexpected fetch: ${u}`);
        const method = u.split("/").pop() || "";
        const body = JSON.parse(String(init?.body ?? "{}")) as { chat_id: string };
        if (method === "sendMessage") tgSent.push(String(body.chat_id));
        return Response.json({ ok: true, result: { message_id: tgSent.length + 1 } });
      }),
    );

    // Tick 1 (T=0, queue active + binding present): promo enqueues 22 rows to BROADCAST_QUEUE,
    // cron backstop does NOT steal fresh (<2 min) telegram rows.
    const tick1Res = await flushTimersUntilSettled(
      cronLitePost(
        new NextRequest("http://localhost/api/cron/lite?job=promo", {
          method: "POST",
          headers: { authorization: "Bearer cron-secret" },
        }),
      ),
    );
    const tick1 = await tick1Res.json();
    expect(tick1).toMatchObject({
      ok: true,
      job: "promo",
      promo_due: true,
      promo_enqueued: 22,
      promo_queued_messages: 2,
      broadcasts: { sent: 0, skipped: 0, failed: 0, unknown: 0, deferred: 0 },
    });
    expect(tgSent).toHaveLength(0);

    // Launch a WhatsApp-only manual campaign: cron backstop delivers WA immediately (<2 min)!
    const templateId = "44444444-4444-4444-8444-444444444444";
    const waCampaign = "55555555-5555-4555-8555-555555555555";
    fx.sql
      .prepare("INSERT INTO broadcast_templates(id,name,title,body,cta_label,cta_url) VALUES(?,?,?,?,?,?)")
      .run(templateId, "WA", "Info", "Halo grup", "", "");
    await launchBroadcast(
      {
        id: waCampaign,
        templateId,
        revision: 1,
        channels: ["whatsapp"],
        waIdentity: { botNumber: "6283181632507", botRevision: "initial", groupId: "120363123456789012@g.us" },
      },
      "admin@axvara.tech",
      createDatabaseAccess(fx.db),
    );
    const waTickRes = await flushTimersUntilSettled(
      cronLitePost(
        new NextRequest("http://localhost/api/cron/lite?job=promo", {
          method: "POST",
          headers: { authorization: "Bearer cron-secret" },
        }),
      ),
    );
    const waTick = await waTickRes.json();
    expect(waTick.broadcasts).toMatchObject({ sent: 1 }); // WA sent immediately, TG still deferred by 2m grace
    expect(tgSent).toHaveLength(0);

    // Tick 2 (T+2m05s, simulating queue missed/DLQ): cron backstop sweeps ALL 22 (>8 cap, >40 statements) in ONE tick!
    vi.setSystemTime(startMs + 125_000);
    const tick2Res = await flushTimersUntilSettled(
      cronLitePost(
        new NextRequest("http://localhost/api/cron/lite?job=promo", {
          method: "POST",
          headers: { authorization: "Bearer cron-secret" },
        }),
      ),
    );
    const tick2 = await tick2Res.json();
    expect(tick2).toMatchObject({
      ok: true,
      job: "promo",
      broadcasts: { sent: 22, skipped: 0, failed: 0, unknown: 0, deferred: 0 },
    });
    expect(tgSent).toHaveLength(22);

    // With broadcast_queue_mode='off', cron/lite?job=promo delivers fresh pending rows immediately (0 grace delay)
    fx.sql.prepare("INSERT OR REPLACE INTO store_settings(key,value) VALUES(?,'off')").run(BROADCAST_QUEUE_MODE_KEY);
    const eveStart = Date.parse("2026-11-19T10:05:00.000Z"); // 17:05 WIB
    vi.setSystemTime(eveStart);
    tgSent.length = 0;
    queueMock.sendBatch.mockClear();
    const offTickRes = await flushTimersUntilSettled(
      cronLitePost(
        new NextRequest("http://localhost/api/cron/lite?job=promo", {
          method: "POST",
          headers: { authorization: "Bearer cron-secret" },
        }),
      ),
    );
    const offTick = await offTickRes.json();
    expect(queueMock.sendBatch).not.toHaveBeenCalled();
    expect(offTick).toMatchObject({
      ok: true,
      job: "promo",
      promo_enqueued: 22,
      broadcasts: { sent: 22 },
    });
    expect(tgSent).toHaveLength(22);
  });

  it("origin recovers expired 'sending' leases: Telegram becomes unknown (never re-sent), Email within 23h retries once", async () => {
    vi.useFakeTimers();
    const t0 = Date.parse("2026-11-19T02:05:00.000Z");
    vi.setSystemTime(t0);

    const templateId = "66666666-6666-4666-8666-666666666666";
    const campaignId = "77777777-7777-4777-8777-777777777777";
    fx.sql
      .prepare("INSERT INTO broadcast_templates(id,name,title,body,cta_label,cta_url) VALUES(?,?,?,?,?,?)")
      .run(templateId, "T", "Judul", "Isi", "", "");
    fx.sql
      .prepare("INSERT INTO newsletter_subscribers(id,email,status,unsubscribe_token) VALUES(1,?,?,?)")
      .run("u@example.test", "active", "e".repeat(64));
    seedTelegramUsers(1, 901);

    await launchBroadcast(
      { id: campaignId, templateId, revision: 1, channels: ["email", "telegram"] },
      "admin@axvara.tech",
      createDatabaseAccess(fx.db),
    );
    const ids = (
      fx.sql.prepare("SELECT id FROM broadcast_deliveries WHERE campaign_id=? ORDER BY id").all(campaignId) as Array<{
        id: number;
      }>
    ).map((r) => r.id);

    // Simulate worker crash 2 minutes ago while both rows were 'sending'
    const pastIso = new Date(t0 - 120_000).toISOString();
    fx.sql
      .prepare("UPDATE broadcast_deliveries SET status='sending', first_attempt_at=?, lease_until=? WHERE campaign_id=?")
      .run(pastIso, pastIso, campaignId);

    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        fetched.push(String(url));
        return Response.json({ id: "resend-recovered-1" });
      }),
    );

    const resPromise = postOrigin({
      v: 1,
      kind: "broadcast_deliveries",
      campaignId,
      deliveryIds: ids,
      attempt: 2,
    });
    await vi.runAllTimersAsync();
    const res = await (await resPromise).json();

    expect(res).toMatchObject({ ok: true, settled: true, state: "done", sent: 1 });
    // Only Resend (email) was called; Telegram crashed row became 'unknown' and was NEVER re-sent!
    expect(fetched).toEqual(["https://api.resend.com/emails"]);
    const statuses = fx.sql
      .prepare("SELECT channel, status, last_error FROM broadcast_deliveries WHERE campaign_id=? ORDER BY channel")
      .all(campaignId);
    expect(statuses).toEqual([
      { channel: "email", status: "sent", last_error: null },
      { channel: "telegram", status: "unknown", last_error: "delivery_interrupted" },
    ]);
  });

  // AU-E2-6: the queue origin read provider_id BEFORE taking the dispatch
  // lease. If another dispatcher sent chunk 1 and returned the row to pending
  // inside that window, the stale snapshot restarted the sender at chunk 0.
  it("re-reads delivery progress after the lease so accepted chunks are never resent", async () => {
    vi.useFakeTimers();
    const t0 = Date.parse("2026-11-19T02:05:00.000Z");
    vi.setSystemTime(t0);

    const templateId = "88888888-8888-4888-8888-888888888888";
    const campaignId = "99999999-9999-4999-8999-999999999999";
    fx.sql
      .prepare("INSERT INTO broadcast_templates(id,name,title,body,cta_label,cta_url) VALUES(?,?,?,?,?,?)")
      .run(templateId, "T", "Judul", "Isi", "", "");
    seedTelegramUsers(1, 931);
    await launchBroadcast(
      { id: campaignId, templateId, revision: 1, channels: ["telegram"] },
      "admin@axvara.tech",
      createDatabaseAccess(fx.db),
    );
    const deliveryId = Number((fx.sql.prepare("SELECT id FROM broadcast_deliveries WHERE campaign_id=?").get(campaignId) as { id: number }).id);
    const snapshot = JSON.parse(String((fx.sql.prepare("SELECT snapshot_json FROM broadcast_campaigns WHERE id=?").get(campaignId) as { snapshot_json: string }).snapshot_json));
    snapshot.promo = {
      kind: "telegram_promo", businessDate: "2026-11-19", slot: "morning",
      bannerUrl: "https://axvara.tech/banners/ready-promo.jpg", bannerMode: "link_preview",
      captionHtml: "", messagesHtml: ["<b>Chunk one</b>", "<b>Chunk two</b>"],
      expiresAt: new Date(t0 + 3_600_000).toISOString(),
    };
    fx.sql.prepare("UPDATE broadcast_campaigns SET snapshot_json=? WHERE id=?").run(JSON.stringify(snapshot), campaignId);

    // The competing dispatcher finishes chunk 1 exactly between our pre-lease
    // read and the lease acquisition (stored as JSON promo progress).
    let advanced = false;
    fx.control.beforeRun = async (sql) => {
      if (advanced || !sql.includes("UPDATE broadcast_dispatch_control SET worker_token")) return;
      advanced = true;
      fx.sql.prepare("UPDATE broadcast_deliveries SET provider_id=?, attempts=attempts+1, updated_at=? WHERE id=?")
        .run(JSON.stringify({ sentChunks: 1, lastMessageId: "m-1" }), new Date(t0).toISOString(), deliveryId);
    };

    const texts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const target = String(url);
        if (!target.includes("api.telegram.org")) throw new Error(`Unexpected fetch: ${target}`);
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        texts.push(String(body.text ?? ""));
        return Response.json({ ok: true, result: { message_id: texts.length } });
      }),
    );

    const resPromise = postOrigin({ v: 1, kind: "broadcast_deliveries", campaignId, deliveryIds: [deliveryId], attempt: 1 });
    await vi.runAllTimersAsync();
    const res = await (await resPromise).json();

    expect(advanced).toBe(true);
    expect(res).toMatchObject({ ok: true });
    // Fresh progress: chunk one already accepted → only chunk two is sent.
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("Chunk two");
    expect(texts.join("\n")).not.toContain("Chunk one");
    expect((fx.sql.prepare("SELECT status FROM broadcast_deliveries WHERE id=?").get(deliveryId) as { status: string }).status).toBe("sent");
  });
});
