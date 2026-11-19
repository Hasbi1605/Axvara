// tests/telegram-payment-terminal-and-fence.test.ts — R3 correction (local only):
// (1) gateway/crypto expiry+cancel PUSH through the existing notifier + shared
// cron-operations probe predicate, (2) dispatch-vs-retry send fence on the
// existing orders.telegram_invoice_attempts claim. Real SQLite D1 fixture, real
// handlers/notifier, mocked Telegram + provider HTTP. Crashed claims are
// simulated by clock aging (no process kill).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";
import { seedCryptoMarket } from "./helpers/crypto-market";
import { handleCallback } from "@/lib/telegram/handlers/callback";
import { parsePayq1State } from "@/lib/telegram/payment-quote";
import { sendMessage, safeEditOrSend, sendPhoto, sendChatAction } from "@/lib/telegram/api";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(), sendPhoto: vi.fn(), sendChatAction: vi.fn(),
  safeEditOrSend: vi.fn(), showLoadingBar: vi.fn(async () => {}),
  answerCallbackQuery: vi.fn(async () => {}),
  withLoadingIndicator: async (_chat: unknown, _label: unknown, fn: (done: () => Promise<void>) => Promise<unknown>) => fn(async () => {}),
}));
vi.mock("@/lib/payments/dana-qris", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/dana-qris")>()),
  isActiveQrisConfigured: () => true,
}));

const buyer = { id: 777002, first_name: "Singularity" };
const send = vi.mocked(sendMessage);
const edit = vi.mocked(safeEditOrSend);
let fx: ReturnType<typeof createD1Fixture>;

const click = (data: string, chatId = buyer.id, from = buyer) =>
  handleCallback(data, chatId, 21, from, `cb-${Math.random()}`);
const userRaw = () =>
  String(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get(String(buyer.id))?.pending_action ?? "");

// NOWPayments provider mock: estimate/min-amount + POST create + GET status
// mirrored from the SAVED ledger so honest GET re-reads agree with finalize.
const PAY_ID = "NP-r2a-fixture-1";
const PAY_ADDR = "0xBEEFCAFE0123456789abcdef0123456789abc";
function nowpaymentsFetchImpl(opts?: { postAmount?: string; status?: string; actuallyPaid?: string }) {
  const status = opts?.status ?? "waiting";
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.includes("/estimate?")) return Response.json({ estimated_amount: "1.25", currency_from: "usd", currency_to: "usdtbsc" });
    if (target.includes("/min-amount?")) return Response.json({ min_amount: "0.0005", currency_from: "usdtbsc", currency_to: "usdtbsc" });
    if (target.endsWith("/payment") && (init as RequestInit | undefined)?.method === "POST") {
      const body = JSON.parse(String((init as RequestInit).body));
      return Response.json({
        payment_id: PAY_ID, pay_address: PAY_ADDR,
        pay_amount: opts?.postAmount ?? "1.25",
        price_amount: String(body.price_amount), price_currency: String(body.price_currency),
        pay_currency: String(body.pay_currency), order_id: String(body.order_id),
        is_fixed_rate: false, is_fee_paid_by_user: false,
        valid_until: new Date(Date.now() + 900_000).toISOString(),
        payment_status: status, actually_paid: opts?.actuallyPaid ?? "0",
        outcome_amount: "1.25", outcome_currency: "usdtbsc",
      }, { status: 201 });
    }
    if (target.includes("/payment/")) {
      const ref = String(target.split("/").at(-1));
      const saved = fx.sql.prepare("SELECT provider_payment_id,pay_amount_text,price_amount_text,price_currency,pay_currency,pay_address,pay_network,order_code FROM payment_transactions WHERE provider_payment_id=? OR order_code=?").get(ref, ref) as Record<string, unknown> | undefined;
      return Response.json({
        payment_id: String(saved?.provider_payment_id ?? PAY_ID),
        pay_address: String(saved?.pay_address ?? PAY_ADDR),
        pay_amount: String(saved?.pay_amount_text ?? "1.25"),
        price_amount: String(saved?.price_amount_text ?? "15.63"),
        price_currency: String(saved?.price_currency ?? "usd"),
        pay_currency: String(saved?.pay_currency ?? "usdtbsc"),
        network: saved?.pay_network ? String(saved.pay_network) : "bsc",
        order_id: String(saved?.order_code ?? ""),
        is_fixed_rate: false, is_fee_paid_by_user: false,
        valid_until: new Date(Date.now() + 900_000).toISOString(),
        payment_status: status, actually_paid: opts?.actuallyPaid ?? "0",
        outcome_amount: "1.25", outcome_currency: "usdtbsc",
      });
    }
    throw new Error(`unexpected ${target}`);
  });
}

