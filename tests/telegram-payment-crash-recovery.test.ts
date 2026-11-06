// tests/telegram-payment-crash-recovery.test.ts — TG R2-C durable crash/replay + pending-state guards (local only).
// Real Telegram handlers + real SQLite D1 fixture; outgoing Telegram and
// NOWPayments HTTP mocked. Crash seams are PERSISTED-STATE reconstructions via
// the REAL helpers (claimPayq1Creating, createChannelOrderAtomic): no isolate
// death is executed. Seams: (1) creating anchor, no order; (2) order+stock but
// no provider POST, plus concurrent duplicate confirms; (3) durable invoice
// whose buyer message send fails (definite / ambiguous). Plus: /start,
// language/currency, cancel, search, qty, email entries never erase or
// overwrite a creating anchor; missing/malformed new-protocol state never
// falls back to legacy QRIS.
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
const sentTexts = (): string[] => send.mock.calls.map(([m]) => String((m as { text?: string })?.text ?? ""));
const editTexts = (): string[] => edit.mock.calls.map(([m]) => String((m as { text?: string })?.text ?? ""));
const lastText = (): string => {
  const calls: unknown[][] = [...(send.mock.calls as unknown[][]), ...(edit.mock.calls as unknown[][])];
  return String((calls.at(-1)?.[0] as { text?: string })?.text ?? "");
};

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


const userId = String(buyer.id);
const posts = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.filter(([u, i]) => String(u).endsWith("/payment") && (i as RequestInit)?.method === "POST");
const count = (table: string) => Number(fx.sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n);
const stock = () => Number(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock);

/** Persisted seam: REAL claimPayq1Creating transition (quoted -> creating),
 * stopping before dispatch (= process lost right after the claim CAS). */
async function claimOnly(f: ReturnType<typeof vi.fn>) {
  const quoted = await offerWithCrypto({ nowFetch: f });
  const { claimPayq1Creating } = await import("@/lib/telegram/payment-create");
  const claim = await claimPayq1Creating(userId, userRaw(), quoted);
  expect(claim.ok).toBe(true);
  if (!claim.ok) throw new Error("claim failed");
  return { quoted, creating: claim.state, orderCode: claim.orderCode, key: claim.idempotencyKey, raw: claim.raw };
}

