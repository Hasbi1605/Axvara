import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { operationQueueProbeSql, WEB_PAID_ADMIN_PENDING_WHERE } from "@/lib/cron-queues";
import {
  notifyTelegramPaidAdmin, notifyWebPaidAdmin, notifyWhatsAppPaidAdmin, retryPendingTelegramNotifications,
} from "@/lib/telegram/order-notifications";
import { createD1Fixture } from "./helpers/d1-fixture";

const CODE = "AXV-20261121-00000001";
const KEY = `admin-paid:${CODE}`;
const RECOVERY_LABEL = "🔁 Kirim ulang otomatis — abaikan bila notif lunas order ini sudah ada";
const T0 = Date.parse("2026-11-21T00:00:00Z");
const ONLY_ADMIN = { created: false, paid: false, paidAdmin: true, paidAdminWeb: true };
const PROBE = operationQueueProbeSql("notify", "0", WEB_PAID_ADMIN_PENDING_WHERE)!;
const senders = { web: notifyWebPaidAdmin, telegram: notifyTelegramPaidAdmin, whatsapp: notifyWhatsAppPaidAdmin };
const channels = Object.keys(senders) as (keyof typeof senders)[];
const accept = () => Response.json({ ok: true, result: { message_id: 42 } });
const reject = (code: number, parameters?: { retry_after: number }) => Response.json({ ok: false, error_code: code, parameters, description: "upstream text not for logs" }, { status: code });
let fx: ReturnType<typeof createD1Fixture>;
let db: ReturnType<typeof createDatabaseAccess>;
let reply: () => Response | Promise<Response>;
let health: (signal?: AbortSignal) => Response | Promise<Response>;
let probes: number;
let posts: Record<string, unknown>[];
let now: number | undefined;
const healthy = () => Response.json({ ok: true, result: { id: 17, is_bot: true, first_name: "Fixture" } });
// Freeze SQLite's clock for the incident scenarios; leave the real SQL/CAS intact.
const sqlClock = (sql: string) => now === undefined ? sql : sql.replaceAll("'now'", `'${new Date(now).toISOString()}'`);
const at = (minutes: number) => { now = T0 + minutes * 60_000; };

beforeEach(() => {
  fx = createD1Fixture();
  const access = createDatabaseAccess(fx.db);
  db = {
    ...access,
    queryFirst: (sql, ...args) => access.queryFirst(sqlClock(sql), ...args),
    queryAll: (sql, ...args) => access.queryAll(sqlClock(sql), ...args),
    execRun: (sql, ...args) => access.execRun(sqlClock(sql), ...args),
  };
  now = undefined;
  posts = [];
  probes = 0;
  reply = accept;
  health = healthy;
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture-only");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-1234");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    expect(init.method).toBe("POST");
    if (url === "https://api.telegram.org/botfixture-only/getMe") {
      probes++;
      return health(init.signal ?? undefined);
    }
    expect(url).toBe("https://api.telegram.org/botfixture-only/sendMessage");
    posts.push(JSON.parse(String(init.body)));
    return reply();
  }));
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const ledger = () => fx.sql.prepare("SELECT * FROM buyer_notice_log WHERE idempotency_key=?").get(KEY);
const marker = () => fx.sql.prepare("SELECT telegram_paid_admin_notified_at AS at FROM orders WHERE code=?").get(CODE)?.at;
const retry = () => retryPendingTelegramNotifications(50, ONLY_ADMIN, db);

function seed(channel: string, code = CODE) {
  fx.sql.prepare(sqlClock(`INSERT INTO orders (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
    sales_channel,paid_at,telegram_user_id,variant_snapshot) VALUES (?,'Test','','[]',10000,'qris','lunas','paid',?,datetime('now'),'123','{}')`)).run(code, channel);
}

function seedNotice(status: string, code = CODE, key = `admin-paid:${code}`) {
  fx.sql.prepare(sqlClock(`INSERT INTO buyer_notice_log (idempotency_key,order_code,channel,status,updated_at)
    VALUES (?,?,'telegram',?,datetime('now'))`)).run(key, code, status);
}

