// tests/telegram-payment-delivery.test.ts — TG R3 provider-aware invoice delivery fence,
// bounded text retry, reminders and notices for gateway/crypto (local only).
// Real handlers + existing invoice-retry/order-notifications code + real SQLite
// D1 fixture; outgoing Telegram and provider HTTP mocked. Definite Telegram
// rejection (error_code) and transport-ambiguous failure (no error_code) are
// tested separately. Retry renders the SAVED view as TEXT: never a QRIS photo,
// never a provider POST/GET, re-quote or reservation.
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
const allSends = (): { text: string; markup?: { inline_keyboard?: { callback_data?: string; url?: string }[][] } }[] =>
  [...send.mock.calls, ...edit.mock.calls].map(([m]) => ({ text: String((m as { text?: string }).text ?? ""), markup: (m as { reply_markup?: never }).reply_markup }));
const withAddress = () => allSends().filter((m) => m.text.includes(PAY_ADDR));
const orderRow = (code: string) => fx.sql.prepare("SELECT telegram_invoice_sent_at AS sent, telegram_invoice_attempts AS attempts, locale, status FROM orders WHERE code=?").get(code) as { sent: string | null; attempts: number; locale: string; status: string };

/** Quoted crypto offer -> pgo with every buyer-facing send failing as `failure`. */
async function createWithSendFailure(failure: typeof DEFINITE | typeof AMBIGUOUS | null) {
  const f = nowpaymentsFetchImpl();
  const quoted = await offerWithCrypto({ nowFetch: f });
  if (failure) {
    edit.mockResolvedValue(failure as never);
    if (failure === DEFINITE) send.mockResolvedValue(failure as never);
  }
  await click(`pgo:${quoted.nonce}`);
  const code = String(fx.sql.prepare("SELECT code FROM orders").get()?.code);
  edit.mockImplementation(async (params) => ({ ok: true, params } as never));
  send.mockResolvedValue({ ok: true } as never);
  return { f, code };
}
const clearTg = () => { send.mockClear(); edit.mockClear(); vi.mocked(sendPhoto).mockClear(); };
const age = () => fx.sql.prepare("UPDATE orders SET updated_at=datetime('now','-5 minutes')").run();
const recover = () => { clearTg(); age(); edit.mockImplementation(async (params) => ({ ok: true, params } as never)); send.mockResolvedValue({ ok: true } as never); };