async function seedCartUser(locale = "en") {
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,locale,buyer_email) VALUES(?,?,?,?)")
    .run(String(buyer.id), String(buyer.id), locale, "buyer@example.test");
  fx.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES(?,?,?,?)").run(String(buyer.id), 1, 1, 2);
}

async function offerWithCrypto(opts?: { nowFetch?: ReturnType<typeof vi.fn> }) {
  vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
  vi.stubEnv("NOWPAYMENTS_API_KEY", "k");
  vi.stubEnv("NOWPAYMENTS_IPN_SECRET", "s");
  vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc");
  vi.stubGlobal("fetch", opts?.nowFetch ?? nowpaymentsFetchImpl());
  await seedCartUser();
  await click("pmentry");
  const frozen = parsePayq1State(userRaw())!;
  const index = frozen.methods.findIndex((m) => m.id === "nowpayments:usdtbsc");
  expect(index).toBeGreaterThanOrEqual(0);
  await click(`pm:${frozen.nonce}:${index}`);
  return parsePayq1State(userRaw())!;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true"); // qty/variant entry points need the variants read path
  vi.stubEnv("ADMIN_JWT_SECRET", "tg-r2a-fixture");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "tg-r2a-fixture-secret-0123456789");
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "klikqris");
  vi.stubEnv("KLIKQRIS_ENABLED", "true");
  vi.stubEnv("KLIKQRIS_API_KEY", "fixture");
  vi.stubEnv("KLIKQRIS_MERCHANT_ID", "123");
  vi.stubEnv("USD_IDR_RATE", "8000");
  vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 60_000).toISOString());
  vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("unexpected network"); }));
  fx = createD1Fixture();
  seedCryptoMarket(fx.sql, { fx: false }); // koin dari snapshot D1; kurs dari pasangan env darurat
  await insertTestProduct(fx.sql, "manual", 1);
  // Discounted cart net: qty 2 x base 10000 with bulk tier 9500 => 19000.
  fx.sql.exec("UPDATE products SET name='Fixture',require_email=0,is_active=1,telegram_enabled=1 WHERE id=1; UPDATE product_variants SET price=10000,stock=100,is_active=1,bulk_pricing_enabled=1,bulk_pricing_tiers='[{\"min_qty\":2,\"unit_price\":9500}]' WHERE id=1; INSERT OR IGNORE INTO categories(id,name,slug) VALUES(1,'Fixture','fixture'); UPDATE products SET category_id=1 WHERE id=1");
  fx.sql.exec("INSERT OR IGNORE INTO payment_methods(id,label,account_number,account_name,is_active,sort_order) VALUES('qris','QRIS','-','AXVARA',1,1)");
  send.mockResolvedValue({ ok: true } as never);
  edit.mockImplementation(async (params) => ({ ok: true, params } as never));
  vi.mocked(sendPhoto).mockResolvedValue({ ok: true } as never);
  vi.mocked(sendChatAction).mockResolvedValue({ ok: true } as never);
});

afterEach(() => {
  fx.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});


const posts = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.filter(([u, i]) => String(u).endsWith("/payment") && (i as RequestInit)?.method === "POST");
const count = (table: string) => Number(fx.sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n);
const stock = () => Number(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock);



const DEFINITE = { ok: false, error_code: 400, description: "Bad Request: chat not found" };
const AMBIGUOUS = { ok: false, description: "Request timeout" };
type Sent = { text: string; markup?: { inline_keyboard?: { text?: string; callback_data?: string; url?: string }[][] } };
const allSends = (): Sent[] =>
  [...send.mock.calls, ...edit.mock.calls].map(([m]) => ({ text: String((m as { text?: string }).text ?? ""), markup: (m as { reply_markup?: never }).reply_markup }));
