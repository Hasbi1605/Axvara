import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { calculateCrc16, createDanaQrisInvoice } from "@/lib/payments/dana-qris";
import { createAdminToken, createIdleToken } from "@/lib/auth";
import { POST as webhook } from "@/app/api/webhook/dana/route";
import { GET as events, POST as retry } from "@/app/api/admin/payments/events/route";

vi.mock("@/lib/telegram/api", () => ({ sendMessage: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/whatsapp/gateway", () => ({ sendTextMessage: vi.fn(async () => ({ ok: true })) }));
let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  await insertTestProduct(fixture.sql);
  vi.stubEnv("DANA_QRIS_ENABLED", "true");
  vi.stubEnv("DANA_WEBHOOK_SECRET", "fixture-secret");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "7".repeat(64));
  const qr = "00020101021153033605802ID6304";
  vi.stubEnv("DANA_STATIC_QRIS", qr + calculateCrc16(qr));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in fixture"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function invoice(code: string) {
  insertTestOrder(fixture.sql, code);
  return createDanaQrisInvoice(code, 10000);
}
function notify(amount: number, event = "notification") {
  return webhook(new NextRequest("http://localhost/api/webhook/dana", {
    method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": "fixture-secret" },
    body: JSON.stringify({ event_id: event, amount }),
  }));
}
async function retryEvent(id: number, extra: Record<string, unknown> = {}) {
  const session = await createAdminToken("admin@axvara.tech");
  const idle = await createIdleToken(session.sid);
  return retry(new NextRequest("http://localhost/api/admin/payments/events", {
    method: "POST", headers: { "content-type": "application/json", cookie: `axvara_admin_token=${session.token}; axvara_idle=${idle}` },
    body: JSON.stringify({ action: "retry_match", event_id: id, ...extra }),
  }));
}
const state = (code: string) => fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status;

async function listEvents(query = "") {
  const session = await createAdminToken("admin@axvara.tech");
  const idle = await createIdleToken(session.sid);
  return events(new NextRequest(`http://localhost/api/admin/payments/events${query}`, {
    headers: { cookie: `axvara_admin_token=${session.token}; axvara_idle=${idle}` },
  }));
}

describe("provider-aware reconciliation health", () => {
  it("requires admin authentication", async () => {
    expect((await events(new NextRequest("http://localhost/api/admin/payments/events"))).status).toBe(401);
  });

  it("exposes effective GoPay configuration and per-provider event times without secrets", async () => {
    vi.stubEnv("QRIS_ACTIVE_PROVIDER", "gopay");
    vi.stubEnv("GOPAY_QRIS_ENABLED", "true");
    vi.stubEnv("GOPAY_STATIC_QRIS", "private-gopay-payload");
    vi.stubEnv("GOPAY_POLLER_SECRET", "private-poller-secret");
    fixture.sql.exec(`INSERT INTO dana_webhook_events(event_key,payload_hash,amount,provider,created_at,status) VALUES
      ('dana-old','private-hash',10000,'dana','2026-10-14 10:00:00','matched'),
      ('gopay-new','private-hash',10100,'gopay','2026-10-15 10:00:00','ignored')`);
    const response = await listEvents("?status=attention");
    const body = await response.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ provider: "gopay", amount: 10100 });
    expect(body.health).toMatchObject({ provider: "gopay", enabled: true, payload_configured: true, webhook_configured: true, secret_header: "X-Poller-Secret", webhook_url: "https://axvara.tech/api/webhook/gopay" });
    expect(body.health.providers.dana.last_event_at).toBe("2026-10-14 10:00:00");
    expect(body.health.providers.gopay.last_event_at).toBe("2026-10-15 10:00:00");
    expect(body.last_event_at).toBe("2026-10-15 10:00:00");
    expect(body.counts).toMatchObject({ matched: 1, ignored: 1 });
    expect(JSON.stringify(body)).not.toMatch(/private-|fixture-secret/);
  });

  it("uses the helper's DANA fallback when requested GoPay is incomplete", async () => {
    vi.stubEnv("QRIS_ACTIVE_PROVIDER", "gopay");
    vi.stubEnv("GOPAY_QRIS_ENABLED", "true");
    vi.stubEnv("GOPAY_STATIC_QRIS", "payload");
    vi.stubEnv("GOPAY_POLLER_SECRET", " ");
    fixture.sql.exec("INSERT INTO dana_webhook_events(event_key,payload_hash,amount) VALUES('legacy','hash',10000)");
    const body = await (await listEvents()).json();
    expect(body.health).toMatchObject({ provider: "dana", enabled: true, payload_configured: true, webhook_configured: true, secret_header: "X-Webhook-Secret" });
    expect(body.health.providers.gopay.webhook_configured).toBe(false);
    expect(body.events[0].provider).toBe("dana");
  });

  it("keeps retry bound to the event provider, not the active rail", async () => {
    const inv = await invoice("DANA-ONLY");
    fixture.sql.prepare("INSERT INTO dana_webhook_events(event_key,payload_hash,amount,provider,status) VALUES('gopay','hash',?,'gopay','ignored')").run(inv.payableAmount);
    expect((await retryEvent(1)).status).toBe(409);
    expect(state("DANA-ONLY")).toBe("pending");
  });
});

