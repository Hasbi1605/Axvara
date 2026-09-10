import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createChannelOrderAtomic } from "@/lib/commerce";
import { calculateCrc16, createDanaQrisInvoice, reissueDanaQrisInvoice } from "@/lib/payments/dana-qris";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));
let fixture: ReturnType<typeof createD1Fixture>;
const A = "AXV-20260910-AAAAAAA1", B = "AXV-20260910-BBBBBBB2";
beforeEach(async () => {
  fixture = createD1Fixture(); stubFulfillmentKey();
  const qr = "00020101021153033605802ID6304";
  vi.stubEnv("DANA_QRIS_ENABLED", "true");
  vi.stubEnv("DANA_STATIC_QRIS", qr + calculateCrc16(qr));
  vi.stubEnv("DANA_WEBHOOK_SECRET", "fixture-secret");
  vi.stubEnv("CRON_SECRET", "fixture-secret");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
  await insertTestProduct(fixture.sql, "manual", 1);
});
afterEach(() => { fixture.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function checkout(code = A) {
  await createChannelOrderAtomic({
    orderCode: code, lines: [{ productId: 1, variantId: 1, qty: 1, fulfillmentMode: "manual", stock: 100 }],
    items: [{ product_id: 1, variant_id: 1, qty: 1, price: 10000, name: "Fixture" }],
    variantSnapshot: "{}", subtotal: 10000, primaryVariantId: 1, customerName: "Fixture", salesChannel: "web",
    paymentMethod: "qris", paymentAccount: "DANA Business", fulfillmentStatus: "not_required",
  });
  return createDanaQrisInvoice(code, 10000);
}
function expireInvoice(code = A) {
  fixture.sql.prepare("UPDATE payment_transactions SET expires_at=? WHERE order_code=?")
    .run(new Date(Date.now() - 60000).toISOString(), code);
}
const order = (code = A) => fixture.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
function chooseCode(code: number) {
  return vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    (array as Uint32Array)[0] = code - 1;
    return array;
  });
}
async function cron(route: "operations" | "publish-scheduled" = "operations") {
  const { POST } = route === "operations"
    ? await import("@/app/api/cron/operations/route") : await import("@/app/api/cron/publish-scheduled/route");
  const response = await POST(new NextRequest(`http://localhost/api/cron/${route}`, {
    method: "POST", headers: { authorization: "Bearer fixture-secret" },
  }));
  expect(response.status).toBe(200);
  return response.json();
}
async function webhook(amount: number, reference = `fixture-${amount}`) {
  const { POST } = await import("@/app/api/webhook/dana/route");
  return POST(new NextRequest("http://localhost/api/webhook/dana", {
    method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": "fixture-secret" },
    body: JSON.stringify({ payment: { amount, currency: "IDR", reference }, merchant: "DANA" }),
  }));
}
async function retry(eventId: number) {
  const { POST } = await import("@/app/api/admin/payments/events/route");
  return POST(new NextRequest("http://localhost/api/admin/payments/events", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ event_id: eventId, action: "retry_match" }),
  }));
}

describe("QRIS order lifetime across cron and renewal", () => {
  it("keeps order and stock reservation after QR expiry, then accepts renewed payment", async () => {
    const original = await checkout(); expireInvoice();
    await cron("publish-scheduled"); await cron();
    expect(order().status).toBe("pending");
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()!.stock).toBe(99);
    const renewed = await reissueDanaQrisInvoice(A);
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) throw new Error(renewed.reason);
    expect(renewed.invoice.payableAmount).not.toBe(original.payableAmount);
    expect((await webhook(renewed.invoice.payableAmount)).status).toBe(200);
    expect(order().status).toBe("lunas");
  });
  it("expires order and ledger together at the order deadline, restoring stock only once", async () => {
    await checkout();
    fixture.sql.prepare("UPDATE orders SET expires_at=? WHERE code=?").run(new Date(Date.now()-60000).toISOString(), A);
    // Even a legacy invoice whose deadline runs beyond the order must close.
    await cron(); await cron("publish-scheduled"); await cron();
    expect(order().status).toBe("kadaluarsa");
    expect(fixture.sql.prepare("SELECT status FROM payment_transactions WHERE order_code=?").get(A)!.status).toBe("expired");
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()!.stock).toBe(100);
  });
  it("caps a renewed QR at the remaining order lifetime", async () => {
    await checkout(); expireInvoice();
    const deadline = new Date(Date.now()+60000).toISOString();
    fixture.sql.prepare("UPDATE orders SET expires_at=? WHERE code=?").run(deadline, A);
    const result = await reissueDanaQrisInvoice(A);
    expect(result.ok).toBe(true);
    expect(result.ok && result.invoice.expiresAt).toBe(deadline);
  });
});