const withAddress = () => allSends().filter((m) => m.text.includes(PAY_ADDR));
const buttons = (m: Sent) => (m.markup?.inline_keyboard ?? []).flat();
const orderRow = (code: string) => fx.sql.prepare("SELECT telegram_invoice_sent_at AS sent, telegram_invoice_attempts AS attempts, locale, status, payment_method AS method FROM orders WHERE code=?").get(code) as { sent: string | null; attempts: number; locale: string; status: string; method: string };
const clearTg = () => { send.mockClear(); edit.mockClear(); vi.mocked(sendPhoto).mockClear(); };
const age = (code: string) => fx.sql.prepare("UPDATE orders SET updated_at=datetime('now','-5 minutes') WHERE code=?").run(code);
const okTg = () => { edit.mockImplementation(async (params) => ({ ok: true, params } as never)); send.mockResolvedValue({ ok: true } as never); };

async function cryptoOrder(locale: "en" | "id" = "en") {
  const f = nowpaymentsFetchImpl();
  const quoted = await offerWithCrypto({ nowFetch: f });
  await click(`pgo:${quoted.nonce}`);
  const code = String(fx.sql.prepare("SELECT code FROM orders").get()?.code);
  fx.sql.prepare("UPDATE orders SET locale=? WHERE code=?").run(locale, code);
  clearTg(); okTg();
  return { f, code };
}
async function probeCount() {
  const { operationQueueProbeSql } = await import("@/lib/cron-queues");
  const { QRIS_EXPIRY_NOTICE_WHERE } = await import("@/lib/payments/qris-expiry-notifications");
  const { WEB_PAID_ADMIN_PENDING_WHERE } = await import("@/lib/telegram/order-notifications");
  const sql = operationQueueProbeSql("notify", QRIS_EXPIRY_NOTICE_WHERE, WEB_PAID_ADMIN_PENDING_WHERE)!;
  return Number((fx.sql.prepare(sql).get() as { qris_notice: number }).qris_notice);
}
const terminate = (code: string, status: "kadaluarsa" | "dibatalkan", withTx: boolean) => {
  fx.sql.prepare("UPDATE orders SET status=?, payment_status=? WHERE code=?").run(status, status === "kadaluarsa" ? "expired" : "failed", code);
  if (withTx) fx.sql.prepare("UPDATE payment_transactions SET status='expired' WHERE order_code=?").run(code);
  else fx.sql.prepare("DELETE FROM payment_transactions WHERE order_code=?").run(code);
};

