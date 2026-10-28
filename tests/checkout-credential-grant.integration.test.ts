import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { createBuyerAccessSession, createCheckoutCredentialGrant, verifyCheckoutCredentialGrant } from "@/lib/order-access";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { verifyCredentialToken } from "@/lib/warung-rebahan/deliver";
import { createDatabaseAccess } from "@/lib/db-access";

const CODE = "AXV-20261028-AUTO0001", QUOTE = "original-checkout-quote";
let fx: ReturnType<typeof createD1Fixture>;
const row = () => fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(CODE)!;
beforeEach(async () => {
  fx = createD1Fixture(); clearRateLimitBucketsForTest();
  vi.stubEnv("ADMIN_JWT_SECRET", "checkout-grant-admin-fixture");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "checkout-grant-buyer-fixture");
  vi.stubEnv("FULFILLMENT_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Fixture blocks external traffic"); }));
  await insertTestProduct(fx.sql); insertTestOrder(fx.sql, CODE, { status: "lunas", channel: "web" });
  fx.sql.prepare("UPDATE orders SET quote_id=?,buyer_access_version=1,buyer_access_format='pin6' WHERE code=?").run(QUOTE, CODE);
  const sealed = await (await import("@/lib/fulfillment/crypto")).encryptSecret("CHECKOUT-ONLY-ACCOUNT");
  fx.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,delivered_ciphertext,delivered_iv)
    VALUES(?,0,1,1,1,'shared','web','delivered',?,?)`).run(CODE, sealed.ciphertext, sealed.iv);
});
afterEach(() => { fx.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function unlock(grant: string) {
  return (await import("@/app/api/orders/[code]/credentials/route")).POST(new NextRequest(`https://axvara.test/api/orders/${CODE}/credentials`, {
    method: "POST", headers: { "content-type": "application/json", "x-checkout-credential-grant": grant }, body: "{}",
  }), { params: Promise.resolve({ code: CODE }) });
}

it("the original checkout grant opens paid ready accounts without a PIN and issues a current-generation capability", async () => {
  const grant = (await createCheckoutCredentialGrant(row()))!;
  expect(grant).toMatch(/^c1\.\d{10}\.[A-Za-z0-9_-]{43}$/);
  const response = await unlock(grant), body = await response.json();
  expect(response.status).toBe(200); expect(body.credentials[0].details).toBe("CHECKOUT-ONLY-ACCOUNT");
  expect(await verifyCredentialToken(CODE, body.capability_token, createDatabaseAccess(fx.db))).toBe(true);
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM order_contact_attempts").get()?.n).toBe(0);
});

it.each(["order", "quote", "version", "format", "expiry", "signature", "status-session"])("a different %s cannot use the original checkout grant", async changed => {
  const original = row(); let grant = (await createCheckoutCredentialGrant(original))!;
  if (changed === "order") grant = (await createCheckoutCredentialGrant({ ...original, code: "AXV-20261028-AUTO0002" }))!;
  if (changed === "quote") grant = (await createCheckoutCredentialGrant({ ...original, quote_id: "new-quote-for-identical-cart" }))!;
  if (changed === "version") fx.sql.prepare("UPDATE orders SET buyer_access_version=2 WHERE code=?").run(CODE);
  if (changed === "format") fx.sql.prepare("UPDATE orders SET buyer_access_format='code26' WHERE code=?").run(CODE);
  if (changed === "expiry") grant = (await createCheckoutCredentialGrant(original, Date.now() - 86401_000))!;
  if (changed === "signature") grant = grant.slice(0, -1) + (grant.endsWith("A") ? "B" : "A");
  if (changed === "status-session") grant = (await createBuyerAccessSession(original))!;
  const response = await unlock(grant); expect(response.status).toBe(404);
  expect(await response.text()).not.toContain("CHECKOUT-ONLY-ACCOUNT");
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM wr_credential_tokens").get()?.n).toBe(0);
});

it("the grant cannot bypass paid or readiness checks", async () => {
  const grant = (await createCheckoutCredentialGrant(row()))!;
  fx.sql.prepare("UPDATE orders SET status='pending',payment_status='pending' WHERE code=?").run(CODE);
  expect((await unlock(grant)).status).toBe(403);
  fx.sql.prepare("UPDATE orders SET status='lunas',payment_status='paid' WHERE code=?").run(CODE);
  fx.sql.prepare("DELETE FROM fulfillment_items WHERE order_code=?").run(CODE);
  expect(await (await unlock(grant)).json()).toMatchObject({ error: "not_ready" });
});

it("missing quote metadata or buyer secret cannot authorize checkout credentials", async () => {
  const original = row(), grant = (await createCheckoutCredentialGrant(original))!;
  expect(await verifyCheckoutCredentialGrant(grant, { ...original, quote_id: undefined })).toBe(false);
  fx.sql.prepare("UPDATE orders SET quote_id=NULL WHERE code=?").run(CODE);
  expect((await unlock(grant)).status).toBe(404);
  fx.sql.prepare("UPDATE orders SET quote_id=? WHERE code=?").run(QUOTE, CODE);
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "");
  expect((await unlock(grant)).status).toBe(503);
});

it("PIN guessing lockout cannot block the original checkout or be cleared by its grant", async () => {
  const db = createDatabaseAccess(fx.db), { admitBuyerPin } = await import("@/lib/orders/pin-attempts");
  for (let i=0;i<10;i++) expect((await admitBuyerPin(db,CODE,1)).allowed).toBe(true);
  expect((await admitBuyerPin(db,CODE,1)).allowed).toBe(false);
  expect((await unlock((await createCheckoutCredentialGrant(row()))!)).status).toBe(200);
  expect((await admitBuyerPin(db,CODE,1)).allowed).toBe(false);
});

it("checkout credential proof cannot authorize status or unpaid mutations", async () => {
  const grant=(await createCheckoutCredentialGrant(row()))!;
  fx.sql.prepare("UPDATE orders SET status='pending',payment_status='pending' WHERE code=?").run(CODE);
  const headers={"content-type":"application/json","x-checkout-credential-grant":grant};
  const req=(path:string,body?:unknown)=>new NextRequest(`https://axvara.test${path}`,{headers,...(body?{method:"POST",body:JSON.stringify(body)}:{})});
  const context={params:Promise.resolve({code:CODE})};
  expect((await (await import("@/app/api/orders/route")).GET(req(`/api/orders?code=${CODE}`))).status).toBe(404);
  expect((await (await import("@/app/api/orders/[code]/cancel/route")).POST(req(`/api/orders/${CODE}/cancel`,{contact:"other@example.test"}),context)).status).toBe(404);
  expect((await (await import("@/app/api/payments/qris/[code]/reissue/route")).POST(req(`/api/payments/qris/${CODE}/reissue`,{}),context)).status).toBe(404);
  expect(row().status).toBe("pending"); expect(fetch).not.toHaveBeenCalled();
});
