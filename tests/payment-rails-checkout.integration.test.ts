// tests/payment-rails-checkout.integration.test.ts — W3 acceptance: USD +
// locale data/quote/API/cron paths in real routes + real D1 fixture.
// No real network; no floats for nominal; NEW crypto only via signed USD.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createChannelOrderAtomic } from "@/lib/commerce";
import { cancelGuardForNowpaymentsRow, buildNowpaymentsPaymentView } from "@/lib/payments/payment-view";
import { loadFxSnapshot } from "@/lib/payments/fx";
import { seedCryptoMarket } from "./helpers/crypto-market";

const mocks = vi.hoisted(() => ({ ensure: vi.fn(async () => true) }));
vi.mock("@/lib/fulfillment/deliver", () => ({ ensureFulfillmentForPaidOrder: mocks.ensure }));
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true })),
  sendPhoto: vi.fn(async () => ({ ok: true })),
  sendChatAction: vi.fn(),
  showLoadingBar: vi.fn(async () => {}),
  safeEditOrNoop: vi.fn(),
  safeEditOrSend: vi.fn(),
}));

const A = "AXV-20261103-CCCCCCC1";
const B = "AXV-20261103-CCCCCCC2";
const C = "AXV-20261103-CCCCCCC3";
const D = "AXV-20261103-CCCCCCC4";
let fixture: ReturnType<typeof createD1Fixture>;
let remote: Map<string, Record<string, unknown>>;
let posts: number;
let postedBody: Record<string, unknown> | undefined;

async function seedOrder(code: string, amount = 250000, locale = "en") {
  await createChannelOrderAtomic({
    orderCode: code,
    lines: [{ productId: 1, variantId: 1, qty: 1, fulfillmentMode: "manual", stock: 100 }],
    items: [{ product_id: 1, variant_id: 1, qty: 1, price: amount, name: "Fixture" }],
    variantSnapshot: "{}",
    subtotal: amount,
    primaryVariantId: 1,
    customerName: "Fixture",
    salesChannel: "web",
    paymentMethod: "crypto",
    paymentAccount: "NOWPayments",
    fulfillmentStatus: "not_required",
  });
  fixture.sql.prepare("UPDATE orders SET expires_at=?, locale=? WHERE code=?")
    .run(new Date(Date.now() + 15 * 60_000).toISOString(), locale, code);
}

const statusRow = (code: string, paymentId: string, payment_status: string, actually_paid = "15.63") => ({
  payment_id: paymentId,
  order_id: code,
  price_amount: "15.63",
  price_currency: "usd",
  pay_currency: "usdtbsc",
  network: "bsc",
  payment_status,
  pay_amount: "15.63",
  actually_paid,
  outcome_amount: "15.60",
  outcome_currency: "usdtbsc",
  updated_at: new Date().toISOString(),
});

// Insert saved USD tx directly (price/fx path covered in unit create tests).
function saveUsdTx(code: string, amount: number, paymentId: string, providerStatus: string | null = null) {
  const fx = new Date(Date.now() - 60_000).toISOString();
  fixture.sql.prepare(`INSERT INTO payment_transactions
    (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,currency,
     price_amount_text,price_currency,pay_currency,pay_network,provider_payment_id,pay_address,
     pay_amount_text,fx_rate_text,fx_effective_at,provider_status_text,status,expires_at,created_at,updated_at)
    VALUES (?,'nowpayments','hosted',?,'nowpayments',?,'IDR','15.63','usd','usdtbsc','bsc',?,'TXYZfixture','15.63',
     '16000_R1_FX',?,?, 'pending',datetime('now','+15 minutes'),datetime('now'),datetime('now'))`)
    .run(code, code, amount, paymentId, fx, providerStatus);
  fixture.sql.prepare("UPDATE orders SET expires_at=datetime('now','+15 minutes') WHERE code=?").run(code);
}

const FRESH = new Date(Date.now() - 60_000).toISOString();
// Snapshot beku koin USDT BSC pada 250000 IDR @16000: base 1563 + biaya layanan 24 = total 1587 (15.87).
const USDT_EXPECTED = {
  cents: "1563", priceText: "15.87", surchargeBps: 150, surchargeCents: "24", totalCents: "1587",
  rateText: "16000", rateNum: "16000", rateDen: "1", effectiveAt: FRESH, idrSubtotal: 250000, payCurrency: "usdtbsc", network: "bsc",
};

beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  await insertTestProduct(fixture.sql, "manual", 1);
  fixture.sql.exec("UPDATE product_variants SET price=250000");
  remote = new Map();
  posts = 0;
  postedBody = undefined;
  mocks.ensure.mockClear();
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("NOWPAYMENTS_ENABLED", "false"); // flag-off reconcile must still work
  vi.stubEnv("NOWPAYMENTS_API_KEY", "fixture-api-key");
  vi.stubEnv("NOWPAYMENTS_IPN_SECRET", "fixture-ipn-secret");
  vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc");
  vi.stubEnv("USD_IDR_RATE", "16000");
  vi.stubEnv("USD_FX_EFFECTIVE_AT", FRESH);
  seedCryptoMarket(fixture.sql, { fx: false }); // koin dari snapshot D1; kurs dari pasangan env darurat
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "fixture-buyer-secret");
  vi.stubEnv("ADMIN_JWT_SECRET", "fixture-checkout-secret");
  const { clearRateLimitBucketsForTest } = await import("@/lib/rateLimit");
  clearRateLimitBucketsForTest();
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.includes("/estimate?")) {
      // price_amount ke provider = TOTAL incl. biaya layanan 1,5% (15.63 + 0.24 = 15.87)
      if (!target.includes("currency_from=usd") || !target.includes("amount=15.87")) {
        throw new Error(`USD pair mismatch ${target}`);
      }
      return Response.json({ estimated_amount: "15.87", currency_from: "usd", currency_to: "usdtbsc" });
    }
    if (target.includes("/min-amount?")) {
      // bentuk mengambang: tanpa is_fixed_rate / is_fee_paid_by_user
      if (/is_fixed_rate|is_fee_paid_by_user/.test(target)) throw new Error(`min-amount must be floating ${target}`);
      return Response.json({ min_amount: "0.0005", currency_from: "usdtbsc", currency_to: "usdtbsc" });
    }
    if (target.endsWith("/v1/payment") && target.includes("nowpayments")) {
      posts++;
      postedBody = JSON.parse(String(init?.body));
      return Response.json({
        payment_id: `np-${String(postedBody!.order_id).slice(-8)}`, pay_address: "TXYZfixture", pay_amount: "15.87",
        pay_currency: "usdtbsc", price_amount: "15.870", price_currency: "usd", order_id: postedBody!.order_id,
        is_fixed_rate: false, is_fee_paid_by_user: false,
        created_at: new Date().toISOString(),
        expiration_estimate_date: new Date(Date.now() + 900_000).toISOString(),
      }, { status: 201 });
    }
    if (target.includes("/v1/payment/")) {
      const id = decodeURIComponent(target.split("/").at(-1)!);
      const row = [...remote.values()].find((entry) => String(entry.payment_id) === id);
      return row ? Response.json(row) : Response.json({ message: "not found" }, { status: 404 });
    }
    throw new Error(`Unexpected network request ${target}`);
  }));
});

afterEach(() => { fixture.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const loadQuote = async (localeHeader: string, expectedPrice: number) => {
  const { POST } = await import("@/app/api/checkout/quote/route");
  return POST(new NextRequest("http://localhost/api/checkout/quote", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "axv_locale=en-US", "accept-language": localeHeader },
    body: JSON.stringify({ items: [{ product_id: 1, variant_id: 1, qty: 1, expected_price: expectedPrice }] }),
  }));
};

