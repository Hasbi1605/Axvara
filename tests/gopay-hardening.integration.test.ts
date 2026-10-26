import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { calculateCrc16, createActiveQrisInvoice, createGopayQrisInvoice, reissueDanaQrisInvoice } from "@/lib/payments/dana-qris";
import { POST } from "@/app/api/webhook/gopay/route";

const mocks = vi.hoisted(() => ({ fulfill: vi.fn(async () => undefined) }));
vi.mock("@/lib/payments/paid-fulfillment", () => ({ schedulePaidFulfillment: mocks.fulfill }));
vi.mock("@/lib/payments/gopay-wake", () => ({ scheduleGopayWake: vi.fn() }));
const A = "AXV-20261027-AAAAAAA1", B = "AXV-20261027-BBBBBBB2";
const merchant = "G111111111", secret = "fixture-poller-secret";
const source = "00020101021126610014COM.GO-JEK.WWW01189360091431111111110210G1111111110303UMI53033605802ID6304";
let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture(); stubFulfillmentKey(); await insertTestProduct(fixture.sql);
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "gopay"); vi.stubEnv("GOPAY_QRIS_ENABLED", "true");
  vi.stubEnv("GOPAY_STATIC_QRIS", source + calculateCrc16(source)); vi.stubEnv("GOPAY_POLLER_SECRET", secret);
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", ""); mocks.fulfill.mockClear();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network forbidden"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function invoice(code = A) { insertTestOrder(fixture.sql, code, { channel: "web" }); return createActiveQrisInvoice(code, 10_000); }
function body(amount: number, override: Record<string, unknown> = {}) {
  return JSON.stringify({ amount, order_code: A, event_id: "gopay-poller:fixture-transaction", payment: { id: "fixture-transaction" },
    merchant_id: merchant, currency: "IDR", transaction_status: "settlement", paid_at: new Date().toISOString(), ...override });
}
async function hook(raw: string, signature = createHmac("sha256", secret).update(raw).digest("hex")) {
  return POST(new NextRequest("https://axvara.test/api/webhook/gopay", { method: "POST", body: raw,
    headers: { "content-type": "application/json", "x-poller-secret": secret, "x-poller-signature": signature } }));
}
const order = (code = A) => fixture.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;

describe("GoPay invoice reuse", () => {
  it("concurrent creates retain one invoice, amount and issuance without network generation", async () => {
    insertTestOrder(fixture.sql, A);
    const invoices = await Promise.all(Array.from({ length: 6 }, () => createGopayQrisInvoice(A, 10_000)));
    expect(new Set(invoices.map(i => i.qrisPayload)).size).toBe(1);
    expect(invoices.filter(i => !i.isExisting)).toHaveLength(1);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_invoice_history WHERE order_code=?").get(A)!.n).toBe(1);
    expect(order().payment_account).toBe("GoPay Merchant"); expect(fetch).not.toHaveBeenCalled();
    expect(fixture.sql.prepare("SELECT merchant_id FROM payment_transactions WHERE order_code=?").get(A)!.merchant_id).toBe(merchant);
  });
  it("rejects missing configuration and a non-GoPay QR before creating any invoice", async () => {
    insertTestOrder(fixture.sql, A); vi.stubEnv("GOPAY_POLLER_SECRET", "");
    await expect(createActiveQrisInvoice(A, 10_000)).rejects.toThrow("dana_qris_not_configured");
    vi.stubEnv("GOPAY_POLLER_SECRET", secret);
    const dana = "00020101021153033605802ID6304"; vi.stubEnv("GOPAY_STATIC_QRIS", dana + calculateCrc16(dana));
    await expect(createActiveQrisInvoice(A, 10_000)).rejects.toThrow("gopay_invalid_merchant_qris");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()!.n).toBe(0);
  });
  it("retains GoPay after a rail switch and rejects a changed amount on retry", async () => {
    const original = await invoice(); vi.stubEnv("QRIS_ACTIVE_PROVIDER", "klikqris");
    expect((await createActiveQrisInvoice(A, 10_000)).qrisPayload).toBe(original.qrisPayload);
    await expect(createActiveQrisInvoice(A, 20_000)).rejects.toThrow("qris_invoice_amount_mismatch");
  });
  it("cannot replace a live QR and permits only one replacement after expiry", async () => {
    await invoice();
    expect(await reissueDanaQrisInvoice(A)).toEqual({ ok: false, reason: "invoice_still_active" });
    vi.stubEnv("DANA_QRIS_ENABLED", "true"); vi.stubEnv("DANA_STATIC_QRIS", source + calculateCrc16(source)); vi.stubEnv("DANA_WEBHOOK_SECRET", secret);
    fixture.sql.prepare("UPDATE payment_transactions SET expires_at=datetime('now','-1 minute') WHERE order_code=?").run(A);
    expect((await reissueDanaQrisInvoice(A)).ok).toBe(true);
    fixture.sql.prepare("UPDATE payment_transactions SET expires_at=datetime('now','-1 minute') WHERE order_code=?").run(A);
    expect(await reissueDanaQrisInvoice(A)).toEqual({ ok: false, reason: "reissue_limit_reached" });
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_invoice_history WHERE order_code=?").get(A)!.n).toBe(2);
  });
});

describe("GoPay signed settlement evidence", () => {
  it("verifies raw bytes, rejecting missing signatures and body tampering before recording events", async () => {
    const inv = await invoice(); const raw = body(inv.payableAmount);
    expect((await hook(raw, "")).status).toBe(401);
    const signature = createHmac("sha256", secret).update(raw).digest("hex");
    expect((await hook(raw + " ", signature)).status).toBe(401);
    expect(order().payment_status).toBe("pending");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM dana_webhook_events").get()!.n).toBe(0);
  });
  it.each([
    { transaction_status: "pending" }, { transaction_status: "" }, { currency: "USD" },
    { paid_at: "invalid" }, { paid_at: "2026-10-27 10:00:00" }, { paid_at: "2099-01-01T00:00:00Z" },
    { merchant_id: null }, { order_code: "" }, { event_id: "" },
  ])("rejects incomplete or unpaid evidence %j", async override => {
    const inv = await invoice(); expect((await hook(body(inv.payableAmount, override))).status).toBe(400);
    expect(order().payment_status).toBe("pending"); expect(mocks.fulfill).not.toHaveBeenCalled();
  });
  it.each([
    { merchant_id: "G222222222" }, { order_code: B },
    { paid_at: new Date(Date.now() - 3_600_000).toISOString() },
  ])("never redirects a mismatched or old transaction to another live order %j", async override => {
    const inv = await invoice(); const response = await hook(body(inv.payableAmount, override));
    expect(await response.json()).toEqual({ ok: true, status: "unmatched" });
    expect(order().payment_status).toBe("pending"); expect(mocks.fulfill).not.toHaveBeenCalled();
  });
  it("commits a matching settlement once with the source paid time and schedules fulfillment once", async () => {
    const inv = await invoice(); const paidAt = new Date(Date.now() - 1000).toISOString();
    const raw = body(inv.payableAmount, { paid_at: paidAt });
    expect(await (await hook(raw)).json()).toEqual({ ok: true, status: "paid" });
    expect(order().payment_status).toBe("paid"); expect(order().paid_at).toBe(paidAt);
    expect(mocks.fulfill).toHaveBeenCalledWith(A, "apps");
    expect(await (await hook(raw)).json()).toEqual({ ok: true, status: "duplicate" });
    expect(mocks.fulfill).toHaveBeenCalledTimes(1);
  });
});
