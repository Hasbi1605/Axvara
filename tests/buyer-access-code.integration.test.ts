import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { deriveOrderAccessCode, buyerOrderAccessMatches } from "@/lib/order-access";
import { normalizeOrderAccessCode } from "@/lib/order-access-format";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { readFileSync } from "node:fs";

const current = "AXV-20261027-ACCE5511", legacy = "AXV-20261027-1E6AC001";
let fx: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fx = createD1Fixture(); vi.stubEnv("ADMIN_JWT_SECRET", "buyer-access-local-fixture-secret");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "independent-buyer-code-fixture-secret");
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("ADMIN_EMAIL", "owner@example.test");
  clearRateLimitBucketsForTest();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external traffic in buyer access fixtures"); }));
  await insertTestProduct(fx.sql, "manual");
  insertTestOrder(fx.sql, current, { channel: "web" }); insertTestOrder(fx.sql, legacy, { channel: "web" });
  fx.sql.prepare("UPDATE orders SET buyer_access_version=1 WHERE code=?").run(current);
});
afterEach(() => { fx.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function row(code = current) { return fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!; }
function req(path: string, body?: unknown, proof = "") {
  return new NextRequest(`https://axvara.test${path}`, { method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.210", ...(proof ? { "x-order-access-code": proof } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

it("derives a stable, canonical per-order code without storing plaintext and rejects wrong order/version", async () => {
  const order = row(), code = await deriveOrderAccessCode(order);
  expect(code).toMatch(/^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){3}-[A-Z0-9]{6}$/);
  expect(await deriveOrderAccessCode(order)).toBe(code);
  expect(await buyerOrderAccessMatches(code.toLowerCase().replace(/-/g, " "), order)).toBe(true);
  expect(await buyerOrderAccessMatches(code, { ...order, code: legacy })).toBe(false);
  expect(await buyerOrderAccessMatches(code, { ...order, buyer_access_version: 2 })).toBe(false);
  expect(await buyerOrderAccessMatches("628000000000", order)).toBe(false);
  expect(JSON.stringify(order)).not.toContain(normalizeOrderAccessCode(code));
  expect(await buyerOrderAccessMatches("628000000000", { code: current, customer_wa: "628000000000" })).toBe(false);
});

it("new orders reject contact-only lookup and accept their access code", async () => {
  const { POST } = await import("@/app/api/orders/lookup/route");
  expect((await POST(req("/api/orders/lookup", { code: current, contact: "628000000000" }))).status).toBe(200);
  const code = await deriveOrderAccessCode(row());
  const response = await POST(req("/api/orders/lookup", { code: current, access_code: code }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).not.toHaveProperty("access_code");
});

it("same signed checkout quote retries return one order and the same access code without another reservation", async () => {
  const qris = await import("@/lib/payments/qris");
  vi.spyOn(qris, "createActiveQrisInvoice").mockImplementation(async (code, amount) => ({ orderCode: code, requestedAmount: amount, payableAmount: amount + 1, uniqueCode: 1, qrisPayload: "fixture", qrisUrl: "/fixture.png", expiresAt: "2099-01-01", isExisting: false }));
  const items = [{ product_id: 1, variant_id: 1, price: 10000, qty: 1, name: "Fixture" }];
  const { createCheckoutQuoteToken } = await import("@/lib/auth");
  const { token } = await createCheckoutQuoteToken({ items, subtotal: 10000, payment_methods: [{ id: "qris", account_number: "Fixture" }] });
  const { POST } = await import("@/app/api/orders/route");
  const body = { customer_wa: "081234567890", customer_email: "buyer@example.test", items, payment_method: "qris", quote_token: token };
  const responses = await Promise.all(Array.from({ length: 3 }, () => POST(req("/api/orders", body))));
  expect(responses.map(r => r.status).sort()).toEqual([200, 200, 201]);
  const payloads = await Promise.all(responses.map(r => r.json()));
  expect(new Set(payloads.map(p => p.code)).size).toBe(1);
  expect(new Set(payloads.map(p => p.buyer_access_code)).size).toBe(1);
  const created = row(payloads[0].code);
  expect(created.buyer_access_version).toBe(1);
  for (const payload of payloads) expect(payload).not.toHaveProperty("buyer_access_code");
  expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(99);
});

it("new order status, wake, and cancellation require access proof before side effects", async () => {
  const { GET } = await import("@/app/api/orders/route");
  for (const suffix of ["", "&wake=1"]) {
    expect((await GET(req(`/api/orders?code=${current}${suffix}`))).status).toBe(404);
  }
  const { POST } = await import("@/app/api/orders/[code]/cancel/route");
  expect((await POST(req(`/api/orders/${current}/cancel`, { contact: "628199999999" }), { params: Promise.resolve({ code: current }) })).status).toBe(404);
  expect(row().status).toBe("pending");
  const code = await deriveOrderAccessCode(row());
  expect((await GET(req(`/api/orders?code=${current}`, undefined, code))).status).toBe(200);
  expect((await POST(req(`/api/orders/${current}/cancel`, { access_code: code }), { params: Promise.resolve({ code: current }) })).status).toBe(200);
  expect(row().status).toBe("dibatalkan");
});

it("keeps legacy contact lookup available only for orders explicitly marked legacy", async () => {
  const { POST } = await import("@/app/api/orders/lookup/route");
  expect((await POST(req("/api/orders/lookup", { code: legacy, contact: "628000000000" }))).status).toBe(200);
  expect(await deriveOrderAccessCode(row(legacy))).toBe("");
});

it("requires a paid order before releasing credentials, then accepts the access code and capability header", async () => {
  const { POST, GET } = await import("@/app/api/orders/[code]/credentials/route");
  const ctx = { params: Promise.resolve({ code: current }) };
  const access = await deriveOrderAccessCode(row());
  expect((await POST(req(`/api/orders/${current}/credentials`, { access_code: access }), ctx)).status).toBe(403);
  const { encryptSecret } = await import("@/lib/fulfillment/crypto");
  vi.stubEnv("FULFILLMENT_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  const sealed = await encryptSecret("PRIVATE-FIXTURE-CREDENTIAL");
  fx.sql.exec("UPDATE orders SET status='lunas',payment_status='paid'");
  fx.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,delivered_ciphertext,delivered_iv)
    VALUES(?,0,1,1,1,'shared','web','delivered',?,?)`).run(current, sealed.ciphertext, sealed.iv);
  const denied = await POST(req(`/api/orders/${current}/credentials`, { contact: "628000000000" }), ctx);
  expect(denied.status).toBe(404); expect(await denied.text()).not.toContain("PRIVATE-FIXTURE");
  const response = await POST(req(`/api/orders/${current}/credentials`, { access_code: access }), ctx);
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.credentials[0].details).toBe("PRIVATE-FIXTURE-CREDENTIAL");
  const tokenRequest = new NextRequest(`https://axvara.test/api/orders/${current}/credentials`, { headers: { "x-credential-token": result.capability_token } });
  expect((await GET(tokenRequest, ctx)).status).toBe(200);
  expect(tokenRequest.url).not.toContain(result.capability_token);
});

it("denies contact-only QR reissue and Pedia wake/refill before any supplier or payment request", async () => {
  const { POST: reissue } = await import("@/app/api/payments/qris/[code]/reissue/route");
  expect((await reissue(req(`/api/payments/qris/${current}/reissue`, {}), { params: Promise.resolve({ code: current }) })).status).toBe(404);
  const pedia = "AXP-20261027-ACCE5512";
  insertTestOrder(fx.sql, pedia, { channel: "web" });
  fx.sql.prepare("UPDATE orders SET buyer_access_version=1,order_kind='pedia' WHERE code=?").run(pedia);
  const { GET } = await import("@/app/api/pedia/orders/[code]/route");
  const { POST } = await import("@/app/api/pedia/orders/[code]/refill/route");
  const params = { params: Promise.resolve({ code: pedia }) };
  const request = new NextRequest(`https://axvara.test/api/pedia/orders/${pedia}?wake=1`, { headers: { "x-order-contact": "628000000000" } });
  expect((await GET(request, params)).status).toBe(404);
  expect((await POST(req(`/api/pedia/orders/${pedia}/refill`, { contact: "628000000000" }), params)).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});

it("counts wrong access proofs durably and fails closed when the counter cannot be stored", async () => {
  const { GET } = await import("@/app/api/orders/route");
  for (let i = 0; i < 20; i++) {
    clearRateLimitBucketsForTest();
    const response = await GET(req(`/api/orders?code=${current}`, undefined, "00000-00000-00000-00000-000000"));
    expect(response.status).toBe(i === 19 ? 429 : 404);
  }
  expect(fx.sql.prepare("SELECT failures FROM order_contact_attempts WHERE order_code=?").get(current)?.failures).toBe(20);
  fx.sql.exec("DELETE FROM order_contact_attempts");
  fx.control.fail = sql => sql.includes("INSERT INTO order_contact_attempts");
  clearRateLimitBucketsForTest();
  expect((await GET(req(`/api/orders?code=${current}`))).status).toBe(503);
  expect(row().status).toBe("pending");
});

it("uses only the dedicated buyer key and refuses new stock reservations when it is absent in production", async () => {
  const before = await deriveOrderAccessCode(row());
  vi.stubEnv("ADMIN_JWT_SECRET", "rotated-jwt-fixture-key");
  expect(await deriveOrderAccessCode(row())).toBe(before);
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "");
  await expect(deriveOrderAccessCode(row())).rejects.toThrow("buyer_access_unavailable");
  const { createOrderWithStock } = await import("@/lib/db");
  await expect(createOrderWithStock({ code: "AXV-20261027-ACCE5513", quoteId: "missing-buyer-key", customerName: "Fixture", customerWa: "6281234567890", customerEmail: "buyer@example.test",
    items: [{ product_id: 1, variant_id: 1, price: 10000, qty: 1, name: "Fixture" }], subtotal: 10000, paymentMethod: "qris", paymentAccount: "Fixture", proofUrl: null })).rejects.toThrow("buyer_access_unavailable");
  expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(2);
});

it("allows only an authenticated admin to reveal or atomically rotate a code and revoke previous capabilities", async () => {
  const { POST } = await import("@/app/api/admin/orders/[code]/access-code/route");
  const ctx = { params: Promise.resolve({ code: current }) };
  expect((await POST(req(`/api/admin/orders/${current}/access-code`, {}), ctx)).status).toBe(401);
  const { createAdminToken, createIdleToken } = await import("@/lib/auth");
  const session = await createAdminToken("owner@example.test"), idle = await createIdleToken(session.sid);
  const admin = (rotate = false) => new NextRequest(`https://axvara.test/api/admin/orders/${current}/access-code`, { method: "POST", headers: { "content-type": "application/json", cookie: `axvara_admin_token=${session.token}; axvara_idle=${idle}` }, body: JSON.stringify({ rotate }) });
  const { issueCredentialToken, verifyCredentialToken } = await import("@/lib/warung-rebahan/deliver");
  const token = await issueCredentialToken(current);
  const response = await POST(admin(), ctx), oldCode = (await response.json()).buyer_access_code;
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  const rotations = await Promise.all([POST(admin(true), ctx), POST(admin(true), ctx)]);
  expect(rotations.map(r => r.status).sort()).toEqual([200, 409]);
  const success = rotations.find(r => r.status === 200)!;
  const newCode = (await success.json()).buyer_access_code;
  expect(await buyerOrderAccessMatches(oldCode, row())).toBe(false);
  expect(await buyerOrderAccessMatches(newCode, row())).toBe(true);
  expect(await verifyCredentialToken(current, token!)).toBe(false);
  const events = fx.sql.prepare("SELECT * FROM security_events WHERE event LIKE 'buyer_access_%'").all();
  expect(events.map(e => e.event)).toEqual(["buyer_access_revealed", "buyer_access_rotated"]);
  expect(JSON.stringify(events)).not.toContain(oldCode); expect(JSON.stringify(events)).not.toContain(newCode);
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM operation_guards").get()?.n).toBe(0);
});

it("keeps legacy rows and existing audit events intact when migration 0081 runs", async () => {
  fx.sql.exec("ALTER TABLE orders DROP COLUMN buyer_access_version; INSERT INTO security_events(event,subject_hash,route,method) VALUES('login_failed','fixture','/api/auth/login','POST')");
  fx.sql.exec(readFileSync("drizzle/migrations/0081_buyer_access_code.sql", "utf8"));
  expect(row().buyer_access_version).toBe(0);
  expect(fx.sql.prepare("SELECT event FROM security_events").get()?.event).toBe("login_failed");
  fx.sql.exec("INSERT INTO security_events(event,subject_hash,route,method) VALUES('buyer_access_revealed','fixture','/api/admin/orders/:code/access-code','POST')");
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM security_events").get()?.n).toBe(2);
});

it("never reveals a Telegram access code to a different buyer or group", async () => {
  fx.sql.prepare("UPDATE orders SET sales_channel='telegram',telegram_chat_id='12345',telegram_user_id='12345' WHERE code=?").run(current);
  const api = await import("@/lib/telegram/api");
  const sent = vi.spyOn(api, "sendMessage").mockResolvedValue({ ok: true } as never);
  const { handleOrderStatus } = await import("@/lib/telegram/handlers/orders");
  const access = await deriveOrderAccessCode(row());
  await handleOrderStatus(22222, current); await handleOrderStatus(-12345, current);
  expect(JSON.stringify(sent.mock.calls)).not.toContain(access);
  sent.mockClear(); await handleOrderStatus(12345, current);
  expect(JSON.stringify(sent.mock.calls)).not.toContain(access);
  expect(JSON.stringify(sent.mock.calls)).toContain(current);
});