describe("TG R3 provider invoice delivery fence + text retry", () => {
  it("definite send failure at dispatch leaves the invoice pending; existing retry sends the SAVED view as text once, then marks sent", async () => {
    const { f, code } = await createWithSendFailure(DEFINITE);
    expect(orderRow(code)).toMatchObject({ sent: null, attempts: 1, locale: "en" }); // dispatch took the claim (attempt 1)
    expect(count("orders")).toBe(1); expect(posts(f)).toHaveLength(1); expect(stock()).toBe(98);
    const getsBefore = f.mock.calls.length;
    recover();
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    expect(await retryTelegramInvoiceDelivery(code)).toBe(true);
    expect(withAddress()).toHaveLength(1);
    const text = withAddress()[0].text;
    expect(text).toContain("Send exactly <b>1.25 USDT</b> on the <b>BNB Smart Chain</b> network only.");
    expect(text).toContain("incl. crypto service fee US$0.11");
    expect(text).toContain("Wrong coin/network may lose funds. Gas paid by sender.");
    expect(text).not.toMatch(/QRIS/i);
    expect(vi.mocked(sendPhoto)).not.toHaveBeenCalled();
    expect(orderRow(code).sent).not.toBeNull();
    expect(orderRow(code).attempts).toBe(2);
    // Saved-only render: no provider traffic at all, no re-create / reservation.
    expect(f.mock.calls.length).toBe(getsBefore);
    expect(posts(f)).toHaveLength(1); expect(count("orders")).toBe(1); expect(count("payment_transactions")).toBe(1); expect(stock()).toBe(98);
    // Marker set => further retries/sweeps send nothing.
    clearTg();
    expect(await retryTelegramInvoiceDelivery(code)).toBe(true);
    expect(allSends()).toHaveLength(0);
  });

  it("successful dispatch send marks the invoice delivered (no retry traffic)", async () => {
    const { code, f } = await createWithSendFailure(null);
    expect(orderRow(code).sent).not.toBeNull();
    clearTg();
    const { retryTelegramInvoiceDelivery, retryInvoicePendingTelegramInvoices } = await import("@/lib/telegram/invoice-retry");
    vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
    expect(await retryTelegramInvoiceDelivery(code)).toBe(true);
    expect(await retryInvoicePendingTelegramInvoices(4)).toBe(0);
    expect(allSends()).toHaveLength(0);
    expect(posts(f)).toHaveLength(1);
  });

  it("ambiguous send at dispatch: no blind resend — marker set + ONE same-order nudge without amount/address", async () => {
    const { code } = await createWithSendFailure(AMBIGUOUS);
    expect(orderRow(code).sent).not.toBeNull();
    const nudges = allSends().filter((m) => m.text.includes("Slow connection"));
    expect(nudges).toHaveLength(1);
    expect(nudges[0].text).toContain(code);
    expect(nudges[0].text).not.toContain(PAY_ADDR);
    expect(nudges[0].text).not.toMatch(/1\.25|QRIS/i);
    expect(nudges[0].markup?.inline_keyboard?.flat().map((b) => b.callback_data)).toEqual([`refresh:${code}`]);
    recover();
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    expect(await retryTelegramInvoiceDelivery(code)).toBe(true);
    expect(allSends()).toHaveLength(0); // never resent after settlement
    expect(count("orders")).toBe(1); expect(stock()).toBe(98);
  });

  it("retry with an ambiguous transport result settles once (marker + nudge) instead of resending", async () => {
    const { code } = await createWithSendFailure(DEFINITE);
    clearTg(); age();
    edit.mockResolvedValue(AMBIGUOUS as never); send.mockResolvedValue({ ok: true } as never);
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    expect(await retryTelegramInvoiceDelivery(code)).toBe(true);
    expect(orderRow(code).sent).not.toBeNull();
    expect(withAddress()).toHaveLength(1); // the single (ambiguous) attempt; never repeated
    expect(allSends().filter((m) => m.text.includes("Slow connection"))).toHaveLength(1);
    clearTg();
    expect(await retryTelegramInvoiceDelivery(code)).toBe(true);
    expect(allSends()).toHaveLength(0);
  });

  it("repeated definite rejections stay pending and stop at the existing 5-attempt ceiling (dispatch claim counts as attempt 1)", async () => {
    const { code } = await createWithSendFailure(DEFINITE);
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    edit.mockResolvedValue(DEFINITE as never); send.mockResolvedValue(DEFINITE as never);
    for (let i = 2; i <= 5; i++) {
      age();
      expect(await retryTelegramInvoiceDelivery(code)).toBe(false);
      expect(orderRow(code)).toMatchObject({ sent: null, attempts: i });
    }
    clearTg(); age();
    expect(await retryTelegramInvoiceDelivery(code)).toBe(false);
    expect(allSends()).toHaveLength(0);
    expect(orderRow(code).attempts).toBe(5);
  });

  it("two/three concurrent retries have ONE sender (attempt-count CAS fence)", async () => {
    const { code } = await createWithSendFailure(DEFINITE);
    recover();
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    await Promise.all([retryTelegramInvoiceDelivery(code), retryTelegramInvoiceDelivery(code), retryTelegramInvoiceDelivery(code)]);
    expect(withAddress()).toHaveLength(1);
    expect(orderRow(code)).toMatchObject({ attempts: 2 });
    expect(orderRow(code).sent).not.toBeNull();
  });

  it("existing cron sweeper picks up the pending crypto invoice (bounded, same limit) and works with flag off + FX/outcome removed", async () => {
    const { code, f } = await createWithSendFailure(DEFINITE);
    recover();
    vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
    vi.stubEnv("USD_IDR_RATE", ""); vi.stubEnv("USD_FX_EFFECTIVE_AT", ""); vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "");
    vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
    const { retryInvoicePendingTelegramInvoices } = await import("@/lib/telegram/invoice-retry");
    expect(await retryInvoicePendingTelegramInvoices(4)).toBe(1);
    expect(withAddress()).toHaveLength(1);
    expect(orderRow(code).sent).not.toBeNull();
    expect(posts(f)).toHaveLength(1);
    expect(vi.mocked(sendPhoto)).not.toHaveBeenCalled();
  });

  it("order locale is immutable: EN order retried after the buyer flipped to ID stays English", async () => {
    const { code } = await createWithSendFailure(DEFINITE);
    fx.sql.prepare("UPDATE telegram_users SET locale='id' WHERE user_id=?").run(String(buyer.id));
    recover();
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    await retryTelegramInvoiceDelivery(code);
    expect(withAddress()[0].text).toContain("Awaiting crypto payment");
    expect(withAddress()[0].text).not.toContain("Menunggu");
    expect(orderRow(code).locale).toBe("en");
  });

  it.each([
    ["expired order", (code: string) => fx.sql.prepare("UPDATE orders SET expires_at=datetime('now','-1 minute') WHERE code=?").run(code)],
    ["manual review", (code: string) => fx.sql.prepare("UPDATE payment_transactions SET last_error='nowpayments_partial_manual_review' WHERE order_code=?").run(code)],
    ["cancelled order", (code: string) => fx.sql.prepare("UPDATE orders SET status='dibatalkan' WHERE code=?").run(code)],
  ])("retry hides details and never marks sent for %s", async (_n, mutate) => {
    const { code } = await createWithSendFailure(DEFINITE);
    mutate(code);
    recover();
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    expect(await retryTelegramInvoiceDelivery(code)).toBe(false);
    expect(withAddress()).toHaveLength(0);
    expect(allSends().some((m) => /QRIS|qrenew/i.test(m.text + JSON.stringify(m.markup ?? {})))).toBe(false);
    expect(orderRow(code).sent).toBeNull();
    expect(vi.mocked(sendPhoto)).not.toHaveBeenCalled();
  });

  it("QRIS orders keep their photo retry (sendPhoto) and are not routed through the text branch", async () => {
    fx.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,telegram_user_id,telegram_chat_id,locale,expires_at) VALUES('AXV-20260101-QRISQRIS','b','','[{\"name\":\"X\",\"qty\":1}]',9000,'qris','pending','pending','telegram',?,?,'id',datetime('now','+10 minutes'))").run(String(buyer.id), String(buyer.id));
    fx.sql.prepare("INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,qris_url,expires_at) VALUES('AXV-20260101-QRISQRIS','dana','static','po1','m',9000,9017,'pending','https://example.test/q.png',?)").run(new Date(Date.now() + 600_000).toISOString());
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    expect(await retryTelegramInvoiceDelivery("AXV-20260101-QRISQRIS")).toBe(true);
    expect(vi.mocked(sendPhoto)).toHaveBeenCalledTimes(1);
    expect(allSends()).toHaveLength(0);
  });
});

