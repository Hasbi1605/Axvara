import { gopaySettlement, seedLegacyDanaInvoice } from "./helpers/qris-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { calculateCrc16, createGopayQrisInvoice } from "@/lib/payments/qris";
import { createAdminToken, createIdleToken } from "@/lib/auth";
import { POST as webhook } from "@/app/api/webhook/gopay/route";
import { GET as events, POST as retry } from "@/app/api/admin/payments/events/route";

vi.mock("@/lib/telegram/api", () => ({ sendMessage: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/whatsapp/gateway", () => ({ sendTextMessage: vi.fn(async () => ({ ok: true })) }));
let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  await insertTestProduct(fixture.sql);
  vi.stubEnv("GOPAY_QRIS_ENABLED", "true");
  vi.stubEnv("GOPAY_POLLER_SECRET", "fixture-secret");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "7".repeat(64));
  const qr = "00020101021126610014COM.GO-JEK.WWW01189360091431111111110210G1111111110303UMI53033605802ID6304";
  vi.stubEnv("GOPAY_STATIC_QRIS", qr + calculateCrc16(qr));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in fixture"); }));
});
afterEach(() => { fixture.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function invoice(code: string, payableAmount?: number) {
  insertTestOrder(fixture.sql, code);
  return seedLegacyDanaInvoice(fixture.sql, code, 10000, payableAmount);
}
async function goInvoice(code: string) {
  insertTestOrder(fixture.sql, code);
  return createGopayQrisInvoice(code, 10000);
}
function notify(code: string, amount: number) {
  return webhook(gopaySettlement(code, amount, "notification"));
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
    expect(body.health.providers).not.toHaveProperty("dana");
    const history = await (await listEvents()).json();
    expect(history.events).toEqual(expect.arrayContaining([expect.objectContaining({ provider: "dana" })]));
    expect(body.health.providers.gopay.last_event_at).toBe("2026-10-15 10:00:00");
    expect(body.last_event_at).toBe("2026-10-15 10:00:00");
    expect(body.counts).toMatchObject({ matched: 1, ignored: 1 });
    expect(JSON.stringify(body)).not.toMatch(/private-|fixture-secret/);
  });

  it("reports incomplete GoPay without silently falling back to a different merchant", async () => {
    vi.stubEnv("QRIS_ACTIVE_PROVIDER", "gopay");
    vi.stubEnv("GOPAY_QRIS_ENABLED", "true");
    vi.stubEnv("GOPAY_STATIC_QRIS", "payload");
    vi.stubEnv("GOPAY_POLLER_SECRET", " ");
    fixture.sql.exec("INSERT INTO dana_webhook_events(event_key,payload_hash,amount) VALUES('legacy','hash',10000)");
    const body = await (await listEvents()).json();
    expect(body.health).toMatchObject({ provider: "gopay", enabled: true, payload_configured: true, webhook_configured: false, secret_header: "X-Poller-Secret" });
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
    const old = await goInvoice("AXV-20260910-OLDER001");
    fixture.sql.exec("UPDATE payment_transactions SET status='expired'; UPDATE orders SET status='kadaluarsa',payment_status='expired'");
    await goInvoice("AXV-20260910-NEWER001");
    fixture.sql.prepare("UPDATE payment_transactions SET payable_amount=? WHERE order_code='AXV-20260910-NEWER001'").run(old.payableAmount);
    await notify("AXV-20260910-NEWER001", old.payableAmount);
    expect(state("AXV-20260910-NEWER001")).toBe("pending");
    expect(fixture.sql.prepare("SELECT last_error FROM dana_webhook_events").get()?.last_error).toBe("amount_reused_requires_review");
    expect((await retryEvent(1)).status).toBe(409);
  });
  it("settles a normal payment once under concurrent delivery and replay", async () => {
    const inv = await goInvoice("AXV-20260910-NORMAL11");
    await Promise.all([notify(inv.orderCode, inv.payableAmount), notify(inv.orderCode, inv.payableAmount)]);
    await notify(inv.orderCode, inv.payableAmount);
    expect(state("AXV-20260910-NORMAL11")).toBe("lunas");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT status,order_code FROM dana_webhook_events").get()).toMatchObject({ status: "matched", order_code: "AXV-20260910-NORMAL11" });
  });
  it("rolls payment and job back when the event claim cannot be persisted", async () => {
    const inv = await goInvoice("AXV-20260910-INTERRUP");
    fixture.control.fail = q => /UPDATE dana_webhook_events/.test(q) && q.includes("status='matched'");
    await notify(inv.orderCode, inv.payableAmount).catch(() => undefined);
    expect(state("AXV-20260910-INTERRUP")).toBe("pending");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
  });
  it("requires explicit verified reconciliation and records the administrator", async () => {
    const old = await goInvoice("AXV-20260910-OLDER001");
    fixture.sql.exec("UPDATE payment_transactions SET status='expired'; UPDATE orders SET status='kadaluarsa',payment_status='expired'");
    await goInvoice("AXV-20260910-REVIEWED");
    fixture.sql.prepare("UPDATE payment_transactions SET payable_amount=? WHERE order_code='AXV-20260910-REVIEWED'").run(old.payableAmount);
    await notify("AXV-20260910-REVIEWED", old.payableAmount);
    const approval = { action: "confirm_match", order_code: "AXV-20260910-REVIEWED", review_note: "Mutasi dan referensi transaksi telah diperiksa." };
    expect((await retryEvent(1, approval)).status).toBe(400);
    expect(state("AXV-20260910-REVIEWED")).toBe("pending");
    expect((await retryEvent(1, { ...approval, verified: true })).status).toBe(200);
    expect(state("AXV-20260910-REVIEWED")).toBe("lunas");
    expect(fixture.sql.prepare("SELECT reviewed_by,review_note FROM dana_webhook_events").get())
      .toMatchObject({ reviewed_by: "admin@axvara.tech", review_note: approval.review_note });
  });
  it("cannot reuse an already matched event to approve another order", async () => {
    const first = await goInvoice("AXV-20260910-FIRST111");
    await notify(first.orderCode, first.payableAmount);
    await goInvoice("AXV-20260910-SECOND11");
    fixture.sql.prepare("UPDATE payment_transactions SET payable_amount=? WHERE order_code='AXV-20260910-SECOND11'").run(first.payableAmount);
    await retryEvent(1, { action: "confirm_match", order_code: "AXV-20260910-SECOND11", review_note: "Another attempted reconciliation", verified: true });
    expect(state("AXV-20260910-SECOND11")).toBe("pending");
    expect(fixture.sql.prepare("SELECT order_code FROM dana_webhook_events").get()?.order_code).toBe("AXV-20260910-FIRST111");
  });
  it("webhook and administrator retry race to one event/payment/job commit", async () => {
    const inv = await goInvoice("AXV-20260910-RACE1111");
    fixture.sql.prepare("INSERT INTO dana_webhook_events(event_key,payload_hash,amount,provider) VALUES('gopay:notification','dummy',?,'gopay')").run(inv.payableAmount);
    await Promise.all([notify(inv.orderCode, inv.payableAmount), retryEvent(1)]);
    expect(state("AXV-20260910-RACE1111")).toBe("lunas");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT status FROM dana_webhook_events").get()?.status).toBe("matched");
  });
});

