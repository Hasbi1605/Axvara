import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { createBuyerAccessSession, deriveOrderAccessCode, verifyBuyerAccessSession } from "@/lib/order-access";
import { issueCredentialToken, verifyCredentialToken } from "@/lib/warung-rebahan/deliver";
import { createDatabaseAccess } from "@/lib/db-access";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";

const CODE = "AXV-20261028-FACTOR01", CONTACT = "buyer@example.test";
let fx: ReturnType<typeof createD1Fixture>, pin: string;
beforeEach(async () => {
  fx = createD1Fixture(); clearRateLimitBucketsForTest();
  vi.stubEnv("ADMIN_JWT_SECRET", "contact-pin-admin-fixture");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "contact-pin-buyer-fixture");
  vi.stubEnv("FULFILLMENT_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external traffic in fixtures"); }));
  await insertTestProduct(fx.sql); insertTestOrder(fx.sql, CODE, { status: "lunas", channel: "web" });
  fx.sql.prepare("UPDATE orders SET customer_email=?,buyer_access_version=1,buyer_access_format='pin6' WHERE code=?").run(CONTACT, CODE);
  const sealed = await (await import("@/lib/fulfillment/crypto")).encryptSecret("PRIVATE-ACCOUNT-FIXTURE");
  fx.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,delivered_ciphertext,delivered_iv)
    VALUES(?,0,1,1,1,'shared','web','delivered',?,?)`).run(CODE, sealed.ciphertext, sealed.iv);
  pin = await deriveOrderAccessCode(row());
});
afterEach(() => { fx.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const row = () => fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(CODE)!;
const ctx = () => ({ params: Promise.resolve({ code: CODE }) });
async function unlock(contact?: string, access?: string, session?: string) {
  const { POST } = await import("@/app/api/orders/[code]/credentials/route");
  return POST(new NextRequest(`https://axvara.test/api/orders/${CODE}/credentials`, { method: "POST", headers: { "content-type": "application/json", ...(session ? { "x-buyer-access-session": session } : {}) }, body: JSON.stringify({ contact, access_code: access }) }), ctx());
}

it.each(["PIN-only", "contact-only", "wrong-contact", "wrong-PIN", "status-session"])("%s never opens credentials or mints a usable capability", async scenario => {
  const response = await unlock(scenario === "PIN-only" ? undefined : scenario === "wrong-contact" ? "other@example.test" : CONTACT,
    ["contact-only", "status-session"].includes(scenario) ? undefined : scenario === "wrong-PIN" ? "AAAAA1" : pin,
    scenario === "status-session" ? await createBuyerAccessSession(row()) : undefined);
  expect(response.status).toBe(404);
  const text = await response.text(); expect(text).not.toContain("PRIVATE-ACCOUNT"); expect(text).not.toContain("capability_token");
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM wr_credential_tokens").get()?.n).toBe(0);
});

it.each([CONTACT.toUpperCase(), "08000000000"])("matching checkout contact %s plus PIN opens credentials and issues generation-bound capability", async contact => {
  // Fixture WA is 628000000000; its local form is 08000000000.
  const response = await unlock(contact, pin), body = await response.json();
  expect(response.status).toBe(200); expect(body.credentials[0].details).toBe("PRIVATE-ACCOUNT-FIXTURE");
  expect(await verifyCredentialToken(CODE, body.capability_token, createDatabaseAccess(fx.db))).toBe(true);
  expect(fx.sql.prepare("SELECT buyer_access_version FROM wr_credential_tokens").get()?.buyer_access_version).toBe(1);
  fx.sql.prepare("UPDATE orders SET buyer_access_version=2 WHERE code=?").run(CODE);
  expect(await verifyCredentialToken(CODE, body.capability_token, createDatabaseAccess(fx.db))).toBe(false);
});

it("pre-cutover PIN-only capabilities and old writers cannot bypass the corrected proof requirement", async () => {
  const db = createDatabaseAccess(fx.db), old = await issueCredentialToken(CODE, db);
  expect(old).toBeTruthy(); expect(await verifyCredentialToken(CODE, old!, db)).toBe(false);
  const accepted = await unlock(CONTACT, pin), body = await accepted.json();
  expect(accepted.status).toBe(200); expect(body.capability_token).toBeTruthy();
  expect(await verifyCredentialToken(CODE, body.capability_token, db)).toBe(true);
  fx.sql.prepare("UPDATE orders SET buyer_access_format='code26' WHERE code=?").run(CODE);
  expect(await verifyCredentialToken(CODE, old!, db)).toBe(true);
});

it("a rotation between proof and token insertion cannot create a valid old-proof capability", async () => {
  const db = createDatabaseAccess(fx.db);
  fx.sql.prepare("UPDATE orders SET buyer_access_version=2 WHERE code=?").run(CODE);
  expect(await issueCredentialToken(CODE, db, { buyerAccessVersion: 1 })).toBeNull();
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM wr_credential_tokens").get()?.n).toBe(0);
});

it("migration0083 preserves existing token metadata and marks prior tokens unverified by default", () => {
  fx.sql.exec("ALTER TABLE wr_credential_tokens DROP COLUMN buyer_access_version");
  fx.sql.prepare("INSERT INTO wr_credential_tokens(order_code,token_hash) VALUES(?,'fixture-old-hash')").run(CODE);
  fx.sql.exec(readFileSync("drizzle/migrations/0083_buyer_pin_contact_proof.sql", "utf8"));
  expect(fx.sql.prepare("SELECT token_hash,buyer_access_version FROM wr_credential_tokens").get()).toEqual({ token_hash: "fixture-old-hash", buyer_access_version: 0 });
});

it("not-ready products do not demand a PIN before the credentials email exists", async () => {
  fx.sql.prepare("DELETE FROM fulfillment_items WHERE order_code=?").run(CODE);
  const response = await unlock(CONTACT); expect(response.status).toBe(404); expect(await response.json()).toMatchObject({ error: "not_ready" });
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM order_contact_attempts").get()?.n).toBe(0);
});

it("status sessions reject the old b1 prefix and cannot cancel or reissue an unpaid order", async () => {
  fx.sql.prepare("UPDATE orders SET status='pending',payment_status='pending' WHERE code=?").run(CODE);
  const session = (await createBuyerAccessSession(row()))!;
  expect(await verifyBuyerAccessSession(session.replace(/^p1/, "b1"), row())).toBe(false);
  const headers = { "content-type": "application/json", "x-buyer-access-session": session };
  const { POST: cancel } = await import("@/app/api/orders/[code]/cancel/route");
  const denied = await cancel(new NextRequest(`https://axvara.test/api/orders/${CODE}/cancel`, { method: "POST", headers, body: JSON.stringify({ contact: "other@example.test" }) }), ctx());
  expect(denied.status).toBe(404); expect(row().status).toBe("pending");
  const { POST: reissue } = await import("@/app/api/payments/qris/[code]/reissue/route");
  expect((await reissue(new NextRequest(`https://axvara.test/api/payments/qris/${CODE}/reissue`, { method: "POST", headers, body: "{}" }), ctx())).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
