import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { sendMessage } from "@/lib/telegram/api";
import { notifyTelegramBuyerPaid, retryPendingTelegramNotifications } from "@/lib/telegram/order-notifications";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/telegram/api", () => ({ sendMessage: vi.fn() }));

let fx: ReturnType<typeof createD1Fixture>;
const paidOnly = { created: false, paid: true, paidAdmin: false };
const key = (code: string) => `telegram:paid:${code}`;
const notice = (code: string) => fx.sql.prepare("SELECT * FROM buyer_notice_log WHERE idempotency_key=?").get(key(code));
const marker = (code: string) => fx.sql.prepare("SELECT telegram_paid_notified_at FROM orders WHERE code=?").get(code)?.telegram_paid_notified_at;

function order(code: string, buyer = "12345", wa = "628123456789") {
  fx.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
     sales_channel,telegram_user_id,telegram_chat_id,paid_at)
    VALUES (?,'Buyer',?,'[{"variant_id":1,"name":"Fixture","qty":1}]',10000,'qris',
      'lunas','paid','telegram',?, '-100500',datetime('now'))`).run(code, wa, buyer);
  fx.sql.prepare("INSERT OR IGNORE INTO telegram_users(user_id,chat_id) VALUES(?,?)").run(buyer, buyer);
}

beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in fixture"); }));
  vi.mocked(sendMessage).mockReset().mockResolvedValue({ ok: true } as never);
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Fixture','fixture',10000,100);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode)
    VALUES(1,1,'FIXTURE','Fixture',10000,100,'manual')`);
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Telegram paid notice durable ownership", () => {
  it("overlapping callers acquire only one transport lease", async () => {
    order("CONCURRENT");
    let finish!: () => void;
    let started!: () => void;
    const sending = new Promise<void>(resolve => { started = resolve; });
    const transport = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(sendMessage).mockImplementationOnce(async () => {
      started();
      await transport;
      return { ok: true } as never;
    });
    const db = createDatabaseAccess(fx.db);
    const first = notifyTelegramBuyerPaid("CONCURRENT", db);
    await sending;
    expect(await notifyTelegramBuyerPaid("CONCURRENT", db)).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(notice("CONCURRENT")).toMatchObject({ status: "sending", access_attempts: 1 });
    finish();
    expect(await first).toBe(true);
    expect(notice("CONCURRENT")).toMatchObject({ status: "sent", access_lease: null });
    expect(marker("CONCURRENT")).toBeTruthy();
  });

  it("fails closed when ownership cannot be persisted", async () => {
    order("DB-FAIL");
    fx.control.fail = sql => sql.includes("INSERT INTO buyer_notice_log");
    expect(await notifyTelegramBuyerPaid("DB-FAIL", createDatabaseAccess(fx.db))).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(marker("DB-FAIL")).toBeNull();
  });

  it("bounds ambiguous failures to five attempts with 1/5/15/60 minute backoff", async () => {
    order("TIMEOUT");
    vi.mocked(sendMessage).mockRejectedValue(new Error("timeout after possible acceptance"));
    const db = createDatabaseAccess(fx.db);
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(await notifyTelegramBuyerPaid("TIMEOUT", db)).toBe(false);
      expect(notice("TIMEOUT")).toMatchObject({ status: "failed", access_attempts: attempt, error: "telegram_send_failed" });
      const minutes = fx.sql.prepare(`SELECT round((julianday(access_retry_at)-julianday(updated_at))*1440) AS n
        FROM buyer_notice_log WHERE idempotency_key=?`).get(key("TIMEOUT"))?.n;
      expect(minutes).toBe([1, 5, 15, 60, 60][attempt - 1]);
      expect(await notifyTelegramBuyerPaid("TIMEOUT", db)).toBe(false);
      expect(sendMessage).toHaveBeenCalledTimes(attempt);
      fx.sql.prepare("UPDATE buyer_notice_log SET access_retry_at=datetime('now','-1 minute') WHERE idempotency_key=?").run(key("TIMEOUT"));
    }
    expect(await notifyTelegramBuyerPaid("TIMEOUT", db)).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(5);
    expect((await retryPendingTelegramNotifications(4, paidOnly, db)).paid).toBe(0);
    expect(marker("TIMEOUT")).toBeNull();
  });

  it("reclaims an expired lease but fences a late failed worker", async () => {
    order("STALE");
    let finish!: () => void;
    let started!: () => void;
    const sending = new Promise<void>(resolve => { started = resolve; });
    const transport = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(sendMessage).mockImplementationOnce(async () => {
      started();
      await transport;
      return { ok: false } as never;
    });
    const db = createDatabaseAccess(fx.db);
    const stale = notifyTelegramBuyerPaid("STALE", db);
    await sending;
    fx.sql.prepare(`UPDATE buyer_notice_log SET updated_at=datetime('now','-11 minutes'),
      access_retry_at=datetime('now','-1 minute') WHERE idempotency_key=?`).run(key("STALE"));
    expect(await notifyTelegramBuyerPaid("STALE", db)).toBe(true);
    finish();
    expect(await stale).toBe(false);
    expect(notice("STALE")).toMatchObject({ status: "sent", access_attempts: 2, error: null });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("a sent ledger repairs an interrupted legacy marker without resending", async () => {
    order("MARKER");
    fx.control.fail = sql => sql.includes("UPDATE orders SET telegram_paid_notified_at");
    expect(await notifyTelegramBuyerPaid("MARKER", createDatabaseAccess(fx.db))).toBe(true);
    expect(marker("MARKER")).toBeNull();
    expect(notice("MARKER")?.status).toBe("sent");
    fx.control.fail = null;
    const budget = createBudgetedDatabase(40, 2, fx.db);
    expect((await retryPendingTelegramNotifications(4, paidOnly, budget.access)).paid).toBe(1);
    expect(budget.used).toBe(3);
    expect(marker("MARKER")).toBeTruthy();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe("Telegram paid notice eligibility and budgets", () => {
  it("four blocked old buyers enter backoff, allowing the next buyer to progress", async () => {
    for (let i = 0; i < 4; i++) {
      order(`BLOCKED-${i}`, `${100 + i}`);
      fx.sql.prepare("UPDATE orders SET paid_at=datetime('now','-1 day'), updated_at=paid_at WHERE code=?").run(`BLOCKED-${i}`);
    }
    vi.mocked(sendMessage).mockResolvedValue({ ok: false, error_code: 403 } as never);
    const first = createBudgetedDatabase(40, 2, fx.db);
    expect((await retryPendingTelegramNotifications(4, paidOnly, first.access)).paid).toBe(0);
    expect(first.used).toBe(17);
    expect(sendMessage).toHaveBeenCalledTimes(4);
    order("NEXT", "999");
    vi.mocked(sendMessage).mockResolvedValue({ ok: true } as never);
    const next = createBudgetedDatabase(40, 2, fx.db);
    expect((await retryPendingTelegramNotifications(4, paidOnly, next.access)).paid).toBe(1);
    expect(next.used).toBe(6);
    expect(marker("NEXT")).toBeTruthy();
    expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ chat_id: "999" }));
    expect(sendMessage).toHaveBeenCalledTimes(5);
  });

  it("new unattempted buyers take precedence even when older retries are due", async () => {
    for (let i = 0; i < 4; i++) order(`OLD-${i}`, `${100 + i}`);
    vi.mocked(sendMessage).mockResolvedValue({ ok: false } as never);
    await retryPendingTelegramNotifications(4, paidOnly, createDatabaseAccess(fx.db));
    fx.sql.exec("UPDATE buyer_notice_log SET access_retry_at=datetime('now','-1 minute')");
    order("NEW", "999");
    vi.mocked(sendMessage).mockClear().mockResolvedValue({ ok: true } as never);
    await retryPendingTelegramNotifications(1, paidOnly, createDatabaseAccess(fx.db));
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chat_id: "999" }));
  });

  it("old delivered and ownerless group history cannot consume fresh notice slots", async () => {
    for (let i = 0; i < 10; i++) {
      order(`DELIVERED-${i}`);
      fx.sql.prepare(`UPDATE orders SET fulfillment_status='delivered', paid_at=datetime('now','-1 year')
        WHERE code=?`).run(`DELIVERED-${i}`);
      order(`GROUP-${i}`, "");
    }
    order("FRESH", "999");
    const budget = createBudgetedDatabase(40, 2, fx.db);
    expect((await retryPendingTelegramNotifications(4, paidOnly, budget.access)).paid).toBe(1);
    expect(budget.used).toBe(6);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chat_id: "999" }));
  });

  it("caps notices at three with counted statements under the shared 40-statement fixture budget (production notify_a uses 300)", async () => {
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100200");
    // Real Bot API success carries message_id; the admin-paid ledger only marks such sends 'sent'.
    vi.mocked(sendMessage).mockResolvedValue({ ok: true, result: { message_id: 1 } } as never);
    for (let i = 0; i < 8; i++) order(`BUDGET-${i}`, `${100 + i}`);
    const budget = createBudgetedDatabase(40, 2, fx.db);
    const before = fx.control.queries;
    const result = await retryPendingTelegramNotifications(8, undefined, budget.access);
    expect(result.paid).toBe(3);
    expect(fx.control.queries - before).toBe(budget.used);
    expect(budget.used).toBe(38);
    expect(vi.mocked(sendMessage).mock.calls.filter(([m]) => Number(m.chat_id) > 0)).toHaveLength(3);
    expect(vi.mocked(sendMessage).mock.calls.filter(([m]) => m.chat_id === "-100200")).toHaveLength(3);
    budget.beginTail();
    await budget.access.execRun("SELECT 1");
    await budget.access.execRun("SELECT 1");
    expect(budget.used).toBe(40);
  });
});

