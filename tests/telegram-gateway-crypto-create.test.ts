// tests/telegram-gateway-crypto-create.test.ts — R2 create/consent (local only).
// Real handler/webhook + real SQLite D1 + mocked outgoing Telegram; provider
// network mocked while core claim/reconcile run for real where needed.
// Covers: single/cart discounted net + contacts gateway-only; exact frozen
// USD; creating CAS concurrency + crash matrix; consent delta; workerd case
// uses existing harness pattern with minimal DDL (honestly scoped).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";
import { handleCallback } from "@/lib/telegram/handlers/callback";
import { parsePayq1State } from "@/lib/telegram/payment-quote";
import { buildMethodOptions } from "@/lib/payments/method-options";
import { sendMessage, safeEditOrSend, sendPhoto, sendChatAction } from "@/lib/telegram/api";
import { seedCryptoMarket } from "./helpers/crypto-market";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(), sendPhoto: vi.fn(), sendChatAction: vi.fn(),
  safeEditOrSend: vi.fn(), showLoadingBar: vi.fn(async () => {}),
  answerCallbackQuery: vi.fn(async () => {}),
}));
vi.mock("@/lib/payments/dana-qris", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/dana-qris")>()),
  isActiveQrisConfigured: () => true,
}));

const buyer = { id: 777001, first_name: "Singularity" };
const send = vi.mocked(sendMessage);
const edit = vi.mocked(safeEditOrSend);
let fx: ReturnType<typeof createD1Fixture>;

const click = (data: string, chatId = buyer.id, from = buyer) =>
  handleCallback(data, chatId, 21, from, `cb-${Math.random()}`);
const userRaw = () =>
  String(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get(String(buyer.id))?.pending_action ?? "");
const sentTexts = (): string[] => send.mock.calls.map(([m]) => String((m as { text?: string })?.text ?? ""));
const lastCallbacks = (): string[] => {
  const calls: unknown[][] = [...(send.mock.calls as unknown[][]), ...(edit.mock.calls as unknown[][])];
  const markup = (calls.at(-1)?.[0] as { reply_markup?: { inline_keyboard?: { callback_data?: string }[][] } })?.reply_markup;
  return markup?.inline_keyboard?.flat().flatMap((b) => (b.callback_data ? [b.callback_data] : [])) ?? [];
};
const lastText = (): string => {
  const calls: unknown[][] = [...(send.mock.calls as unknown[][]), ...(edit.mock.calls as unknown[][])];
  return String((calls.at(-1)?.[0] as { text?: string })?.text ?? "");
};

function gatewayFetchImpl(methods: unknown[]) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith("payment-methods")) return Response.json({ status: true, data: methods });
    if (target.endsWith("/payment") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      return Response.json({
        status: true,
        data: {
          merchant_ref_id: body.merchant_ref_id, invoice: "SPY-r2-fixture",
          amount: body.amount, fee: 700, total: body.amount + 700,
          payment_code: body.payment_code, payment_link: "https://sekalipay.com/payment/SPY-r2-fixture",
          virtual_account: "888001", checkout_url: null, status: "pending",
          is_sandbox: false, expired_at: new Date(Date.now() + 900_000).toISOString(),
        },
      }, { status: 201 });
    }
    if (target.includes("/payment/")) {
      const ref = String(target.split("/").at(-1));
      // Mirror the saved TX: honest GET re-read must agree with what the
      // finalize wrote (same invoice id/channel/amounts/link/VA), otherwise
      // the reconcile marks a legit invoice mismatched.
      const saved = fx.sql.prepare("SELECT provider_payment_id,gateway_channel,gateway_label,requested_amount,gateway_estimated_fee,gateway_fee,payable_amount,gateway_virtual_account AS va,direct_url FROM payment_transactions WHERE order_code=?").get(ref) as Record<string, unknown> | undefined;
      const invoice = String(saved?.provider_payment_id ?? "SPY-r2-fixture");
      const fee = Number(saved?.gateway_fee ?? 700);
      const amount = Number(saved?.requested_amount ?? 19000);
      return Response.json({
        status: true,
        data: {
          merchant_ref_id: ref, invoice,
          amount, fee, total: amount + fee, payment_code: String(saved?.gateway_channel ?? "GATEVA"),
          payment_link: String(saved?.direct_url ?? "https://sekalipay.com/payment/SPY-r2-fixture"),
          checkout_url: null, virtual_account: saved?.va ?? "888001",
          status: "pending", paid_at: null, is_sandbox: false,
          expired_at: new Date(Date.now() + 900_000).toISOString(),
        },
      });
    }
    throw new Error(`unexpected ${target}`);
  });
}

