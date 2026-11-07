import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { verifyCheckoutQuoteToken } from "@/lib/auth";
import { seedCryptoMarket } from "./helpers/crypto-market";

let fixture: ReturnType<typeof createD1Fixture>;
const tiers = [{ min_qty: 10, unit_price: 90000 }, { min_qty: 50, unit_price: 80000 }];
beforeEach(async () => {
  fixture = createD1Fixture(); stubFulfillmentKey(); await insertTestProduct(fixture.sql);
  fixture.sql.prepare("UPDATE product_variants SET price=100000,stock=100,bulk_pricing_enabled=1,bulk_pricing_tiers=? WHERE id=1").run(JSON.stringify(tiers));
  fixture.sql.exec("UPDATE products SET is_active=1; UPDATE payment_methods SET is_active=1 WHERE id='qris'");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true"); vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("ADMIN_JWT_SECRET", "bulk-fixture"); vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "fixture-buyer");
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "klikqris"); vi.stubEnv("KLIKQRIS_ENABLED", "true"); vi.stubEnv("KLIKQRIS_API_KEY", "fixture"); vi.stubEnv("KLIKQRIS_MERCHANT_ID", "123");
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false"); vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
  const { clearRateLimitBucketsForTest } = await import("@/lib/rateLimit"); clearRateLimitBucketsForTest();
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const quote = async (items: object[]) => {
  const { POST } = await import("@/app/api/checkout/quote/route");
  return POST(new NextRequest("http://localhost/api/checkout/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) }));
};
it("applies all-unit tiers at boundaries and aggregates slug/id aliases", async () => {
  for (const [qty, price] of [[9,100000],[10,90000],[49,90000],[50,80000]]) {
    const response = await quote([{ product_id: 1, variant_id: 1, qty, expected_price: 100000 }]);
    expect(response.status).toBe(200); const data = await response.json();
    expect(data.items[0].price).toBe(price); expect(data.subtotal).toBe(qty * price); expect(data.changes).toEqual([]);
  }
  const result = await (await quote([{ slug: "fixture", variant_id: 1, qty: 5 }, { product_id: 1, variant_id: 1, qty: 5 }])).json();
  expect(result.items).toHaveLength(1); expect(result.items[0]).toMatchObject({ price: 90000, qty: 10, base_price: 100000, applied_tier_min_qty: 10 });
  expect((await verifyCheckoutQuoteToken(result.quoteToken))?.items[0]).toMatchObject({ base_price: 100000, applied_tier_min_qty: 10 });
  const foreign = await quote([{ product_id: 1, variant_id: 1, qty: 9 }, { product_id: 999, variant_id: 1, qty: 1 }]); expect(foreign.status).toBe(409);
});
it("fails closed for corrupt active configuration but permits disabled stale tiers", async () => {
  fixture.sql.prepare("UPDATE product_variants SET price=1000 WHERE id=1").run();
  expect((await quote([{ product_id: 1, variant_id: 1, qty: 10 }])).status).toBe(409);
  fixture.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=0 WHERE id=1").run();
  expect((await (await quote([{ product_id: 1, variant_id: 1, qty: 10 }])).json()).items[0].price).toBe(1000);
});
it("never pools variants or relaxes minimum, stock and unique caps", async () => {
  fixture.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,bulk_pricing_enabled,bulk_pricing_tiers) VALUES(2,1,'SKU-2','Other',100000,100,'manual',1,?)").run(JSON.stringify(tiers));
  const different = await (await quote([{ product_id: 1, variant_id: 1, qty: 5 }, { product_id: 1, variant_id: 2, qty: 5 }])).json();
  expect(different.items.map((item: { price: number }) => item.price)).toEqual([100000, 100000]);
  fixture.sql.prepare("UPDATE product_variants SET min_qty=50 WHERE id=1").run();
  expect((await quote([{ product_id: 1, variant_id: 1, qty: 49 }])).status).toBe(409);
  expect((await (await quote([{ product_id: 1, variant_id: 1, qty: 50 }])).json()).items[0].price).toBe(80000);
  fixture.sql.prepare("UPDATE product_variants SET stock=49 WHERE id=1").run();
  expect((await quote([{ product_id: 1, variant_id: 1, qty: 50 }])).status).toBe(409);
  fixture.sql.prepare("UPDATE product_variants SET stock=100,fulfillment_mode='unique',min_qty=1 WHERE id=1").run();
  expect((await quote([{ product_id: 1, variant_id: 1, qty: 11 }])).status).toBe(409);
});
it("converts discounted subtotal once, not independently rounded units", async () => {
  fixture.sql.prepare("UPDATE product_variants SET price=10001,bulk_pricing_tiers=? WHERE id=1").run(JSON.stringify([{ min_qty: 10, unit_price: 10001 }]));
  vi.stubEnv("USD_IDR_RATE", "16000"); vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 1000).toISOString());
  const result = await (await quote([{ product_id: 1, variant_id: 1, qty: 10 }])).json();
  expect(result.subtotal).toBe(100010); expect(result.displayPreferences.usdCents).toBe("625");
});
it("rejects independently signed invalid bulk metadata", async () => {
  const sign = (item: object) => new SignJWT({ purpose: "checkout_quote", items: [item], subtotal: 900000, payment_methods: [{ id: "qris", account_number: "-" }] }).setProtectedHeader({ alg: "HS256" }).setJti("bulk").setExpirationTime("1h").sign(new TextEncoder().encode("bulk-fixture"));
  for (const item of [{ product_id: 1, variant_id: 1, name: "x", qty: 10, price: 90000, base_price: 100000, applied_tier_min_qty: 11 }, { product_id: 1, name: "x", qty: 10, price: 90000, base_price: 100000, applied_tier_min_qty: 10 }]) expect(await verifyCheckoutQuoteToken(await sign(item))).toBeNull();
});
it("stores signed tier snapshot, rejects stale new quote and preserves saved retry", async () => {
  const qris = await import("@/lib/payments/dana-qris");
  const invoice = vi.spyOn(qris, "createActiveQrisInvoice").mockImplementation(async (code, amount) => ({ orderCode: code, requestedAmount: amount, payableAmount: amount, uniqueCode: 0, qrisPayload: "fixture", qrisUrl: "/fixture.png", expiresAt: "2099-01-01", isExisting: false }));
  const { POST } = await import("@/app/api/orders/route");
  const request = (token: string) => new NextRequest("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 10 }], payment_method: "qris", quote_token: token }) });
  const stale = await (await quote([{ product_id: 1, variant_id: 1, qty: 10 }])).json();
  fixture.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=0 WHERE id=1").run();
  expect((await POST(request(stale.quoteToken))).status).toBe(409); expect(invoice).not.toHaveBeenCalled();
  fixture.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=1 WHERE id=1").run();
  const current = await (await quote([{ product_id: 1, variant_id: 1, qty: 10 }])).json();
  const result = await POST(request(current.quoteToken)); expect(result.status).toBe(201); const order = await result.json();
  expect(JSON.parse(String(fixture.sql.prepare("SELECT items FROM orders WHERE code=?").get(order.code)?.items))[0]).toMatchObject({ price: 90000, base_price: 100000, applied_tier_min_qty: 10 });
  fixture.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=0 WHERE id=1").run();
  expect((await POST(request(current.quoteToken))).status).toBe(200); expect(invoice).toHaveBeenCalledTimes(1);
});

it("atomic reservation rejects tier mutation after stale-price read", async () => {
  const quoted = await (await quote([{ product_id: 1, variant_id: 1, qty: 10 }])).json();
  let injected = false;
  fixture.control.fail = (sql) => {
    if (!injected && sql.includes("pv.bulk_pricing_enabled=?")) {
      injected = true; fixture.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=0 WHERE id=1").run();
    }
    return false;
  };
  const { POST } = await import("@/app/api/orders/route");
  const result = await POST(new NextRequest("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 10 }], payment_method: "qris", quote_token: quoted.quoteToken }) }));
  expect(injected).toBe(true); expect(result.status).toBe(409);
  expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
  expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
});

it.each(["gateway", "crypto"])("sends discounted IDR subtotal correctly to %s provider", async (rail) => {
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", rail === "gateway" ? "true" : "false");
  vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", `fixture-${crypto.randomUUID()}`); vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture");
  vi.stubEnv("NOWPAYMENTS_ENABLED", rail === "crypto" ? "true" : "false"); vi.stubEnv("NOWPAYMENTS_API_KEY", "fixture"); vi.stubEnv("NOWPAYMENTS_IPN_SECRET", "fixture");
  vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc"); seedCryptoMarket(fixture.sql, { fx: false });
  vi.stubEnv("USD_IDR_RATE", "16000"); vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 1000).toISOString());
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith("payment-methods")) return Response.json({ status: true, data: [{ payment_code: "BULKVA", payment_name: "Fixture", payment_type: "va", min_amount: 100, max_amount: 1000000, fee_info: { type: "flat", description: "Rp 500" } }] });
    if (target.includes("/estimate?")) return Response.json({ estimated_amount: "56.90", currency_from: "usd", currency_to: "usdtbsc" });
    if (target.includes("/min-amount?")) return Response.json({ min_amount: "1", currency_from: "usdtbsc", currency_to: "usdtbsc" });
    const body = JSON.parse(String(init?.body)); calls.push(body);
    if (rail === "gateway") return Response.json({ status: true, data: { merchant_ref_id: body.merchant_ref_id, invoice: "SPYbulk", amount: 900000, fee: 500, total: 900500, payment_code: "BULKVA", payment_link: "https://sekalipay.com/payment/SPYbulk", status: "pending", is_sandbox: false, expired_at: new Date(Date.now() + 600000).toISOString() } }, { status: 201 });
    return Response.json({ payment_id: "npbulk", order_id: body.order_id, pay_address: "TXYZfixture", pay_amount: "57.50", pay_currency: "usdtbsc", price_amount: "56.90", price_currency: "usd", is_fixed_rate: false, is_fee_paid_by_user: false }, { status: 201 });
  }));
  const quoted = await (await quote([{ product_id: 1, variant_id: 1, qty: 10 }])).json();
  expect(quoted.subtotal).toBe(900000); expect(quoted.displayPreferences.usdCents).toBe("5625");
  const { POST } = await import("@/app/api/orders/route");
  const result = await POST(new NextRequest("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 10 }], payment_method: rail === "gateway" ? "sekalipay_gateway:BULKVA" : "nowpayments:usdtbsc", quote_token: quoted.quoteToken }) }));
  expect(result.status).toBe(201);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject(rail === "gateway" ? { amount: 900000, payment_code: "BULKVA" } : { price_amount: "56.90", price_currency: "usd", is_fee_paid_by_user: false, is_fixed_rate: false });
  const order = await result.json(); expect(order.subtotal).toBe(900000);
  if (rail === "gateway") expect(order.payment).toMatchObject({ fee: 500, total: 900500 });
});