describe("Telegram paid notice privacy and conversation ownership", () => {
  it.each(["search:", "email:checkout", "qty:1", "wa_after_paid:OTHER"])("does not replace active %s input", async pending => {
    order("ACTIVE", "12345", "");
    fx.sql.prepare("UPDATE telegram_users SET pending_action=? WHERE user_id='12345'").run(pending);
    expect(await notifyTelegramBuyerPaid("ACTIVE", createDatabaseAccess(fx.db))).toBe(true);
    expect(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id='12345'").get()?.pending_action).toBe(pending);
  });

  it("does not replace a conversation started while the notice was in flight", async () => {
    order("IN-FLIGHT", "12345", "");
    vi.mocked(sendMessage).mockImplementationOnce(async () => {
      fx.sql.exec("UPDATE telegram_users SET pending_action='search:' WHERE user_id='12345'");
      return { ok: true } as never;
    });
    expect(await notifyTelegramBuyerPaid("IN-FLIGHT", createDatabaseAccess(fx.db))).toBe(true);
    expect(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id='12345'").get()?.pending_action).toBe("search:");
  });

  it.each([null, "", "  "])("never installs a WA-number prompt for a paid order, even when idle (%s)", async pending => {
    order("IDLE", "12345", "");
    fx.sql.prepare("UPDATE telegram_users SET pending_action=? WHERE user_id='12345'").run(pending);
    const budget = createBudgetedDatabase(40, 2, fx.db);
    expect(await notifyTelegramBuyerPaid("IDLE", budget.access)).toBe(true);
    expect(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id='12345'").get()?.pending_action).toBe(pending);
    expect(vi.mocked(sendMessage).mock.calls.at(-1)?.[0].text).not.toMatch(/cadangan|nomor WhatsApp aktif/);
  });

  it.each(["-100500", "99999", ""])("uses the verified order owner instead of stale saved chat %s", async saved => {
    order("FALLBACK");
    fx.sql.prepare("UPDATE telegram_users SET chat_id=? WHERE user_id='12345'").run(saved);
    expect(await notifyTelegramBuyerPaid("FALLBACK", createDatabaseAccess(fx.db))).toBe(true);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chat_id: "12345" }));
  });

  it("falls back to the order owner even without a saved user row", async () => {
    order("NO-ROW");
    fx.sql.exec("DELETE FROM telegram_users");
    expect(await notifyTelegramBuyerPaid("NO-ROW", createDatabaseAccess(fx.db))).toBe(true);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chat_id: "12345" }));
  });

  it.each(["", "-100500", "not-an-id", "1e5", "9007199254740992"])("never sends to a group or guesses an owner from %s", async buyer => {
    order("UNOWNED", buyer);
    fx.sql.prepare("UPDATE telegram_users SET chat_id='99999' WHERE user_id=?").run(buyer);
    expect(await notifyTelegramBuyerPaid("UNOWNED", createDatabaseAccess(fx.db))).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(marker("UNOWNED")).toBeNull();
  });
});
