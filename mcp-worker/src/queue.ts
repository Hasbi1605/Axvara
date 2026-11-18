import { isValidBuyerOrderCode } from "../../src/lib/security";
import { sanitizeError, type CronEnv } from "./cron";

export const MAIN_QUEUE_NAME = "axvara-order-fulfillment";
export const DLQ_QUEUE_NAME = "axvara-order-fulfillment-dlq";
export const QUEUE_FETCH_TIMEOUT_MS = 45_000;
export const QUEUE_TELEGRAM_TIMEOUT_MS = 10_000;
export const QUEUE_MAX_CONCURRENCY = 5;
export const BACKOFF_SECONDS = [5, 15, 45, 120] as const;
export const MAX_SETTLED_FALSE_ATTEMPTS = 5;
export const MAX_DELAY_SECONDS = 43_200;

export const SETTLED_STATES = new Set([
  "done",
  "async_polling",
  "manual_required",
  "not_paid",
  "dry_run_ok",
]);

export type QueueFulfillmentKind = "order_paid" | "supplier_settled";
export type QueueOrderKind = "apps" | "pedia" | "games";
export type QueueMessageMode = "shadow" | "active";

export type QueueFulfillmentMessage = {
  v: 1;
  kind: QueueFulfillmentKind;
  orderCode: string;
  orderKind: QueueOrderKind;
  source: string;
  enqueuedAt: number;
  mode: QueueMessageMode;
};

export type QueueMessage<T = unknown> = {
  readonly id: string;
  readonly timestamp: Date;
  readonly body: T;
  readonly attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

export type QueueMessageBatch<T = unknown> = {
  readonly queue: string;
  readonly messages: readonly QueueMessage<T>[];
  ackAll(): void;
  retryAll(options?: { delaySeconds?: number }): void;
};

export type QueueEnv = CronEnv & {
  QUEUE_CONSUMER_MODE?: string;
};

export type QueueLogEntry = {
  event: "queue_message" | "queue_dlq";
  queue: string;
  kind?: QueueFulfillmentKind;
  orderCode?: string;
  orderKind?: QueueOrderKind | "unknown";
  source?: string;
  mode?: QueueMessageMode;
  attempt: number;
  outcome: string;
  status?: number;
  state?: string;
  delaySeconds?: number;
  latencyMs?: number;
  error?: string;
};

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type QueueDeps = {
  fetchFn?: FetchFn;
  nowFn?: () => number;
  logFn?: (level: "info" | "error", entry: QueueLogEntry) => void;
  timeoutMs?: number;
  telegramTimeoutMs?: number;
};

export function computeBackoffSeconds(attempts: number): number {
  const index = Math.min(
    Math.max(0, Math.floor(Number.isFinite(attempts) ? attempts : 1) - 1),
    BACKOFF_SECONDS.length - 1,
  );
  return BACKOFF_SECONDS[index];
}

export function isConsumerOff(env: Pick<QueueEnv, "QUEUE_CONSUMER_MODE">): boolean {
  return (env.QUEUE_CONSUMER_MODE ?? "active").trim().toLowerCase() === "off";
}

function isSafeSource(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 64 &&
    !/[\r\n\t]/.test(value)
  );
}

export function parseQueueMessage(raw: unknown): QueueFulfillmentMessage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const msg = raw as Record<string, unknown>;
  if (msg.v !== 1) return null;
  if (msg.kind !== "order_paid" && msg.kind !== "supplier_settled") return null;
  if (typeof msg.orderCode !== "string" || !isValidBuyerOrderCode(msg.orderCode)) return null;
  if (msg.orderKind !== "apps" && msg.orderKind !== "pedia" && msg.orderKind !== "games") return null;
  if (!isSafeSource(msg.source)) return null;
  if (typeof msg.enqueuedAt !== "number" || !Number.isFinite(msg.enqueuedAt) || msg.enqueuedAt <= 0) return null;
  if (msg.mode !== "shadow" && msg.mode !== "active") return null;
  return {
    v: 1,
    kind: msg.kind,
    orderCode: msg.orderCode,
    orderKind: msg.orderKind,
    source: msg.source.trim(),
    enqueuedAt: msg.enqueuedAt,
    mode: msg.mode,
  };
}