describe.each(channels)("%s paid-admin ledger", (channel) => {
  const send = () => senders[channel](CODE, db);
  const count = () => fx.sql.prepare(sqlClock(PROBE)).get()?.[channel === "web" ? "paid_admin_web" : "paid_admin"];
  beforeEach(() => { at(0); seed(channel); });

  it.each([
    ["timeout", () => { throw new DOMException("aborted", "AbortError"); }],
    ["Network connection lost", () => { throw new Error("Network connection lost"); }],
    ["parse error", () => new Response("<html>", { status: 500 })],
    ["structured 500", () => reject(500)],
    ["ok without message_id", () => Response.json({ ok: true, result: {} })],
  ])("records %s as ambiguous, not eligible early or on direct follow-up", async (_name, failure) => {
    expect(count()).toBe(1);
    reply = failure;
    expect(await send()).toBe(false);
    expect(ledger()).toMatchObject({ status: "unknown", error: "ambiguous", access_lease: null, access_retry_at: null });
    expect(marker()).toBeNull();
    reply = accept;
    for (const minutes of [10, 20, 29]) {
      at(minutes);
      expect(count()).toBe(0);
      expect(await retry()).toMatchObject({ paidAdmin: 0, paidAdminWeb: 0 });
    }
    expect(probes).toBe(0);
    at(41);
    expect(count()).toBe(1);
    expect(await send()).toBe(false);
    expect(posts).toHaveLength(1);
    expect(ledger()?.status).toBe("unknown");
  });

  it("recovers exactly once at T+41 after a 40-minute outage, preserving text and keyboard", async () => {
    reply = () => { throw new DOMException("timeout", "AbortError"); };
    health = () => { throw new Error("network unavailable"); };
    expect(await send()).toBe(false);
    const original = posts[0];
    for (let minute = 1; minute <= 40; minute++) {
      at(minute);
      expect(count()).toBe(minute >= 30 ? 1 : 0);
      expect(await retry()).toMatchObject({ paidAdmin: 0, paidAdminWeb: 0 });
      expect(posts).toHaveLength(1);
      expect(ledger()?.access_attempts).toBe(0);
    }
    expect(probes).toBe(11);
    at(41);
    health = healthy;
    reply = accept;
    expect((await retry())[channel === "web" ? "paidAdminWeb" : "paidAdmin"]).toBe(1);
    expect(posts[1]).toEqual({ ...original, text: `${RECOVERY_LABEL}\n${original.text}` });
    expect(ledger()).toMatchObject({ status: "sent", access_attempts: 1 });
    if (channel !== "web") expect(marker()).not.toBeNull();
    for (let minute = 42; minute <= 360; minute++) { at(minute); await retry(); }
    expect(posts).toHaveLength(2);
    expect(probes).toBe(12);
  });

  it("recovers a 31-minute stale claim, never a 9-minute claim", async () => {
    seedNotice("sending");
    at(9);
    expect(count()).toBe(0);
    await retry();
    expect(probes).toBe(0);
    at(31);
    expect(await send()).toBe(false);
    expect(count()).toBe(1);
    await retry();
    expect(posts).toHaveLength(1);
    expect(String(posts[0].text).split("\n")[0]).toBe(RECOVERY_LABEL);
    expect(ledger()).toMatchObject({ status: "sent", access_attempts: 1 });
  });

  it("fails closed when the D1 claim throws", async () => {
    const queryFirst = db.queryFirst;
    db.queryFirst = async (sql, ...args) => {
      if (sql.startsWith("INSERT INTO buyer_notice_log")) throw new Error("D1 unavailable");
      return queryFirst(sql, ...args);
    };
    expect(await send()).toBe(false);
    expect(ledger()).toBeUndefined();
    expect(posts).toHaveLength(0);
  });

  it("fences competing calls before acknowledgement and never replays sent", async () => {
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<Response>();
    reply = () => { entered.resolve(); return finish.promise; };
    const winner = send();
    try {
      await Promise.race([entered.promise, winner.then(() => { throw new Error("no POST"); })]);
      expect(ledger()?.status).toBe("sending");
      expect(count()).toBe(0);
      // Do not hold a hypothetical duplicate: make it visible as a second POST.
      reply = accept;
      expect(await send()).toBe(false);
      expect(posts).toHaveLength(1);
    } finally { finish.resolve(accept()); await winner; }
    expect(await winner).toBe(true);
    expect(ledger()).toMatchObject({ status: "sent", provider_id: "42", access_lease: null });
    if (channel !== "web") expect(marker()).not.toBeNull();
    expect(count()).toBe(0);
    await retry();
    await send();
    expect(posts).toHaveLength(1);
  });

  it("quarantines a legacy canonical failure without retry evidence", async () => {
    seedNotice("failed");
    at(60);
    expect(count()).toBe(0);
    expect(await retry()).toMatchObject({ paidAdminWeb: 0, paidAdmin: 0 });
    expect(await send()).toBe(false);
    expect(posts).toHaveLength(0);
  });

  it.each([false, true])("does not select old paid orders (ambiguous ledger: %s)", async (withLedger) => {
    if (withLedger) seedNotice("unknown");
    at(361);
    expect(count()).toBe(0);
    expect(await retry()).toMatchObject({ paidAdmin: 0, paidAdminWeb: 0 });
    expect(posts).toHaveLength(0);
  });

  it.each([[125, 125], [1, 60]])("429 retry_after=%s is due no sooner than %s seconds", async (retryAfter, minimum) => {
    reply = () => reject(429, { retry_after: retryAfter });
    expect(await send()).toBe(false);
    expect(posts).toHaveLength(1);
    expect(ledger()).toMatchObject({ status: "failed", error: "rate_limited" });
    expect(Date.parse(String(ledger()?.access_retry_at)) - T0).toBe(minimum * 1000);
    reply = accept;
    expect(count()).toBe(0);
    expect(await send()).toBe(false);
    await retry();
    expect(posts).toHaveLength(1);
    at(minimum / 60);
    expect(count()).toBe(1);
    await retry();
    expect(posts).toHaveLength(2);
    expect(ledger()?.status).toBe("sent");
    expect(probes).toBe(0);
  });
});

