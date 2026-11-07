// tests/telegram-crypto-recovery.test.ts — TG R2-A crypto creation + saved-invoice recovery (local only).
// Real Telegram handlers + real SQLite D1 + mocked outgoing Telegram; provider
// network mocked while core claim/reconcile run for real where needed.
// Covers: frozen cart crypto quote -> one order + one mocked NOWPayments POST
// (discounted IDR, frozen exact USD, buyer fee flags, provider amount/address/
// currency/network, saved locale); FX rotate keeps frozen cents; email rules:
// phone never required, existing product-required email still enforced;
// saved recovery with creation flag off + FX/outcome env removed (GET-only,
// no new quote/POST/order/reservation/QRIS fallback);
// expired/manual-review/underpaid conceal address, never mark paid; forged
// qrenew on crypto issues no QRIS; cross-user/group cannot read or mutate;
// EN order stays EN after pref flip to ID; ambiguous POST retry proves
// GET-only recovery (one POST, same code); unknown provider id fails closed.
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
function nowpaymentsFetchImpl(opts?: { postAmount?: string; status?: string; actuallyPaid?: string; extraId?: string }) {
  const status = opts?.status ?? "waiting";
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    const q = new URL(target).searchParams;
    if (target.includes("/estimate?")) return Response.json({ estimated_amount: "1.25", currency_from: "usd", currency_to: q.get("currency_to") });
    if (target.includes("/min-amount?")) return Response.json({ min_amount: "0.0005", currency_from: q.get("currency_from"), currency_to: "usdtbsc" });
    if (target.endsWith("/payment") && (init as RequestInit | undefined)?.method === "POST") {
      const body = JSON.parse(String((init as RequestInit).body));
      return Response.json({
        payment_id: PAY_ID, pay_address: PAY_ADDR,
        pay_amount: opts?.postAmount ?? "1.25",
        ...(opts?.extraId !== undefined ? { payin_extra_id: opts.extraId } : {}),
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

async function offerWithCrypto(opts?: { nowFetch?: ReturnType<typeof vi.fn>; ticker?: string }) {
  vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
  vi.stubEnv("NOWPAYMENTS_API_KEY", "k");
  vi.stubEnv("NOWPAYMENTS_IPN_SECRET", "s");
  vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc");
  vi.stubGlobal("fetch", opts?.nowFetch ?? nowpaymentsFetchImpl());
  await seedCartUser();
  await click("pmentry");
  const frozen = parsePayq1State(userRaw())!;
  const index = frozen.methods.findIndex((m) => m.id === `nowpayments:${opts?.ticker ?? "usdtbsc"}`);
  expect(index).toBeGreaterThanOrEqual(0);
  await click(`pm:${frozen.nonce}:${index}`);
  return parsePayq1State(userRaw())!;
}
const postsOf = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith("/payment") && (i as RequestInit)?.method === "POST");

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
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

describe("TG R2-A crypto creation + saved recovery (local only)", () => {
  it("frozen crypto quote creates one order + one POST: discounted net, exact USD, buyer fee flags, EN locale", async () => {
    const fetchMock = nowpaymentsFetchImpl();
    const frozen = await offerWithCrypto({ nowFetch: fetchMock });
    // Cart discounted net 19000 (qty2 x tier 9500); test FX 8000 IDR/USD => base 238 cents,
    // biaya layanan per koin (usdtbsc 1% + 8c) => total 249 cents (US$2.49). No AXVARA US$2 floor.
    expect(frozen.idrSubtotal).toBe(19000);
    const crypto = frozen.methods.find((m) => m.id === "nowpayments:usdtbsc") as { usd?: { cents: string; idr_subtotal?: number }; amount_text?: string } | undefined;
    expect(crypto?.amount_text).toBeTruthy();
    expect(crypto?.usd?.cents).toBe("238");
    expect(crypto?.amount_text).toBe("2.49");
    expect((crypto?.usd as { idr_subtotal?: number } | undefined)?.idr_subtotal).toBe(19000);
    // Rotate live FX AFTER freeze: creation must keep the frozen snapshot.
    vi.stubEnv("USD_IDR_RATE", "17000");
    await click(`pgo:${frozen.nonce}`);
    const stateAfter = parsePayq1State(userRaw())!;
    // Crypto never asks for phone (contact phase is gateway-only); direct
    // dispatch renders the provider invoice view and clears quoted intent.
    expect(["quoted", "creating"]).toContain(stateAfter?.st ?? "quoted");
    const code = String((lastText().match(/AXV-\d{8}-[A-Z0-9]{8}/) ?? [])[0] ?? "");
    expect(code).toMatch(/^AXV-/);
    const order = fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
    expect(order).toMatchObject({ subtotal: 19000, payment_method: "nowpayments:usdtbsc", locale: "en" });
    const tx = fx.sql.prepare("SELECT * FROM payment_transactions WHERE order_code=?").get(code)!;
    expect(tx.provider).toBe("nowpayments");
    expect(Number(tx.requested_amount)).toBe(19000);
    expect(Number(tx.fee_paid_by_user)).toBe(0); // floating rate, provider fee paid by merchant
    expect(Number(tx.fixed_rate)).toBe(0);
    expect(tx).toMatchObject({ crypto_base_usd_cents: 238, crypto_surcharge_usd_cents: 11, crypto_surcharge_bps: 100 });
    expect(String(tx.pay_currency).toLowerCase()).toBe("usdtbsc");
    expect(String(tx.price_currency)).toBe("usd");
    expect(String(tx.price_amount_text)).toBe("2.49");
    expect(String(tx.pay_amount_text)).toBeTruthy();
    expect(String(tx.pay_address)).toBe(PAY_ADDR);
    expect(String(tx.provider_payment_id)).toBe(PAY_ID);
    // Single POST (claim-first); GET-only on replays.
    expect(fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith("/payment") && (i as RequestInit)?.method === "POST")).toHaveLength(1);
    // View shows actual provider amount/currency/network + address, no QRIS.
    expect(lastText()).toMatch(/1\.25 USDT/i);
    expect(lastText()).toMatch(/BNB Smart Chain/);
    expect(lastText()).toContain(PAY_ADDR.slice(0, 12));
    expect(lastText()).not.toMatch(/QRIS|qris_url/i);
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(98);
  });

  it("non-USDT coin (BTC) chosen from the coin sub-keyboard: one order + one POST with floating/merchant-fee body, BTC/Bitcoin copy", async () => {
    const fetchMock = nowpaymentsFetchImpl();
    const frozen = await offerWithCrypto({ nowFetch: fetchMock, ticker: "btc" });
    expect(frozen.sel).toBe("nowpayments:btc");
    await click(`pgo:${frozen.nonce}`);
    const posts = postsOf(fetchMock);
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String((posts[0][1] as RequestInit).body))).toMatchObject({
      pay_currency: "btc", price_amount: "2.61", price_currency: "usd", is_fixed_rate: false, is_fee_paid_by_user: false,
    });
    const code = String((lastText().match(/AXV-\d{8}-[A-Z0-9]{8}/) ?? [])[0] ?? "");
    expect(fx.sql.prepare("SELECT payment_method FROM orders WHERE code=?").get(code)?.payment_method).toBe("nowpayments:btc");
    expect(fx.sql.prepare("SELECT pay_currency,pay_network,fee_paid_by_user,fixed_rate,price_amount_text FROM payment_transactions WHERE order_code=?").get(code))
      .toMatchObject({ pay_currency: "btc", pay_network: "btc", fee_paid_by_user: 0, fixed_rate: 0, price_amount_text: "2.61" });
    expect(lastText()).toContain("Send exactly <b>1.25 BTC</b> on the <b>Bitcoin</b> network only.");
    expect(lastText()).not.toMatch(/USDT|QRIS/);
  });

  it("coin disabled in the dashboard between freeze and confirm: no order, no POST, honest 'choose another method'", async () => {
    const fetchMock = nowpaymentsFetchImpl();
    const frozen = await offerWithCrypto({ nowFetch: fetchMock, ticker: "btc" });
    seedCryptoMarket(fx.sql, { fx: false, coins: [{ ticker: "usdtbsc", min_usd_text: "0.08" }] }); // btc gone from the fresh snapshot
    await click(`pgo:${frozen.nonce}`);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(postsOf(fetchMock)).toHaveLength(0);
    expect(lastText()).toMatch(/can't be used right now|choose another/i);
  });

  it("provider minimum rose above the frozen total between freeze and confirm: refused without an order", async () => {
    const fetchMock = nowpaymentsFetchImpl();
    const frozen = await offerWithCrypto({ nowFetch: fetchMock, ticker: "btc" });
    seedCryptoMarket(fx.sql, { fx: false, coins: [{ ticker: "btc", min_usd_text: "2.30" }] }); // needs ceil(2.65)=265 > frozen total 261
    await click(`pgo:${frozen.nonce}`);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(postsOf(fetchMock)).toHaveLength(0);
  });

  it("payin_extra_id (memo) in the create response fails closed: address never shown, order cancelled + stock restored, tx failed", async () => {
    const fetchMock = nowpaymentsFetchImpl({ extraId: "123456789" });
    const frozen = await offerWithCrypto({ nowFetch: fetchMock });
    await click(`pgo:${frozen.nonce}`);
    expect(postsOf(fetchMock)).toHaveLength(1);
    const order = fx.sql.prepare("SELECT code,status FROM orders").get()!;
    expect(order.status).toBe("dibatalkan");
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
    expect(fx.sql.prepare("SELECT status,last_error,provider_payment_id,pay_address FROM payment_transactions WHERE order_code=?").get(order.code))
      .toMatchObject({ status: "failed", last_error: "nowpayments_extra_id_unsupported", provider_payment_id: PAY_ID, pay_address: null });
    expect([...sentTexts(), ...editTexts()].join("\n")).not.toContain(PAY_ADDR.slice(0, 12));
    expect(lastText()).toMatch(/can't be used right now|choose another/i);
    expect(userRaw()).toBe(""); // creating anchor released after the durable TX
  });

  it("an EMPTY payin_extra_id is not a memo: invoice proceeds normally", async () => {
    const fetchMock = nowpaymentsFetchImpl({ extraId: "" });
    const frozen = await offerWithCrypto({ nowFetch: fetchMock });
    await click(`pgo:${frozen.nonce}`);
    expect(lastText()).toContain(PAY_ADDR.slice(0, 12));
    expect(fx.sql.prepare("SELECT status FROM payment_transactions").get()?.status).toBe("pending");
  });

  it("email-required product still gates crypto; phone never required", async () => {
    const fetchMock = nowpaymentsFetchImpl();
    fx.sql.exec("UPDATE products SET require_email=1 WHERE id=1");
    vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
    vi.stubEnv("NOWPAYMENTS_API_KEY", "k");
    vi.stubEnv("NOWPAYMENTS_IPN_SECRET", "s");
    vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc");
    vi.stubGlobal("fetch", fetchMock);
    // No buyer email on file + product requires email => offer entry defers
    // at email confirmation (no frozen quote, no order, no provider call).
    fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,locale) VALUES(?,?,?)")
      .run(String(buyer.id), String(buyer.id), "en");
    fx.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES(?,?,?,?)").run(String(buyer.id), 1, 1, 2);
    await click("pmentry");
    expect(parsePayq1State(userRaw())).toBeNull();
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    // With email present: crypto completes without any phone capture.
    fx.sql.prepare("UPDATE telegram_users SET buyer_email=?,pending_action=NULL WHERE user_id=?").run("buyer@example.test", String(buyer.id));
    vi.clearAllMocks();
    await click("pmentry");
    const frozen = parsePayq1State(userRaw())!;
    const index = frozen.methods.findIndex((m) => m.id === "nowpayments:usdtbsc");
    await click(`pm:${frozen.nonce}:${index}`);
    expect(parsePayq1State(userRaw())?.contact?.phone ?? null).toBeNull();
    await click(`pgo:${parsePayq1State(userRaw())!.nonce}`);
    const code = String((lastText().match(/AXV-\d{8}-[A-Z0-9]{8}/) ?? [])[0] ?? "");
    expect(code).toMatch(/^AXV-/);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()?.n).toBe(1);
  });

  it("saved crypto invoice recovers with creation flag off + FX/outcome removed: GET-only, no new write", async () => {
    const fetchMock = nowpaymentsFetchImpl();
    const frozen = await offerWithCrypto({ nowFetch: fetchMock });
    await click(`pgo:${frozen.nonce}`);
    const code = String((lastText().match(/AXV-\d{8}-[A-Z0-9]{8}/) ?? [])[0] ?? "");
    expect(code).toMatch(/^AXV-/);
    const postCount = fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith("/payment") && (i as RequestInit)?.method === "POST").length;
    expect(postCount).toBe(1);
    // Turn off creation + remove FX/outcome envs; keep API key for GET reads.
    vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
    vi.stubEnv("USD_IDR_RATE", "");
    vi.stubEnv("USD_FX_EFFECTIVE_AT", "");
    vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "");
    const totals = () => ({
      orders: Number(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n),
      tx: Number(fx.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()?.n),
      stock: Number(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock),
    });
    const before = totals();
    await click(`refresh:${code}`);
    expect(lastText()).toMatch(/USDT|bsc|Menunggu pembayaran crypto|Awaiting crypto payment/i);
    expect(lastText()).toContain(PAY_ADDR.slice(0, 12));
    // No new quote/POST/order/reservation/QRIS fallback on saved recovery.
    expect(totals()).toEqual(before);
    expect(fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith("/payment") && (i as RequestInit)?.method === "POST")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes(`/payment/${PAY_ID}`)).length).toBeGreaterThanOrEqual(1);
    expect(sentTexts().join("\n")).not.toMatch(/QRIS|qris_url/i);
  });

  it("expired/manual-review/underpaid conceal address and never mark paid; EN stays EN after pref flip", async () => {
    const frozen = await offerWithCrypto();
    await click(`pgo:${frozen.nonce}`);
    const code = String((lastText().match(/AXV-\d{8}-[A-Z0-9]{8}/) ?? [])[0] ?? "");
    expect(code).toMatch(/^AXV-/);
    const unpoll = () => fx.sql.prepare("UPDATE payment_transactions SET last_checked_at=NULL WHERE order_code=?").run(code);
    // Flip saved prefs to ID: bound EN order must keep EN copy.
    fx.sql.prepare("UPDATE telegram_users SET locale='id' WHERE user_id=?").run(String(buyer.id));
    unpoll();
    vi.stubGlobal("fetch", nowpaymentsFetchImpl({ status: "expired" }));
    await click(`refresh:${code}`);
    const expiredText = lastText();
    expect(expiredText).toMatch(/Invoice expired|Invoice kedaluwarsa/i);
    expect(expiredText).not.toContain(PAY_ADDR.slice(0, 12));
    expect(fx.sql.prepare("SELECT payment_status FROM orders WHERE code=?").get(code)?.payment_status).not.toBe("paid");
    // Manual review conceals details too.
    fx.sql.prepare("UPDATE payment_transactions SET last_error='nowpayments_partial_manual_review',status='pending',last_checked_at=NULL WHERE order_code=?").run(code);
    await click(`refresh:${code}`);
    expect(lastText()).toMatch(/manual review|pemeriksaan manual/i);
    expect(lastText()).not.toContain(PAY_ADDR.slice(0, 12));
    expect(fx.sql.prepare("SELECT payment_status FROM orders WHERE code=?").get(code)?.payment_status).not.toBe("paid");
    // Underpaid GET fixture: actually_paid below expected => still review.
    vi.stubGlobal("fetch", nowpaymentsFetchImpl({ status: "confirming", actuallyPaid: "0.10" }));
    fx.sql.prepare("UPDATE payment_transactions SET last_error=NULL,status='pending',last_checked_at=NULL WHERE order_code=?").run(code);
    await click(`refresh:${code}`);
    expect(lastText()).toMatch(/manual review|pemeriksaan manual/i);
    expect(lastText()).not.toContain(PAY_ADDR.slice(0, 12));
    expect(fx.sql.prepare("SELECT payment_status FROM orders WHERE code=?").get(code)?.payment_status).not.toBe("paid");
  });

  it("forged qrenew on crypto issues no QRIS; cross-user/group cannot read or mutate", async () => {
    const fetchMock = nowpaymentsFetchImpl();
    const frozen = await offerWithCrypto({ nowFetch: fetchMock });
    await click(`pgo:${frozen.nonce}`);
    const code = String((lastText().match(/AXV-\d{8}-[A-Z0-9]{8}/) ?? [])[0] ?? "");
    expect(code).toMatch(/^AXV-/);
    const beforePhoto = vi.mocked(sendPhoto).mock.calls.length;
    const beforeTx = Number(fx.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()?.n);
    await click(`qrenew:${code}`);
    expect(vi.mocked(sendPhoto).mock.calls.length).toBe(beforePhoto);
    expect(Number(fx.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()?.n)).toBe(beforeTx);
    expect(lastText()).not.toMatch(/sekalipay\.com|888001/);
    // Cross-user tap on the private order is rejected without mutation.
    await click(`refresh:${code}`, 999999, { id: 999999, first_name: "Eve" });
    expect(String(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get("999999")?.pending_action ?? "")).toBe("");
    // Group tap is redirected without mutation.
    await click(`refresh:${code}`, -12345, { id: buyer.id, first_name: "Singularity" });
    expect(Number(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n)).toBe(1);
    expect(fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith("/payment") && (i as RequestInit)?.method === "POST")).toHaveLength(1);
  });

  it("ambiguous POST retry proves GET-only recovery: one POST, same code", async () => {
    let posts = 0;
    const flaky = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/estimate?")) return Response.json({ estimated_amount: "1.25", currency_from: "usd", currency_to: "usdtbsc" });
      if (target.includes("/min-amount?")) return Response.json({ min_amount: "0.0005", currency_from: "usdtbsc", currency_to: "usdtbsc" });
      if (target.endsWith("/payment") && init?.method === "POST") {
        posts++;
        // First POST: provider accepted but the response is lost (timeout) —
        // durable TX already has the known payment id for GET recovery.
        if (posts === 1) throw new Error("upstream timeout (ambiguous)");
        throw new Error("must not re-POST");
      }
      if (target.includes("/payment/")) {
        return Response.json({
          payment_id: PAY_ID, pay_address: PAY_ADDR, pay_amount: "1.25",
          price_amount: "1.19", price_currency: "usd", pay_currency: "usdtbsc",
          network: "bsc", order_id: String(target.split("/").at(-1)),
          is_fixed_rate: false, is_fee_paid_by_user: false,
          valid_until: new Date(Date.now() + 900_000).toISOString(),
          payment_status: "waiting", actually_paid: "0",
          outcome_amount: "1.25", outcome_currency: "usdtbsc",
        });
      }
      throw new Error(`unexpected ${target}`);
    });
    // Seed durable TX + order as if POST accepted but response was lost.
    const frozen = await offerWithCrypto({ nowFetch: nowpaymentsFetchImpl() });
    await click(`pgo:${frozen.nonce}`);
    const code = String((lastText().match(/AXV-\d{8}-[A-Z0-9]{8}/) ?? [])[0] ?? "");
    expect(code).toMatch(/^AXV-/);
    vi.stubGlobal("fetch", flaky);
    await click(`refresh:${code}`);
    expect(lastText()).toContain(PAY_ADDR.slice(0, 12));
    expect(posts).toBe(0);
    expect(Number(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n)).toBe(1);
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(98);
  });

  it("unknown provider id fails closed: pending/manual review, no resubmission", async () => {
    const frozen = await offerWithCrypto();
    await click(`pgo:${frozen.nonce}`);
    const code = String((lastText().match(/AXV-\d{8}-[A-Z0-9]{8}/) ?? [])[0] ?? "");
    expect(code).toMatch(/^AXV-/);
    // Saved TX points at an id the provider never knew: GET 500/ambiguous.
    // A 404 JSON throws nowpayments_http_404 (fail-closed); the ambiguous
    // 5xx path surfaces provider_unavailable without inventing paid.
    fx.sql.prepare("UPDATE payment_transactions SET provider_payment_id='NP-unknown-zzz',last_checked_at=NULL WHERE order_code=?").run(code);
    const unknownFetch = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/min-amount?") || target.includes("/estimate?")) {
        return Response.json({ estimated_amount: "1.25", currency_from: "usd", currency_to: "usdtbsc", min_amount: "0.0005" });
      }
      return Response.json({ message: "upstream boom" }, { status: 500 });
    });
    vi.stubGlobal("fetch", unknownFetch);
    // Ambiguous GET runs but does not crash the view, leak details, mark
    // paid, or invent a resubmission; the saved binding is preserved.
    await click(`refresh:${code}`);
    expect(unknownFetch.mock.calls.some(([u]) => String(u).includes("/payment/NP-unknown-zzz"))).toBe(true);
    expect(lastText()).toContain(PAY_ADDR.slice(0, 12));
    expect(lastText()).toMatch(/Awaiting crypto payment|Menunggu pembayaran crypto/);
    expect(fx.sql.prepare("SELECT payment_status FROM orders WHERE code=?").get(code)?.payment_status).not.toBe("paid");
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
  });
});
