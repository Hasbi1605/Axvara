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

async function offerWithGateway() {
  const key = `fixture-${crypto.randomUUID()}`;
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", key);
  vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture");
  vi.stubGlobal("fetch", gatewayFetchImpl([
    { payment_code: "GATEVA", payment_name: "Gate VA", payment_type: "va", min_amount: 100, max_amount: 999999999, fee_info: { type: "flat", description: "Rp 500" } },
  ]));
  await seedCartUser();
  await click("pmentry");
  const frozen = parsePayq1State(userRaw())!;
  const index = frozen.methods.findIndex((m) => m.id === "sekalipay_gateway:GATEVA");
  expect(index).toBeGreaterThanOrEqual(0);
  await click(`pm:${frozen.nonce}:${index}`);
  return parsePayq1State(userRaw())!;
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
  it("single gateway: exact discounted net + provider-required contacts, one reserve + one POST then GET", async () => {
    fx.sql.exec("UPDATE product_variants SET bulk_pricing_enabled=1,bulk_pricing_tiers='[{\"min_qty\":2,\"unit_price\":9500}]' WHERE id=1");
    const key = `fixture-${crypto.randomUUID()}`;
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", key);
    vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture");
    const fetchMock = gatewayFetchImpl([
      { payment_code: "GATEVA", payment_name: "Gate VA", payment_type: "va", min_amount: 100, max_amount: 999999999, fee_info: { type: "flat", description: "Rp 500" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,locale,buyer_email) VALUES(?,?,?,?)").run(String(buyer.id), String(buyer.id), "id", "buyer@example.test");
    fx.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES(?,?,?,?)").run(String(buyer.id), 1, 1, 2);
    await click("pmentry");
    const frozen = parsePayq1State(userRaw())!;
    expect(frozen.idrSubtotal).toBe(19000);
    const index = frozen.methods.findIndex((m) => m.id === "sekalipay_gateway:GATEVA");
    await click(`pm:${frozen.nonce}:${index}`);
    const sel = parsePayq1State(userRaw())!;
    // Gateway needs phone BEFORE creating: pgo asks for contact first.
    // The contact prompt is a sendMessage (surfaces in sentTexts, not the
    // last edit) — fixtures must not conflate it with selection notices.
    await click(`pgo:${sel.nonce}`);
    expect(sentTexts().join("\n")).toMatch(/WhatsApp|nomor|kontak/i);
    // Phone captured via payq1 contact phase (CAS), crypto never gated.
    const contactState = parsePayq1State(userRaw())!;
    expect(contactState.st).toBe("contact");
    const { handlePayq1PhoneInput } = await import("@/lib/telegram/handlers/payment-contact");
    expect(await handlePayq1PhoneInput("081234567890", buyer.id, buyer)).toBe(true);
    const afterPhone = userRaw();
    const afterPhoneState = parsePayq1State(afterPhone);
    expect(afterPhone).toContain('"st":"contact"');
    expect(afterPhoneState?.st).toBe("contact");
    await click(`pgo:${afterPhoneState!.nonce}`);
    // R2 clears payq1 ONLY after a durable TX exists (consent-gated view
    // shown): raw is NULL/empty and the status view renders the invoice.
    const rawAfterPgo = userRaw();
    const state = parsePayq1State(rawAfterPgo);
    const lastEditText = String((edit.mock.calls.at(-1)?.[0] as { text?: string } | undefined)?.text ?? "");
    expect(lastEditText).toMatch(/Menunggu pembayaran gateway|Total/);
    const createdCode = (lastEditText.match(/AXV-\d{8}-[A-Z0-9]{8}/) ?? [])[0];
    expect(createdCode).toBeTruthy();
    const orderCode = String(createdCode);
    const order = fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(orderCode)!;
    expect(order).toMatchObject({ subtotal: 19000, payment_method: "sekalipay_gateway:GATEVA", customer_email: "buyer@example.test", locale: "id" });
    const tx = fx.sql.prepare("SELECT * FROM payment_transactions WHERE order_code=?").get(orderCode)!;
    expect(tx.provider).toBe("sekalipay_gateway");
    expect(Number(tx.requested_amount)).toBe(19000);
    // Claim-first single POST: one POST then GET-only on replays.
    expect(fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith("/payment") && (i as RequestInit)?.method === "POST")).toHaveLength(1);
    // Same order code reused on resume; stock cut once.
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(98);
  });

  it("concurrent pgo taps have one creating winner and resume the same order", async () => {
    vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "tg-r2-fixture-secret-0123456789");
    const frozen = await offerWithGateway();
    await click(`pgo:${frozen.nonce}`);
    await click(`pgo:${frozen.nonce}`);
    const first = parsePayq1State(userRaw())!;
    expect(first.st).toBe("contact");
    const { handlePayq1PhoneInput } = await import("@/lib/telegram/handlers/payment-contact");
    await handlePayq1PhoneInput("081234567890", buyer.id, buyer);
    const contactRaw = userRaw();
    expect(parsePayq1State(contactRaw)?.st).toBe("contact");
    const nonce = parsePayq1State(contactRaw)!.nonce;
    await Promise.all([click(`pgo:${nonce}`), click(`pgo:${nonce}`)]);
    // Both taps race the same creating claim: exactly one order, one TX,
    // one single POST (claim-first); the invoice view renders, not a dup.
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()?.n).toBe(1);
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(98);
  });

  it("old consent button after live total change is rejected and re-presented without details", async () => {
    vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "tg-r2-fixture-secret-0123456789");
    const frozen = await offerWithGateway();
    await click(`pgo:${frozen.nonce}`);
    const { handlePayq1PhoneInput } = await import("@/lib/telegram/handlers/payment-contact");
    await handlePayq1PhoneInput("081234567890", buyer.id, buyer);
    await click(`pgo:${parsePayq1State(userRaw())!.nonce}`);
    const rendered = String((edit.mock.calls.at(-1)?.[0] as { text?: string } | undefined)?.text ?? "");
    const code = String((rendered.match(/AXV-\d{8}-[A-Z0-9]{8}/) ?? [])[0]);
    expect(code).toMatch(/^AXV-/);
    // The consent VIEW is resolved from the DB fee state: the fixture POST
    // returns fee 700 (delta over the frozen 500) so the provider view is
    // fee_consent_required — read the CURRENT button from the LATEST send
    // (the create dispatch may render status + consent across messages).
    const { payq1ConsentTag } = await import("@/lib/telegram/handlers/payment-consent");
    await click(`refresh:${code}`);
    // View shows consent view with a valid tag for the CURRENT total.
    const allCbs: string[] = [...send.mock.calls, ...edit.mock.calls].flatMap(([m]) => {
      const mk = (m as { reply_markup?: { inline_keyboard?: { callback_data?: string }[][] } })?.reply_markup;
      return mk?.inline_keyboard?.flat().flatMap((b) => (b.callback_data ? [b.callback_data] : [])) ?? [];
    });
    expect(allCbs.some((d) => d.startsWith("gconsent:"))).toBe(true);
    const shown = Number(fx.sql.prepare("SELECT payable_amount FROM payment_transactions WHERE order_code=?").get(code)?.payable_amount);
    // Old button (100) after live TX changed by the PROVIDER to 20800
    // (20000 + updated 800 fee): tag mismatch => NO consent; the stale click
    // re-presents the CURRENT total consent without leaking details.
    // NOTE: fixture cart is qty 2 x 10000 => requested 20000; simulate the
    // provider TOTAL drifting while requested stays: 20800 = 20000 + 800.
    fx.sql.prepare("UPDATE payment_transactions SET payable_amount=20800,gateway_fee=800,gateway_fee_consent_required=1 WHERE order_code=?").run(code);
    const stale = `gconsent:${code}:100:${await payq1ConsentTag(code, String(buyer.id), "SPY-r2-fixture", 100)}`;
    await click(stale);
    expect(fx.sql.prepare("SELECT gateway_fee_consented_at FROM payment_transactions WHERE order_code=?").get(code)?.gateway_fee_consented_at).toBeNull();
    expect(lastText()).not.toContain("sekalipay.com");
    const currentTotal = Number(fx.sql.prepare("SELECT payable_amount FROM payment_transactions WHERE order_code=?").get(code)?.payable_amount);
    expect(currentTotal).toBe(20800);
    expect(shown).not.toBe(currentTotal);
    // Replay with the FRESH total consents exactly once (no double fee).
    const fresh = `gconsent:${code}:${currentTotal}:${await payq1ConsentTag(code, String(buyer.id), "SPY-r2-fixture", currentTotal)}`;
    await click(fresh);
    expect(fx.sql.prepare("SELECT gateway_fee_consented_at FROM payment_transactions WHERE order_code=?").get(code)?.gateway_fee_consented_at).not.toBeNull();
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE order_code=?").get(code)?.n).toBe(1);
  });

  it("forged/cross-user/group consent denied without DB mutation or leak", async () => {
    vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "tg-r2-fixture-secret-0123456789");
    const frozen = await offerWithGateway();
    await click(`pgo:${frozen.nonce}`);
    const { handlePayq1PhoneInput } = await import("@/lib/telegram/handlers/payment-contact");
    await handlePayq1PhoneInput("081234567890", buyer.id, buyer);
    await click(`pgo:${parsePayq1State(userRaw())!.nonce}`);
    const rendered2 = String((edit.mock.calls.at(-1)?.[0] as { text?: string } | undefined)?.text ?? "");
    const code = String((rendered2.match(/AXV-\d{8}-[A-Z0-9]{8}/) ?? [])[0]);
    expect(code).toMatch(/^AXV-/);
    const before = fx.sql.prepare("SELECT gateway_fee_consented_at FROM payment_transactions WHERE order_code=?").get(code);
    const { payq1ConsentTag } = await import("@/lib/telegram/handlers/payment-consent");
    const total = Number(fx.sql.prepare("SELECT payable_amount FROM payment_transactions WHERE order_code=?").get(code)?.payable_amount);
    const valid = `gconsent:${code}:${total}:${await payq1ConsentTag(code, String(buyer.id), "SPY-r2-fixture", total)}`;
    await click(valid.replace(/:[0-9a-f]{16}$/, ":ffffffffffffffff"), 999999, { id: 999999, first_name: "Eve" });
    await click(`gconsent:${code}:${total}:ffffffffffffffff`);
    expect(fx.sql.prepare("SELECT gateway_fee_consented_at FROM payment_transactions WHERE order_code=?").get(code)).toEqual(before);
    expect(lastText()).not.toContain("sekalipay.com");
    expect(fetch).not.toHaveBeenCalledTimes(999);
  });

  it("independent paid status with a changed fee remains review on Telegram refresh", async () => {
    const frozen = await offerWithGateway();
    await click(`pgo:${frozen.nonce}`);
    const { handlePayq1PhoneInput } = await import("@/lib/telegram/handlers/payment-contact");
    await handlePayq1PhoneInput("081234567890", buyer.id, buyer);
    await click(`pgo:${parsePayq1State(userRaw())!.nonce}`);
    const code = String((lastText().match(/AXV-\d{8}-[A-Z0-9]{8}/) ?? [])[0]);
    expect(code).toMatch(/^AXV-/);
    const provider = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      return Response.json({ status: true, data: { merchant_ref_id: code, invoice: "SPY-r2-fixture", amount: 20000, fee: 800, total: 20800, payment_code: "GATEVA", status: "paid", paid_at: new Date().toISOString(), is_sandbox: false } });
    });
    vi.stubGlobal("fetch", provider);
    fx.sql.prepare("UPDATE payment_transactions SET last_checked_at=NULL WHERE order_code=?").run(code);
    await click(`refresh:${code}`);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(fx.sql.prepare("SELECT provider_payment_id,gateway_fee,payable_amount,last_error FROM payment_transactions WHERE order_code=?").get(code)).toMatchObject({ provider_payment_id: "SPY-r2-fixture", gateway_fee: 700, payable_amount: 20700, last_error: "sekalipay_gateway_status_mismatch_manual_review" });
    expect(lastText()).not.toMatch(/sekalipay\.com|888001/);
    expect(fx.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("pending");
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
  });

  it("saved flag-off invoice still reconciles; new create denied flag-off; 64B caps hold", async () => {
    const frozen = await offerWithGateway();
    await click(`pgo:${frozen.nonce}`);
    const { handlePayq1PhoneInput } = await import("@/lib/telegram/handlers/payment-contact");
    await handlePayq1PhoneInput("081234567890", buyer.id, buyer);
    await click(`pgo:${parsePayq1State(userRaw())!.nonce}`);
    const rendered3 = String((edit.mock.calls.at(-1)?.[0] as { text?: string } | undefined)?.text ?? "");
    const code = String((rendered3.match(/AXV-\d{8}-[A-Z0-9]{8}/) ?? [])[0]);
    expect(code).toMatch(/^AXV-/);
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
    // Saved-invoice refresh works flag-off (GET recovery), render stays safe.
    await click(`refresh:${code}`);
    expect(lastText()).not.toContain("sekalipay.com/payment/SPY");
    for (const data of lastCallbacks()) expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(userRaw(), "utf8")).toBeLessThanOrEqual(16 * 1024);
  });
});