it("one healthy getMe covers recovery across both admin queues, including a legacy timeout", async () => {
  at(0);
  const telegramCode = `${CODE}-TG`;
  const waCode = `${CODE}-WA`;
  seed("web"); seedNotice("unknown");
  seed("telegram", telegramCode); seedNotice("sending", telegramCode);
  seed("whatsapp", waCode); seedNotice("failed", waCode, `admin-paid-timeout:${waCode}`);
  at(31);
  expect(await notifyWhatsAppPaidAdmin(waCode, db)).toBe(false);
  expect(fx.sql.prepare(sqlClock(PROBE)).get()).toMatchObject({ paid_admin_web: 1, paid_admin: 2 });
  expect(await retry()).toMatchObject({ paidAdminWeb: 1, paidAdmin: 2 });
  expect(posts).toHaveLength(3);
  expect(posts.every(({ text }) => String(text).startsWith(`${RECOVERY_LABEL}\n`))).toBe(true);
  expect(fx.sql.prepare("SELECT idempotency_key, status, access_attempts FROM buyer_notice_log WHERE order_code=?").all(waCode))
    .toEqual([{ idempotency_key: `admin-paid:${waCode}`, status: "sent", access_attempts: 1 }]);
  at(60);
  await retry();
  expect(probes).toBe(1);
  expect(posts).toHaveLength(3);
});

it("two cron runs compete for one recovery and a second ambiguity is terminal", async () => {
  at(0);
  seed("web");
  reply = () => reject(500);
  expect(await notifyWebPaidAdmin(CODE, db)).toBe(false);
  at(31);
  const bothProbed = Promise.withResolvers<void>();
  health = async () => {
    if (probes === 2) bothProbed.resolve();
    await bothProbed.promise;
    return healthy();
  };
  await Promise.all([retry(), retry()]);
  expect(probes).toBe(2);
  expect(posts).toHaveLength(2);
  expect(posts[1].text).toBe(`${RECOVERY_LABEL}\n${posts[0].text}`);
  expect(ledger()).toMatchObject({ status: "unknown", access_attempts: 1 });
  at(360);
  await retry();
  expect(await notifyWebPaidAdmin(CODE, db)).toBe(false);
  expect(probes).toBe(2);
  expect(posts).toHaveLength(2);
});