describe("TG R2-C crash/replay + pending-state guards (local only)", () => {
  it("seam 1: creating anchor persisted, NO order yet -> same confirmation creates the SAME saved code once, no QRIS fallback", async () => {
    const f = nowpaymentsFetchImpl();
    const { quoted, creating, orderCode, key } = await claimOnly(f);
    expect(creating.st).toBe("creating");
    expect(count("orders")).toBe(0); // simulated: process lost between claim CAS and order insert
    expect(count("payment_transactions")).toBe(0);
    // Locale/FX drift while "down": snapshot + order locale must not move.
    fx.sql.prepare("UPDATE telegram_users SET locale='id' WHERE user_id=?").run(userId);
    vi.stubEnv("USD_IDR_RATE", "17000");
    await click(`pgo:${quoted.nonce}`);
    const orders = fx.sql.prepare("SELECT code,locale,subtotal,payment_method,quote_id FROM orders").all();
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ code: orderCode, subtotal: 19000, payment_method: "nowpayments:usdtbsc", quote_id: key });
    expect(orders[0].locale).toBe("en"); // locale frozen in the quote at claim time
    expect(posts(f)).toHaveLength(1);
    const tx = fx.sql.prepare("SELECT * FROM payment_transactions WHERE order_code=?").get(orderCode)!;
    expect(tx).toMatchObject({ provider: "nowpayments", price_amount_text: "2.42", fee_paid_by_user: 0, fixed_rate: 0 });
    expect(stock()).toBe(98);
    expect(userRaw()).toBe(""); // anchor released only after durable TX
    expect(vi.mocked(sendPhoto)).not.toHaveBeenCalled();
    expect(lastText()).toContain(orderCode);
    expect(lastText()).not.toMatch(/QRIS/i);
    // Replay of the same button after release: nothing new.
    await click(`pgo:${quoted.nonce}`);
    expect(count("orders")).toBe(1);
    expect(posts(f)).toHaveLength(1);
    expect(stock()).toBe(98);
  });

  it("seam 2: order + stock reserved but NO provider POST -> resume uses that exact order; one POST; concurrent confirms are one creator", async () => {
    const f = nowpaymentsFetchImpl();
    const { quoted, creating, orderCode, key } = await claimOnly(f);
    // Persisted seam: do exactly what dispatch does up to (excluding) the provider POST.
    const { resolveCurrentPayq1Lines } = await import("@/lib/telegram/handlers/payment-lines");
    const { orderLinesFromSource, sanitizeCustomerName } = await import("@/lib/telegram/payment-create");
    const { createChannelOrderAtomic } = await import("@/lib/commerce");
    const resolved = await resolveCurrentPayq1Lines(userId, creating);
    if (!resolved.ok) throw new Error("lines");
    const built = orderLinesFromSource(creating, resolved.cartLines)!;
    await createChannelOrderAtomic({
      orderCode, idempotencyKey: key, lines: built.lines, items: built.items, variantSnapshot: built.variantSnapshot,
      subtotal: built.subtotal, locale: creating.locale, primaryVariantId: built.primaryVariantId,
      customerName: sanitizeCustomerName(buyer.first_name), customerWa: "", customerEmail: "buyer@example.test",
      salesChannel: "telegram", telegramChatId: userId, telegramUserId: userId, conversationId: null, channelMemberId: null,
      paymentMethod: "nowpayments:usdtbsc", paymentAccount: "NOWPayments", fulfillmentStatus: "not_required", orderWindowMinutes: 15,
    });
    expect(count("orders")).toBe(1);
    expect(count("payment_transactions")).toBe(0);
    expect(stock()).toBe(98);
    const orderBefore = fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(orderCode)!;
    await Promise.all([click(`pgo:${quoted.nonce}`), click(`pgo:${quoted.nonce}`), click(`pgo:${quoted.nonce}`)]);
    expect(count("orders")).toBe(1);
    expect(count("payment_transactions")).toBe(1);
    expect(posts(f)).toHaveLength(1);
    expect(stock()).toBe(98); // no second deduction
    const orderAfter = fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(orderCode)!;
    expect(orderAfter).toMatchObject({ code: orderCode, subtotal: orderBefore.subtotal, items: orderBefore.items, variant_snapshot: orderBefore.variant_snapshot, locale: "en", quote_id: key });
    expect(fx.sql.prepare("SELECT order_code FROM payment_transactions").get()?.order_code).toBe(orderCode);
    expect(vi.mocked(sendPhoto)).not.toHaveBeenCalled();
  });

  it("seam 2b: concurrent duplicate confirmations from a QUOTED draft create exactly one order/POST/TX", async () => {
    const f = nowpaymentsFetchImpl();
    const quoted = await offerWithCrypto({ nowFetch: f });
    await Promise.all([click(`pgo:${quoted.nonce}`), click(`pgo:${quoted.nonce}`), click(`pgo:${quoted.nonce}`)]);
    expect(count("orders")).toBe(1);
    expect(count("payment_transactions")).toBe(1);
    expect(posts(f)).toHaveLength(1);
    expect(stock()).toBe(98);
    expect(userRaw()).toBe("");
  });

  it.each([
    ["definite Telegram rejection", { ok: false, error_code: 400, description: "Bad Request" }],
    ["ambiguous send (no error_code)", { ok: false, description: "Request timeout" }],
  ])("seam 3: durable invoice but buyer message fails (%s) -> saved status shows same invoice; nothing re-created or marked sent", async (_name, failure) => {
    const f = nowpaymentsFetchImpl();
    const quoted = await offerWithCrypto({ nowFetch: f });
    edit.mockResolvedValue(failure as never);
    send.mockResolvedValue(failure as never);
    await click(`pgo:${quoted.nonce}`);
    const order = fx.sql.prepare("SELECT code,telegram_invoice_sent_at FROM orders").get() as { code: string; telegram_invoice_sent_at: string | null };
    expect(count("orders")).toBe(1);
    expect(count("payment_transactions")).toBe(1);
    expect(posts(f)).toHaveLength(1);
    expect(stock()).toBe(98);
    // R3 fence: a DEFINITE rejection stays pending (eligible for bounded retry);
    // an AMBIGUOUS send is settled once (marker set + same-order nudge), never resent.
    if (_name.startsWith("definite")) expect(order.telegram_invoice_sent_at).toBeNull();
    else expect(order.telegram_invoice_sent_at).not.toBeNull();
    edit.mockImplementation(async (params) => ({ ok: true, params } as never));
    send.mockResolvedValue({ ok: true } as never);
    send.mockClear(); edit.mockClear();
    await click(`order:${order.code}`);
    const shown = [...sentTexts(), ...editTexts()].join("\n");
    expect(shown).toContain(order.code);
    expect(shown).toContain(PAY_ADDR);
    expect(shown).toMatch(/1\.25 USDT/i);
    expect(shown).not.toMatch(/QRIS/i);
    await click(`refresh:${order.code}`);
    expect(count("orders")).toBe(1);
    expect(count("payment_transactions")).toBe(1);
    expect(posts(f)).toHaveLength(1);
    expect(stock()).toBe(98);
    expect(vi.mocked(sendPhoto)).not.toHaveBeenCalled();
    // The existing retry never issues a QRIS photo for a provider rail (R3: text only, covered in telegram-payment-delivery.test.ts).
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    await retryTelegramInvoiceDelivery(order.code);
    expect(vi.mocked(sendPhoto)).not.toHaveBeenCalled();
    expect(posts(f)).toHaveLength(1);
    expect(count("orders")).toBe(1);
    expect(stock()).toBe(98);
  });

  // ---- pending-state guard matrix -------------------------------------------------
  const textEntries = ["/start", "/start promo_abc", "/language en", "/language id", "/settings", "/currency USD", "/katalog", "/cari", "/search", "/batal", "/help", "/pesanan", "/keranjang", "hello there", "5", "buyer2@example.test"];
  const callbackEntries = ["lang:en", "lang:id", "cur:USD", "home", "catalog:0", "cats:0", "cat:1:0", "prd:1", "buy:1", "vars:1", "var:1", "qty:1:1", "q:1:1:2", "qinput:1:1", "eedit:1:1:2", "ceedit", "help", "myorders"];

  it.each(textEntries)("creating anchor survives text entry %s", async (text) => {
    const f = nowpaymentsFetchImpl();
    const { raw } = await claimOnly(f);
    const { handleCommand } = await import("@/lib/telegram/handlers/command");
    await handleCommand(text, buyer.id, "private", buyer);
    expect(userRaw()).toBe(raw);
    expect(count("orders")).toBe(0);
    expect(posts(f)).toHaveLength(0);
  });

  it.each(callbackEntries)("creating anchor survives callback %s", async (data) => {
    const f = nowpaymentsFetchImpl();
    const { raw } = await claimOnly(f);
    await click(data);
    expect(userRaw()).toBe(raw);
    expect(count("orders")).toBe(0);
    expect(posts(f)).toHaveLength(0);
  });

  it.each([
    ["/cari", "search:"], ["qty:1:1", "qty_for:1:1"], ["qinput:1:1", "qty_for:1:1"], ["eedit:1:1:2", "email_for:1:1:2"], ["ceedit", "emailcart:"],
  ])("positive control: entry %s DOES set its own state when no creating anchor exists", async (entry, expected) => {
    await seedCartUser();
    if (entry.startsWith("/")) {
      const { handleCommand } = await import("@/lib/telegram/handlers/command");
      await handleCommand(entry, buyer.id, "private", buyer);
    } else await click(entry);
    expect(userRaw()).toBe(expected);
  });

  it("creating anchor survives wainput on a prior PAID order (wa_after_paid entry)", async () => {
    const f = nowpaymentsFetchImpl();
    fx.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,telegram_user_id,telegram_chat_id,locale) VALUES('AXV-20260101-PAIDPAID','b','','[]',1000,'qris','lunas','paid','telegram',?,?,'en')").run(userId, userId);
    const { raw } = await claimOnly(f);
    const before = count("orders");
    await click("wainput:AXV-20260101-PAIDPAID");
    expect(userRaw()).toBe(raw);
    expect(count("orders")).toBe(before);
  });

  it.each(["/start", "/start promo_abc"])("creating anchor survives %s even when no locale is saved yet (onboarding payload path)", async (text) => {
    const f = nowpaymentsFetchImpl();
    const { raw } = await claimOnly(f);
    fx.sql.prepare("UPDATE telegram_users SET locale=NULL WHERE user_id=?").run(userId);
    const { handleCommand } = await import("@/lib/telegram/handlers/command");
    await handleCommand(text, buyer.id, "private", buyer);
    expect(userRaw()).toBe(raw);
  });

  it("positive control: /start promo_abc with no locale and no anchor DOES store the onboarding payload", async () => {
    fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id) VALUES(?,?)").run(userId, userId);
    const { handleCommand } = await import("@/lib/telegram/handlers/command");
    await handleCommand("/start promo_abc", buyer.id, "private", buyer);
    expect(userRaw()).toBe("onboarding:promo_abc");
  });

  it("creating anchor with NO order whose cart changed/quote expired is not a permanent dead end (buyer can requote)", async () => {
    const f = nowpaymentsFetchImpl();
    const { quoted } = await claimOnly(f);
    expect(count("orders")).toBe(0);
    // Buyer clears the cart / the 10-minute quote window passes while "down".
    fx.sql.prepare("DELETE FROM telegram_carts WHERE user_id=?").run(userId);
    fx.sql.prepare("UPDATE telegram_users SET pending_action=REPLACE(pending_action, '\"exp\":' || ?, '\"exp\":1') WHERE user_id=?").run(String(quoted.exp), userId);
    await click(`pgo:${quoted.nonce}`);
    expect(count("orders")).toBe(0);
    expect(posts(f)).toHaveLength(0);
    // No order, no TX, no stock held: nothing financial depends on the anchor, so it must release.
    expect(userRaw()).toBe("");
    // And a fresh quote works again (positive control).
    fx.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES(?,?,?,?)").run(userId, 1, 1, 2);
    await click("pmentry");
    expect(parsePayq1State(userRaw())?.st).toBe("quoted");
  });

  it("seam 2c: order exists (stock held) but the cart changed before the POST -> resume still POSTs for THAT order and keeps the new cart", async () => {
    const f = nowpaymentsFetchImpl();
    const { quoted, creating, orderCode, key } = await claimOnly(f);
    const { resolveCurrentPayq1Lines } = await import("@/lib/telegram/handlers/payment-lines");
    const { orderLinesFromSource, sanitizeCustomerName } = await import("@/lib/telegram/payment-create");
    const { createChannelOrderAtomic } = await import("@/lib/commerce");
    const resolved = await resolveCurrentPayq1Lines(userId, creating);
    if (!resolved.ok) throw new Error("lines");
    const built = orderLinesFromSource(creating, resolved.cartLines)!;
    await createChannelOrderAtomic({
      orderCode, idempotencyKey: key, lines: built.lines, items: built.items, variantSnapshot: built.variantSnapshot,
      subtotal: built.subtotal, locale: creating.locale, primaryVariantId: built.primaryVariantId,
      customerName: sanitizeCustomerName(buyer.first_name), customerWa: "", customerEmail: "buyer@example.test",
      salesChannel: "telegram", telegramChatId: userId, telegramUserId: userId, conversationId: null, channelMemberId: null,
      paymentMethod: "nowpayments:usdtbsc", paymentAccount: "NOWPayments", fulfillmentStatus: "not_required", orderWindowMinutes: 15,
    });
    fx.sql.prepare("UPDATE telegram_carts SET qty=5 WHERE user_id=?").run(userId); // buyer edits the cart while the process was down
    await click(`pgo:${quoted.nonce}`);
    expect(count("orders")).toBe(1);
    expect(count("payment_transactions")).toBe(1);
    expect(posts(f)).toHaveLength(1);
    expect(stock()).toBe(98);
    expect(fx.sql.prepare("SELECT subtotal FROM orders WHERE code=?").get(orderCode)?.subtotal).toBe(19000);
    expect(fx.sql.prepare("SELECT price_amount_text FROM payment_transactions WHERE order_code=?").get(orderCode)?.price_amount_text).toBe("2.42");
    expect(fx.sql.prepare("SELECT qty FROM telegram_carts WHERE user_id=?").get(userId)?.qty).toBe(5); // new cart untouched
    expect(userRaw()).toBe("");
  });

  it("explicit /batal clears a normal QUOTED draft (positive control)", async () => {
    await offerWithCrypto({ nowFetch: nowpaymentsFetchImpl() });
    expect(userRaw()).toMatch(/^payq1:/);
    const { handleCommand } = await import("@/lib/telegram/handlers/command");
    await handleCommand("/batal", buyer.id, "private", buyer);
    expect(userRaw()).toBe("");
  });

  it("terminal order releases the creating anchor through the existing resume path", async () => {
    const f = nowpaymentsFetchImpl();
    const quoted = await offerWithCrypto({ nowFetch: f });
    await click(`pgo:${quoted.nonce}`);
    const code = String(fx.sql.prepare("SELECT code FROM orders").get()?.code);
    fx.sql.prepare("UPDATE orders SET status='dibatalkan' WHERE code=?").run(code);
    const creatingState = { ...quoted, st: "creating" as const, orderCode: code, idempotencyKey: `tg:payq1:${userId}:${quoted.nonce}`, selected: { id: "nowpayments:usdtbsc", kind: "crypto" } };
    fx.sql.prepare("UPDATE telegram_users SET pending_action=? WHERE user_id=?").run(`payq1:${JSON.stringify(creatingState)}`, userId);
    await click(`pgo:${quoted.nonce}`);
    expect(userRaw()).toBe("");
    expect(count("orders")).toBe(1);
    expect(posts(f)).toHaveLength(1);
  });

  it.each([
    ["no state at all"],
    ["malformed payq1"],
    ["stale nonce"],
  ])("new-protocol confirm with %s never falls back to legacy QRIS", async (name) => {
    const f = nowpaymentsFetchImpl();
    vi.stubGlobal("fetch", f);
    await seedCartUser();
    if (name === "stale nonce") await click("pmentry");
    else if (name === "malformed payq1") fx.sql.prepare("UPDATE telegram_users SET pending_action=? WHERE user_id=?").run("payq1:{not-json", userId);
    const before = userRaw();
    await click("pgo:0123456789abcdef");
    expect(count("orders")).toBe(0);
    expect(count("payment_transactions")).toBe(0);
    expect(posts(f)).toHaveLength(0);
    expect(vi.mocked(sendPhoto)).not.toHaveBeenCalled();
    expect(f.mock.calls.some(([u]) => /qris/i.test(String(u)))).toBe(false);
    expect(userRaw()).toBe(before);
    expect(stock()).toBe(100);
  });
});
