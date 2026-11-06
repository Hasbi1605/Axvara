import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdminToken, createIdleToken, bumpAuthVersion, verifyCheckoutQuoteToken } from "@/lib/auth";
import { POST as quote } from "@/app/api/admin/payments/test/quote/route";
import { POST as order } from "@/app/api/admin/payments/test/orders/route";
import { buildMethodOptions } from "@/lib/payments/method-options";
import { isNowpaymentsConfigured, isSekalipayGatewayConfigured } from "@/lib/payments/rails";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { seedCryptoMarket } from "./helpers/crypto-market";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";

let fixture: ReturnType<typeof createD1Fixture>, cookie: string, sid: string;
let posts: Record<string, unknown>[];
beforeEach(async () => {
  fixture = createD1Fixture(); await insertTestProduct(fixture.sql); stubFulfillmentKey();
  fixture.sql.exec("UPDATE product_variants SET price=64000; UPDATE payment_methods SET is_active=1 WHERE id='qris'");
  seedCryptoMarket(fixture.sql);
  for (const [name, value] of Object.entries({
    ADMIN_JWT_SECRET: "admin-payment-test-fixture", ADMIN_EMAIL: "admin@axvara.tech", ADMIN_PASSWORD_SHA256: "7".repeat(64),
    BUYER_ORDER_ACCESS_SECRET: "fixture-buyer-access", NEXT_PUBLIC_PAYMENTS_MAINTENANCE: "false",
    PAYMENT_ADMIN_TEST_ENABLED: "true", NOWPAYMENTS_ENABLED: "false", SEKALIPAY_GATEWAY_ENABLED: "false",
    NOWPAYMENTS_API_KEY: "fixture-np-key", NOWPAYMENTS_IPN_SECRET: "fixture-ipn", NOWPAYMENTS_OUTCOME_CURRENCY: "usdtbsc",
    SEKALIPAY_GATEWAY_API_KEY: `fixture-${crypto.randomUUID()}`, SEKALIPAY_GATEWAY_SECRET_KEY: "fixture-skg-secret",
    QRIS_ACTIVE_PROVIDER: "klikqris", KLIKQRIS_ENABLED: "true", KLIKQRIS_API_KEY: "fixture-qris", KLIKQRIS_MERCHANT_ID: "123",
  })) vi.stubEnv(name, value);
  const session = await createAdminToken("admin@axvara.tech"); sid = session.sid;
  cookie = `axvara_admin_token=${session.token}; axvara_idle=${await createIdleToken(sid)}`;
  clearRateLimitBucketsForTest(); posts = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url), params = new URL(target).searchParams;
    if (target.endsWith("payment-methods")) return Response.json({ status: true, data: [{ payment_code: "TESTVA", payment_name: "BCA Virtual Account", payment_type: "va", min_amount: 10000, max_amount: 1000000, fee_info: { type: "flat", description: "Rp 500" } }] });
    if (target.includes("/estimate?")) return Response.json({ estimated_amount: "4", currency_from: "usd", currency_to: params.get("currency_to") });
    if (target.includes("/min-amount?")) return Response.json({ min_amount: "0.1", fiat_equivalent: "0.1", currency_from: params.get("currency_from"), currency_to: "usdtbsc" });
    if (init?.method === "POST" && target.endsWith("/payment")) {
      const body = JSON.parse(String(init.body)); posts.push(body);
      if (body.order_id) return Response.json({ payment_id: "np-test", order_id: body.order_id, pay_address: "0xfixture", pay_amount: "4.06", pay_currency: body.pay_currency, price_amount: body.price_amount, price_currency: body.price_currency });
      return Response.json({ status: true, data: { merchant_ref_id: body.merchant_ref_id, invoice: "SPYadmin", amount: body.amount, fee: 500, total: body.amount + 500, payment_code: body.payment_code, payment_link: "https://sekalipay.com/payment/SPYadmin", status: "pending", is_sandbox: false, expired_at: new Date(Date.now() + 600000).toISOString() } });
    }
    throw new Error("Unexpected fixture request");
  }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function request(path: string, body: object, admin = true, auth = cookie) {
  if (admin) path = path === "orders" ? "admin/payments/test/orders" : "admin/payments/test/quote";
  return new NextRequest(`https://axvara.tech/api/${path}`, { method: "POST", headers: {
    "content-type": "application/json", ...(auth ? { cookie: auth } : {}),
  }, body: JSON.stringify(body) });
}
const items = [{ product_id: 1, variant_id: 1, qty: 1 }];
const loadQuote = (admin = true, auth = cookie) => quote(request("checkout/quote", { items }, admin, auth));
const create = (token: string, method: string, admin = true, auth = cookie) => order(request("orders", { items, customer_wa: "081234567890", customer_email: "buyer@example.test", quote_token: token, payment_method: method }, admin, auth));