describe("QRIS amount history survives renewal", () => {
  it("does not allocate a superseded amount to a new order when unused amounts remain", async () => {
    const random = chooseCode(42); const old = await checkout(); expireInvoice();
    random.mockRestore(); chooseCode(100);
    expect((await reissueDanaQrisInvoice(A)).ok).toBe(true);
    vi.restoreAllMocks(); chooseCode(42);
    const next = await checkout(B);
    expect(next.payableAmount).not.toBe(old.payableAmount);
  });
  it("never automatically matches a delayed old payment to a different order, including admin retry", async () => {
    const random = chooseCode(42); const old = await checkout(); expireInvoice();
    random.mockRestore(); chooseCode(100);
    await reissueDanaQrisInvoice(A);
    await checkout(B);
    // Force the finite-pool reuse case: even when allocation must reuse an
    // amount, history must require actual bank verification, in both paths.
    fixture.sql.prepare("UPDATE payment_transactions SET payable_amount=? WHERE order_code=?").run(old.payableAmount, B);
    const response = await webhook(old.payableAmount, "delayed-for-A");
    expect(response.status).toBe(200);
    expect(order(B).status).toBe("pending");
    const event = fixture.sql.prepare("SELECT id,last_error FROM dana_webhook_events ORDER BY id DESC LIMIT 1").get()!;
    expect(event.last_error).toBe("amount_reused_requires_review");
    expect((await retry(Number(event.id))).status).toBe(409);
    expect(order(B).status).toBe("pending");
  });
  it("does not repeat a previous amount of the same order even with a repeating RNG", async () => {
    chooseCode(42); const old = await checkout(); expireInvoice();
    vi.restoreAllMocks(); chooseCode(42); const result = await reissueDanaQrisInvoice(A);
    expect(result.ok).toBe(true);
    expect(result.ok && result.invoice.payableAmount).not.toBe(old.payableAmount);
  });
  it("rejects an event observed before the renewed invoice was issued", async () => {
    await checkout(); expireInvoice();
    fixture.sql.prepare("UPDATE payment_transactions SET created_at=datetime('now','-30 minutes') WHERE order_code=?").run(A);
    chooseCode(100);
    // An earlier unrelated notification now happens to equal the next QR.
    fixture.sql.prepare("INSERT INTO dana_webhook_events(event_key,payload_hash,amount,status,created_at) VALUES('earlier','fixture',10100,'ignored',datetime('now','-5 minutes'))").run();
    const event = fixture.sql.prepare("SELECT id FROM dana_webhook_events WHERE event_key='earlier'").get()!;
    const result = await reissueDanaQrisInvoice(A);
    expect(result.ok && result.invoice.payableAmount).toBe(10100);
    expect((await retry(Number(event.id))).status).toBe(409);
    expect(order().status).toBe("pending");
  });
});

describe("QRIS mutation fencing", () => {
  it("commits only one concurrent renewal and records exactly one new issuance", async () => {
    await checkout(); expireInvoice();
    const results = await Promise.all([reissueDanaQrisInvoice(A), reissueDanaQrisInvoice(A)]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(order().qris_reissue_count).toBe(1);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_invoice_history WHERE order_code=?").get(A)!.n).toBe(2);
  });
  it("rolls history back together with invoice when the order update fails", async () => {
    const original = await checkout(); expireInvoice();
    fixture.control.fail = query => query.includes("qris_reissue_count=qris_reissue_count+1");
    await expect(reissueDanaQrisInvoice(A)).rejects.toThrow("Injected database interruption");
    fixture.control.fail = null;
    expect(order().qris_reissue_count).toBe(0);
    expect(fixture.sql.prepare("SELECT payable_amount FROM payment_transactions WHERE order_code=?").get(A)!.payable_amount).toBe(original.payableAmount);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_invoice_history WHERE order_code=?").get(A)!.n).toBe(1);
  });
  it("rechecks invoice expiry inside the renewal transaction", async () => {
    await checkout(); expireInvoice();
    const batch = fixture.db.batch.bind(fixture.db);
    vi.spyOn(fixture.db, "batch").mockImplementation(async statements => {
      fixture.sql.prepare("UPDATE payment_transactions SET expires_at=? WHERE order_code=?")
        .run(new Date(Date.now()+600000).toISOString(), A);
      return batch(statements);
    });
    expect(await reissueDanaQrisInvoice(A)).toEqual({ ok: false, reason: "order_not_reissuable" });
    expect(order().qris_reissue_count).toBe(0);
  });
  it("checks retained amount history again inside the atomic payment guard", async () => {
    const invoice = await checkout();
    fixture.sql.prepare("INSERT INTO payment_invoice_history(provider,order_code,payable_amount,issued_at) VALUES('dana','OLDER',?,datetime('now','-1 hour'))").run(invoice.payableAmount);
    fixture.sql.prepare("INSERT INTO dana_webhook_events(event_key,payload_hash,amount) VALUES('guard','fixture',?)").run(invoice.payableAmount);
    const event = fixture.sql.prepare("SELECT id FROM dana_webhook_events WHERE event_key='guard'").get()!;
    const { transitionPendingPaymentToPaid } = await import("@/lib/db");
    expect(await transitionPendingPaymentToPaid(A, null, null, { id: Number(event.id) })).toBe(false);
    expect(order().status).toBe("pending");
    expect(fixture.sql.prepare("SELECT status FROM dana_webhook_events WHERE id=?").get(event.id)!.status).toBe("received");
  });
});