describe("terminal reconciliation review races", () => {
  async function pendingEvent() {
    const inv = await invoice("TERMINAL");
    fixture.sql.prepare("INSERT INTO dana_webhook_events(event_key,payload_hash,amount,status) VALUES('terminal','hash',?,'ignored')").run(inv.payableAmount);
    return Number(fixture.sql.prepare("SELECT id FROM dana_webhook_events WHERE event_key='terminal'").get()!.id);
  }
  const row = (id: number) => fixture.sql.prepare("SELECT * FROM dana_webhook_events WHERE id=?").get(id);
  const mark = (id: number, note = "Mutasi diperiksa, tidak ada pembayaran.") => retryEvent(id, { action: "mark_reviewed", note });
  const manual = { action: "confirm_match", order_code: "TERMINAL", verified: true, review_note: "Mutasi telah diverifikasi untuk invoice ini." };

  it.each(["retry_match", "confirm_match"])("review wins after %s pre-read but before atomic payment claim", async action => {
    const id = await pendingEvent();
    const orderBefore = fixture.sql.prepare("SELECT * FROM orders").get();
    const ledgerBefore = fixture.sql.prepare("SELECT * FROM payment_transactions").get();
    const batch = fixture.db.batch.bind(fixture.db);
    let reviewed: Record<string, unknown> | undefined;
    vi.spyOn(fixture.db, "batch").mockImplementationOnce(async statements => {
      expect((await mark(id)).status).toBe(200);
      reviewed = row(id);
      return batch(statements);
    });
    const response = await retryEvent(id, action === "confirm_match" ? manual : {});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "event_reviewed" });
    expect(row(id)).toEqual(reviewed);
    expect(fixture.sql.prepare("SELECT * FROM orders").get()).toEqual(orderBefore);
    expect(fixture.sql.prepare("SELECT * FROM payment_transactions").get()).toEqual(ledgerBefore);
    expect(fixture.sql.prepare("SELECT count(*) n FROM fulfillment_jobs").get()!.n).toBe(0);
    expect((await (await listEvents("?status=attention")).json()).attention).toBe(0);
  });

  it.each([false, true])("matched wins before mark CAS, with manual audit=%s", async confirmed => {
    const id = await pendingEvent();
    fixture.control.beforeRun = async query => {
      if (!query.includes("SET status='ignored', reviewed_by=")) return;
      fixture.control.beforeRun = null;
      expect((await retryEvent(id, confirmed ? manual : {})).status).toBe(200);
    };
    const response = await mark(id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "event_not_actionable" });
    expect(state("TERMINAL")).toBe("lunas");
    expect(row(id)).toMatchObject({ status: "matched", reviewed_by: confirmed ? "admin@axvara.tech" : null, review_note: confirmed ? manual.review_note : null });
    expect((await mark(id)).status).toBe(409);
    expect(fixture.sql.prepare("SELECT count(*) n FROM fulfillment_jobs").get()!.n).toBe(1);
  });

  it("a concurrent genuine repeat preserves the first reviewer note", async () => {
    const id = await pendingEvent();
    fixture.control.beforeRun = async query => {
      if (!query.includes("SET status='ignored', reviewed_by=")) return;
      fixture.control.beforeRun = null;
      expect((await mark(id, "First terminal review note")).status).toBe(200);
    };
    const response = await mark(id, "Second review must not overwrite");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "already_reviewed" });
    expect(row(id)).toMatchObject({ status: "ignored", review_note: "First terminal review note" });
    expect(state("TERMINAL")).toBe("pending");
  });

  it.each(["no_active_exact_amount", "amount_reused_requires_review", "payment_transition_failed"])("late %s failure cannot rewrite terminal review audit", async reason => {
    const id = await pendingEvent();
    if (reason === "no_active_exact_amount") fixture.sql.exec("UPDATE payment_transactions SET payable_amount=payable_amount+1");
    if (reason === "amount_reused_requires_review") {
      const inv = await invoice("HISTORY", 10043);
      fixture.sql.prepare("UPDATE payment_transactions SET status='expired',payable_amount=(SELECT payable_amount FROM payment_transactions WHERE order_code='TERMINAL') WHERE order_code='HISTORY'").run();
      expect(inv.payableAmount).toBeGreaterThan(0);
    }
    if (reason === "payment_transition_failed") vi.spyOn(fixture.db, "batch").mockRejectedValueOnce(new Error("operation_guards CHECK constraint"));
    let reviewed: Record<string, unknown> | undefined;
    fixture.control.beforeRun = async query => {
      if (!query.includes("UPDATE dana_webhook_events") || !query.includes("last_error=")) return;
      fixture.control.beforeRun = null;
      expect((await mark(id)).status).toBe(200);
      reviewed = row(id);
    };
    expect((await retryEvent(id)).status).toBe(409);
    expect(reviewed).toBeDefined();
    expect(row(id)).toEqual(reviewed);
    expect((await (await listEvents("?status=attention")).json()).attention).toBe(0);
    expect(state("TERMINAL")).toBe("pending");
  });

  it.each(["sekalipay_gateway", "nowpayments", "unknown", ""])("rejects nonlegacy provider %s instead of paying a same-amount DANA invoice", async provider => {
    const id = await pendingEvent();
    fixture.sql.prepare("UPDATE dana_webhook_events SET provider=? WHERE id=?").run(provider, id);
    const before = row(id);
    for (const extra of [{}, manual]) {
      const response = await retryEvent(id, extra);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: "provider_requires_manual_review" });
      expect(row(id)).toEqual(before);
      expect(state("TERMINAL")).toBe("pending");
      expect(fixture.sql.prepare("SELECT status FROM payment_transactions").get()!.status).toBe("pending");
      expect(fixture.sql.prepare("SELECT count(*) n FROM fulfillment_jobs").get()!.n).toBe(0);
    }
  });

  it.each(["dana", "gopay"])("unreviewed %s retry still pays once", async provider => {
    const id = await pendingEvent();
    fixture.sql.prepare("UPDATE dana_webhook_events SET provider=? WHERE id=?").run(provider, id);
    fixture.sql.prepare("UPDATE payment_transactions SET provider=?").run(provider);
    expect((await retryEvent(id)).status).toBe(200);
    expect((await retryEvent(id)).status).toBe(200);
    expect(state("TERMINAL")).toBe("lunas");
    expect(fixture.sql.prepare("SELECT status FROM payment_transactions").get()!.status).toBe("paid");
    expect(fixture.sql.prepare("SELECT count(*) n FROM fulfillment_jobs").get()!.n).toBe(1);
  });

  it("keeps null-provider legacy events bound to DANA", async () => {
    // Current schema forbids NULL; model an older nullable-provider database.
    const schema = String(fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE name='dana_webhook_events'").get()!.sql);
    fixture.sql.exec("DROP TABLE dana_webhook_events");
    fixture.sql.exec(schema.replace("provider TEXT NOT NULL", "provider TEXT"));
    const id = await pendingEvent();
    fixture.sql.prepare("UPDATE dana_webhook_events SET provider=NULL WHERE id=?").run(id);
    expect((await retryEvent(id)).status).toBe(200);
    expect(state("TERMINAL")).toBe("lunas");
    expect(row(id)).toMatchObject({ provider: null, status: "matched", reviewed_by: null });
  });
});
