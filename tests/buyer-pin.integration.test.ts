import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { buyerOrderAccessMatches, createBuyerAccessSession, deriveOrderAccessCode, newOrderAccessFailure as orderFailure, verifyBuyerAccessSession } from "@/lib/order-access";
import { encodeOrderAccessPin } from "@/lib/order-access-format";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";

const CODE = "AXV-20261027-PIN00001";
let fx: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fx = createD1Fixture();
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "six-character-pin-fixture-key");
  vi.stubEnv("ADMIN_JWT_SECRET", "buyer-pin-admin-fixture-key");
  vi.stubEnv("ADMIN_EMAIL", "owner@example.test");
  clearRateLimitBucketsForTest();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Fixture blocks all external traffic"); }));
  await insertTestProduct(fx.sql);
  insertTestOrder(fx.sql, CODE, { channel: "web" });
  fx.sql.prepare("UPDATE orders SET buyer_access_version=1,buyer_access_format='pin6' WHERE code=?").run(CODE);
});
afterEach(() => { fx.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const row = () => fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(CODE)!;
const newOrderAccessFailure = (request: Request, order: Parameters<typeof orderFailure>[1], pin: string) => orderFailure(request, order, pin, { allowAdmin: false, purpose: "credentials", contact: "628000000000" });
function request(index = 1, session = "") {
  return new NextRequest(`https://axvara.test/api/orders?code=${CODE}`, { headers: {
    "cf-connecting-ip": `203.0.113.${index}`, ...(session ? { "x-buyer-access-session": session } : {}),
  } });
}
function failures() { return fx.sql.prepare("SELECT failures FROM order_contact_attempts WHERE order_code=? AND client_hash='pin:v1:1'").get(CODE)?.failures; }

it("derives six mixed characters with leading-zero support and keeps existing 26-character orders isolated", async () => {
  const pin = await deriveOrderAccessCode(row());
  expect(pin).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/); expect(pin).toMatch(/[0-9]/); expect(pin).toMatch(/[A-Z]/);
  expect(await deriveOrderAccessCode(row())).toBe(pin);
  expect(encodeOrderAccessPin(new Uint8Array(4))).toBe("000000");
  const old = { ...row(), buyer_access_format: "code26" };
  const long = await deriveOrderAccessCode(old);
  expect(long.replace(/-/g, "")).toHaveLength(26);
  expect(await buyerOrderAccessMatches(long, row())).toBe(false);
  expect(await buyerOrderAccessMatches(pin, old)).toBe(false);
  expect(await buyerOrderAccessMatches(long, old)).toBe(true);
});

it("admits at most ten parallel PIN guesses across rotating source IPs before comparison", async () => {
  const order = row();
  const sign = vi.spyOn(crypto.subtle, "sign");
  await deriveOrderAccessCode(order); const perVerification = sign.mock.calls.length; sign.mockClear();
  const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => newOrderAccessFailure(request(i + 1), order, "AAAAA1")));
  expect(responses.filter(r => r?.status === 404)).toHaveLength(10);
  expect(responses.filter(r => r?.status === 429)).toHaveLength(10);
  expect(sign).toHaveBeenCalledTimes(10 * perVerification);
  expect(failures()).toBe(10);
  const pin = await deriveOrderAccessCode(order); sign.mockClear();
  expect((await newOrderAccessFailure(request(99), order, pin))?.status).toBe(429);
  expect(sign).not.toHaveBeenCalled();
});

it("a successful PIN returns only its own admission slot; verified sessions never erase failed guesses", async () => {
  const order = row(), pin = await deriveOrderAccessCode(order), session = await createBuyerAccessSession(order);
  for (let i = 0; i < 9; i++) expect((await newOrderAccessFailure(request(i + 1), order, "AAAAA1"))?.status).toBe(404);
  expect(await newOrderAccessFailure(request(10), order, pin)).toBeNull();
  expect(failures()).toBe(9);
  for (let i = 0; i < 15; i++) expect(await orderFailure(request(70, session), order, undefined, { allowStatusSession: true })).toBeNull();
  expect(failures()).toBe(9);
  expect((await newOrderAccessFailure(request(30), order, "AAAAA1"))?.status).toBe(404);
  expect((await newOrderAccessFailure(request(31), order, pin))?.status).toBe(429);
  expect(await orderFailure(request(70, session), order, undefined, { allowStatusSession: true })).toBeNull();
});