it("recovery claim failure sends nothing and leaves the attempt unused", async () => {
  at(0);
  seed("telegram"); seedNotice("sending");
  at(31);
  const queryFirst = db.queryFirst;
  db.queryFirst = async (sql, ...args) => {
    if (sql.startsWith("UPDATE buyer_notice_log")) throw new Error("D1 unavailable");
    return queryFirst(sql, ...args);
  };
  expect(await retry()).toMatchObject({ paidAdmin: 0 });
  expect(probes).toBe(1);
  expect(posts).toHaveLength(0);
  expect(ledger()).toMatchObject({ status: "sending", access_attempts: 0 });
});

it("the recovery claim rechecks the paid window after getMe", async () => {
  at(0);
  seed("web"); seedNotice("unknown");
  at(360);
  health = () => { at(361); return healthy(); };
  expect(await retry()).toMatchObject({ paidAdminWeb: 0 });
  expect(probes).toBe(1);
  expect(posts).toHaveLength(0);
  expect(ledger()).toMatchObject({ status: "unknown", access_attempts: 0 });
});

it.each([["telegram", 11_000], ["web", 21_000]])("%s defers recovery if the probe plus send will not fit or the probe uses the remaining time", async (channel, sendMs) => {
  at(0);
  seed(channel); seedNotice("unknown");
  at(31);
  let remaining = sendMs + 4_999;
  const tick = () => retryPendingTelegramNotifications(50, ONLY_ADMIN, db, ms => ms <= remaining);
  await tick();
  expect(probes).toBe(0);
  remaining++;
  health = () => { remaining = sendMs - 1; return healthy(); };
  await tick();
  expect(probes).toBe(1);
  expect(posts).toHaveLength(0);
  expect(ledger()).toMatchObject({ status: "unknown", access_attempts: 0 });
  remaining = sendMs + 5_000;
  health = healthy;
  await tick();
  expect(probes).toBe(2);
  expect(posts[0]?.text).toMatch(/^🔁 Kirim ulang otomatis/);
});

it("first claim rechecks the order after preparing the message", async () => {
  at(0);
  seed("whatsapp");
  const queryFirst = db.queryFirst;
  db.queryFirst = (sql, ...args) => {
    if (sql.startsWith("INSERT INTO buyer_notice_log")) {
      fx.sql.prepare("UPDATE orders SET telegram_paid_admin_notified_at=datetime('now') WHERE code=?").run(CODE);
    }
    return queryFirst(sql, ...args);
  };
  expect(await notifyWhatsAppPaidAdmin(CODE, db)).toBe(false);
  expect(ledger()).toBeUndefined();
  expect(posts).toHaveLength(0);
});

it("a hung getMe aborts after five seconds without consuming the attempt", async () => {
  at(0);
  seed("web"); seedNotice("unknown");
  at(31);
  const started = Promise.withResolvers<AbortSignal>();
  health = (signal) => new Promise((_resolve, rejectProbe) => {
    if (!signal) throw new Error("Missing abort signal");
    signal.addEventListener("abort", () => rejectProbe(signal.reason), { once: true });
    started.resolve(signal);
  });
  vi.useFakeTimers();
  try {
    const tick = retry();
    const signal = await Promise.race([started.promise, tick.then(() => { throw new Error("No getMe probe"); })]);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    expect(await tick).toMatchObject({ paidAdminWeb: 0 });
    expect(posts).toHaveLength(0);
    expect(ledger()).toMatchObject({ status: "unknown", access_attempts: 0 });
  } finally { vi.useRealTimers(); }
});

it("unhealthy getMe never gates first sends or definite retries", async () => {
  at(0);
  const webCode = `${CODE}-WEB`;
  const waCode = `${CODE}-WA`;
  seed("telegram"); seedNotice("unknown");
  seed("web", webCode);
  seed("whatsapp", waCode);
  reply = () => reject(403);
  expect(await notifyWhatsAppPaidAdmin(waCode, db)).toBe(false);
  at(31);
  health = () => Response.json({ ok: true }); // malformed health result
  reply = accept;
  expect(await retry()).toMatchObject({ paidAdmin: 1, paidAdminWeb: 1 });
  expect(probes).toBe(1);
  expect(posts.slice(1).map(({ text }) => String(text).includes(RECOVERY_LABEL))).toEqual([false, false]);
  expect(ledger()).toMatchObject({ status: "unknown", access_attempts: 0 });
});