it("test flag and stored credentials never enable public/bot methods", async () => {
  expect(isNowpaymentsConfigured()).toBe(false); expect(isSekalipayGatewayConfigured()).toBe(false);
  expect(isNowpaymentsConfigured(true)).toBe(true); expect(isSekalipayGatewayConfigured(true)).toBe(true);
  const publicQuote = await (await loadQuote(false)).json();
  expect(publicQuote.paymentMethods.some((m: { kind: string }) => ["gateway", "crypto"].includes(m.kind))).toBe(false);
  expect((await buildMethodOptions(64000)).some(m => ["gateway", "crypto"].includes(m.kind))).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  expect((await verifyCheckoutQuoteToken(publicQuote.quoteToken))?.admin_payment_test).toBeUndefined();
});

it("query/body alone cannot authorize tests; missing, expired and revoked sessions fail before provider access", async () => {
  expect((await loadQuote(true, "")).status).toBe(401);
  expect((await create("invalid-quote-but-long-enough", "sekalipay_gateway:TESTVA", true, "")).status).toBe(401);
  const publicResponse = await quote(request("checkout/quote?payment_test=admin", { items, admin_payment_test: true }, false, ""));
  expect((await publicResponse.json()).paymentMethods.some((m: { kind: string }) => m.kind === "gateway")).toBe(false);
  const tokenOnly = cookie.split(";")[0]; expect((await loadQuote(true, tokenOnly)).status).toBe(401);
  await bumpAuthVersion(sid); expect((await loadQuote()).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled(); expect(posts).toHaveLength(0);
});

it("admin test quote is signed, no-store, not reusable publicly; public quotes cannot be upgraded", async () => {
  const response = await loadQuote(); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  const testQuote = await response.json();
  const verified = await verifyCheckoutQuoteToken(testQuote.quoteToken); expect(verified?.admin_payment_test).toBe(true);
  expect(verified?.payment_methods.some(m => m.kind === "gateway")).toBe(true);
  expect(verified?.payment_methods.some(m => m.kind === "crypto")).toBe(true);
  expect((await create(testQuote.quoteToken, "sekalipay_gateway:TESTVA", false, "")).status).toBe(403);
  const publicQuote = await (await loadQuote(false)).json();
  expect((await create(publicQuote.quoteToken, "qris")).status).toBe(403);
  expect(posts).toHaveLength(0); expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
});

it.each(["nowpayments:usdtbsc", "sekalipay_gateway:TESTVA"])("creates %s once with public flags off; saved retry survives test kill-switch", async method => {
  const signed = await (await loadQuote()).json();
  const response = await create(signed.quoteToken, method); expect(response.status).toBe(201);
  const created = await response.json(); expect(created.payment.kind).toBe(method.startsWith("nowpayments:") ? "crypto" : "gateway");
  expect(posts).toHaveLength(1);
  expect((await create(signed.quoteToken, method, false, "")).status).toBe(403);
  expect((await create(signed.quoteToken, method, true, "")).status).toBe(401);
  vi.stubEnv("PAYMENT_ADMIN_TEST_ENABLED", "false");
  const retry = await create(signed.quoteToken, method); expect(retry.status).toBe(200); expect((await retry.json()).code).toBe(created.code);
  expect(posts).toHaveLength(1); expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(99);
});

it("kill-switch rejects a fresh quote/order before stock or invoice writes", async () => {
  const signed = await (await loadQuote()).json(); vi.stubEnv("PAYMENT_ADMIN_TEST_ENABLED", "false");
  expect((await loadQuote()).status).toBe(503);
  expect((await create(signed.quoteToken, "nowpayments:usdtbsc")).status).toBe(503);
  expect(posts).toHaveLength(0); expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
});

it("production still requires Cloudflare Access as well as the application session", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", "fixture.cloudflareaccess.com");
  vi.stubEnv("CF_ACCESS_AUD", "a".repeat(64));
  expect((await loadQuote()).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});
