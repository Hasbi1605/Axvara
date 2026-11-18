import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../mcp-worker/src/index";
import {
  computeBackoffSeconds,
  DLQ_QUEUE_NAME,
  handleQueueBatch,
  MAIN_QUEUE_NAME,
  parseQueueMessage,
  QUEUE_FETCH_TIMEOUT_MS,
  QUEUE_MAX_CONCURRENCY,
  type QueueEnv,
  type QueueFulfillmentMessage,
  type QueueLogEntry,
  type QueueMessage,
  type QueueMessageBatch,
} from "../mcp-worker/src/queue";

const baseEnv: QueueEnv = {
  AXVARA_API_ORIGIN: "https://origin.test",
  AXVARA_CRON_SECRET: "cron-secret-value-123",
  TELEGRAM_BOT_TOKEN: "999888:telegram-secret-token",
  TELEGRAM_ADMIN_CHAT_ID: "-100123456",
  QUEUE_CONSUMER_MODE: "active",
};

function makePayload(overrides: Partial<QueueFulfillmentMessage> = {}): QueueFulfillmentMessage {
  return {
    v: 1,
    kind: "order_paid",
    orderCode: "AXV-20261118-AB12CD34",
    orderKind: "apps",
    source: "webhook:klikqris",
    enqueuedAt: 1_700_000_000_000,
    mode: "active",
    ...overrides,
  };
}

function makeMessage<T>(body: T, attempts = 1, id = "msg-1") {
  const ack = vi.fn();
  const retry = vi.fn();
  const message: QueueMessage<T> = {
    id,
    timestamp: new Date(1_700_000_001_000),
    body,
    attempts,
    ack,
    retry,
  };
  return { message, ack, retry };
}