function sanitizeQueueText(value: string, env: QueueEnv): string {
  let out = value;
  for (const secret of [env.AXVARA_CRON_SECRET, env.TELEGRAM_BOT_TOKEN]) {
    if (secret && secret.length >= 8) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  out = out.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
  return sanitizeError(out, env);
}

function defaultLog(level: "info" | "error", entry: QueueLogEntry): void {
  const payload = JSON.stringify(entry);
  if (level === "error") console.error(payload);
  else console.log(payload);
}

function computeLatencyMs(enqueuedAt: unknown, nowMs: number): number | undefined {
  if (typeof enqueuedAt !== "number" || !Number.isFinite(enqueuedAt) || enqueuedAt <= 0) {
    return undefined;
  }
  return Math.max(0, Math.round(nowMs - enqueuedAt));
}

function extractErrorDetail(text: string, fallbackStatus: number): string {
  if (!text) return `HTTP ${fallbackStatus}`;
  try {
    const parsed = JSON.parse(text) as { error?: unknown } | null;
    if (typeof parsed?.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    // Non-JSON error bodies still carry diagnostic context once sanitized.
  }
  return text;
}

async function fetchTextWithTimeout(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutCode: string,
): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchFn(url, { ...init, signal: controller.signal });
        const text = await response.text();
        return { status: response.status, text };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(timeoutCode));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const count = Math.min(Math.max(1, limit), items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: count }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index]);
      }
    }),
  );
}

function safeLogFieldsFromUnknown(
  raw: unknown,
  env: QueueEnv,
  nowMs: number,
): Partial<QueueLogEntry> {
  const parsed = parseQueueMessage(raw);
  if (parsed) {
    return {
      kind: parsed.kind,
      orderCode: parsed.orderCode,
      orderKind: parsed.orderKind,
      source: sanitizeQueueText(parsed.source, env),
      mode: parsed.mode,
      latencyMs: computeLatencyMs(parsed.enqueuedAt, nowMs),
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  return {
    ...(obj.kind === "order_paid" || obj.kind === "supplier_settled" ? { kind: obj.kind } : {}),
    ...(typeof obj.orderCode === "string" && isValidBuyerOrderCode(obj.orderCode)
      ? { orderCode: obj.orderCode }
      : {}),
    ...(obj.orderKind === "apps" || obj.orderKind === "pedia" || obj.orderKind === "games"
      ? { orderKind: obj.orderKind }
      : {}),
    ...(isSafeSource(obj.source) ? { source: sanitizeQueueText(obj.source.trim(), env) } : {}),
    ...(obj.mode === "shadow" || obj.mode === "active" ? { mode: obj.mode } : {}),
    ...(computeLatencyMs(obj.enqueuedAt, nowMs) !== undefined
      ? { latencyMs: computeLatencyMs(obj.enqueuedAt, nowMs) }
      : {}),
  };
}

async function processMainMessage(
  queueName: string,
  msg: QueueMessage<unknown>,
  env: QueueEnv,
  deps: Required<QueueDeps>,
): Promise<void> {
  const nowMs = deps.nowFn();

  if (isConsumerOff(env)) {
    msg.ack();
    deps.logFn("info", {
      event: "queue_message",
      queue: queueName,
      ...safeLogFieldsFromUnknown(msg.body, env, nowMs),
      attempt: msg.attempts,
      outcome: "consumer_off",
    });
    return;
  }

  const parsed = parseQueueMessage(msg.body);
  if (!parsed) {
    msg.ack();
    deps.logFn("error", {
      event: "queue_message",
      queue: queueName,
      attempt: msg.attempts,
      outcome: "invalid_message",
    });
    return;
  }

  const baseLog: Omit<QueueLogEntry, "outcome"> = {
    event: "queue_message",
    queue: queueName,
    kind: parsed.kind,
    orderCode: parsed.orderCode,
    orderKind: parsed.orderKind,
    source: sanitizeQueueText(parsed.source, env),
    mode: parsed.mode,
    attempt: msg.attempts,
    latencyMs: computeLatencyMs(parsed.enqueuedAt, nowMs),
  };

  if (!env.AXVARA_CRON_SECRET) {
    const delaySeconds = computeBackoffSeconds(msg.attempts);
    msg.retry({ delaySeconds });
    deps.logFn("error", {
      ...baseLog,
      outcome: "missing_cron_secret",
      delaySeconds,
      error: "missing_cron_secret",
    });
    return;
  }

  const origin = env.AXVARA_API_ORIGIN.replace(/\/$/, "");
  let status: number;
  let text: string;
  try {
    const res = await fetchTextWithTimeout(
      deps.fetchFn,
      `${origin}/api/internal/queue/fulfill`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.AXVARA_CRON_SECRET}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          v: 1,
          kind: parsed.kind,
          orderCode: parsed.orderCode,
          orderKind: parsed.orderKind,
          source: parsed.source,
          attempt: msg.attempts,
          dryRun: parsed.mode === "shadow",
        }),
      },
      deps.timeoutMs,
      "queue_fetch_timeout",
    );
    status = res.status;
    text = res.text;
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : "network_error";
    const delaySeconds = computeBackoffSeconds(msg.attempts);
    msg.retry({ delaySeconds });
    deps.logFn("error", {
      ...baseLog,
      outcome: rawMsg === "queue_fetch_timeout" ? "fetch_timeout" : "network_error",
      delaySeconds,
      error: sanitizeQueueText(rawMsg, env),
    });
    return;
  }

  if (status === 400) {
    msg.ack();
    deps.logFn("error", {
      ...baseLog,
      status: 400,
      outcome: "http_400_ack",
      error: sanitizeQueueText(extractErrorDetail(text, 400), env),
    });
    return;
  }

  if (status === 200) {
    let body: { ok?: unknown; settled?: unknown; state?: unknown; retrySec?: unknown } | null = null;
    try {
      body = JSON.parse(text) as { ok?: unknown; settled?: unknown; state?: unknown; retrySec?: unknown } | null;
    } catch {
      body = null;
    }

    if (
      body &&
      body.ok === true &&
      body.settled === true &&
      typeof body.state === "string" &&
      SETTLED_STATES.has(body.state)
    ) {
      msg.ack();
      deps.logFn("info", {
        ...baseLog,
        status: 200,
        state: body.state,
        outcome: "ack_settled",
      });
      return;
    }

    if (body && body.ok === true && body.settled === false) {
      if (msg.attempts >= MAX_SETTLED_FALSE_ATTEMPTS) {
        msg.ack();
        deps.logFn("info", {
          ...baseLog,
          status: 200,
          outcome: "ack_unsettled_max_attempts",
        });
        return;
      }

      const requestedRetry =
        typeof body.retrySec === "number" && Number.isFinite(body.retrySec) && body.retrySec > 0
          ? Math.min(MAX_DELAY_SECONDS, Math.ceil(body.retrySec))
          : 0;
      const delaySeconds = Math.max(requestedRetry, computeBackoffSeconds(msg.attempts));
      msg.retry({ delaySeconds });
      deps.logFn("info", {
        ...baseLog,
        status: 200,
        outcome: "retry_unsettled",
        delaySeconds,
      });
      return;
    }

    const delaySeconds = computeBackoffSeconds(msg.attempts);
    msg.retry({ delaySeconds });
    deps.logFn("error", {
      ...baseLog,
      status: 200,
      outcome: "invalid_origin_response",
      delaySeconds,
      error: sanitizeQueueText(extractErrorDetail(text, 200), env),
    });
    return;
  }

  const delaySeconds = computeBackoffSeconds(msg.attempts);
  msg.retry({ delaySeconds });
  deps.logFn("error", {
    ...baseLog,
    status,
    outcome: "retry_http_error",
    delaySeconds,
    error: sanitizeQueueText(extractErrorDetail(text, status), env),
  });
}

