import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import {
  createCheckoutCredentialGrant, createDeviceCredentialGrant, deriveOrderAccessCode, verifyDeviceCredentialGrant,
} from "@/lib/order-access";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";

const CODE = "AXV-20261118-DEVICE01", OTHER = "AXV-20261118-DEVICE02", QUOTE = "device-cookie-quote", CONTACT = "buyer@example.test";
const BASE = `https://axvara.test/api/orders/${CODE}`;
let fx: ReturnType<typeof createD1Fixture>, pin: string;
const row = () => fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(CODE)!;
const ctx = () => ({ params: Promise.resolve({ code: CODE }) });
const attempts = () => fx.sql.prepare("SELECT COUNT(*) n FROM order_contact_attempts").get()?.n;

beforeEach(async () => {
  fx = createD1Fixture(); clearRateLimitBucketsForTest();
  vi.stubEnv("ADMIN_JWT_SECRET", "device-cookie-admin-fixture");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "device-cookie-buyer-fixture");
  vi.stubEnv("FULFILLMENT_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external traffic in fixtures"); }));
  await insertTestProduct(fx.sql); insertTestOrder(fx.sql, CODE, { status: "lunas", channel: "web" });
  fx.sql.prepare("UPDATE orders SET quote_id=?,customer_email=?,buyer_access_version=1,buyer_access_format='pin6' WHERE code=?").run(QUOTE, CONTACT, CODE);
  const sealed = await (await import("@/lib/fulfillment/crypto")).encryptSecret("DEVICE-ACCOUNT-FIXTURE");
  fx.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,delivered_ciphertext,delivered_iv)
    VALUES(?,0,1,1,1,'shared','web','delivered',?,?)`).run(CODE, sealed.ciphertext, sealed.iv);
  pin = await deriveOrderAccessCode(row());
});
afterEach(() => { fx.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function mintDevice() { return (await createDeviceCredentialGrant(row()))!; }
async function credentials(body: unknown, headers: Record<string, string> = {}, cookie?: string) {
  const { POST } = await import("@/app/api/orders/[code]/credentials/route");
  return POST(new NextRequest(`${BASE}/credentials`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers, ...(cookie ? { cookie: `axv_d1=${cookie}` } : {}) },
  }), ctx());
}
async function pinRoute(headers: Record<string, string> = {}, cookie?: string) {
  const { POST } = await import("@/app/api/orders/[code]/pin/route");
  return POST(new NextRequest(`${BASE}/pin`, { method: "POST", headers: { ...headers, ...(cookie ? { cookie: `axv_d1=${cookie}` } : {}) } }), ctx());
}
async function deviceRoute(method: "POST" | "DELETE", headers: Record<string, string> = {}) {
  const route = await import("@/app/api/orders/[code]/device/route");
  return route[method](new NextRequest(`${BASE}/device`, { method, headers }), ctx());
}

it("d1 round trips and is bound to order, version and expiry window", async () => {
  const original = row(), grant = (await createDeviceCredentialGrant(original))!;
  expect(grant).toMatch(/^d1\.\d{10}\.[A-Za-z0-9_-]{43}$/);
  expect(await verifyDeviceCredentialGrant(grant, original)).toBe(true);
  // Not bound to the quote, so contact+PIN verification can mint the same proof.
  expect(await verifyDeviceCredentialGrant(grant, { ...original, quote_id: "other" })).toBe(true);
  expect(await verifyDeviceCredentialGrant(grant, { ...original, code: OTHER })).toBe(false);
  expect(await verifyDeviceCredentialGrant(grant.slice(0, -1) + (grant.endsWith("A") ? "B" : "A"), original)).toBe(false);
  expect(await verifyDeviceCredentialGrant((await createBadClass(original)), original)).toBe(false);
  fx.sql.prepare("UPDATE orders SET buyer_access_version=2 WHERE code=?").run(CODE);
  expect(await verifyDeviceCredentialGrant(grant, row())).toBe(false);
});
async function createBadClass(order: Record<string, unknown>) {
  // A c1 proof (or p1) must never validate as d1, even with the prefix swapped.
  return (await createCheckoutCredentialGrant(order))!.replace(/^c1/, "d1");
}

it("d1 rejects expired and too-far-future proofs and non-pin6 orders", async () => {
  const original = row();
  expect(await verifyDeviceCredentialGrant((await createDeviceCredentialGrant(original, Date.now() - 31 * 86400_000))!, original)).toBe(false);
  expect(await verifyDeviceCredentialGrant((await createDeviceCredentialGrant(original, Date.now() + 2 * 86400_000))!, original)).toBe(false);
  expect(await verifyDeviceCredentialGrant((await createDeviceCredentialGrant(original, Date.now() - 29 * 86400_000))!, original)).toBe(true);
  expect(await createDeviceCredentialGrant({ ...original, buyer_access_format: "code26" })).toBeUndefined();
  expect(await createDeviceCredentialGrant({ ...original, buyer_access_version: 0 })).toBeUndefined();
  expect(await verifyDeviceCredentialGrant(await mintDevice(), { ...original, buyer_access_format: "code26" })).toBe(false);
});

it("device POST sets a scoped HttpOnly 30-day cookie only for a valid checkout grant", async () => {
  const grant = (await createCheckoutCredentialGrant(row()))!;
  const ok = await deviceRoute("POST", { "x-checkout-credential-grant": grant });
  expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ ok: true });
  const cookie = ok.headers.get("set-cookie")!;
  expect(cookie).toMatch(/^axv_d1=d1\.\d{10}\.[A-Za-z0-9_-]{43};/);
  expect(cookie).toContain("HttpOnly"); expect(cookie).toMatch(/SameSite=lax/i); expect(cookie).toContain("Secure");
  expect(cookie).toContain(`Path=/api/orders/${CODE}`); expect(cookie).toContain("Max-Age=2592000");
  expect(ok.headers.get("cache-control")).toBe("private, no-store");
  for (const headers of [{}, { "x-checkout-credential-grant": grant.slice(0, -2) + "zz" }] as Record<string, string>[]) {
    const denied = await deviceRoute("POST", headers);
    expect(denied.status).toBe(404); expect(denied.headers.get("set-cookie")).toBeNull();
  }
  fx.sql.prepare("UPDATE orders SET buyer_access_format='code26' WHERE code=?").run(CODE);
  expect((await deviceRoute("POST", { "x-checkout-credential-grant": grant })).status).toBe(404);
});

it("device POST works for unpaid orders but the cookie still cannot open credentials", async () => {
  fx.sql.prepare("UPDATE orders SET status='pending',payment_status='pending' WHERE code=?").run(CODE);
  const response = await deviceRoute("POST", { "x-checkout-credential-grant": (await createCheckoutCredentialGrant(row()))! });
  expect(response.status).toBe(200);
  const cookie = /axv_d1=([^;]+)/.exec(response.headers.get("set-cookie")!)![1];
  expect((await credentials({ device: true }, {}, cookie)).status).toBe(403);
});

it("device DELETE clears the cookie without proof and validates the code", async () => {
  const response = await deviceRoute("DELETE");
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toMatch(/^axv_d1=;/); expect(cookie).toContain("Max-Age=0"); expect(cookie).toContain(`Path=/api/orders/${CODE}`);
  const route = await import("@/app/api/orders/[code]/device/route");
  expect((await route.DELETE(new NextRequest(`${BASE}/device`, { method: "DELETE" }), { params: Promise.resolve({ code: "bad" }) })).status).toBe(400);
});

it("credentials {device:true} with a valid cookie opens credentials without PIN admission or re-minting", async () => {
  const response = await credentials({ device: true }, {}, await mintDevice()), body = await response.json();
  expect(response.status).toBe(200); expect(body.credentials[0].details).toBe("DEVICE-ACCOUNT-FIXTURE");
  expect(body.capability_token).toBeTruthy();
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(attempts()).toBe(0);
});

it("credentials {device:true} without a valid cookie is 404 device_unrecognized and consumes no attempts", async () => {
  const none = await credentials({ device: true });
  expect(none.status).toBe(404); expect(await none.json()).toMatchObject({ error: "device_unrecognized" });
  expect(none.headers.get("set-cookie")).toBeNull();
  const stale = await credentials({ device: true }, {}, "d1.1234567890." + "a".repeat(43));
  expect(stale.status).toBe(404); expect(stale.headers.get("set-cookie")).toContain("Max-Age=0");
  const oldGeneration = await mintDevice();
  fx.sql.prepare("UPDATE orders SET buyer_access_version=2 WHERE code=?").run(CODE);
  expect((await credentials({ device: true }, {}, oldGeneration)).status).toBe(404);
  // A cookie alone never works without the explicit device flag (contact+PIN path stays PIN-gated).
  expect((await credentials({}, {}, await createDeviceCredentialGrant(row()))).status).toBe(404);
  expect(attempts()).toBe(0);
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM wr_credential_tokens").get()?.n).toBe(0);
});

it("the device flag never combines with checkout grants or bypasses paid/readiness checks", async () => {
  const device = await mintDevice();
  fx.sql.prepare("UPDATE orders SET status='pending',payment_status='pending' WHERE code=?").run(CODE);
  expect((await credentials({ device: true }, {}, device)).status).toBe(403);
  fx.sql.prepare("UPDATE orders SET status='lunas',payment_status='paid' WHERE code=?").run(CODE);
  fx.sql.prepare("DELETE FROM fulfillment_items WHERE order_code=?").run(CODE);
  expect(await (await credentials({ device: true }, {}, device)).json()).toMatchObject({ error: "not_ready" });
});

it("contact+PIN success and checkout-grant success each mint a fresh d1 cookie that verifies", async () => {
  for (const attempt of ["pin", "grant"]) {
    const response = attempt === "pin" ? await credentials({ contact: CONTACT, access_code: pin })
      : await credentials({}, { "x-checkout-credential-grant": (await createCheckoutCredentialGrant(row()))! });
    expect(response.status).toBe(200);
    const header = response.headers.get("set-cookie")!;
    expect(header).toContain("HttpOnly"); expect(header).toContain(`Path=/api/orders/${CODE}`); expect(header).toContain("Max-Age=2592000");
    expect(await verifyDeviceCredentialGrant(/axv_d1=([^;]+)/.exec(header)![1], row())).toBe(true);
  }
  // Failed contact+PIN never mints.
  const wrong = await credentials({ contact: CONTACT, access_code: "AAAAA1" });
  expect(wrong.status).toBe(404); expect(wrong.headers.get("set-cookie")).toBeNull();
});

it("pin route accepts a valid d1 cookie and rejects invalid, stale or unpaid proofs", async () => {
  const device = await mintDevice();
  const ok = await pinRoute({}, device);
  expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ pin });
  expect((await pinRoute({}, "d1.1234567890." + "a".repeat(43))).status).toBe(404);
  expect((await pinRoute()).status).toBe(404);
  fx.sql.prepare("UPDATE orders SET status='pending',payment_status='pending' WHERE code=?").run(CODE);
  expect((await pinRoute({}, device)).status).toBe(403);
  fx.sql.prepare("UPDATE orders SET status='lunas',payment_status='paid',buyer_access_version=2 WHERE code=?").run(CODE);
  expect((await pinRoute({}, device)).status).toBe(404);
});