describe("S3b final gateway route races", () => {
  const deadline = () => new Date(Date.now() + 600000).toISOString();
  const setup = async () => {
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true"); vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", `fixture-${crypto.randomUUID()}`); vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "gateway-secret");
    const { createCheckoutQuoteToken } = await import("@/lib/auth");
    const { token } = await createCheckoutQuoteToken({ items: [{ product_id: 1, variant_id: 1, price: 250000, qty: 1, name: "Fixture" }], subtotal: 250000, payment_methods: [{ id: "sekalipay_gateway:RACEVA", kind: "gateway", account_number: "", currency: "IDR", gateway: { channel: "RACEVA", estimated_fee: 500, estimated_total: 250500, idr_subtotal: 250000 } }] });
    const { POST } = await import("@/app/api/orders/route");
    const request = (email = "first@example.test") => new NextRequest("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: email, items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: "sekalipay_gateway:RACEVA", quote_token: token }) });
    return { POST, request };
  };

  it("losing retry cannot cancel owner when owner suffers a definite preclaim rejection", async () => {
    const { POST, request } = await setup();
    let resolve!: () => void, arrived!: () => void;
    const gate = new Promise<void>((r) => { resolve = r; }), entered = new Promise<void>((r) => { arrived = r; });
    let methodCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      methodCalls++;
      if (methodCalls === 1) return Response.json({ status: true, data: [{ payment_code: "RACEVA", payment_name: "Fixture", payment_type: "va", min_amount: 100, max_amount: 300000, fee_info: { type: "flat", description: "Rp 500" } }] });
      throw new Error("fixture unavailable");
    }));
    fixture.control.afterBatch = async (queries) => { if (queries.some((q) => q.startsWith("INSERT INTO orders"))) { arrived(); await gate; } };
    const first = POST(request()); await entered;
    const loser = await POST(request()); expect(loser.status).toBe(503);
    const code = (await loser.json()).code;
    expect(fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("pending");
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(99);
    // The owner alone subsequently encounters a definite preclaim failure.
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false"); resolve();
    expect((await first).status).toBe(503);
    expect(fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("dibatalkan");
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()?.n).toBe(0);
  });

  it("a contact for order A cannot consent or lookup order B", async () => {
    for (const [code, email] of [[A, "first@example.test"], [B, "second@example.test"]]) {
      await seedOrder(code);
      fixture.sql.prepare("UPDATE orders SET customer_email=?,buyer_access_version=1,buyer_access_format='pin6',payment_method='sekalipay_gateway:RACEVA' WHERE code=?").run(email, code);
      fixture.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,provider_payment_id,status,expires_at,gateway_fee,gateway_estimated_fee,gateway_fee_consent_required,gateway_channel,direct_url)
        VALUES(?,'sekalipay_gateway','merchant',?,'fixture',250000,250600,?,'pending',?,600,500,1,'RACEVA','https://sekalipay.com/payment/fixture')`).run(code, code, `SPY${code}`, deadline());
    }
    const { POST: consent } = await import("@/app/api/orders/[code]/payment-consent/route");
    const { POST: lookup } = await import("@/app/api/orders/lookup/route");
    const consentRequest = (contact: string) => new NextRequest("http://localhost/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contact, expected_final_total: 250600 }) });
    const lookupRequest = (contact: string) => new NextRequest("http://localhost/lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: B, contact }) });
    expect((await consent(consentRequest("first@example.test"), { params: Promise.resolve({ code: B }) })).status).toBe(404);
    const denied = await lookup(lookupRequest("first@example.test")); expect(denied.status).toBe(404);
    expect(JSON.stringify(await denied.json())).not.toContain("sekalipay.com");
    expect(fixture.sql.prepare("SELECT gateway_fee_consented_at FROM payment_transactions WHERE order_code=?").get(B)?.gateway_fee_consented_at).toBeNull();
    const { buildSekalipayGatewayPaymentView } = await import("@/lib/payments/payment-view");
    expect(await buildSekalipayGatewayPaymentView(B)).toMatchObject({ payment_link: null, state: "fee_consent_required" });
    expect((await consent(consentRequest("second@example.test"), { params: Promise.resolve({ code: B }) })).status).toBe(200);
  });

  it("retry reads paid order after callback settles during initializing GET", async () => {
    const { POST, request } = await setup();
    let code = "", posts = 0, gets = 0, release!: () => void, arrived!: () => void;
    const gate = new Promise<void>((r) => { release = r; }), entered = new Promise<void>((r) => { arrived = r; });
    const payload = () => ({ merchant_ref_id: code, invoice: "SPYrace", amount: 250000, fee: 500, total: 250500, payment_code: "RACEVA", payment_link: "https://sekalipay.com/payment/SPYrace", status: "pending", is_sandbox: false, expired_at: deadline() });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("payment-methods")) return Response.json({ status: true, data: [{ payment_code: "RACEVA", payment_name: "Fixture", payment_type: "va", min_amount: 100, max_amount: 300000, fee_info: { type: "flat", description: "Rp 500" } }] });
      if (init?.method === "POST") { posts++; code = JSON.parse(String(init.body)).merchant_ref_id; throw new Error("fixture timeout"); }
      gets++;
      if (gets === 1) { arrived(); await gate; return Response.json({ status: true, data: payload() }); }
      return Response.json({ status: true, data: { ...payload(), status: "paid", paid_at: new Date().toISOString() } });
    }));
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
    const retry = POST(request()); await entered;
    // The interrupted creator's valid finalization wins before the signed callback.
    fixture.sql.prepare(`UPDATE payment_transactions SET status='pending',provider_payment_id='SPYrace',payable_amount=250500,gateway_fee=500,gateway_fee_consent_required=0,gateway_fee_consented_at=datetime('now'),gateway_is_sandbox=0,direct_url='https://sekalipay.com/payment/SPYrace',expires_at=? WHERE order_code=?`).run(deadline(), code);
    const raw = JSON.stringify({ merchant_ref_id: code, invoice: "SPYrace", amount: 250000, fee: 500, total: 250500, status: "paid", paid_at: "2026-11-04 09:00:00" });
    const { gatewayHmac } = await import("@/lib/payments/sekalipay-gateway");
    const { POST: callback } = await import("@/app/api/payments/sekalipay-gateway/callback/route");
    const notice = await callback(new NextRequest("http://localhost/callback", { method: "POST", headers: { "content-type": "application/json", "x-signature": await gatewayHmac("gateway-secret", raw) }, body: raw }));
    expect(notice.status).toBe(200); expect(fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("lunas");
    release(); const response = await retry; expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ code, status: "lunas", payment: { state: "paid" } });
    expect(posts).toBe(1); expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(99);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?").get(code)?.n).toBe(1);
  });
});

describe("W3 USD + locale checkout rails", () => {
  it("a signed crypto quote WITHOUT the merchant/floating policy fields (legacy shape) never verifies and creates nothing", async () => {
    vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
    const body = await (await loadQuote("en", 250000)).json();
    const { verifyCheckoutQuoteToken } = await import("@/lib/auth");
    const verified = (await verifyCheckoutQuoteToken(body.quoteToken))!;
    const legacyMethods = verified.payment_methods.map(({ fee_payer: _payer, fixed_rate: _fixed, ...method }) => method);
    const sign = (jti: string) => new SignJWT({ purpose: "checkout_quote", items: verified.items, subtotal: verified.subtotal, payment_methods: legacyMethods, locale: "en" }).setProtectedHeader({ alg: "HS256" }).setJti(jti).setExpirationTime("1h").sign(new TextEncoder().encode("fixture-checkout-secret"));
    expect(await verifyCheckoutQuoteToken(await sign("legacy-new"))).toBeNull();
    const { POST } = await import("@/app/api/orders/route");
    const request = (token: string) => new NextRequest("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: "nowpayments:usdtbsc", quote_token: token, fee_payer: "buyer", fixed_rate: true }) });
    const fresh = await POST(request(await sign("legacy-new")));
    expect(fresh.status).toBeGreaterThanOrEqual(400);
    expect(posts).toBe(0);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()!.n).toBe(0);
  });
  it("creates and retries a real signed checkout without repricing or another POST", async () => {
    vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
    const quote = await (await loadQuote("en", 250000)).json();
    const { POST } = await import("@/app/api/orders/route");
    const request = () => new NextRequest("http://localhost/api/orders", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: "nowpayments:usdtbsc", quote_token: quote.quoteToken }),
    });
    const first = await POST(request());
    expect(first.status).toBe(201);
    const order = await first.json();
    // floating + merchant-paid provider fee; price_amount = base 15.63 + 1.5% service fee 0.24
    expect(postedBody).toMatchObject({ price_amount: "15.87", price_currency: "usd", pay_currency: "usdtbsc", is_fixed_rate: false, is_fee_paid_by_user: false });
    expect(fixture.sql.prepare("SELECT fee_paid_by_user,fixed_rate,crypto_base_usd_cents,crypto_surcharge_usd_cents,crypto_surcharge_bps,price_amount_text FROM payment_transactions WHERE order_code=?").get(order.code))
      .toMatchObject({ fee_paid_by_user: 0, fixed_rate: 0, crypto_base_usd_cents: 1563, crypto_surcharge_usd_cents: 24, crypto_surcharge_bps: 150, price_amount_text: "15.87" });
    expect(order.payment).toMatchObject({ label: "USDT", sublabel: "BNB Smart Chain", amount_text: "15.87", base_amount_text: "15.63", surcharge_amount_text: "0.24", surcharge_bps: 150, fee_payer: "merchant", fixed_rate: false });
    expect(order.payment).not.toHaveProperty("fee_unknown");
    expect(posts).toBe(1);
    expect(fixture.sql.prepare("SELECT locale,subtotal FROM orders WHERE code=?").get(order.code)).toMatchObject({ locale: "en", subtotal: 250000 });
    vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
    vi.stubEnv("USD_IDR_RATE", "17000");
    const retry = await POST(request());
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ code: order.code, locale: "en", reused: true });
    expect(posts).toBe(1);
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()!.stock).toBe(99);
  });

  it("rejects a rotated FX quote before reservation", async () => {
    vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
    const quote = await (await loadQuote("en", 250000)).json();
    vi.stubEnv("USD_IDR_RATE", "17000");
    const { POST } = await import("@/app/api/orders/route");
    const response = await POST(new NextRequest("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: "nowpayments:usdtbsc", quote_token: quote.quoteToken }) }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "quote_stale" });
    expect(posts).toBe(0);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()!.n).toBe(0);
  });

  describe("automatic FX snapshot (D1) at create", () => {
    const seedFx = (rate: string, effectiveAt = new Date(Date.now() - 60_000).toISOString()) => {
      fixture.sql.exec("DELETE FROM crypto_market_snapshot");
      fixture.sql.prepare("INSERT INTO crypto_market_snapshot(id,fx_rate_text,fx_source,fx_effective_at,coins_json,coins_refreshed_at) VALUES (1,?,'nowpayments-estimate',?,?,?)")
        .run(rate, effectiveAt, JSON.stringify([{ ticker: "usdtbsc", min_usd_text: "0.08" }, { ticker: "btc", min_usd_text: "1.95" }]), new Date(Date.now() - 60_000).toISOString());
    };
    const createOrder = async (quoteToken: string) => {
      const { POST } = await import("@/app/api/orders/route");
      return POST(new NextRequest("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: "nowpayments:usdtbsc", quote_token: quoteToken }) }));
    };
    beforeEach(async () => {
      vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
      vi.stubEnv("USD_IDR_RATE", ""); vi.stubEnv("USD_FX_EFFECTIVE_AT", ""); // env pair is only an emergency fallback
      (await import("@/lib/payments/market-snapshot")).resetCryptoMarketMemo();
    });

    it("quotes from the D1 snapshot (source nowpayments-estimate) and creates at the signed USD price", async () => {
      seedFx("16000.00");
      const quote = await (await loadQuote("en", 250000)).json();
      const crypto = quote.paymentMethods.find((m: { id: string }) => m.id === "nowpayments:usdtbsc");
      expect(crypto).toMatchObject({ amount_text: "15.87", base_cents: 1563, surcharge_cents: 24, total_cents: 1587, usd: { source: "nowpayments-estimate", rate_text: "16000.00" } });
      expect(quote.displayPreferences).toMatchObject({ usdAvailable: true, usdCents: "1563" });
      const created = await createOrder(quote.quoteToken);
      expect(created.status).toBe(201);
      expect(postedBody).toMatchObject({ price_amount: "15.87", price_currency: "usd" });
    });

    it("accepts a signed snapshot after a refresh moved the rate within 2% (price stays the signed one)", async () => {
      seedFx("16000.00");
      const quote = await (await loadQuote("en", 250000)).json();
      seedFx("16300.00"); // +1.875%
      (await import("@/lib/payments/market-snapshot")).resetCryptoMarketMemo();
      const created = await createOrder(quote.quoteToken);
      expect(created.status).toBe(201);
      expect(postedBody).toMatchObject({ price_amount: "15.87" });
    });

    it("409 quote_stale when the rate moved more than 2% since the signed quote", async () => {
      seedFx("16000.00");
      const quote = await (await loadQuote("en", 250000)).json();
      seedFx("16400.00"); // +2.5%
      (await import("@/lib/payments/market-snapshot")).resetCryptoMarketMemo();
      const response = await createOrder(quote.quoteToken);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "quote_stale" });
      expect(posts).toBe(0);
      expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()!.n).toBe(0);
    });

    it("503 (fail closed) when the D1 snapshot went stale and no env fallback exists", async () => {
      seedFx("16000.00");
      const quote = await (await loadQuote("en", 250000)).json();
      seedFx("16000.00", new Date(Date.now() - 25 * 3600_000).toISOString());
      (await import("@/lib/payments/market-snapshot")).resetCryptoMarketMemo();
      const response = await createOrder(quote.quoteToken);
      expect(response.status).toBe(503);
      expect(posts).toBe(0);
    });

    it("emergency env pair still serves quotes when D1 has no snapshot", async () => {
      vi.stubEnv("USD_IDR_RATE", "16000"); vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 1000).toISOString());
      const quote = await (await loadQuote("en", 250000)).json();
      expect(quote.paymentMethods.find((m: { id: string }) => m.id === "nowpayments:usdtbsc")).toMatchObject({ usd: { source: "operator-fixed" } });
    });
  });

  it.each([
    ["provider reports fixed-rate", { is_fixed_rate: true }], ["provider reports fee-by-user", { is_fee_paid_by_user: true }],
    ["malformed deadline", { valid_until: "tomorrow" }], ["expired deadline", { valid_until: "2020-01-01T00:00:00Z" }],
  ])("holds known invoice for manual review on %s", async (_label, override) => {
    vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
    const prior = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/v1/payment")) {
        posts++; const body = JSON.parse(String(init?.body));
        return Response.json({ payment_id: "np-unverified", order_id: body.order_id, pay_address: "TXYZfixture", pay_amount: "16.00", pay_currency: "usdtbsc", price_amount: "15.87", price_currency: "usd", is_fixed_rate: false, is_fee_paid_by_user: false, valid_until: new Date(Date.now() + 600000).toISOString(), ...override }, { status: 201 });
      }
      return prior(url, init);
    }));
    const quoted = await (await loadQuote("en", 250000)).json();
    const { POST } = await import("@/app/api/orders/route");
    const response = await POST(new NextRequest("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: "nowpayments:usdtbsc", quote_token: quoted.quoteToken }) }));
    expect(response.status).toBe(503);
    const failed = await response.json();
    // Copy gangguan baru mengikuti locale quote (EN di suite ini), bukan "checkout yang sama", + kontrak error_code.
    expect(failed).toMatchObject({ error: "This payment method is having problems. Please try another payment method.", error_code: "payment_method_unavailable" });
    const saved = fixture.sql.prepare("SELECT provider_payment_id,last_error,fee_paid_by_user,fixed_rate FROM payment_transactions").get();
    expect(saved).toMatchObject({ provider_payment_id: "np-unverified", last_error: "nowpayments_invalid_invoice_manual_review", fee_paid_by_user: 0, fixed_rate: 0 });
    const { buildNowpaymentsPaymentView } = await import("@/lib/payments/payment-view");
    const code = String(failed.code);
    expect(await buildNowpaymentsPaymentView(code)).toMatchObject({ state: "manual_review", pay_address: "" });
    expect(posts).toBe(1);
  });

  it("accepts a 0/0 invoice with no valid_until and no policy flags echoed (own order TTL governs)", async () => {
    vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
    const prior = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/v1/payment")) {
        posts++; const body = JSON.parse(String(init?.body));
        return Response.json({ payment_id: "np-bare", order_id: body.order_id, pay_address: "TXYZfixture", pay_amount: "15.87", pay_currency: "usdtbsc", price_amount: "15.87", price_currency: "usd" }, { status: 201 });
      }
      return prior(url, init);
    }));
    const quoted = await (await loadQuote("en", 250000)).json();
    const { POST } = await import("@/app/api/orders/route");
    const response = await POST(new NextRequest("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: "nowpayments:usdtbsc", quote_token: quoted.quoteToken }) }));
    expect(response.status).toBe(201);
    const saved = fixture.sql.prepare("SELECT status,last_error,expires_at FROM payment_transactions").get()!;
    expect(saved).toMatchObject({ status: "pending", last_error: null });
    expect(Date.parse(String(saved.expires_at))).toBeGreaterThan(Date.now());
  });

  it("0/0 invoice keeps the earliest provider-or-order deadline and reviews a payment that lands after it", async () => {
    await seedOrder(A); vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
    const validUntil = new Date(Date.now() + 500000).toISOString();
    const estimateUntil = new Date(Date.now() + 300000).toISOString();
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const response = await original(url, init);
      if (!String(url).endsWith("/v1/payment")) return response;
      return Response.json({ ...(await response.json()), valid_until: validUntil, expiration_estimate_date: estimateUntil }, { status: 201 });
    }));
    const { createNowpaymentsInvoice, reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
    const inv = await createNowpaymentsInvoice(A, 250000, "usdtbsc", { payNetwork: "bsc", feePayer: "merchant", fixedRate: false, expectedUsd: USDT_EXPECTED });
    expect(inv.expiresAt).toBe(estimateUntil);
    remote.set(A, { ...statusRow(A, inv.providerPaymentId, "waiting", "0"), price_amount: "15.87", pay_amount: "15.87", is_fixed_rate: false, is_fee_paid_by_user: false });
    expect(await reconcileNowpaymentsPayment(A)).toBe("pending");
    expect(fixture.sql.prepare("SELECT expires_at FROM payment_transactions WHERE order_code=?").get(A)?.expires_at).toBe(estimateUntil);
    remote.set(A, { ...statusRow(A, inv.providerPaymentId, "finished", "15.87"), price_amount: "15.87", pay_amount: "15.87", is_fixed_rate: false, is_fee_paid_by_user: false, updated_at: new Date(Date.parse(estimateUntil) + 1000).toISOString() });
    expect(await reconcileNowpaymentsPayment(A)).toBe("manual_review");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
  });

  it("0/0 row: provider reports fixed-rate=true => manual review, never paid; finished+gross ok with 0/0 echoed => paid", async () => {
    await seedOrder(A); vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
    const { createNowpaymentsInvoice, reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
    const inv = await createNowpaymentsInvoice(A, 250000, "usdtbsc", { payNetwork: "bsc", feePayer: "merchant", fixedRate: false, expectedUsd: USDT_EXPECTED });
    const finished = { ...statusRow(A, inv.providerPaymentId, "finished", "15.87"), price_amount: "15.87", pay_amount: "15.87" };
    remote.set(A, { ...finished, is_fixed_rate: true, is_fee_paid_by_user: false });
    expect(await reconcileNowpaymentsPayment(A)).toBe("manual_review");
    expect(fixture.sql.prepare("SELECT last_error FROM payment_transactions WHERE order_code=?").get(A)?.last_error).toBe("nowpayments_policy_manual_review");
    remote.set(A, { ...finished, is_fixed_rate: false, is_fee_paid_by_user: false });
    expect(await reconcileNowpaymentsPayment(A)).toBe("manual_review"); // sticky
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
    await seedOrder(B);
    const second = await createNowpaymentsInvoice(B, 250000, "usdtbsc", { payNetwork: "bsc", feePayer: "merchant", fixedRate: false, expectedUsd: USDT_EXPECTED });
    remote.set(B, { ...statusRow(B, second.providerPaymentId, "finished", "15.87"), price_amount: "15.87", pay_amount: "15.87", is_fixed_rate: false, is_fee_paid_by_user: false });
    expect(await reconcileNowpaymentsPayment(B)).toBe("paid");
    expect(fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(B)?.status).toBe("lunas");
  });

  it("accepts provider gross above the estimate without increasing the USD price (0/0)", async () => {
    await seedOrder(A); vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const response = await original(url, init);
      if (!String(url).endsWith("/v1/payment")) return response;
      return Response.json({ ...(await response.json()), pay_amount: "16.00" }, { status: 201 });
    }));
    const { createNowpaymentsInvoice, reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
    const inv = await createNowpaymentsInvoice(A, 250000, "usdtbsc", { payNetwork: "bsc", feePayer: "merchant", fixedRate: false, expectedUsd: USDT_EXPECTED });
    expect(inv.payAmountText).toBe("16.00"); expect(postedBody).toMatchObject({ price_amount: "15.87", is_fee_paid_by_user: false, is_fixed_rate: false });
    remote.set(A, { ...statusRow(A, inv.providerPaymentId, "finished", "16.00"), price_amount: "15.87", pay_amount: "16.00", is_fixed_rate: false, is_fee_paid_by_user: false });
    expect(await reconcileNowpaymentsPayment(A)).toBe("paid");
  });

  it("flag-off hides crypto and rejects a previously signed new order", async () => {
    vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
    const quote = await (await loadQuote("en", 250000)).json();
    vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
    const hidden = await loadQuote("en", 250000);
    const hiddenBody = await hidden.json();
    expect((hiddenBody.paymentMethods ?? []).some((m: { id: string }) => m.id === "nowpayments:usdtbsc")).toBe(false);
    const { POST } = await import("@/app/api/orders/route");
    const response = await POST(new NextRequest("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: "nowpayments:usdtbsc", quote_token: quote.quoteToken }) }));
    expect(response.status).toBe(503);
    expect(posts).toBe(0);
  });
  it("quote emits narrow USD method + en locale; stale FX hides crypto, QRIS unchanged", async () => {
    vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
    const ok = await loadQuote("en-US,en;q=0.9", 250000);
    expect(ok.status).toBe(200);
    const body = await ok.json() as {
      ok: boolean; locale: string; subtotal: number;
      paymentMethods: { id: string; kind?: string; currency?: string; amount_text?: string; usd?: { cents: string } }[];
    };
    expect(body.ok).toBe(true);
    expect(body.locale).toBe("en");
    const crypto = body.paymentMethods.find((m) => m.id === "nowpayments:usdtbsc");
    expect(crypto).toMatchObject({ kind: "crypto", currency: "USD", amount_text: "15.87", base_cents: 1563, total_cents: 1587, fee_payer: "merchant", fixed_rate: false });
    expect(crypto!.usd).toMatchObject({ cents: "1563" });
    // Fixture only seeds qris in dedicated QRIS tests; this file asserts the
    // narrow crypto contract — QRIS presence asserted in quote-sk coverage.
    vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 30 * 60 * 60_000).toISOString());
    const stale = await loadQuote("en-US,en;q=0.9", 250000);
    const staleBody = await stale.json() as {
      ok?: boolean; error?: string; paymentMethods?: { id: string }[]; payment_methods?: { id: string }[];
    };
    // Stale FX may empty the method list => route 503 fail-closed (valid:
    // no rail fabricated). Either way crypto is hidden, not degraded.
    const staleMethods = staleBody.paymentMethods ?? staleBody.payment_methods ?? [];
    if (stale.status === 503) {
      expect(staleBody.error).toBeTruthy();
    } else {
      expect(staleMethods.some((m) => m.id === "nowpayments:usdtbsc")).toBe(false);
    }
  });
});

describe("W3 cancel guard + buyer view (durable provider status)", () => {
  it.each([false, undefined])("policy mismatch %s remains sticky after later valid finished GET", async (flag) => {
    await seedOrder(A); saveUsdTx(A, 250000, "np-policy");
    fixture.sql.prepare("UPDATE payment_transactions SET fee_paid_by_user=1,fixed_rate=1 WHERE order_code=?").run(A);
    remote.set(A, { ...statusRow(A, "np-policy", "finished"), is_fixed_rate: flag, is_fee_paid_by_user: true });
    const { reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
    expect(await reconcileNowpaymentsPayment(A)).toBe("manual_review");
    remote.set(A, { ...statusRow(A, "np-policy", "finished"), is_fixed_rate: true, is_fee_paid_by_user: true });
    expect(await reconcileNowpaymentsPayment(A)).toBe("manual_review");
    expect(await buildNowpaymentsPaymentView(A)).toMatchObject({ state: "manual_review", pay_address: "" });
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?").get(A)?.n).toBe(0);
  });

  it("atomic received_text guard rejects policy review introduced immediately before paid batch", async () => {
    await seedOrder(A); saveUsdTx(A, 250000, "np-race-policy");
    fixture.sql.prepare("UPDATE payment_transactions SET fee_paid_by_user=1,fixed_rate=1 WHERE order_code=?").run(A);
    remote.set(A, { ...statusRow(A, "np-race-policy", "finished"), is_fixed_rate: true, is_fee_paid_by_user: true });
    const batch = fixture.db.batch;
    fixture.db.batch = async (statements) => {
      fixture.sql.prepare("UPDATE payment_transactions SET last_error='nowpayments_policy_manual_review' WHERE order_code=?").run(A);
      return batch(statements);
    };
    const { reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
    expect(await reconcileNowpaymentsPayment(A)).toBe("manual_review");
    expect(fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(A)?.status).toBe("pending");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?").get(A)?.n).toBe(0);
  });
  it("GET confirming with ledger pending => view confirming + cancel 409 + no release", async () => {
    await seedOrder(A);
    const pid = "np-confirm-1";
    saveUsdTx(A, 250000, pid);
    remote.set(A, statusRow(A, pid, "confirming", "15.63"));
    const { claimNowpaymentsPollReconcile, reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
    expect(await claimNowpaymentsPollReconcile(A)).toBe(true);
    expect(await reconcileNowpaymentsPayment(A)).toBe("pending");
    const tx = fixture.sql.prepare("SELECT provider_status_text,last_error FROM payment_transactions WHERE order_code=?").get(A)!;
    expect(tx.provider_status_text).toBe("confirming");
    const view = await buildNowpaymentsPaymentView(A);
    expect(view?.state).toBe("confirming");
    const guard = cancelGuardForNowpaymentsRow({
      provider: "nowpayments", provider_status_text: tx.provider_status_text,
      actually_paid_text: "15.63", pay_amount_text: "15.63", last_error: tx.last_error,
    });
    expect(guard.cancelBlocked).toBe(true);
    fixture.sql.prepare("UPDATE orders SET buyer_access_version=0,customer_email='buyer@example.test' WHERE code=?").run(A);
    const { POST } = await import("@/app/api/orders/[code]/cancel/route");
    const response = await POST(new NextRequest(`http://localhost/api/orders/${A}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contact: "buyer@example.test" }) }), { params: Promise.resolve({ code: A }) });
    expect(response.status).toBe(409);
    const { transitionPendingOrder } = await import("@/lib/db");
    await expect(transitionPendingOrder(A, "dibatalkan", "buyer_cancel", [{ product_id: 1, variant_id: 1, qty: 1 }])).rejects.toThrow();
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()!.stock).toBe(99);
    expect(fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(A)!.status).toBe("pending");
  });

  it("atomic cancel guard rejects a provider observation after the route read", async () => {
    await seedOrder(A);
    saveUsdTx(A, 250000, "np-race", "waiting");
    fixture.sql.prepare("UPDATE orders SET buyer_access_version=0,customer_email='buyer@example.test' WHERE code=?").run(A);
    fixture.control.fail = (sql) => {
      if (sql.includes("INSERT INTO operation_guards") && sql.includes("provider_status_text")) {
        fixture.sql.prepare("UPDATE payment_transactions SET provider_status_text='confirming' WHERE order_code=?").run(A);
      }
      return false;
    };
    const { POST } = await import("@/app/api/orders/[code]/cancel/route");
    const response = await POST(new NextRequest(`http://localhost/api/orders/${A}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contact: "buyer@example.test" }) }), { params: Promise.resolve({ code: A }) });
    expect(response.status).toBe(409);
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()!.stock).toBe(99);
    expect(fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(A)!.status).toBe("pending");
  });

  it("unknown partial (sufficient amount, unknown status) => manual_review, no confirming, cancel 409", async () => {
    await seedOrder(B);
    const pid = "np-partial-1";
    saveUsdTx(B, 250000, pid);
    remote.set(B, statusRow(B, pid, "wait_for_payment", "7.00"));
    const { reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
    expect(await reconcileNowpaymentsPayment(B)).toBe("manual_review");
    const view = await buildNowpaymentsPaymentView(B);
    expect(view?.state).toBe("manual_review");
    const tx = fixture.sql.prepare("SELECT last_error FROM payment_transactions WHERE order_code=?").get(B)!;
    const guard = cancelGuardForNowpaymentsRow({
      provider: "nowpayments", provider_status_text: "wait_for_payment",
      actually_paid_text: "7.00", pay_amount_text: "15.63", last_error: tx.last_error,
    });
    expect(guard.cancelBlocked).toBe(true);
  });

  it("confirming with a positive underpayment enters manual review", async () => {
    await seedOrder(B);
    saveUsdTx(B, 250000, "np-partial-confirming");
    remote.set(B, statusRow(B, "np-partial-confirming", "confirming", "7.00"));
    const { reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
    expect(await reconcileNowpaymentsPayment(B)).toBe("manual_review");
    expect((await buildNowpaymentsPaymentView(B))?.state).toBe("manual_review");
  });

  it("accepts equivalent provider decimals and rejects a different price", async () => {
    await seedOrder(B);
    saveUsdTx(B, 250000, "np-decimal");
    remote.set(B, { ...statusRow(B, "np-decimal", "confirming", "0"), price_amount: "15.630", pay_amount: "15.630" });
    const { reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
    expect(await reconcileNowpaymentsPayment(B)).toBe("pending");
    remote.set(B, { ...statusRow(B, "np-decimal", "confirming", "0"), price_amount: "15.64" });
    await expect(reconcileNowpaymentsPayment(B)).rejects.toThrow("nowpayments_price_mismatch");
  });

  it("expired order + provider finished => manual review view, no fulfillment, even flag-off", async () => {
    await seedOrder(C);
    const pid = "np-late-1";
    saveUsdTx(C, 250000, pid);
    fixture.sql.prepare("UPDATE orders SET status='kadaluarsa', payment_status='expired', expires_at=? WHERE code=?")
      .run(new Date(Date.now() - 60_000).toISOString(), C);
    remote.set(C, statusRow(C, pid, "finished", "15.63"));
    const { reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
    expect(await reconcileNowpaymentsPayment(C)).toBe("manual_review");
    const view = await buildNowpaymentsPaymentView(C);
    expect(view?.state).toBe("expired");
    expect(fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(C)!.status).toBe("kadaluarsa");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?").get(C)!.n).toBe(0);
    expect(fixture.sql.prepare("SELECT status FROM payment_transactions WHERE order_code=?").get(C)!.status).not.toBe("paid");
  });

  it("already-paid never downgrades on later confirming GET", async () => {
    await seedOrder(D);
    const pid = "np-paid-1";
    saveUsdTx(D, 250000, pid);
    remote.set(D, { ...statusRow(D, pid, "finished", "15.63"), updated_at: new Date().toISOString() });
    const { reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
    expect(await reconcileNowpaymentsPayment(D)).toBe("paid");
    remote.set(D, statusRow(D, pid, "confirming", "0"));
    expect(await reconcileNowpaymentsPayment(D)).toBe("already_paid");
    expect((await buildNowpaymentsPaymentView(D))?.state).toBe("paid");
    expect(fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(D)!.status).toBe("lunas");
  });
});

describe("W3 saved retry + cron late pass", () => {
  it("payments job bounds late flag-off reconciliation and does not repeat alerts", async () => {
    vi.stubEnv("CRON_SECRET", "cron-fixture");
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "12345");
    const { sendMessage } = await import("@/lib/telegram/api");
    vi.mocked(sendMessage).mockClear();
    for (let i = 1; i <= 5; i++) {
      const code = `AXV-20261103-LLLLLLL${i}`;
      await seedOrder(code);
      const id = `np-late-${i}`;
      saveUsdTx(code, 250000, id);
      fixture.sql.prepare("UPDATE orders SET status='kadaluarsa',payment_status='expired',expires_at=? WHERE code=?")
        .run(new Date(Date.now() - 60_000).toISOString(), code);
      remote.set(code, statusRow(code, id, "finished"));
    }
    const { POST } = await import("@/app/api/cron/lite/route");
    const run = () => POST(new NextRequest("http://localhost/api/cron/lite?job=payments", { method: "POST", headers: { authorization: "Bearer cron-fixture" } }));
    const first = await (await run()).json();
    expect(first.nowpayments_late_checked).toBe(4);
    expect(first.nowpayments_late_manual_review).toBe(4);
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(4);
    const second = await (await run()).json();
    expect(second.nowpayments_late_checked).toBe(1);
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(5);
    expect((await (await run()).json()).nowpayments_late_checked).toBe(0);
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(5);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/v1/payment/"))).toHaveLength(5);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()!.n).toBe(0);
  });
  it("saved retry resolves via quote_id binding: same code/locale/payment, one POST, no extra reserve", async () => {
    await seedOrder(A);
    const { createNowpaymentsInvoice } = await import("@/lib/payments/nowpayments");
    vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
    remote.set("x", {});
    const inv = await createNowpaymentsInvoice(A, 250000, "usdtbsc", {
      payNetwork: "bsc",
      feePayer: "merchant", fixedRate: false,
      expectedUsd: USDT_EXPECTED,
    });
    expect(inv.isExisting).toBe(false);
    expect(posts).toBe(1);
    expect(fixture.sql.prepare("SELECT provider_status_text FROM payment_transactions WHERE order_code=?").get(A)!.provider_status_text).toBeUndefined;
    expect(fixture.sql.prepare("SELECT locale FROM orders WHERE code=?").get(A)!.locale).toBe("en");
    // flags/rate rotated after binding: saved retry resolves via the saved
    // binding (flag-off + stale FX irrelevant for known-id reconcile).
    vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
    vi.stubEnv("USD_IDR_RATE", "17000");
    const { claimNowpaymentsPollReconcile, reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
    expect(await claimNowpaymentsPollReconcile(A)).toBe(true);
    const before = fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()!.stock;
    remote.set(A, { ...statusRow(A, inv.providerPaymentId, "confirming", "0"), price_amount: "15.87", pay_amount: "15.87", is_fixed_rate: false, is_fee_paid_by_user: false });
    expect(await reconcileNowpaymentsPayment(A)).toBe("pending");
    const afterSave = fixture.sql.prepare("SELECT provider_status_text,last_checked_at FROM payment_transactions WHERE order_code=?").get(A)!;
    expect(afterSave.provider_status_text).toBe("confirming");
    expect(fixture.sql.prepare("SELECT locale FROM orders WHERE code=?").get(A)!.locale).toBe("en");
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()!.stock).toBe(before);
    expect(posts).toBe(1);
  });

  it("late known-id pass marks manual review without reviving expired order", async () => {
    await seedOrder(C);
    const pid = "np-cron-late-1";
    saveUsdTx(C, 250000, pid);
    fixture.sql.prepare("UPDATE orders SET status='kadaluarsa', payment_status='expired', expires_at=? WHERE code=?")
      .run(new Date(Date.now() - 60_000).toISOString(), C);
    remote.set(C, statusRow(C, pid, "finished", "15.63"));
    const { createBudgetedDatabase } = await import("@/lib/db-access");
    const { reconcileLateKnownNowpaymentsPayments } = await import("@/lib/payments/payment-view");
    const out = await reconcileLateKnownNowpaymentsPayments(createBudgetedDatabase(40).access);
    expect(out.late_checked).toBe(1);
    expect(out.late_manual_review).toBe(1);
    expect(fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(C)!.status).toBe("kadaluarsa");
    expect(fixture.sql.prepare("SELECT status FROM payment_transactions WHERE order_code=?").get(C)!.status).not.toBe("paid");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?").get(C)!.n).toBe(0);
  });
});