async function processDlqMessage(
  queueName: string,
  msg: QueueMessage<unknown>,
  env: QueueEnv,
  deps: Required<QueueDeps>,
): Promise<void> {
  const nowMs = deps.nowFn();
  const obj =
    msg.body && typeof msg.body === "object" && !Array.isArray(msg.body)
      ? (msg.body as Record<string, unknown>)
      : {};

  const orderCode =
    typeof obj.orderCode === "string" && isValidBuyerOrderCode(obj.orderCode)
      ? obj.orderCode
      : "[invalid-order]";
  const orderKind: QueueOrderKind | "unknown" =
    obj.orderKind === "apps" || obj.orderKind === "pedia" || obj.orderKind === "games"
      ? obj.orderKind
      : "unknown";
  const source = isSafeSource(obj.source)
    ? sanitizeQueueText(obj.source.trim(), env) || "unknown"
    : "unknown";
  const kind =
    obj.kind === "order_paid" || obj.kind === "supplier_settled" ? obj.kind : undefined;
  const mode = obj.mode === "shadow" || obj.mode === "active" ? obj.mode : undefined;
  const latencyMs = computeLatencyMs(obj.enqueuedAt, nowMs);

  const rawLastError =
    typeof obj.lastError === "string"
      ? obj.lastError
      : typeof obj.error === "string"
        ? obj.error
        : "melebihi batas percobaan antrean";
  const sanitizedDetail =
    sanitizeQueueText(rawLastError, env) || "melebihi batas percobaan antrean";

  const baseLog: Omit<QueueLogEntry, "outcome"> = {
    event: "queue_dlq",
    queue: queueName,
    ...(kind ? { kind } : {}),
    orderCode,
    orderKind,
    source,
    ...(mode ? { mode } : {}),
    attempt: msg.attempts,
    ...(latencyMs !== undefined ? { latencyMs } : {}),
  };

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ADMIN_CHAT_ID) {
    msg.retry();
    deps.logFn("error", {
      ...baseLog,
      outcome: "dlq_telegram_unconfigured",
      error: "telegram_config_missing",
    });
    return;
  }

  const text = `⚠️ Antrean instan gagal untuk ${orderCode} (${orderKind}, sumber ${source}, percobaan ${msg.attempts}). Cron 1-menit tetap mengambil alih.\nError: ${sanitizedDetail}`;

  try {
    const res = await fetchTextWithTimeout(
      deps.fetchFn,
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_ADMIN_CHAT_ID,
          text,
          disable_web_page_preview: true,
        }),
      },
      deps.telegramTimeoutMs,
      "telegram_timeout",
    );

    let telegramOk = res.status >= 200 && res.status < 300;
    if (telegramOk && res.text) {
      try {
        const parsed = JSON.parse(res.text) as { ok?: unknown } | null;
        if (parsed && parsed.ok === false) telegramOk = false;
      } catch {
        // Non-JSON 2xx response from test doubles counts as ok.
      }
    }

    if (telegramOk) {
      msg.ack();
      deps.logFn("info", {
        ...baseLog,
        status: res.status,
        outcome: "dlq_alert_sent",
      });
      return;
    }

    msg.retry();
    deps.logFn("error", {
      ...baseLog,
      status: res.status,
      outcome: "dlq_alert_failed",
      error: sanitizeQueueText(extractErrorDetail(res.text, res.status), env),
    });
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : "telegram_fetch_failed";
    msg.retry();
    deps.logFn("error", {
      ...baseLog,
      outcome: "dlq_alert_failed",
      error: sanitizeQueueText(rawMsg, env),
    });
  }
}