describe("TG R3 gateway consent-gated delivery, reminders, notices", () => {
  async function gatewayOrderWithSendFailure() {
    // Legacy saved gateway invoice seeded directly (Telegram no longer creates
    // the rail since 7 Nov 2026). Delivery semantics are unchanged.
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", "wk"); vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "ws");
    const code = "AXV-20261107-DELIVGW1";
    const expires = new Date(Date.now() + 900_000).toISOString();
    const gw = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes(`/payment/${code}`)) return Response.json({ status: true, data: { merchant_ref_id: code, invoice: "SPY-r3", amount: 19000, fee: 700, total: 19700, payment_code: "GATEVA", payment_link: "https://sekalipay.com/payment/SPY-r3", virtual_account: "888001", checkout_url: null, status: "pending", is_sandbox: false, expired_at: expires } });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", gw);
    await seedCartUser();
    fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_status,status,sales_channel,telegram_chat_id,telegram_user_id,variant_id,variant_snapshot,expires_at,locale)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(code, "Fixture", "6281234567890", "buyer@example.test", "[]", 19000, "sekalipay_gateway:GATEVA", "pending", "pending", "telegram", String(buyer.id), String(buyer.id), 1, "{}", expires, "en");
    fx.sql.prepare(`INSERT INTO payment_transactions
      (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,provider_payment_id,status,expires_at,gateway_fee,gateway_estimated_fee,gateway_fee_consent_required,gateway_channel,gateway_label,direct_url,gateway_virtual_account,gateway_is_sandbox)
      VALUES(?,'sekalipay_gateway','merchant',?,'sekalipay_gateway',19000,19700,'SPY-r3','pending',?,700,500,1,'GATEVA','Gate VA','https://sekalipay.com/payment/SPY-r3','888001',0)`)
      .run(code, code, expires);
    edit.mockResolvedValue(DEFINITE as never); send.mockResolvedValue(DEFINITE as never);
    const { showProviderInvoiceStatus } = await import("@/lib/telegram/handlers/payment-status");
    await showProviderInvoiceStatus(buyer.id, 21, code, buyer, { locale: "en" });
    return { gw, code };
  }

  it("gateway: fee-consent prompt is the delivered invoice; retry resends the NON-disclosing prompt as text from saved data", async () => {
    const { gw, code } = await gatewayOrderWithSendFailure();
    expect(orderRow(code).sent).toBeNull();
    const before = gw.mock.calls.length;
    recover();
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    expect(await retryTelegramInvoiceDelivery(code)).toBe(true);
    const sent = allSends();
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("Confirm gateway fee");
    expect(sent[0].text + JSON.stringify(sent[0].markup)).not.toMatch(/888001|sekalipay\.com\/payment|SPY-r3|QRIS/);
    expect(sent[0].markup?.inline_keyboard?.flat().some((b) => b.callback_data?.startsWith("gconsent:"))).toBe(true);
    expect(gw.mock.calls.length).toBe(before); // no POST/GET/re-quote
    expect(orderRow(code).sent).not.toBeNull();
    expect(count("orders")).toBe(1); expect(stock()).toBe(100); // legacy seed tidak mereservasi stok
  });

  it("reminders: crypto order gets generic saved-locale copy with a refresh button (no QRIS wording/amount/address); QRIS reminder unchanged", async () => {
    const { code } = await createWithSendFailure(null);
    fx.sql.prepare("UPDATE telegram_users SET locale='id' WHERE user_id=?").run(String(buyer.id));
    fx.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,telegram_user_id,telegram_chat_id,locale,expires_at) VALUES('AXV-20260101-QRISQRIS','b','','[{\"name\":\"X\",\"qty\":1}]',9000,'qris','pending','pending','telegram',?,?,'id',datetime('now','+10 minutes'))").run(String(buyer.id), String(buyer.id));
    fx.sql.prepare("INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,qris_url,expires_at) VALUES('AXV-20260101-QRISQRIS','dana','static','po1','m',9000,9017,'pending','https://example.test/q.png',?)").run(new Date(Date.now() + 600_000).toISOString());
    vi.stubEnv("TELEGRAM_BOT_ENABLED", "true"); vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    clearTg(); send.mockResolvedValue({ ok: true } as never);
    const { sendPendingOrderReminders } = await import("@/lib/telegram/order-notifications");
    expect(await sendPendingOrderReminders(8)).toBe(2);
    const mine = allSends().find((m) => m.text.includes(code))!;
    expect(mine.text).toContain("Awaiting payment");
    expect(mine.text).not.toMatch(/QRIS|1\.25|1\.19|Rp|IDR/i);
    expect(mine.text).not.toContain(PAY_ADDR);
    expect(mine.markup?.inline_keyboard?.flat().map((b) => b.callback_data)).toEqual([`refresh:${code}`]);
    const qris = allSends().find((m) => m.text.includes("AXV-20260101-QRISQRIS"))!;
    expect(qris.text).toMatch(/QRIS/);
  });

  it("paid notification for a crypto order uses the saved locale and the existing guarded copy (no QRIS wording)", async () => {
    const { code } = await createWithSendFailure(null);
    fx.sql.prepare("UPDATE telegram_users SET locale='id' WHERE user_id=?").run(String(buyer.id));
    fx.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid', paid_at=datetime('now') WHERE code=?").run(code);
    vi.stubEnv("TELEGRAM_BOT_ENABLED", "true"); vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    clearTg(); send.mockResolvedValue({ ok: true } as never);
    const { notifyTelegramBuyerPaid } = await import("@/lib/telegram/order-notifications");
    expect(await notifyTelegramBuyerPaid(code)).toBe(true);
    const text = allSends().map((m) => m.text).join("\n");
    expect(text).toContain(code);
    expect(text).not.toMatch(/QRIS/i);
    expect(text).not.toMatch(/Pembayaran diterima|lunas/i); // English order stays English
    expect(fx.sql.prepare("SELECT telegram_paid_notified_at AS t FROM orders WHERE code=?").get(code)?.t).not.toBeNull();
  });

  it("expired new-rail order: the notifier pushes ONE generic localized notice (no QRIS copy/renew); buyer view hides details; forged qrenew denied", async () => {
    const { code } = await createWithSendFailure(null);
    fx.sql.prepare("UPDATE orders SET status='kadaluarsa', payment_status='expired' WHERE code=?").run(code);
    fx.sql.prepare("UPDATE payment_transactions SET status='expired' WHERE order_code=?").run(code);
    clearTg(); send.mockResolvedValue({ ok: true } as never);
    const { sendQrisExpiryNotifications } = await import("@/lib/payments/qris-expiry-notifications");
    expect((await sendQrisExpiryNotifications(5)).sent).toBe(1);
    expect(allSends()).toHaveLength(1);
    expect(allSends()[0].text).toContain("Invoice expired");
    expect(allSends()[0].text + JSON.stringify(allSends()[0].markup)).not.toMatch(/QRIS|qrenew/i);
    clearTg();
    await click(`refresh:${code}`);
    const view = allSends().map((m) => m.text).join("\n");
    expect(view).toContain("Invoice expired");
    expect(view).not.toContain(PAY_ADDR);
    expect(view).not.toMatch(/QRIS/i);
    clearTg();
    await click(`qrenew:${code}`);
    expect(vi.mocked(sendPhoto)).not.toHaveBeenCalled();
    expect(allSends().some((m) => m.text.includes(PAY_ADDR))).toBe(false);
    expect(count("payment_transactions")).toBe(1);
  });
});