it("retains web 400 fallback and 429 retry without spending another recovery", async () => {
  at(0);
  seed("web"); seedNotice("unknown");
  at(31);
  reply = () => posts.length === 1 ? reject(400) : reject(429, { retry_after: 120 });
  expect(await retry()).toMatchObject({ paidAdminWeb: 0 });
  expect(posts).toHaveLength(2);
  expect(posts[0].reply_markup).toBeTruthy();
  expect(posts[1].reply_markup).toBeUndefined();
  expect(posts[1].text).toBe(posts[0].text);
  expect(String(posts[0].text).split("\n")[0]).toBe(RECOVERY_LABEL);
  expect(ledger()).toMatchObject({ status: "failed", access_attempts: 1 });
  at(32);
  await retry();
  expect(posts).toHaveLength(2);
  at(33);
  reply = () => reject(500);
  await retry();
  expect(posts).toHaveLength(3);
  expect(String(posts[2].text).split("\n")[0]).toBe(RECOVERY_LABEL);
  expect(ledger()).toMatchObject({ status: "unknown", access_attempts: 1 });
  at(70);
  await retry();
  expect(probes).toBe(1);
  expect(posts).toHaveLength(3);
});

it("persistent web 400 retries the same text without a keyboard once per claim, then next cron; stops when aged out", async () => {
  seed("web");
  reply = () => reject(400);
  expect(await notifyWebPaidAdmin(CODE, db)).toBe(false);
  expect(posts).toHaveLength(2);
  expect(posts[0].reply_markup).toBeTruthy();
  expect(posts[1]).toEqual({ chat_id: posts[0].chat_id, text: posts[0].text, parse_mode: posts[0].parse_mode });
  expect(ledger()).toMatchObject({ status: "failed", error: "rejected:400", access_lease: null });
  expect(fx.sql.prepare(PROBE).get()?.paid_admin_web).toBe(1);
  expect((await retry()).paidAdminWeb).toBe(0);
  expect(posts).toHaveLength(4);
  fx.sql.prepare("UPDATE orders SET paid_at=datetime('now','-7 hours') WHERE code=?").run(CODE);
  expect(fx.sql.prepare(PROBE).get()?.paid_admin_web).toBe(0);
  expect((await retry()).paidAdminWeb).toBe(0);
  expect(posts).toHaveLength(4);
});

it("a late settler cannot change another lease or downgrade sent", async () => {
  seed("telegram");
  const update = fx.sql.prepare("UPDATE buyer_notice_log SET status=?, access_lease=COALESCE(?,access_lease), provider_id='other' WHERE idempotency_key=?");
  for (const status of ["sending", "sent"]) {
    fx.sql.prepare("DELETE FROM buyer_notice_log WHERE idempotency_key=?").run(KEY);
    reply = () => { update.run(status, status === "sending" ? "other-lease" : null, KEY); return reject(403); };
    expect(await notifyTelegramPaidAdmin(CODE, db)).toBe(false);
    expect(ledger()).toMatchObject({ status, provider_id: "other", error: null });
  }
  expect(posts).toHaveLength(2);
});

it("an accepted POST with a lost D1 settlement stays suppressed even after the old stale cutoff", async () => {
  seed("web");
  const execRun = db.execRun;
  db.execRun = async (sql, ...args) => {
    if (sql.startsWith("UPDATE buyer_notice_log SET status=")) throw new Error("D1 timeout after POST");
    return execRun(sql, ...args);
  };
  expect(await notifyWebPaidAdmin(CODE, db)).toBe(false);
  expect(ledger()?.status).toBe("sending");
  fx.sql.prepare("UPDATE buyer_notice_log SET updated_at=datetime('now','-11 minutes') WHERE idempotency_key=?").run(KEY);
  db.execRun = execRun;
  await retry();
  expect(await notifyWebPaidAdmin(CODE, db)).toBe(false);
  expect(posts).toHaveLength(1);
});
