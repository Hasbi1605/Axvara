import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { operationQueueProbeSql, WEB_PAID_ADMIN_PENDING_WHERE } from "@/lib/cron-queues";
import {
  notifyTelegramPaidAdmin, notifyWebPaidAdmin, notifyWhatsAppPaidAdmin, retryPendingTelegramNotifications,
} from "@/lib/telegram/order-notifications";
import { createD1Fixture } from "./helpers/d1-fixture";

const CODE = "AXV-20261121-00000001";
const KEY = `admin-paid:${CODE}`;
const ONLY_ADMIN = { created: false, paid: false, paidAdmin: true, paidAdminWeb: true };
const PROBE = operationQueueProbeSql("notify", "0", WEB_PAID_ADMIN_PENDING_WHERE)!;
const senders = { web: notifyWebPaidAdmin, telegram: notifyTelegramPaidAdmin, whatsapp: notifyWhatsAppPaidAdmin };
const channels = Object.keys(senders) as (keyof typeof senders)[];
const accept = () => Response.json({ ok: true, result: { message_id: 42 } });
const reject = (code: number, parameters?: { retry_after: number }) => Response.json({ ok: false, error_code: code, parameters, description: "upstream text not for logs" }, { status: code });
let fx: ReturnType<typeof createD1Fixture>;
let db: ReturnType<typeof createDatabaseAccess>;
let reply: () => Response | Promise<Response>;
let posts: Record<string, unknown>[];

beforeEach(() => {
  fx = createD1Fixture();
  db = createDatabaseAccess(fx.db);
  posts = [];
  reply = accept;
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture-only");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-1234");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("https://api.telegram.org/botfixture-only/sendMessage");
    expect(init.method).toBe("POST");
    posts.push(JSON.parse(String(init.body)));
    return reply();
  }));
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const ledger = () => fx.sql.prepare("SELECT * FROM buyer_notice_log WHERE idempotency_key=?").get(KEY);
const marker = () => fx.sql.prepare("SELECT telegram_paid_admin_notified_at AS at FROM orders WHERE code=?").get(CODE)?.at;
const retry = () => retryPendingTelegramNotifications(50, ONLY_ADMIN, db);

function seed(channel: string) {
  fx.sql.prepare(`INSERT INTO orders (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
    sales_channel,paid_at,telegram_user_id,variant_snapshot) VALUES (?,'Test','','[]',10000,'qris','lunas','paid',?,datetime('now'),'123','{}')`).run(CODE, channel);
}

describe.each(channels)("%s paid-admin ledger", (channel) => {
  const send = () => senders[channel](CODE, db);
  const count = () => fx.sql.prepare(PROBE).get()?.[channel === "web" ? "paid_admin_web" : "paid_admin"];
  beforeEach(() => seed(channel));

  it.each([
    ["timeout", () => { throw new DOMException("aborted", "AbortError"); }],
    ["Network connection lost", () => { throw new Error("Network connection lost"); }],
    ["parse error", () => new Response("<html>", { status: 500 })],
    ["structured 500", () => reject(500)],
    ["ok without message_id", () => Response.json({ ok: true, result: {} })],
  ])("does not replay %s at +10/+20/+60/+360 or on direct follow-up", async (_name, failure) => {
    // Anchor all simulated elapsed intervals to the same initial paid/claim time.
    expect(count()).toBe(1);
    reply = failure;
    expect(await send()).toBe(false);
    expect(ledger()).toMatchObject({ status: "unknown", error: "ambiguous", access_lease: null, access_retry_at: null });
    expect(marker()).toBeNull();
    reply = accept;
    for (const minutes of [10, 20, 60, 360]) {
      fx.sql.prepare("UPDATE orders SET paid_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?) WHERE code=?").run(`-${minutes} minutes`, CODE);
      fx.sql.prepare("UPDATE buyer_notice_log SET updated_at=datetime('now',?) WHERE idempotency_key=?").run(`-${minutes} minutes`, KEY);
      expect(count()).toBe(0);
      expect(await retry()).toMatchObject({ paidAdmin: 0, paidAdminWeb: 0 });
    }
    expect(await send()).toBe(false);
    expect(posts).toHaveLength(1);
    expect(ledger()?.status).toBe("unknown");
  });

  it("fails closed when the D1 claim throws", async () => {
    const execRun = db.execRun;
    db.execRun = async (sql, ...args) => {
      if (sql.startsWith("INSERT INTO buyer_notice_log")) throw new Error("D1 unavailable");
      return execRun(sql, ...args);
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

  it.each([
    [KEY, "sending"], [`admin-paid-timeout:${CODE}`, "failed"], [KEY, "failed"],
  ])("does not reclaim legacy/stale notice %s (%s)", async (key, status) => {
    fx.sql.prepare(`INSERT INTO buyer_notice_log (idempotency_key,order_code,channel,status,updated_at)
      VALUES (?,?,'telegram',?,datetime('now','-1 hour'))`).run(key, CODE, status);
    expect(count()).toBe(0);
    expect(await retry()).toMatchObject({ paidAdminWeb: 0, paidAdmin: 0 });
    expect(await send()).toBe(false);
    expect(posts).toHaveLength(0);
  });

  it("does not select old paid orders without a ledger", async () => {
    fx.sql.prepare("UPDATE orders SET paid_at=datetime('now','-6 hours','-1 second') WHERE code=?").run(CODE);
    expect(count()).toBe(0);
    expect(await retry()).toMatchObject({ paidAdmin: 0, paidAdminWeb: 0 });
    expect(posts).toHaveLength(0);
  });

  it.each([[125, 125], [1, 60]])("429 retry_after=%s is due no sooner than %s seconds", async (retryAfter, minimum) => {
    const now = () => Number(fx.sql.prepare("SELECT ROUND(julianday('now') * 86400000) AS ms").get()?.ms);
    const start = now();
    reply = () => reject(429, { retry_after: retryAfter });
    expect(await send()).toBe(false);
    expect(posts).toHaveLength(1);
    expect(ledger()).toMatchObject({ status: "failed", error: "rate_limited" });
    const due = Number(fx.sql.prepare("SELECT ROUND(julianday(access_retry_at) * 86400000) AS ms FROM buyer_notice_log WHERE idempotency_key=?").get(KEY)?.ms);
    expect(due - start).toBeGreaterThanOrEqual(minimum * 1000);
    expect(due - now()).toBeLessThanOrEqual(minimum * 1000);
    reply = accept;
    expect(count()).toBe(0);
    expect(await send()).toBe(false);
    await retry();
    expect(posts).toHaveLength(1);
    fx.sql.prepare("UPDATE buyer_notice_log SET access_retry_at=datetime('now','-1 second') WHERE idempotency_key=?").run(KEY);
    expect(count()).toBe(1);
    await retry();
    expect(posts).toHaveLength(2);
    expect(ledger()?.status).toBe("sent");
  });
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