export async function handleQueueBatch(
  batch: QueueMessageBatch<unknown>,
  env: QueueEnv,
  deps: QueueDeps = {},
): Promise<void> {
  const resolved: Required<QueueDeps> = {
    fetchFn: deps.fetchFn ?? fetch,
    nowFn: deps.nowFn ?? Date.now,
    logFn: deps.logFn ?? defaultLog,
    timeoutMs: deps.timeoutMs ?? QUEUE_FETCH_TIMEOUT_MS,
    telegramTimeoutMs: deps.telegramTimeoutMs ?? QUEUE_TELEGRAM_TIMEOUT_MS,
  };

  if (batch.queue === DLQ_QUEUE_NAME) {
    await runWithConcurrency(batch.messages, QUEUE_MAX_CONCURRENCY, async (msg) => {
      try {
        await processDlqMessage(batch.queue, msg, env, resolved);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "unexpected_dlq_error";
        msg.retry();
        resolved.logFn("error", {
          event: "queue_dlq",
          queue: batch.queue,
          attempt: msg.attempts,
          outcome: "dlq_unexpected_error",
          error: sanitizeQueueText(errMsg, env),
        });
      }
    });
    return;
  }

  if (batch.queue !== MAIN_QUEUE_NAME) {
    for (const msg of batch.messages) {
      msg.ack();
      resolved.logFn("error", {
        event: "queue_message",
        queue: batch.queue,
        attempt: msg.attempts,
        outcome: "unknown_queue",
      });
    }
    return;
  }

  await runWithConcurrency(batch.messages, QUEUE_MAX_CONCURRENCY, async (msg) => {
    try {
      await processMainMessage(batch.queue, msg, env, resolved);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "unexpected_queue_error";
      const delaySeconds = computeBackoffSeconds(msg.attempts);
      msg.retry({ delaySeconds });
      resolved.logFn("error", {
        event: "queue_message",
        queue: batch.queue,
        ...safeLogFieldsFromUnknown(msg.body, env, resolved.nowFn()),
        attempt: msg.attempts,
        outcome: "unexpected_error",
        delaySeconds,
        error: sanitizeQueueText(errMsg, env),
      });
    }
  });
}
