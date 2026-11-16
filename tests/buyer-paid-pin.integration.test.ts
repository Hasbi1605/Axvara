import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { createBuyerAccessSession, createCheckoutCredentialGrant, deriveOrderAccessCode } from "@/lib/order-access";
import { issueCredentialToken } from "@/lib/warung-rebahan/deliver";
import { createDatabaseAccess } from "@/lib/db-access";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { POST } from "@/app/api/orders/[code]/pin/route";

const CODE = "AXV-20261116-PAIDPIN1";
let fx: ReturnType<typeof createD1Fixture>;
const row = () => fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(CODE)!;
async function capability() {
  fx.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,delivered_ciphertext)
    VALUES(?,0,1,1,1,'shared','web','delivered','fixture-encrypted')`).run(CODE);
  const token = await issueCredentialToken(CODE, createDatabaseAccess(fx.db), { buyerAccessVersion: 1 });
  expect(token).toBeTruthy(); return token!;
}
const reveal = (headers: Record<string, string> = {}, body = "{}", code = CODE) => POST(new NextRequest(`https://axvara.test/api/orders/${code}/pin`, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body,
}), { params: Promise.resolve({ code }) });
beforeEach(async () => {
  fx = createD1Fixture(); clearRateLimitBucketsForTest();
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "paid-pin-fixture-secret");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external traffic"); }));
  await insertTestProduct(fx.sql); insertTestOrder(fx.sql, CODE, { status: "lunas", channel: "web" });
  fx.sql.prepare("UPDATE orders SET quote_id='checkout-quote',buyer_access_version=1,buyer_access_format='pin6' WHERE code=?").run(CODE);
});
afterEach(() => { fx.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("reveals the existing PIN after payment even with no credentials, without minting another capability", async () => {
  const response = await reveal({ "x-checkout-credential-grant": (await createCheckoutCredentialGrant(row()))! });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ pin: await deriveOrderAccessCode(row()) });
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM wr_credential_tokens").get()?.n).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["missing", "contact", "status", "wrong-order", "wrong-quote", "expiry", "signature", "version", "format"])("rejects %s proof without exposing a PIN", async changed => {
  const original = row(); let grant = (await createCheckoutCredentialGrant(original))!;
  if (changed === "wrong-order") grant = (await createCheckoutCredentialGrant({ ...original, code: "AXV-20261116-PAIDPIN2" }))!;
  if (changed === "wrong-quote") grant = (await createCheckoutCredentialGrant({ ...original, quote_id: "other" }))!;
  if (changed === "expiry") grant = (await createCheckoutCredentialGrant(original, Date.now() - 86401_000))!;
  if (changed === "signature") grant = grant.slice(0, -1) + (grant.endsWith("A") ? "B" : "A");
  if (changed === "version") fx.sql.prepare("UPDATE orders SET buyer_access_version=2 WHERE code=?").run(CODE);
  if (changed === "format") fx.sql.prepare("UPDATE orders SET buyer_access_format='code26' WHERE code=?").run(CODE);
  const headers: Record<string, string> = ["missing", "contact"].includes(changed) ? {} : changed === "status" ? { "x-buyer-access-session": (await createBuyerAccessSession(original))! } : { "x-checkout-credential-grant": grant };
  const response = await reveal(headers, JSON.stringify({ contact: "buyer@example.test" }));
  expect(response.status).toBe(404); expect(await response.text()).not.toContain('"pin"');
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it.each(["pending", "cancelled", "expired", "unconfirmed"])("does not reveal for %s payment", async status => {
  const grant = (await createCheckoutCredentialGrant(row()))!;
  fx.sql.prepare("UPDATE orders SET status=?,payment_status='pending' WHERE code=?").run(status === "unconfirmed" ? "lunas" : status, CODE);
  expect((await reveal({ "x-checkout-credential-grant": grant })).status).toBe(403);
});
it.each(["valid", "revoked", "expired", "old-generation", "wrong-order"])("checks %s credential capability", async state => {
  const token = await capability();
  if (state === "revoked") fx.sql.prepare("UPDATE wr_credential_tokens SET revoked=1").run();
  if (state === "expired") fx.sql.prepare("UPDATE wr_credential_tokens SET expires_at=datetime('now','-1 day')").run();
  if (state === "old-generation") fx.sql.prepare("UPDATE orders SET buyer_access_version=2 WHERE code=?").run(CODE);
  if (state === "wrong-order") {
    insertTestOrder(fx.sql, "AXV-20261116-PAIDPIN2", { status: "lunas", channel: "web" });
    fx.sql.prepare("UPDATE wr_credential_tokens SET order_code='AXV-20261116-PAIDPIN2'").run();
  }
  const response = await reveal({ "x-credential-token": token });
  expect(response.status).toBe(state === "valid" ? 200 : 404);
});
it("fails closed when the buyer secret is unavailable", async () => {
  const grant = (await createCheckoutCredentialGrant(row()))!;
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "");
  expect((await reveal({ "x-checkout-credential-grant": grant })).status).toBe(503);
});
it.each(["version", "payment", "quote", "revoke"])("rechecks a concurrent %s change before disclosure", async changed => {
  const token = await capability();
  const headers: Record<string, string> = changed === "revoke" ? { "x-credential-token": token } : { "x-checkout-credential-grant": (await createCheckoutCredentialGrant(row()))! };
  const original = crypto.subtle.sign.bind(crypto.subtle); let calls = 0;
  vi.spyOn(crypto.subtle, "sign").mockImplementation(async (...args) => {
    const result = await original(...args);
    if (++calls === (changed === "revoke" ? 1 : 3)) {
      const sql = changed === "version" ? "UPDATE orders SET buyer_access_version=2" : changed === "payment" ? "UPDATE orders SET payment_status='pending'"
        : changed === "quote" ? "UPDATE orders SET quote_id='replacement'" : "UPDATE wr_credential_tokens SET revoked=1";
      fx.sql.exec(sql);
    }
    return result;
  });
  const response = await reveal(headers);
  expect(response.status).toBe(409); expect(await response.text()).not.toContain('"pin"');
});