async function seedCartUser() {
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,locale,buyer_email) VALUES(?,?,?,?)")
    .run(String(buyer.id), String(buyer.id), "en", "buyer@example.test");
  fx.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES(?,?,?,?)").run(String(buyer.id), 1, 1, 2);
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("ADMIN_JWT_SECRET", "tg-r2-fixture");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "tg-r2-fixture-secret-0123456789");
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "klikqris");
  vi.stubEnv("KLIKQRIS_ENABLED", "true");
  vi.stubEnv("KLIKQRIS_API_KEY", "fixture");
  vi.stubEnv("KLIKQRIS_MERCHANT_ID", "123");
  vi.stubEnv("USD_IDR_RATE", "16000");
  vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 60_000).toISOString());
  vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("unexpected network"); }));
  fx = createD1Fixture();
  await insertTestProduct(fx.sql, "manual", 1);
  fx.sql.exec("UPDATE products SET name='Fixture',require_email=0,is_active=1,telegram_enabled=1 WHERE id=1; UPDATE product_variants SET price=10000,stock=100,is_active=1,bulk_pricing_enabled=0 WHERE id=1; INSERT OR IGNORE INTO categories(id,name,slug) VALUES(1,'Fixture','fixture'); UPDATE products SET category_id=1 WHERE id=1");
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

/** Legacy saved gateway invoice (pre-7 Nov) seeded directly: Telegram must still read/consent/refresh it. */
const LEGACY = "AXV-20261107-LEGACY01";
function seedLegacyGateway(opts: { fee?: number; estimated?: number; payable?: number; consentRequired?: boolean; status?: string } = {}) {
  const fee = opts.fee ?? 700;
  const estimated = opts.estimated ?? 500;
  const payable = opts.payable ?? 20_700;
  const expires = new Date(Date.now() + 900_000).toISOString();
  fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_status,status,sales_channel,telegram_chat_id,telegram_user_id,variant_id,variant_snapshot,expires_at,locale)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(LEGACY, "Fixture", "6281234567890", "buyer@example.test", "[]", 20_000, "sekalipay_gateway:GATEVA", "unpaid", "pending", "telegram", String(buyer.id), String(buyer.id), 1, "{}", expires, "en");
  fx.sql.prepare(`INSERT INTO payment_transactions
    (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,provider_payment_id,status,expires_at,gateway_fee,gateway_estimated_fee,gateway_fee_consent_required,gateway_channel,gateway_label,direct_url,gateway_virtual_account,gateway_is_sandbox,last_error)
    VALUES(?,'sekalipay_gateway','merchant',?,'sekalipay_gateway',20000,?,'SPY-r2-fixture',?,?,?,?,?,'GATEVA','Gate VA','https://sekalipay.com/payment/SPY-r2-fixture','888001',0,NULL)`)
    .run(LEGACY, LEGACY, payable, opts.status ?? "pending", expires, fee, estimated, opts.consentRequired === false ? 0 : 1);
  return LEGACY;
}
function legacyButton(code: string): string | undefined {
  const calls: unknown[][] = [...(send.mock.calls as unknown[][]), ...(edit.mock.calls as unknown[][])];
  for (const [message] of [...calls].reverse()) {
    const markup = (message as { reply_markup?: { inline_keyboard?: { callback_data?: string }[][] } }).reply_markup;
    const hit = markup?.inline_keyboard?.flat().find((b) => b.callback_data?.startsWith(`gconsent:${code}:`));
    if (hit?.callback_data) return hit.callback_data;
  }
  return undefined;
}

