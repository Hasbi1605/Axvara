import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as jose from "jose";
import { NextRequest } from "next/server";
import { createAdminToken, createIdleToken, verifyCheckoutQuoteToken } from "@/lib/auth";
import { POST as publicQuote } from "@/app/api/checkout/quote/route";
import { POST as publicOrder } from "@/app/api/orders/route";
import { buildMethodOptions } from "@/lib/payments/method-options";
import { isNowpaymentsConfigured, isSekalipayGatewayConfigured } from "@/lib/payments/rails";
import * as rails from "@/lib/payments/rails";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { seedCryptoMarket } from "./helpers/crypto-market";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";

let fixture: ReturnType<typeof createD1Fixture>, cookie: string;

beforeEach(async () => {
  fixture = createD1Fixture();
  await insertTestProduct(fixture.sql);
  stubFulfillmentKey();
  fixture.sql.exec("UPDATE product_variants SET price=64000; UPDATE payment_methods SET is_active=1 WHERE id='qris'");
  seedCryptoMarket(fixture.sql);
  for (const [name, value] of Object.entries({
    ADMIN_JWT_SECRET: "admin-payment-test-fixture",
    ADMIN_EMAIL: "admin@axvara.tech",
    ADMIN_PASSWORD_SHA256: "7".repeat(64),
    BUYER_ORDER_ACCESS_SECRET: "fixture-buyer-access",
    NEXT_PUBLIC_PAYMENTS_MAINTENANCE: "false",
    PAYMENT_ADMIN_TEST_ENABLED: "true",
    NOWPAYMENTS_ENABLED: "false",
    SEKALIPAY_GATEWAY_ENABLED: "false",
    NOWPAYMENTS_API_KEY: "fixture-np-key",
    NOWPAYMENTS_IPN_SECRET: "fixture-ipn",
    NOWPAYMENTS_OUTCOME_CURRENCY: "usdtbsc",
    SEKALIPAY_GATEWAY_API_KEY: `fixture-${crypto.randomUUID()}`,
    SEKALIPAY_GATEWAY_SECRET_KEY: "fixture-skg-secret",
    QRIS_ACTIVE_PROVIDER: "klikqris",
    KLIKQRIS_ENABLED: "true",
    KLIKQRIS_API_KEY: "fixture-qris",
    KLIKQRIS_MERCHANT_ID: "123",
  })) vi.stubEnv(name, value);
  const session = await createAdminToken("admin@axvara.tech");
  cookie = `axvara_admin_token=${session.token}; axvara_idle=${await createIdleToken(session.sid)}`;
  clearRateLimitBucketsForTest();
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("Unexpected network fetch");
  }));
});

afterEach(() => {
  fixture.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("retires /admin/payments/test page, scope helper, and isPaymentAdminTestEnabled", () => {
  expect(fs.existsSync(path.join(process.cwd(), "src/app/(shop)/admin/payments/test/page.tsx"))).toBe(false);
  expect(fs.existsSync(path.join(process.cwd(), "src/components/storefront/PaymentTestScope.tsx"))).toBe(false);
  expect("isPaymentAdminTestEnabled" in rails).toBe(false);
});

it("PAYMENT_ADMIN_TEST_ENABLED=true never enables crypto/gateway; public quote ignores test query/body", async () => {
  expect(isNowpaymentsConfigured()).toBe(false);
  expect(isSekalipayGatewayConfigured()).toBe(false);
  expect((await buildMethodOptions(64000)).some((m) => ["gateway", "crypto"].includes(m.kind))).toBe(false);

  const response = await publicQuote(new NextRequest("https://axvara.tech/api/checkout/quote?payment_test=admin", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ items: [{ product_id: 1, variant_id: 1, qty: 1 }], admin_payment_test: true }),
  }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.paymentMethods.some((m: { kind: string }) => ["gateway", "crypto"].includes(m.kind))).toBe(false);
  const verified = await verifyCheckoutQuoteToken(body.quoteToken);
  expect(verified).not.toBeNull();
  expect((verified as Record<string, unknown>)?.admin_payment_test).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects legacy quote tokens carrying admin_payment_test=true in verifier and POST /api/orders", async () => {
  const key = new TextEncoder().encode("admin-payment-test-fixture");
  const now = Math.floor(Date.now() / 1000);
  const legacyTestQuote = await new jose.SignJWT({
    purpose: "checkout_quote",
    admin_payment_test: true,
    items: [{ product_id: 1, variant_id: 1, name: "Produk", price: 64000, qty: 1 }],
    subtotal: 64000,
    payment_methods: [{ id: "qris", account_number: "QRIS", kind: "qris" }],
    locale: "id",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setJti("legacy-admin-test-quote")
    .sign(key);

  expect(await verifyCheckoutQuoteToken(legacyTestQuote)).toBeNull();

  const orderResponse = await publicOrder(new NextRequest("https://axvara.tech/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [{ product_id: 1, variant_id: 1, qty: 1 }],
      customer_wa: "081234567890",
      customer_email: "buyer@example.test",
      quote_token: legacyTestQuote,
      payment_method: "qris",
      proof_url: null,
    }),
  }));
  expect(orderResponse.status).toBe(409);
  expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
  expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
});