describe("R3 correction 1: gateway/crypto expiry + cancel push", () => {
  it.each([
    ["en", "kadaluarsa", true], ["en", "kadaluarsa", false], ["id", "dibatalkan", true], ["id", "dibatalkan", false],
    ["en", "dibatalkan", true], ["en", "dibatalkan", false], ["id", "kadaluarsa", true], ["id", "kadaluarsa", false],
  ] as const)("crypto %s %s withTx=%s: one localized generic notice, no QRIS/renew/address, queue probe sees then drains", async (locale, status, withTx) => {
    const { code } = await cryptoOrder(locale);
    fx.sql.prepare("UPDATE telegram_users SET locale=? WHERE user_id=?").run(locale === "en" ? "id" : "en", String(buyer.id)); // buyer pref must not matter
    terminate(code, status, withTx);
    expect(await probeCount()).toBe(1);
    const { sendQrisExpiryNotifications } = await import("@/lib/payments/qris-expiry-notifications");
    expect((await sendQrisExpiryNotifications(2)).sent).toBe(1);
    const sent = allSends();
    expect(sent).toHaveLength(1);
    const expected = locale === "en"
      ? (status === "kadaluarsa" ? "Invoice expired" : "cancelled")
      : (status === "kadaluarsa" ? "kedaluwarsa" : "dibatalkan");
    expect(sent[0].text.toLowerCase()).toContain(expected.toLowerCase());
    expect(sent[0].text).toContain(code);
    expect(sent[0].text + JSON.stringify(sent[0].markup ?? {})).not.toMatch(/QRIS|qrenew|0xBEEF|https?:\/\//i);
    expect(buttons(sent[0]).map((b) => b.callback_data)).toEqual([`order:${code}`, "catalog:0"]);
    expect(vi.mocked(sendPhoto)).not.toHaveBeenCalled();
    // Exactly once: later ticks (and a concurrent pair) send nothing; probe drained.
    clearTg();
    await Promise.all([sendQrisExpiryNotifications(2), sendQrisExpiryNotifications(2)]);
    expect(allSends()).toHaveLength(0);
    expect(await probeCount()).toBe(0);
    expect(orderRow(code)).toMatchObject({ locale, status, method: "nowpayments:usdtbsc" });
  });

  it("concurrent first ticks send ONE notice", async () => {
    const { code } = await cryptoOrder("en");
    terminate(code, "kadaluarsa", true);
    const { sendQrisExpiryNotifications } = await import("@/lib/payments/qris-expiry-notifications");
    await Promise.all([sendQrisExpiryNotifications(2), sendQrisExpiryNotifications(2), sendQrisExpiryNotifications(2)]);
    expect(allSends()).toHaveLength(1);
  });

  it("failed send retries on the bounded backoff (at most 5), then stays quiet", async () => {
    const { code } = await cryptoOrder("en");
    terminate(code, "kadaluarsa", true);
    const { sendQrisExpiryNotifications } = await import("@/lib/payments/qris-expiry-notifications");
    send.mockResolvedValue(DEFINITE as never);
    expect((await sendQrisExpiryNotifications(2)).sent).toBe(0);
    expect(await probeCount()).toBe(0); // backing off, not hot-looping the probe
    for (let i = 2; i <= 5; i++) {
      fx.sql.prepare("UPDATE buyer_notice_log SET access_retry_at=datetime('now','-1 minute') WHERE idempotency_key=?").run(`telegram:terminal:${code}`);
      expect(await probeCount()).toBe(1);
      await sendQrisExpiryNotifications(2);
    }
    fx.sql.prepare("UPDATE buyer_notice_log SET access_retry_at=datetime('now','-1 minute') WHERE idempotency_key=?").run(`telegram:terminal:${code}`);
    expect(await probeCount()).toBe(0); // ceiling reached
    expect(send).toHaveBeenCalledTimes(5);
  });

  it("manual-review and paid orders are NOT announced as expired; live pending order untouched", async () => {
    const { code } = await cryptoOrder("en");
    fx.sql.prepare("UPDATE orders SET status='kadaluarsa', payment_status='expired' WHERE code=?").run(code);
    fx.sql.prepare("UPDATE payment_transactions SET status='expired', last_error='nowpayments_partial_manual_review' WHERE order_code=?").run(code);
    const { sendQrisExpiryNotifications } = await import("@/lib/payments/qris-expiry-notifications");
    expect(await probeCount()).toBe(0);
    expect((await sendQrisExpiryNotifications(2)).sent).toBe(0);
    fx.sql.prepare("UPDATE payment_transactions SET status='paid',last_error=NULL WHERE order_code=?").run(code);
    expect(await probeCount()).toBe(0);
    expect((await sendQrisExpiryNotifications(2)).sent).toBe(0);
    fx.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid' WHERE code=?").run(code);
    fx.sql.prepare("UPDATE payment_transactions SET last_error=NULL WHERE order_code=?").run(code);
    expect(await probeCount()).toBe(0);
    fx.sql.prepare("UPDATE orders SET status='pending', payment_status='pending' WHERE code=?").run(code);
    expect(await probeCount()).toBe(0);
    expect(allSends()).toHaveLength(0);
  });

  it.each(["review", "paid"]) ("does not send if %s wins between selection and terminal claim", async (winner) => {
    const { code } = await cryptoOrder("en");
    terminate(code, "kadaluarsa", true);
    let raced = false;
    fx.control.beforeRun = async (sql) => {
      if (!raced && sql.includes("INSERT INTO buyer_notice_log")) {
        raced = true;
        if (winner === "paid") fx.sql.prepare("UPDATE orders SET status='lunas',payment_status='paid' WHERE code=?").run(code);
        else fx.sql.prepare("UPDATE payment_transactions SET last_error='nowpayments_partial_manual_review' WHERE order_code=?").run(code);
      }
    };
    const { sendQrisExpiryNotifications } = await import("@/lib/payments/qris-expiry-notifications");
    expect((await sendQrisExpiryNotifications(2)).sent).toBe(0);
    expect(raced).toBe(true);
    expect(allSends()).toHaveLength(0);
  });

  it("QRIS baseline unchanged: terminal QRIS keeps its copy, shares the per-tick ceiling with the new rail", async () => {
    const { code } = await cryptoOrder("en");
    terminate(code, "kadaluarsa", true);
    fx.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,telegram_user_id,telegram_chat_id,locale,expires_at) VALUES('AXV-20260101-QRISQRIS','b','','[]',9000,'qris','kadaluarsa','expired','telegram','55','55','id',datetime('now','-1 hour'))").run();
    fx.sql.prepare("INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,expires_at) VALUES('AXV-20260101-QRISQRIS','dana','static','po1','m',9000,9017,'expired',?)").run(new Date(Date.now() - 3_600_000).toISOString());
    const { sendQrisExpiryNotifications } = await import("@/lib/payments/qris-expiry-notifications");
    expect(await probeCount()).toBe(2);
    expect((await sendQrisExpiryNotifications(1)).sent).toBe(1); // ceiling honoured
    expect((await sendQrisExpiryNotifications(1)).sent).toBe(1);
    expect(allSends()).toHaveLength(2);
    const qris = allSends().find((m) => m.text.includes("AXV-20260101-QRISQRIS"))!;
    expect(buttons(qris)).toHaveLength(0);
    expect(fx.sql.prepare("SELECT expiry_notice_state AS s FROM payment_transactions WHERE order_code='AXV-20260101-QRISQRIS'").get()?.s).toBe("terminal");
    expect(await probeCount()).toBe(0);
  });

  it("budget: a new-rail notice costs at most the 2 statements the cron already reserves per row", async () => {
    const { code } = await cryptoOrder("en");
    terminate(code, "kadaluarsa", true);
    const { createBudgetedDatabase } = await import("@/lib/db-access");
    const { sendQrisExpiryNotifications } = await import("@/lib/payments/qris-expiry-notifications");
    // select(1) + claim(1) + settle(1) = 3 statements for one row; budget 3 must suffice, no overrun.
    const budgeted = createBudgetedDatabase(5, 2);
    const before = fx.control.queries;
    const result = await sendQrisExpiryNotifications(2, budgeted.access);
    expect(result.sent).toBe(1);
    expect(budgeted.used).toBe(3);
    expect(fx.control.queries - before).toBe(3);
  });
});