function makeBatch<T>(
  queue: string,
  messages: QueueMessage<T>[],
): QueueMessageBatch<T> {
  return {
    queue,
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("mcp-worker queue consumer", () => {
  it("R1-1: exhausted unsettled work retries into configured DLQ instead of silently acknowledging", async () => {
    const m = makeMessage(makePayload(), 5);
    const logFn = vi.fn();
    await handleQueueBatch(makeBatch(MAIN_QUEUE_NAME, [m.message]), baseEnv, {
      fetchFn: async () => Response.json({ ok: true, settled: false, retrySec: 60 }), logFn,
    });
    expect(m.ack).not.toHaveBeenCalled();
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 120 });
    expect(logFn).toHaveBeenCalledWith("error", expect.objectContaining({ outcome: "unsettled_to_dlq", attempt: 5 }));
  });
  it("computes exponential backoff 5, 15, 45, 120 seconds", () => {
    expect(computeBackoffSeconds(1)).toBe(5);
    expect(computeBackoffSeconds(2)).toBe(15);
    expect(computeBackoffSeconds(3)).toBe(45);
    expect(computeBackoffSeconds(4)).toBe(120);
    expect(computeBackoffSeconds(5)).toBe(120);
  });

  it("validates message schema and accepts AXV/AXP/AXG + order_paid/supplier_settled", () => {
    expect(parseQueueMessage(makePayload())).toEqual(makePayload());
    expect(
      parseQueueMessage(
        makePayload({
          kind: "supplier_settled",
          orderCode: "AXP-20261118-ZZ99AA11",
          orderKind: "pedia",
          mode: "shadow",
        }),
      ),
    ).not.toBeNull();
    expect(
      parseQueueMessage(
        makePayload({
          orderCode: "AXG-20261118-1234ABCD",
          orderKind: "games",
        }),
      ),
    ).not.toBeNull();

    const invalidBodies: unknown[] = [
      null,
      "AXV-20261118-AB12CD34",
      [],
      { ...makePayload(), v: 2 },
      { ...makePayload(), kind: "other" },
      { ...makePayload(), orderCode: "BAD-20261118-AB12CD34" },
      { ...makePayload(), orderCode: "AXV-20261118-AB12CD34; DROP TABLE" },
      { ...makePayload(), orderKind: "other" },
      { ...makePayload(), source: "" },
      { ...makePayload(), source: "bad\nsource" },
      { ...makePayload(), enqueuedAt: 0 },
      { ...makePayload(), enqueuedAt: Number.NaN },
      { ...makePayload(), mode: "canary:apps" },
      { ...makePayload(), buyerEmail: "pii@example.com", orderCode: "invalid" },
    ];

    for (const bad of invalidBodies) {
      expect(parseQueueMessage(bad)).toBeNull();
    }
  });

  it("acks malformed messages and logs error without calling origin or leaking raw payload", async () => {
    const fetchFn = vi.fn();
    const logs: Array<{ level: string; entry: QueueLogEntry }> = [];
    const { message, ack, retry } = makeMessage({
      v: 1,
      orderCode: "NOT_VALID",
      buyerEmail: "secret-buyer@example.com",
    });

    await handleQueueBatch(makeBatch(MAIN_QUEUE_NAME, [message]), baseEnv, {
      fetchFn,
      nowFn: () => 1_700_000_002_500,
      logFn: (level, entry) => logs.push({ level, entry }),
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe("error");
    expect(logs[0].entry.outcome).toBe("invalid_message");
    expect(JSON.stringify(logs[0].entry)).not.toContain("secret-buyer@example.com");
  });

  it("acks immediately without calling origin when QUEUE_CONSUMER_MODE is off", async () => {
    const fetchFn = vi.fn();
    const logs: QueueLogEntry[] = [];
    const { message, ack, retry } = makeMessage(makePayload());

    await handleQueueBatch(
      makeBatch(MAIN_QUEUE_NAME, [message]),
      { ...baseEnv, QUEUE_CONSUMER_MODE: "off" },
      {
        fetchFn,
        nowFn: () => 1_700_000_001_200,
        logFn: (_level, entry) => logs.push(entry),
      },
    );

    expect(fetchFn).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(logs[0]).toMatchObject({
      outcome: "consumer_off",
      kind: "order_paid",
      orderKind: "apps",
      source: "webhook:klikqris",
      mode: "active",
      attempt: 1,
      latencyMs: 1200,
    });
  });

  it.each(["done", "async_polling", "manual_required", "not_paid", "dry_run_ok"] as const)(
    "acks 200 settled:true state=%s and posts expected payload",
    async (state) => {
      const mode = state === "dry_run_ok" ? "shadow" : "active";
      const payload = makePayload({ mode, orderKind: "games", orderCode: "AXG-20261118-00112233" });
      const fetchFn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
        async () => Response.json({ ok: true, settled: true, state }),
      );
      const logs: QueueLogEntry[] = [];
      const { message, ack, retry } = makeMessage(payload, 2);

      await handleQueueBatch(makeBatch(MAIN_QUEUE_NAME, [message]), baseEnv, {
        fetchFn,
        nowFn: () => 1_700_000_000_500,
        logFn: (_level, entry) => logs.push(entry),
      });

      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe("https://origin.test/api/internal/queue/fulfill");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).authorization).toBe(
        `Bearer ${baseEnv.AXVARA_CRON_SECRET}`,
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        v: 1,
        kind: "order_paid",
        orderCode: "AXG-20261118-00112233",
        orderKind: "games",
        source: "webhook:klikqris",
        attempt: 2,
        dryRun: mode === "shadow",
      });
      expect(ack).toHaveBeenCalledTimes(1);
      expect(retry).not.toHaveBeenCalled();
      expect(logs[0]).toMatchObject({
        kind: "order_paid",
        orderKind: "games",
        source: "webhook:klikqris",
        mode,
        attempt: 2,
        outcome: "ack_settled",
        state,
        latencyMs: 500,
      });
    },
  );

  it("handles 200 settled:false with max(retrySec, backoff), then retries into DLQ at attempts >= 5", async () => {
    const cases: Array<{ attempts: number; retrySec: number; expectedDelay?: number; expectAck: boolean }> = [
      { attempts: 1, retrySec: 60, expectedDelay: 60, expectAck: false },
      { attempts: 2, retrySec: 10, expectedDelay: 15, expectAck: false },
      { attempts: 3, retrySec: 20, expectedDelay: 45, expectAck: false },
      { attempts: 4, retrySec: 30, expectedDelay: 120, expectAck: false },
      { attempts: 5, retrySec: 60, expectedDelay: 120, expectAck: false },
      { attempts: 6, retrySec: 60, expectedDelay: 120, expectAck: false },
    ];

    for (const tc of cases) {
      const fetchFn = vi.fn(async () =>
        Response.json({ ok: true, settled: false, retrySec: tc.retrySec }),
      );
      const { message, ack, retry } = makeMessage(makePayload(), tc.attempts);

      await handleQueueBatch(makeBatch(MAIN_QUEUE_NAME, [message]), baseEnv, {
        fetchFn,
        nowFn: () => 1_700_000_001_000,
        logFn: () => {},
      });

      if (tc.expectAck) {
        expect(ack).toHaveBeenCalledTimes(1);
        expect(retry).not.toHaveBeenCalled();
      } else {
        expect(ack).not.toHaveBeenCalled();
        expect(retry).toHaveBeenCalledWith({ delaySeconds: tc.expectedDelay });
      }
    }
  });

  it("acks 400 malformed error from origin without retrying", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json(
        { error: `Invalid payload token=${baseEnv.AXVARA_CRON_SECRET}` },
        { status: 400 },
      ),
    );
    const logs: Array<{ level: string; entry: QueueLogEntry }> = [];
    const { message, ack, retry } = makeMessage(makePayload(), 1);

    await handleQueueBatch(makeBatch(MAIN_QUEUE_NAME, [message]), baseEnv, {
      fetchFn,
      nowFn: () => 1_700_000_001_000,
      logFn: (level, entry) => logs.push({ level, entry }),
    });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(logs[0].level).toBe("error");
    expect(logs[0].entry.outcome).toBe("http_400_ack");
    expect(logs[0].entry.error).not.toContain(baseEnv.AXVARA_CRON_SECRET!);
  });

  it.each([
    [401, 1, 5],
    [403, 2, 15],
    [500, 3, 45],
    [503, 4, 120],
  ])("retries HTTP %i at attempt %i with backoff %is and redacts secrets", async (status, attempt, delaySeconds) => {
    const fetchFn = vi.fn(async () =>
      Response.json(
        { error: `Auth failed Bearer ${baseEnv.AXVARA_CRON_SECRET} token=abc` },
        { status },
      ),
    );
    const logs: QueueLogEntry[] = [];
    const { message, ack, retry } = makeMessage(makePayload(), attempt);

    await handleQueueBatch(makeBatch(MAIN_QUEUE_NAME, [message]), baseEnv, {
      fetchFn,
      nowFn: () => 1_700_000_001_000,
      logFn: (_level, entry) => logs.push(entry),
    });

    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds });
    expect(logs[0].status).toBe(status);
    expect(logs[0].error).not.toContain(baseEnv.AXVARA_CRON_SECRET!);
    expect(logs[0].error).toContain("[REDACTED]");
  });

  it("retries network errors with backoff", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED Bearer ${baseEnv.AXVARA_CRON_SECRET}`);
    });
    const logs: QueueLogEntry[] = [];
    const { message, ack, retry } = makeMessage(makePayload(), 2);

    await handleQueueBatch(makeBatch(MAIN_QUEUE_NAME, [message]), baseEnv, {
      fetchFn,
      nowFn: () => 1_700_000_001_000,
      logFn: (_level, entry) => logs.push(entry),
    });

    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 15 });
    expect(logs[0].outcome).toBe("network_error");
    expect(logs[0].error).not.toContain(baseEnv.AXVARA_CRON_SECRET!);
  });

  it.each([true, false])("times out stalled origin request (stalledFetch=%s) at 45s and retries with backoff", async (stalledFetch) => {
    vi.useFakeTimers();
    const fetchFn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => {
      if (stalledFetch) return new Promise<Response>(() => {});
      return Promise.resolve(new Response(new ReadableStream({ start() {} }), { status: 200 }));
    });
    const logs: QueueLogEntry[] = [];
    const { message, ack, retry } = makeMessage(makePayload(), 3);

    const pending = handleQueueBatch(makeBatch(MAIN_QUEUE_NAME, [message]), baseEnv, {
      fetchFn,
      nowFn: () => 1_700_000_005_000,
      logFn: (_level, entry) => logs.push(entry),
    });

    await vi.advanceTimersByTimeAsync(QUEUE_FETCH_TIMEOUT_MS);
    await pending;

    expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 45 });
    expect(logs[0].outcome).toBe("fetch_timeout");
  });

  it("processes batch in bounded parallel concurrency (<= 5)", async () => {
    let active = 0;
    let maxActive = 0;
    const resolvers: Array<() => void> = [];

    const fetchFn = vi.fn(() => {
      active++;
      maxActive = Math.max(maxActive, active);
      return new Promise<Response>((resolve) => {
        resolvers.push(() => {
          active--;
          resolve(Response.json({ ok: true, settled: true, state: "done" }));
        });
      });
    });

    const items = Array.from({ length: 12 }, (_, idx) =>
      makeMessage(
        makePayload({ orderCode: `AXV-20261118-000000${String(idx).padStart(2, "0")}` }),
        1,
        `msg-${idx}`,
      ),
    );

    const run = handleQueueBatch(
      makeBatch(MAIN_QUEUE_NAME, items.map((i) => i.message)),
      baseEnv,
      { fetchFn, nowFn: () => 1_700_000_001_000, logFn: () => {} },
    );

    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(QUEUE_MAX_CONCURRENCY);
    });
    expect(maxActive).toBe(QUEUE_MAX_CONCURRENCY);

    while (resolvers.length > 0 || items.some((i) => i.ack.mock.calls.length === 0)) {
      const next = resolvers.shift();
      if (next) next();
      await Promise.resolve();
    }
    await run;

    expect(maxActive).toBeLessThanOrEqual(QUEUE_MAX_CONCURRENCY);
    expect(fetchFn).toHaveBeenCalledTimes(12);
    expect(items.every((i) => i.ack.mock.calls.length === 1)).toBe(true);
  });

  it("DLQ sends sanitized Telegram admin alert and acks only after Telegram succeeds", async () => {
    const sentTexts: string[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`https://api.telegram.org/bot${baseEnv.TELEGRAM_BOT_TOKEN}/sendMessage`);
      const parsed = JSON.parse(String(init?.body)) as { chat_id: string; text: string };
      expect(parsed.chat_id).toBe(baseEnv.TELEGRAM_ADMIN_CHAT_ID);
      sentTexts.push(parsed.text);
      return Response.json({ ok: true });
    });
    const logs: QueueLogEntry[] = [];
    const { message, ack, retry } = makeMessage(
      {
        ...makePayload({ orderCode: "AXP-20261118-12345678", orderKind: "pedia", source: "webhook:dana" }),
        lastError: `HTTP 503 Bearer ${baseEnv.AXVARA_CRON_SECRET} bot${baseEnv.TELEGRAM_BOT_TOKEN}`,
      },
      2,
    );

    await handleQueueBatch(makeBatch(DLQ_QUEUE_NAME, [message]), baseEnv, {
      fetchFn,
      nowFn: () => 1_700_000_010_000,
      logFn: (_level, entry) => logs.push(entry),
    });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]).toContain(
      "⚠️ Antrean instan gagal untuk AXP-20261118-12345678 (pedia, sumber webhook:dana, percobaan 2). Cron 1-menit tetap mengambil alih.",
    );
    expect(sentTexts[0]).not.toContain(baseEnv.AXVARA_CRON_SECRET!);
    expect(sentTexts[0]).not.toContain(baseEnv.TELEGRAM_BOT_TOKEN!);
    expect(logs[0]).toMatchObject({
      event: "queue_dlq",
      orderCode: "AXP-20261118-12345678",
      orderKind: "pedia",
      source: "webhook:dana",
      attempt: 2,
      outcome: "dlq_alert_sent",
    });
  });

  it("DLQ retries without acking when Telegram fails or is unconfigured", async () => {
    const failFetch = vi.fn(async () => Response.json({ ok: false, description: "Bad Gateway" }, { status: 502 }));
    const logs: Array<{ level: string; entry: QueueLogEntry }> = [];
    const msg1 = makeMessage(makePayload(), 1, "dlq-1");

    await handleQueueBatch(makeBatch(DLQ_QUEUE_NAME, [msg1.message]), baseEnv, {
      fetchFn: failFetch,
      nowFn: () => 1_700_000_001_000,
      logFn: (level, entry) => logs.push({ level, entry }),
    });

    expect(msg1.ack).not.toHaveBeenCalled();
    expect(msg1.retry).toHaveBeenCalledTimes(1);
    expect(logs[0].level).toBe("error");
    expect(logs[0].entry.outcome).toBe("dlq_alert_failed");

    const msg2 = makeMessage(makePayload(), 1, "dlq-2");
    await handleQueueBatch(
      makeBatch(DLQ_QUEUE_NAME, [msg2.message]),
      { ...baseEnv, TELEGRAM_BOT_TOKEN: undefined },
      { fetchFn: failFetch, nowFn: () => 1_700_000_001_000, logFn: () => {} },
    );

    expect(msg2.ack).not.toHaveBeenCalled();
    expect(msg2.retry).toHaveBeenCalledTimes(1);
  });

  it("retries with backoff when AXVARA_CRON_SECRET is missing or origin returns malformed 200", async () => {
    const fetchNoSecret = vi.fn();
    const m1 = makeMessage(makePayload(), 1, "no-secret");
    await handleQueueBatch(
      makeBatch(MAIN_QUEUE_NAME, [m1.message]),
      { ...baseEnv, AXVARA_CRON_SECRET: undefined },
      { fetchFn: fetchNoSecret, nowFn: () => 1_700_000_001_000, logFn: () => {} },
    );
    expect(fetchNoSecret).not.toHaveBeenCalled();
    expect(m1.ack).not.toHaveBeenCalled();
    expect(m1.retry).toHaveBeenCalledWith({ delaySeconds: 5 });

    const fetchBad200 = vi.fn(async () => Response.json({ ok: true, settled: true, state: "unexpected_state" }));
    const m2 = makeMessage(makePayload(), 2, "bad-state");
    await handleQueueBatch(makeBatch(MAIN_QUEUE_NAME, [m2.message]), baseEnv, {
      fetchFn: fetchBad200,
      nowFn: () => 1_700_000_001_000,
      logFn: () => {},
    });
    expect(m2.ack).not.toHaveBeenCalled();
    expect(m2.retry).toHaveBeenCalledWith({ delaySeconds: 15 });
  });

  it("DLQ redacts email PII and retries on Telegram network failure", async () => {
    const sent: string[] = [];
    const fetchOk = vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)).text);
      return Response.json({ ok: true });
    });
    const m1 = makeMessage(
      { orderCode: "BAD_CODE", orderKind: "other", source: "bad\nsource", error: "fail for buyer@example.com" },
      3,
      "dlq-pii",
    );
    await handleQueueBatch(makeBatch(DLQ_QUEUE_NAME, [m1.message]), baseEnv, {
      fetchFn: fetchOk,
      nowFn: () => 1_700_000_001_000,
      logFn: () => {},
    });
    expect(m1.ack).toHaveBeenCalledTimes(1);
    expect(sent[0]).toContain("[invalid-order] (unknown, sumber unknown, percobaan 3)");
    expect(sent[0]).not.toContain("buyer@example.com");
    expect(sent[0]).toContain("[REDACTED_EMAIL]");

    const fetchThrow = vi.fn(async () => {
      throw new Error("telegram_socket_closed");
    });
    const m2 = makeMessage(makePayload(), 1, "dlq-net");
    await handleQueueBatch(makeBatch(DLQ_QUEUE_NAME, [m2.message]), baseEnv, {
      fetchFn: fetchThrow,
      nowFn: () => 1_700_000_001_000,
      logFn: () => {},
    });
    expect(m2.ack).not.toHaveBeenCalled();
    expect(m2.retry).toHaveBeenCalledTimes(1);
  });

  it("worker entrypoint exports queue handler delegating to main vs DLQ", async () => {
    const fetchStub = vi.fn(async (url: string) => {
      if (url.includes("/api/internal/queue/fulfill")) {
        return Response.json({ ok: true, settled: true, state: "done" });
      }
      return Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", fetchStub);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const mainMsg = makeMessage(makePayload(), 1);
    await worker.queue(
      makeBatch(MAIN_QUEUE_NAME, [mainMsg.message]),
      baseEnv,
      { waitUntil: vi.fn() },
    );
    expect(mainMsg.ack).toHaveBeenCalledTimes(1);

    const dlqMsg = makeMessage(makePayload(), 1);
    await worker.queue(
      makeBatch(DLQ_QUEUE_NAME, [dlqMsg.message]),
      baseEnv,
      { waitUntil: vi.fn() },
    );
    expect(dlqMsg.ack).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledTimes(2);
  });
});