describe("R1 payment handlers preserve invoice/event identity", () => {
  it("does not accept an event observed 30 seconds before the invoice", async () => {
    const inv = await invoice("NEW");
    fixture.sql.prepare(`INSERT INTO dana_webhook_events(event_key,payload_hash,amount,status,created_at)
      VALUES('early','dummy',?,'ignored',datetime('now','-30 seconds'))`).run(inv.payableAmount);
    expect((await retryEvent(1)).status).toBe(409);
    expect(state("NEW")).toBe("pending");
  });
  it("does not settle a reused amount from a delayed old notification", async () => {
    const old = await invoice("OLD");
    fixture.sql.exec("UPDATE payment_transactions SET status='expired'; UPDATE orders SET status='kadaluarsa',payment_status='expired'");
    await invoice("NEW");
    fixture.sql.prepare("UPDATE payment_transactions SET payable_amount=? WHERE order_code='NEW'").run(old.payableAmount);
    await notify(old.payableAmount);
    expect(state("NEW")).toBe("pending");
    expect(fixture.sql.prepare("SELECT last_error FROM dana_webhook_events").get()?.last_error).toBe("amount_reused_requires_review");
    expect((await retryEvent(1)).status).toBe(409);
  });
  it("settles a normal payment once under concurrent delivery and replay", async () => {
    const inv = await invoice("NORMAL");
    await Promise.all([notify(inv.payableAmount), notify(inv.payableAmount)]);
    await notify(inv.payableAmount);
    expect(state("NORMAL")).toBe("lunas");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT status,order_code FROM dana_webhook_events").get()).toMatchObject({ status: "matched", order_code: "NORMAL" });
  });
  it("rolls payment and job back when the event claim cannot be persisted", async () => {
    const inv = await invoice("INTERRUPTED");
    fixture.control.fail = q => /UPDATE dana_webhook_events/.test(q) && q.includes("status='matched'");
    await notify(inv.payableAmount).catch(() => undefined);
    expect(state("INTERRUPTED")).toBe("pending");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
  });
  it("requires explicit verified reconciliation and records the administrator", async () => {
    const old = await invoice("OLD");
    fixture.sql.exec("UPDATE payment_transactions SET status='expired'; UPDATE orders SET status='kadaluarsa',payment_status='expired'");
    await invoice("REVIEWED");
    fixture.sql.prepare("UPDATE payment_transactions SET payable_amount=? WHERE order_code='REVIEWED'").run(old.payableAmount);
    await notify(old.payableAmount);
    const approval = { action: "confirm_match", order_code: "REVIEWED", review_note: "Mutasi dan referensi transaksi telah diperiksa." };
    expect((await retryEvent(1, approval)).status).toBe(400);
    expect(state("REVIEWED")).toBe("pending");
    expect((await retryEvent(1, { ...approval, verified: true })).status).toBe(200);
    expect(state("REVIEWED")).toBe("lunas");
    expect(fixture.sql.prepare("SELECT reviewed_by,review_note FROM dana_webhook_events").get())
      .toMatchObject({ reviewed_by: "admin@axvara.tech", review_note: approval.review_note });
  });
  it("cannot reuse an already matched event to approve another order", async () => {
    const first = await invoice("FIRST");
    await notify(first.payableAmount);
    await invoice("SECOND");
    fixture.sql.prepare("UPDATE payment_transactions SET payable_amount=? WHERE order_code='SECOND'").run(first.payableAmount);
    await retryEvent(1, { action: "confirm_match", order_code: "SECOND", review_note: "Another attempted reconciliation", verified: true });
    expect(state("SECOND")).toBe("pending");
    expect(fixture.sql.prepare("SELECT order_code FROM dana_webhook_events").get()?.order_code).toBe("FIRST");
  });
  it("webhook and administrator retry race to one event/payment/job commit", async () => {
    const inv = await invoice("RACE");
    fixture.sql.prepare("INSERT INTO dana_webhook_events(event_key,payload_hash,amount) VALUES('hook:notification','dummy',?)").run(inv.payableAmount);
    await Promise.all([notify(inv.payableAmount), retryEvent(1)]);
    expect(state("RACE")).toBe("lunas");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT status FROM dana_webhook_events").get()?.status).toBe("matched");
  });
});