describe("R3 correction 1b: gateway terminal push", () => {
  async function gatewayOrder(locale: "en" | "id") {
    // Legacy saved gateway invoice seeded directly: Telegram no longer creates
    // this rail (owner 7 Nov 2026), but terminal push/resume must still work.
    const code = "AXV-20261107-TERMGW01";
    const expires = new Date(Date.now() + 900_000).toISOString();
    await seedCartUser();
    fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_status,status,sales_channel,telegram_chat_id,telegram_user_id,variant_id,variant_snapshot,expires_at,locale)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(code, "Fixture", "6281234567890", "buyer@example.test", "[]", 19000, "sekalipay_gateway:GATEVA", "pending", "pending", "telegram", String(buyer.id), String(buyer.id), 1, "{}", expires, locale);
    fx.sql.prepare(`INSERT INTO payment_transactions
      (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,provider_payment_id,status,expires_at,gateway_fee,gateway_estimated_fee,gateway_fee_consent_required,gateway_channel,gateway_label,direct_url,gateway_virtual_account,gateway_is_sandbox)
      VALUES(?,'sekalipay_gateway','merchant',?,'sekalipay_gateway',19000,19700,'SPY-r3b','pending',?,700,500,1,'GATEVA','Gate VA','https://sekalipay.com/payment/SPY-r3b','888001',0)`)
      .run(code, code, expires);
    clearTg(); okTg();
    return code;
  }
  it.each([
    ["id", "dibatalkan", true], ["id", "dibatalkan", false], ["id", "kadaluarsa", true], ["id", "kadaluarsa", false],
    ["en", "dibatalkan", true], ["en", "dibatalkan", false], ["en", "kadaluarsa", true], ["en", "kadaluarsa", false],
  ] as const)("gateway %s %s withTx=%s: one generic notice with order/catalog buttons only (no VA/link/QRIS)", async (locale, status, withTx) => {
    const code = await gatewayOrder(locale);
    terminate(code, status, withTx);
    expect(await probeCount()).toBe(1);
    const { sendQrisExpiryNotifications } = await import("@/lib/payments/qris-expiry-notifications");
    expect((await sendQrisExpiryNotifications(2)).sent).toBe(1);
    const sent = allSends();
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(code);
    expect(sent[0].text).toMatch(status === "dibatalkan" ? (locale === "id" ? /dibatalkan/i : /cancelled/i) : (locale === "id" ? /kedaluwarsa/i : /expired/i));
    expect(sent[0].text + JSON.stringify(sent[0].markup ?? {})).not.toMatch(/QRIS|qrenew|888001|sekalipay\.com|SPY-r3b/);
    expect(buttons(sent[0]).map((b) => b.callback_data)).toEqual([`order:${code}`, "catalog:0"]);
    clearTg();
    expect((await sendQrisExpiryNotifications(2)).sent).toBe(0);
    expect(await probeCount()).toBe(0);
    expect(orderRow(code)).toMatchObject({ locale, method: "sekalipay_gateway:GATEVA" });
  });

  it("gateway retry accounts every query within the captured budget", async () => {
    const code = await gatewayOrder("en");
    fx.sql.prepare("UPDATE orders SET telegram_invoice_sent_at=NULL,telegram_invoice_attempts=0,updated_at=datetime('now','-5 minutes') WHERE code=?").run(code);
    const { createBudgetedDatabase } = await import("@/lib/db-access");
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    const budget = createBudgetedDatabase(8, 0, fx.db);
    const before = fx.control.queries;
    expect(await retryTelegramInvoiceDelivery(code, budget.access)).toBe(true);
    expect(budget.used).toBe(8);
    expect(fx.control.queries - before).toBe(8);
    expect(allSends().map((m) => m.text).join(" ")).not.toMatch(/sekalipay\.com|888001/);
  });
});