it("fails closed before PIN comparison on admission outage and refuses missing format metadata", async () => {
  const order = row(), pin = await deriveOrderAccessCode(order);
  const sign = vi.spyOn(crypto.subtle, "sign");
  fx.control.fail = sql => sql.includes("INSERT INTO order_contact_attempts");
  expect((await newOrderAccessFailure(request(), order, pin))?.status).toBe(503);
  expect(sign).not.toHaveBeenCalled();
  fx.control.fail = null;
  const { buyer_access_format: _format, ...partial } = order;
  expect((await newOrderAccessFailure(request(), partial, pin))?.status).toBe(503);
  expect(await buyerOrderAccessMatches(pin, { ...partial, buyer_access_version: 0 })).toBe(false);
});

it("issues the browsing session only after successful buyer proof, bound to order/version and 24-hour expiry", async () => {
  const { POST } = await import("@/app/api/orders/lookup/route");
  const lookup = (access: string) => POST(new NextRequest("https://axvara.test/api/orders/lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: CODE, contact: "628000000000", access_code: access }) }));
  const denied = await lookup("AAAAA1"); expect(denied.status).toBe(404);
  expect(await denied.json()).not.toHaveProperty("buyer_access_session");
  const pin = await deriveOrderAccessCode(row());
  const accepted = await lookup(pin), body = await accepted.json();
  expect(accepted.status).toBe(200); expect(body.buyer_access_session).toMatch(/^p1\.\d{10}\.[A-Za-z0-9_-]{43}$/);
  expect(await verifyBuyerAccessSession(body.buyer_access_session, row())).toBe(true);
  expect(await verifyBuyerAccessSession(body.buyer_access_session, { ...row(), code: "AXV-20261027-PIN00002" })).toBe(false);
  expect(await verifyBuyerAccessSession(body.buyer_access_session, { ...row(), buyer_access_version: 2 })).toBe(false);
  expect(await verifyBuyerAccessSession(body.buyer_access_session, row(), Date.now() + 86401_000)).toBe(false);
  expect(JSON.stringify(fx.sql.prepare("SELECT * FROM order_contact_attempts").all())).not.toContain(pin);
});

it("rotation creates a fresh PIN admission bucket and invalidates prior browsing sessions", async () => {
  const old = row(), pin = await deriveOrderAccessCode(old), session = await createBuyerAccessSession(old);
  for (let i = 0; i < 10; i++) await newOrderAccessFailure(request(i + 1), old, "AAAAA1");
  fx.sql.prepare("UPDATE orders SET buyer_access_version=2 WHERE code=?").run(CODE);
  const current = row(), newPin = await deriveOrderAccessCode(current);
  expect(newPin).not.toBe(pin);
  expect(await verifyBuyerAccessSession(session!, current)).toBe(false);
  expect(await newOrderAccessFailure(request(), current, newPin)).toBeNull();
});

it.each(["status", "lookup", "cancel", "credentials", "reissue", "pedia-status", "pedia-lookup", "pedia-refill"])("%s fails closed if its order projection loses the stored format", async (surface) => {
  const pedia = surface.startsWith("pedia-");
  const code = pedia ? CODE.replace("AXV-", "AXP-") : CODE;
  if (pedia) fx.sql.prepare("UPDATE orders SET code=?,order_kind='pedia' WHERE code=?").run(code, CODE);
  const order = fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
  const pin = await deriveOrderAccessCode(order);
  const prepare = fx.db.prepare.bind(fx.db);
  vi.spyOn(fx.db, "prepare").mockImplementation(sql => {
    const wrap = (statement: ReturnType<typeof prepare>): ReturnType<typeof prepare> => ({
      ...statement, bind: (...args) => wrap(statement.bind(...args)),
      first: async () => {
        const result = await statement.first();
        if (result && typeof result === "object" && "buyer_access_version" in result) {
          const { buyer_access_format: _format, ...partial } = result as Record<string, unknown>;
          return partial;
        }
        return result;
      },
    });
    return wrap(prepare(sql));
  });
  const context = { params: Promise.resolve({ code }) };
  const req = (path: string, body?: unknown) => new NextRequest(`https://axvara.test${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-order-access-code": pin }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let response: Response;
  if (surface === "status") response = await (await import("@/app/api/orders/route")).GET(req(`/api/orders?code=${code}`));
  else if (surface.endsWith("lookup")) response = await (await import("@/app/api/orders/lookup/route")).POST(req("/api/orders/lookup", { code, access_code: pin }));
  else if (surface === "cancel") response = await (await import("@/app/api/orders/[code]/cancel/route")).POST(req(`/api/orders/${code}/cancel`, { access_code: pin }), context);
  else if (surface === "credentials") response = await (await import("@/app/api/orders/[code]/credentials/route")).POST(req(`/api/orders/${code}/credentials`, { access_code: pin }), context);
  else if (surface === "reissue") response = await (await import("@/app/api/payments/qris/[code]/reissue/route")).POST(req(`/api/payments/qris/${code}/reissue`, {}), context);
  else if (surface === "pedia-status") response = await (await import("@/app/api/pedia/orders/[code]/route")).GET(req(`/api/pedia/orders/${code}`), context);
  else response = await (await import("@/app/api/pedia/orders/[code]/refill/route")).POST(req(`/api/pedia/orders/${code}/refill`, { access_code: pin }), context);
  expect([403, 409, 503]).toContain(response.status);
  expect(fetch).not.toHaveBeenCalled();
});

it("migration0082 preserves previously issued code26 and existing notice state", async () => {
  fx.sql.exec("ALTER TABLE orders DROP COLUMN buyer_access_format; ALTER TABLE buyer_notice_log DROP COLUMN access_attempts; ALTER TABLE buyer_notice_log DROP COLUMN access_retry_at; ALTER TABLE buyer_notice_log DROP COLUMN access_lease;");
  fx.sql.prepare("INSERT INTO buyer_notice_log(idempotency_key,order_code,channel,status) VALUES('existing-notice',?,'email','sent')").run(CODE);
  fx.sql.exec(readFileSync("drizzle/migrations/0082_buyer_access_pin.sql", "utf8"));
  expect(row().buyer_access_format).toBe("code26");
  expect(fx.sql.prepare("SELECT status,access_attempts FROM buyer_notice_log").get()).toEqual({ status: "sent", access_attempts: 0 });
});

it("checkout creates its order without creating an early PIN email queue or calling the email provider", async () => {
  const { createOrderWithStock } = await import("@/lib/db");
  const input = { code: "AXV-20261027-QUEUE001", quoteId: "pin-queue-fixture", customerName: "Fixture", customerWa: "6281234567890", customerEmail: "buyer@example.test",
    items: [{ product_id: 1, variant_id: 1, price: 10000, qty: 1, name: "Fixture" }], subtotal: 10000, paymentMethod: "qris", paymentAccount: "Fixture", proofUrl: null };
  fx.control.fail = sql => sql.includes("INSERT OR IGNORE INTO buyer_notice_log");
  await createOrderWithStock(input);
  expect(fx.sql.prepare("SELECT buyer_access_format FROM orders WHERE code=?").get(input.code)?.buyer_access_format).toBe("pin6");
  expect(fx.sql.prepare("SELECT idempotency_key FROM buyer_notice_log WHERE order_code=?").get(input.code)).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

it("parallel signed-quote retries grant sessions only for the durable winning order; failed creation grants none", async () => {
  const qris = await import("@/lib/payments/dana-qris");
  const invoice = vi.spyOn(qris, "createActiveQrisInvoice").mockImplementation(async (code, amount) => ({ orderCode: code, requestedAmount: amount, payableAmount: amount + 1, uniqueCode: 1, qrisPayload: "fixture", qrisUrl: "/fixture.png", expiresAt: "2099-01-01", isExisting: false }));
  const { createCheckoutQuoteToken } = await import("@/lib/auth");
  const { POST } = await import("@/app/api/orders/route");
  const quote = async () => (await createCheckoutQuoteToken({ items: [{ product_id: 1, variant_id: 1, price: 10000, qty: 1, name: "Fixture" }], subtotal: 10000, payment_methods: [{ id: "qris", account_number: "Fixture" }] })).token;
  const checkout = (token: string) => POST(new NextRequest("https://axvara.test/api/orders", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.60" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: "qris", quote_token: token }) }));
  const signedQuote = await quote();
  const responses = await Promise.all(Array.from({ length: 3 }, () => checkout(signedQuote)));
  expect(responses.map(r => r.status).sort()).toEqual([200, 200, 201]);
  const payloads = await Promise.all(responses.map(r => r.json()));
  expect(new Set(payloads.map(p => p.code)).size).toBe(1);
  const winner = fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(payloads[0].code)!;
  for (const payload of payloads) expect(await verifyBuyerAccessSession(payload.buyer_access_session, winner)).toBe(true);
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM buyer_notice_log WHERE order_code=?").get(winner.code)?.n).toBe(0);
  for (const payload of payloads) expect(payload).not.toHaveProperty("buyer_access_code");
  clearRateLimitBucketsForTest();
  fx.sql.exec("UPDATE product_variants SET stock=0 WHERE id=1");
  const rejected = await checkout(await quote()), body = await rejected.json();
  expect(rejected.status).toBe(409);
  expect(body).not.toHaveProperty("buyer_access_session"); expect(body).not.toHaveProperty("buyer_access_code");
  expect(invoice).toHaveBeenCalledTimes(1);
});