describe("TG R2 gateway create + consent (local only)", () => {
  it("matches the legacy HMAC tag and verifies exact bindings fail closed", async () => {
    vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "fixture-secret-123456");
    const { payq1ConsentTag, verifyConsentTag } = await import("@/lib/telegram/handlers/payment-consent");
    const args = ["AXV-20261104-TEST0001", "777001", "SPYfixture", 14700] as const;
    const tag = await payq1ConsentTag(...args);
    expect(tag).toBe("a4e5379d09b7e57c");
    expect(await verifyConsentTag(...args, tag!)).toBe(true);
    expect(await verifyConsentTag(...args, "a4e5379d09b7e57d")).toBe(false);
    expect(await verifyConsentTag(args[0], "777002", args[2], args[3], tag!)).toBe(false);
    expect(await verifyConsentTag(args[0], args[1], "other", args[3], tag!)).toBe(false);
    expect(await verifyConsentTag(args[0], args[1], args[2], 14701, tag!)).toBe(false);
    expect(await verifyConsentTag(...args, "NOT-A-VALID-TAG!")).toBe(false);
    const verify = vi.spyOn(crypto.subtle, "verify").mockRejectedValueOnce(new Error("unavailable"));
    expect(await verifyConsentTag(...args, tag!)).toBe(false);
    verify.mockRestore();
    vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "");
    expect(await payq1ConsentTag(...args)).toBeNull();
    expect(await verifyConsentTag(...args, tag!)).toBe(false);
  });
  it("Telegram create rejects a gateway id from a forged/legacy frozen state (no order/TX, generic notice + fresh-quote entry)", async () => {
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", `fixture-${crypto.randomUUID()}`);
    vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture");
    vi.stubGlobal("fetch", gatewayFetchImpl([
      { payment_code: "GATEVA", payment_name: "Gate VA", payment_type: "va", min_amount: 100, max_amount: 999999999, fee_info: { type: "flat", description: "Rp 500" } },
    ]));
    await seedCartUser();
    // Real canonical option shape (frozen before the 7 Nov contract) so the
    // forged state parses; create must still fail closed on the gateway id.
    const canonical = await buildMethodOptions(20_000);
    const gateway = canonical.find((m) => m.id === "sekalipay_gateway:GATEVA");
    expect(gateway).toBeTruthy();
    const state = {
      v: 1, nonce: "0123456789abcdef", exp: Math.floor(Date.now() / 1000) + 600, tag: "0123456789ab",
      locale: "en", idrSubtotal: 20_000, source: { kind: "cart" },
      methods: canonical, sel: "sekalipay_gateway:GATEVA",
      contact: { email: "buyer@example.test", phone: "081234567890" }, st: "quoted",
    };
    fx.sql.prepare("UPDATE telegram_users SET pending_action=? WHERE user_id=?").run(`payq1:${JSON.stringify(state)}`, String(buyer.id));
    await click(`pgo:${state.nonce}`);
    expect(lastText()).toMatch(/Method unavailable|Metode belum tersedia/i);
    expect(lastCallbacks()).toContain("pmentry");
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()?.n).toBe(0);
  });

  it("definitive crypto create failure shows the gangguan copy + fresh-quote entry; tapping it freezes a NEW nonce", async () => {
    vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
    vi.stubEnv("NOWPAYMENTS_API_KEY", "k");
    vi.stubEnv("NOWPAYMENTS_IPN_SECRET", "s");
    vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc");
    vi.stubEnv("USD_IDR_RATE", "8000");
    vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 60_000).toISOString());
    seedCryptoMarket(fx.sql, { fx: false });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/min-amount?")) return Response.json({ min_amount: "100", fiat_equivalent: "100", currency_from: "usdtbsc", currency_to: "usdtbsc" });
      if (target.includes("/estimate?")) return Response.json({ estimated_amount: "2.54", currency_from: "usd", currency_to: "usdtbsc" });
      throw new Error(`unexpected ${target}`);
    }));
    await seedCartUser();
    await click("pmentry");
    const frozen = parsePayq1State(userRaw())!;
    const index = frozen.methods.findIndex((m) => m.id === "nowpayments:btc");
    expect(index).toBeGreaterThanOrEqual(0);
    await click(`pm:${frozen.nonce}:${index}`);
    await click(`pgo:${frozen.nonce}`);
    expect(lastText()).toContain("Payment method error. Try another method.");
    expect(lastCallbacks()).toContain("pmentry");
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()?.n).toBe(0);
    expect(userRaw()).toBe(""); // definitive failure without order/TX releases the anchor
    await click("pmentry");
    const fresh = parsePayq1State(userRaw())!;
    expect(fresh.nonce).not.toBe(frozen.nonce);
    expect(fresh.methods.some((m) => m.id.startsWith("sekalipay_gateway:"))).toBe(false);
  });

  it("legacy saved invoice: consent view hides link/VA until exactly the shown total; stale total re-presented, fresh total consents once", async () => {
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", `fixture-${crypto.randomUUID()}`);
    vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture");
    vi.stubGlobal("fetch", gatewayFetchImpl([]));
    await seedCartUser();
    const code = seedLegacyGateway();
    await click(`refresh:${code}`);
    const consentText = lastText().replace(/\u00a0/g, " ");
    expect(consentText).toContain("Confirm gateway fee");
    expect(consentText).toContain("Total: IDR 20,700");
    expect(consentText).not.toMatch(/sekalipay\.com|888001/);
    const { payq1ConsentTag } = await import("@/lib/telegram/handlers/payment-consent");
    const good = legacyButton(code);
    expect(good).toBe(`gconsent:${code}:20700:${await payq1ConsentTag(code, String(buyer.id), "SPY-r2-fixture", 20_700)}`);
    // Provider drifts the total while requested stays: old total/tag never consents.
    fx.sql.prepare("UPDATE payment_transactions SET payable_amount=20800,gateway_fee=800,gateway_fee_consent_required=1 WHERE order_code=?").run(code);
    await click(`gconsent:${code}:20700:${await payq1ConsentTag(code, String(buyer.id), "SPY-r2-fixture", 20_700)}`);
    expect(fx.sql.prepare("SELECT gateway_fee_consented_at FROM payment_transactions WHERE order_code=?").get(code)?.gateway_fee_consented_at).toBeNull();
    expect(lastText()).not.toMatch(/sekalipay\.com|888001/);
    const currentTotal = 20_800;
    await click(`gconsent:${code}:${currentTotal}:${await payq1ConsentTag(code, String(buyer.id), "SPY-r2-fixture", currentTotal)}`);
    expect(fx.sql.prepare("SELECT gateway_fee_consented_at FROM payment_transactions WHERE order_code=?").get(code)?.gateway_fee_consented_at).not.toBeNull();
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE order_code=?").get(code)?.n).toBe(1);
  });

  it("forged/cross-user/group consent denied without DB mutation or leak", async () => {
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", `fixture-${crypto.randomUUID()}`);
    vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture");
    vi.stubGlobal("fetch", gatewayFetchImpl([]));
    await seedCartUser();
    const code = seedLegacyGateway();
    await click(`refresh:${code}`);
    const before = fx.sql.prepare("SELECT gateway_fee_consented_at FROM payment_transactions WHERE order_code=?").get(code);
    const { payq1ConsentTag } = await import("@/lib/telegram/handlers/payment-consent");
    const total = Number(fx.sql.prepare("SELECT payable_amount FROM payment_transactions WHERE order_code=?").get(code)?.payable_amount);
    const valid = `gconsent:${code}:${total}:${await payq1ConsentTag(code, String(buyer.id), "SPY-r2-fixture", total)}`;
    await click(valid.replace(/:[0-9a-f]{16}$/, ":ffffffffffffffff"), 999999, { id: 999999, first_name: "Eve" });
    await click(`gconsent:${code}:${total}:ffffffffffffffff`);
    expect(fx.sql.prepare("SELECT gateway_fee_consented_at FROM payment_transactions WHERE order_code=?").get(code)).toEqual(before);
    expect(lastText()).not.toMatch(/sekalipay\.com|888001/);
  });

  it("legacy independent paid status with a changed fee remains review on Telegram refresh", async () => {
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", `fixture-${crypto.randomUUID()}`);
    vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture");
    await seedCartUser();
    const code = seedLegacyGateway({ consentRequired: false });
    const provider = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(String(url)).toContain(`/payment/${code}`);
      return Response.json({ status: true, data: { merchant_ref_id: code, invoice: "SPY-r2-fixture", amount: 20000, fee: 800, total: 20800, payment_code: "GATEVA", status: "paid", paid_at: new Date().toISOString(), is_sandbox: false } });
    });
    vi.stubGlobal("fetch", provider);
    fx.sql.prepare("UPDATE payment_transactions SET last_checked_at=NULL WHERE order_code=?").run(code);
    await click(`refresh:${code}`);
    expect(provider).toHaveBeenCalled();
    expect(fx.sql.prepare("SELECT provider_payment_id,gateway_fee,payable_amount,last_error FROM payment_transactions WHERE order_code=?").get(code)).toMatchObject({ provider_payment_id: "SPY-r2-fixture", gateway_fee: 700, payable_amount: 20700, last_error: "sekalipay_gateway_status_mismatch_manual_review" });
    expect(lastText()).toMatch(/review|diperiksa/i);
    expect(lastText()).not.toMatch(/sekalipay\.com|888001/);
    expect(fx.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("pending");
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
  });

  it("Telegram crypto instructions show the rounded-up amount; stored/provider amount unchanged", async () => {
    await seedCartUser();
    const code = "AXV-20261107-CRYPTODISP";
    const expires = new Date(Date.now() + 900_000).toISOString();
    fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_status,status,sales_channel,telegram_chat_id,telegram_user_id,variant_id,variant_snapshot,expires_at,locale)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(code, "Fixture", "6281234567890", "buyer@example.test", "[]", 20_000, "nowpayments:usdtbsc", "pending", "pending", "telegram", String(buyer.id), String(buyer.id), 1, "{}", expires, "en");
    fx.sql.prepare(`INSERT INTO payment_transactions
      (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,currency,price_amount_text,price_currency,pay_currency,pay_network,provider_payment_id,pay_address,pay_amount_text,status,expires_at,created_at,updated_at,fx_rate_text,fx_effective_at)
      VALUES(?,'nowpayments','hosted',?,'nowpayments',20000,'IDR','2.25','usd','usdtbsc','bsc','NP-DISP','0xDISP','2.24671004','pending',?,datetime('now'),datetime('now'),'8000/1@x',?)`)
      .run(code, code, expires, new Date().toISOString());
    await click(`refresh:${code}`);
    expect(lastText()).toContain("Send exactly <b>2.25 USDT</b>");
    expect(lastText()).not.toContain("2.24671004");
    expect(fx.sql.prepare("SELECT pay_amount_text,price_amount_text FROM payment_transactions WHERE order_code=?").get(code)).toMatchObject({ pay_amount_text: "2.24671004", price_amount_text: "2.25" });
  });

  it("legacy saved invoice still refreshes with the flag off; 64B caps hold", async () => {
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
    vi.stubGlobal("fetch", gatewayFetchImpl([]));
    await seedCartUser();
    const code = seedLegacyGateway({ consentRequired: false });
    await click(`refresh:${code}`);
    expect(lastText()).toMatch(/Awaiting payment|Menunggu pembayaran/);
    expect(lastText()).not.toMatch(/sekalipay\.com\/payment|888001/);
    for (const data of lastCallbacks()) expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(userRaw(), "utf8")).toBeLessThanOrEqual(16 * 1024);
  });
});
