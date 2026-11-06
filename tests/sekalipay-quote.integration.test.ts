import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { createCheckoutQuoteToken, verifyCheckoutQuoteToken } from "@/lib/auth";

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture(); await insertTestProduct(fixture.sql);
  fixture.sql.exec("INSERT OR IGNORE INTO payment_methods(id,label,account_number,account_name,is_active,sort_order) VALUES('qris','QRIS','-','AXVARA',1,1); UPDATE payment_methods SET is_active=1 WHERE id='qris'");
  vi.stubEnv("ADMIN_JWT_SECRET", "gateway-quote-fixture");
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "klikqris"); vi.stubEnv("KLIKQRIS_ENABLED", "true");
  vi.stubEnv("KLIKQRIS_API_KEY", "fixture"); vi.stubEnv("KLIKQRIS_MERCHANT_ID", "123");
  vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", `fixture-${crypto.randomUUID()}`); vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture");
  const { clearRateLimitBucketsForTest } = await import("@/lib/rateLimit"); clearRateLimitBucketsForTest();
});
afterEach(() => { fixture.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const quote = async () => {
  const { POST } = await import("@/app/api/checkout/quote/route");
  return POST(new NextRequest("http://localhost/api/checkout/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ product_id: 1, variant_id: 1, qty: 1, expected_price: 10000 }] }) }));
};
it("quotes only enabled account methods, signs estimate and keeps QRIS first", async () => {
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
  const row = { payment_name: "Fixture", min_amount: 100, max_amount: 100000, fee_info: { type: "percent", description: "3,7%" } };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: true, data: [
    { ...row, payment_code: "TESTVA", payment_type: "va" }, { ...row, payment_code: "TESTEW", payment_type: "ewallet" },
    { ...row, payment_code: "XQRIS", payment_type: "va" }, { ...row, payment_code: "BAD", payment_type: "va", fee_info: { type: "flat", description: "unknown" } },
  ] })));
  const res = await quote(); expect(res.status).toBe(200); const data = await res.json();
  expect(data.paymentMethods.map((m: { id: string }) => m.id)).toEqual(["qris", "ewallet", "seabank", "sekalipay_gateway:TESTVA", "sekalipay_gateway:TESTEW"]);
  expect(data.paymentMethods[3]).toMatchObject({ kind: "gateway", currency: "IDR", gateway: { channel: "TESTVA", idr_subtotal: 10000, estimated_fee: 370, estimated_total: 10370 } });
  expect((await verifyCheckoutQuoteToken(data.quoteToken))?.payment_methods[3]).toMatchObject({ gateway: { channel: "TESTVA", estimated_fee: 370, estimated_total: 10370 } });
});
it("flag off never fetches; provider failure retains QRIS", async () => {
  const fetchMock = vi.fn(async () => { throw new Error("fixture outage"); }); vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
  expect((await (await quote()).json()).paymentMethods[0].id).toBe("qris"); expect(fetchMock).not.toHaveBeenCalled();
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
  const result = await quote(); expect(result.status).toBe(200);
  expect((await result.json()).paymentMethods.map((m: { id: string }) => m.id)).toEqual(["qris", "ewallet", "seabank"]); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("independently signed gateway snapshots fail closed on invalid values", async () => {
  const method = { id: "sekalipay_gateway:TESTVA", kind: "gateway", account_number: "", currency: "IDR", gateway: { channel: "TESTVA", estimated_fee: 370, estimated_total: 10370, idr_subtotal: 10000 } };
  const base = { items: [{ product_id: 1, name: "Fixture", price: 10000, qty: 1 }], subtotal: 10000, payment_methods: [method] };
  const sign = (value: object) => new SignJWT({ purpose: "checkout_quote", ...value }).setProtectedHeader({ alg: "HS256" }).setJti("fixture").setExpirationTime("1h").sign(new TextEncoder().encode("gateway-quote-fixture"));
  expect((await verifyCheckoutQuoteToken(await sign(base)))?.payment_methods[0].gateway).toEqual(method.gateway);
  for (const invalid of [
    { ...method, gateway: { ...method.gateway, estimated_total: 10371 } },
    { ...method, gateway: { ...method.gateway, idr_subtotal: 9999 } },
    { ...method, gateway: { ...method.gateway, channel: "qris" } },
    { ...method, gateway: { ...method.gateway, estimated_fee: -1 } },
    { ...method, gateway: { ...method.gateway, extra: 1 } },
    { ...method, kind: "qris" }, { ...method, gateway: undefined },
    { ...method, usd: { cents: "1" } },
  ]) {
    const input = { ...base, payment_methods: [invalid] };
    expect(await verifyCheckoutQuoteToken(await sign(input))).toBeNull();
    await expect(createCheckoutQuoteToken(input as never)).rejects.toThrow();
  }
  const token = await sign(base); expect(await verifyCheckoutQuoteToken(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"))).toBeNull();
});

it("creates gateway once from signed quote and requires buyer proof for fee consent", async () => {
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "fixture-buyer-secret");
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
  let posts = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("payment-methods")) return Response.json({ status: true, data: [{ payment_code: "TESTVA", payment_name: "Fixture", payment_type: "va", min_amount: 100, max_amount: 100000, fee_info: { type: "flat", description: "Rp 500" } }] });
    if (String(url).endsWith("/payment")) {
      posts++; const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ amount: 10000, payment_code: "TESTVA" });
      return Response.json({ status: true, data: { merchant_ref_id: body.merchant_ref_id, invoice: "SPYtest", amount: 10000, fee: 600, total: 10600, payment_code: "TESTVA", payment_link: "https://sekalipay.com/payment/SPYtest", virtual_account: "12345678", checkout_url: null, status: "pending", is_sandbox: false, expired_at: new Date(Date.now() + 1800000).toISOString() } }, { status: 201 });
    }
    throw new Error("unexpected fixture network");
  }));
  const quoted = await (await quote()).json();
  const { POST } = await import("@/app/api/orders/route");
  const request = () => new NextRequest("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: "sekalipay_gateway:TESTVA", quote_token: quoted.quoteToken, amount: 1, fee: 0 }) });
  const response = await POST(request()); expect(response.status).toBe(201); const order = await response.json();
  expect(order.payment).toMatchObject({ kind: "gateway", subtotal: 10000, estimated_fee: 500, fee: 600, total: 10600, state: "fee_consent_required", payment_link: null });
  expect(Date.parse(order.payment.expires_at) - Date.now()).toBeLessThanOrEqual(15 * 60_000);
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
  const retry = await POST(request()); expect(retry.status).toBe(200); expect((await retry.json()).code).toBe(order.code); expect(posts).toBe(1);
  const { POST: consent } = await import("@/app/api/orders/[code]/payment-consent/route");
  const consentRequest = (total: number, contact: string) => new NextRequest(`http://localhost/api/orders/${order.code}/payment-consent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contact, expected_final_total: total }) });
  const params = { params: Promise.resolve({ code: order.code }) };
  expect((await consent(consentRequest(10600, ""), params)).status).toBe(400);
  expect((await consent(consentRequest(10600, "badcode"), params)).status).not.toBe(200);
  expect((await consent(consentRequest(10600, order.buyer_access_session), params)).status).not.toBe(200);
  expect((await consent(consentRequest(10601, "buyer@example.test"), params)).status).toBe(409);
  fixture.sql.prepare("UPDATE payment_transactions SET last_error='sekalipay_gateway_preconsent_manual_review' WHERE order_code=?").run(order.code);
  expect((await consent(consentRequest(10600, "buyer@example.test"), params)).status).toBe(409);
  const { buildSekalipayGatewayPaymentView } = await import("@/lib/payments/payment-view");
  expect(await buildSekalipayGatewayPaymentView(order.code)).toMatchObject({ state: "manual_review", payment_link: null });
  fixture.sql.prepare("UPDATE payment_transactions SET last_error=NULL WHERE order_code=?").run(order.code);
  const accepted = await consent(consentRequest(10600, "buyer@example.test"), params); expect(accepted.status).toBe(200);
  expect((await accepted.json()).payment).toMatchObject({ state: "pending", total: 10600, virtual_account: "12345678" });
  expect((await consent(consentRequest(10600, "buyer@example.test"), params)).status).toBe(200);
  const { POST: lookup } = await import("@/app/api/orders/lookup/route");
  const lookupRequest = (contact: string) => new NextRequest("http://localhost/api/orders/lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: order.code, contact }) });
  expect((await lookup(lookupRequest("wrong@example.test"))).status).toBe(404);
  const found = await lookup(lookupRequest("buyer@example.test")); expect(found.status).toBe(200);
  expect((await found.json()).order.payment).toMatchObject({ virtual_account: "12345678" });
  fixture.control.afterRun = async (sql) => {
    if (sql.includes("UPDATE payment_transactions SET gateway_fee_consented_at")) fixture.sql.prepare("UPDATE orders SET status='dibatalkan',payment_status='failed' WHERE code=?").run(order.code);
  };
  const raced = await consent(consentRequest(10600, "buyer@example.test"), params);
  expect(raced.status).toBe(409); expect(await raced.json()).not.toHaveProperty("payment");
  fixture.control.afterRun = null;
  expect((await consent(consentRequest(10600, "buyer@example.test"), params)).status).toBe(409);
  expect(await buildSekalipayGatewayPaymentView(order.code)).toMatchObject({ state: "expired", payment_link: null, virtual_account: null });
  expect(posts).toBe(1);
});

it("same quote racing before ledger claim returns 503 and reserves/posts once", async () => {
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false"); vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "fixture-buyer-secret"); vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
  let posts = 0, release!: () => void, reached!: () => void;
  const waiting = new Promise<void>((r) => { release = r; });
  const barrier = new Promise<void>((r) => { reached = r; });
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("payment-methods")) return Response.json({ status: true, data: [{ payment_code: "RACEVA", payment_name: "Fixture", payment_type: "va", min_amount: 100, max_amount: 100000, fee_info: { type: "flat", description: "Rp 500" } }] });
    if (String(url).endsWith("/payment")) {
      posts++; const body = JSON.parse(String(init?.body));
      return Response.json({ status: true, data: { merchant_ref_id: body.merchant_ref_id, invoice: "SPYrace", amount: 10000, fee: 500, total: 10500, payment_code: "RACEVA", payment_link: "https://sekalipay.com/payment/SPYrace", status: "pending", is_sandbox: false, expired_at: new Date(Date.now() + 1800000).toISOString() } }, { status: 201 });
    }
    throw new Error("unexpected fixture request");
  }));
  const signed = await (await quote()).json();
  const { POST } = await import("@/app/api/orders/route");
  const request = () => new NextRequest("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: "sekalipay_gateway:RACEVA", quote_token: signed.quoteToken }) });
  fixture.control.afterBatch = async (queries) => { if (queries.some((q) => q.startsWith("INSERT INTO orders"))) { reached(); await waiting; } };
  const first = POST(request()); await barrier;
  const retry = await POST(request()); expect(retry.status).toBe(503); expect(retry.headers.get("cache-control")).toBe("private, no-store");
  const pending = await retry.json(); expect(pending.code).toMatch(/^AXV-/); expect(pending.buyer_access_session).toBeTruthy();
  release(); const created = await first; expect(created.status).toBe(201); expect((await created.json()).code).toBe(pending.code);
  expect(posts).toBe(1); expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(99);
  expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()?.n).toBe(1);
});

it.each(["pending", "paid"])("saved initializing retry flag off recovers %s reference by GET only", async (remoteStatus) => {
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false"); vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "fixture-buyer-secret"); vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
  let posts = 0, gets = 0, savedRef = "";
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("payment-methods")) return Response.json({ status: true, data: [{ payment_code: "RECVA", payment_name: "Fixture", payment_type: "va", min_amount: 100, max_amount: 100000, fee_info: { type: "flat", description: "Rp 500" } }] });
    if (String(url).endsWith("/payment")) { posts++; savedRef = JSON.parse(String(init?.body)).merchant_ref_id; throw new Error("fixture timeout"); }
    if (String(url).endsWith(`/payment/${savedRef}`)) { gets++; return Response.json({ status: true, data: { merchant_ref_id: savedRef, invoice: "SPYrecovered", amount: 10000, fee: 500, total: 10500, payment_code: "RECVA", payment_link: "https://sekalipay.com/payment/SPYrecovered", status: remoteStatus, paid_at: new Date().toISOString(), is_sandbox: false, expired_at: new Date(Date.now() + 1800000).toISOString() } }); }
    throw new Error("unexpected fixture request");
  }));
  const signed = await (await quote()).json();
  const { POST } = await import("@/app/api/orders/route");
  const request = () => new NextRequest("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: "sekalipay_gateway:RECVA", quote_token: signed.quoteToken }) });
  const failed = await POST(request()); expect(failed.status).toBe(503); const first = await failed.json();
  expect(first.code).toBe(savedRef); expect(first.buyer_access_session).toBeTruthy(); expect(failed.headers.get("cache-control")).toBe("private, no-store");
  expect(fixture.sql.prepare("SELECT status FROM payment_transactions WHERE order_code=?").get(savedRef)?.status).toBe("initializing");
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
  const retried = await POST(request()); expect(retried.status).toBe(200); const body = await retried.json();
  expect(body).toMatchObject({ code: savedRef, reused: true, payment: { state: remoteStatus === "paid" ? "manual_review" : "pending", total: 10500 } });
  expect(posts).toBe(1); expect(gets).toBe(remoteStatus === "paid" ? 2 : 1);
  expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(99);
});

it("rejects missing email and disabled new gateway before any reservation", async () => {
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false"); vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "fixture-buyer-secret"); vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
  const fetchMock = vi.fn(async () => Response.json({ status: true, data: [{ payment_code: "NOPOST", payment_name: "Fixture", payment_type: "va", min_amount: 100, max_amount: 100000, fee_info: { type: "flat", description: "Rp 500" } }] }));
  vi.stubGlobal("fetch", fetchMock);
  const signed = await (await quote()).json();
  const { POST } = await import("@/app/api/orders/route");
  const request = (email?: string) => new NextRequest("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: email, items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: "sekalipay_gateway:NOPOST", quote_token: signed.quoteToken }) });
  expect((await POST(request())).status).toBe(400);
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
  expect((await POST(request("buyer@example.test"))).status).toBe(503);
  expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
  expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("consent requires matching contact, gateway rail and live unpaid order", async () => {
  const code = "AXV-20261104-CONTACT1";
  insertTestOrder(fixture.sql, code, { channel: "web" });
  fixture.sql.prepare("UPDATE orders SET customer_email='buyer@example.test',buyer_access_version=0,expires_at=? WHERE code=?").run(new Date(Date.now() + 900000).toISOString(), code);
  fixture.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,provider_payment_id,status,expires_at,gateway_fee,gateway_estimated_fee,gateway_fee_consent_required,gateway_channel,direct_url)
    VALUES(?,'sekalipay_gateway','merchant',?,'fixture',10000,10500,'SPYlegacy','pending',?,500,400,1,'TESTVA','https://sekalipay.com/payment/SPYlegacy')`).run(code, code, new Date(Date.now() + 900000).toISOString());
  const { POST } = await import("@/app/api/orders/[code]/payment-consent/route");
  const call = (contact: string, value = 10500) => POST(new NextRequest("http://localhost/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contact, expected_final_total: value }) }), { params: Promise.resolve({ code }) });
  expect((await call("other@example.test")).status).toBe(404);
  expect((await call("buyer@example.test", 1)).status).toBe(409);
  fixture.sql.prepare("UPDATE payment_transactions SET provider='dana' WHERE order_code=?").run(code);
  expect((await call("buyer@example.test")).status).toBe(409);
  fixture.sql.prepare("UPDATE payment_transactions SET provider='sekalipay_gateway' WHERE order_code=?").run(code);
  fixture.sql.prepare("UPDATE orders SET expires_at=datetime('now','-1 minute') WHERE code=?").run(code);
  expect((await call("buyer@example.test")).status).toBe(409);
  fixture.sql.prepare("UPDATE orders SET expires_at=datetime('now','+15 minutes') WHERE code=?").run(code);
  expect((await call("buyer@example.test")).status).toBe(200);
});