describe("R3 correction 2: dispatch-vs-retry send fence", () => {
  it("a retry tick during the in-flight FIRST send sends nothing; ok:true => delivered, no POST/stock/order change", async () => {
    const f = nowpaymentsFetchImpl();
    const quoted = await offerWithCrypto({ nowFetch: f });
    let release!: (v: unknown) => void;
    const gate = new Promise((r) => { release = r; });
    edit.mockImplementation(async (params) => (String((params as { text?: string }).text).includes(PAY_ADDR) ? (await gate, { ok: true }) : { ok: true }) as never);
    const inflight = click(`pgo:${quoted.nonce}`);
    await vi.waitFor(() => expect(withAddress()).toHaveLength(1));
    const code = String(fx.sql.prepare("SELECT code FROM orders").get()?.code);
    expect(orderRow(code)).toMatchObject({ sent: null, attempts: 1 }); // claimed BEFORE the HTTP
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    expect(await retryTelegramInvoiceDelivery(code)).toBe(false);
    expect(await retryTelegramInvoiceDelivery(code)).toBe(false);
    expect(withAddress()).toHaveLength(1); // still only the in-flight message
    release(undefined);
    await inflight;
    expect(orderRow(code).sent).not.toBeNull();
    expect(orderRow(code).attempts).toBe(1);
    expect(posts(f)).toHaveLength(1); expect(count("orders")).toBe(1); expect(count("payment_transactions")).toBe(1); expect(stock()).toBe(98);
    clearTg(); okTg();
    expect(await retryTelegramInvoiceDelivery(code)).toBe(true);
    expect(allSends()).toHaveLength(0);
  });

  it("in-flight first send ends with a DEFINITE denial: stays pending, recovers via the existing retry once the backoff passes (attempt 2)", async () => {
    const f = nowpaymentsFetchImpl();
    const quoted = await offerWithCrypto({ nowFetch: f });
    edit.mockResolvedValue(DEFINITE as never); send.mockResolvedValue(DEFINITE as never);
    await click(`pgo:${quoted.nonce}`);
    const code = String(fx.sql.prepare("SELECT code FROM orders").get()?.code);
    expect(orderRow(code)).toMatchObject({ sent: null, attempts: 1 });
    clearTg(); okTg();
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    expect(await retryTelegramInvoiceDelivery(code)).toBe(false); // too soon: the claim is fresh
    expect(allSends()).toHaveLength(0);
    age(code); // backoff elapsed (clock aging, not a process kill)
    expect(await retryTelegramInvoiceDelivery(code)).toBe(true);
    expect(withAddress()).toHaveLength(1);
    expect(orderRow(code)).toMatchObject({ attempts: 2 });
    expect(orderRow(code).sent).not.toBeNull();
    expect(posts(f)).toHaveLength(1); expect(stock()).toBe(98);
  });

  it("in-flight first send ends AMBIGUOUS: settled once (marker + nudge), never resent by a later retry", async () => {
    const f = nowpaymentsFetchImpl();
    const quoted = await offerWithCrypto({ nowFetch: f });
    edit.mockResolvedValue(AMBIGUOUS as never);
    await click(`pgo:${quoted.nonce}`);
    const code = String(fx.sql.prepare("SELECT code FROM orders").get()?.code);
    expect(orderRow(code)).toMatchObject({ attempts: 1 });
    expect(orderRow(code).sent).not.toBeNull();
    expect(allSends().filter((m) => m.text.includes("Slow connection"))).toHaveLength(1);
    clearTg(); okTg(); age(code);
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    expect(await retryTelegramInvoiceDelivery(code)).toBe(true);
    expect(allSends()).toHaveLength(0);
  });

  it("crashed claim (claimed, never sent): no retry while fresh; after the backoff exactly one send, attempts +1 (clock aging, not process kill)", async () => {
    const { code } = await cryptoOrder("en");
    fx.sql.prepare("UPDATE orders SET telegram_invoice_sent_at=NULL, telegram_invoice_attempts=1, updated_at=datetime('now') WHERE code=?").run(code);
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    expect(await retryTelegramInvoiceDelivery(code)).toBe(false);
    expect(allSends()).toHaveLength(0);
    age(code);
    await Promise.all([retryTelegramInvoiceDelivery(code), retryTelegramInvoiceDelivery(code)]);
    expect(withAddress()).toHaveLength(1);
    expect(orderRow(code).attempts).toBe(2);
  });

  it("non-live saved views (expired / review) do not burn an attempt", async () => {
    const { code } = await cryptoOrder("en");
    fx.sql.prepare("UPDATE orders SET telegram_invoice_sent_at=NULL, telegram_invoice_attempts=0 WHERE code=?").run(code);
    age(code);
    fx.sql.prepare("UPDATE payment_transactions SET last_error='nowpayments_partial_manual_review' WHERE order_code=?").run(code);
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    expect(await retryTelegramInvoiceDelivery(code)).toBe(false);
    expect(orderRow(code).attempts).toBe(0);
    fx.sql.prepare("UPDATE payment_transactions SET last_error=NULL WHERE order_code=?").run(code);
    fx.sql.prepare("UPDATE orders SET expires_at=datetime('now','-1 minute') WHERE code=?").run(code);
    age(code);
    expect(await retryTelegramInvoiceDelivery(code)).toBe(false);
    expect(orderRow(code).attempts).toBe(0);
    expect(allSends()).toHaveLength(0);
  });

  it("saved Indonesian locale wins over an English preference during status render", async () => {
    const { code } = await cryptoOrder("id");
    const { showProviderInvoiceStatus } = await import("@/lib/telegram/handlers/payment-status");
    await showProviderInvoiceStatus(buyer.id, 21, code, buyer, { locale: "en", savedOnly: true });
    expect(allSends().at(-1)?.text).toContain("Menunggu pembayaran crypto");
  });

  it("charges every retry query to the supplied cron budget", async () => {
    const { code } = await cryptoOrder("en");
    fx.sql.prepare("UPDATE orders SET telegram_invoice_sent_at=NULL,telegram_invoice_attempts=0,updated_at=datetime('now','-5 minutes') WHERE code=?").run(code);
    const { createBudgetedDatabase } = await import("@/lib/db-access");
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    const budget = createBudgetedDatabase(20, 0, fx.db);
    const before = fx.control.queries;
    expect(await retryTelegramInvoiceDelivery(code, budget.access)).toBe(true);
    expect(budget.used).toBe(fx.control.queries - before);
    expect(budget.used).toBe(8);
  });

  it("does not send or claim a provider invoice when the remaining budget is insufficient", async () => {
    const { code } = await cryptoOrder("en");
    fx.sql.prepare("UPDATE orders SET telegram_invoice_sent_at=NULL,telegram_invoice_attempts=0,updated_at=datetime('now','-5 minutes') WHERE code=?").run(code);
    const { createBudgetedDatabase } = await import("@/lib/db-access");
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    const budget = createBudgetedDatabase(7, 0, fx.db);
    expect(await retryTelegramInvoiceDelivery(code, budget.access)).toBe(false);
    expect(orderRow(code)).toMatchObject({ sent: null, attempts: 0 });
    expect(allSends()).toHaveLength(0);
  });
});
