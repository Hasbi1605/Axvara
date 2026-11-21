import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  sendPhoto: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  answerCallbackQuery: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  showLoadingBar: vi.fn(async () => {}),
  sendChatAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/whatsapp/gateway", () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "cron-budget-wa" })),
}));

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture();
  await insertTestProduct(fixture.sql, "manual", 1);
  const { calculateCrc16 } = await import("@/lib/payments/qris");
  vi.stubEnv("GOPAY_QRIS_ENABLED", "true");
  vi.stubEnv("GOPAY_POLLER_SECRET", "x");
  const qr = "00020101021126610014COM.GO-JEK.WWW01189360091431111111110210G1111111110303UMI53033605802ID6304";
  vi.stubEnv("GOPAY_STATIC_QRIS", qr + calculateCrc16(qr));
  vi.stubEnv("CRON_SECRET", "c");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in fixture"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function seedExpired(n: number, prefix: string) {
  const { createGopayQrisInvoice } = await import("@/lib/payments/qris");
  for (let i = 0; i < n; i++) {
    const code = `${prefix}-${i}`;
    fixture.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,expires_at)
      VALUES (?,?,?, ?,10000,'qris','pending','pending','web',datetime('now','+15 minutes'))`)
      .run(code, "X", "6280", JSON.stringify([{ product_id: 1, qty: 1 }]));
    await createGopayQrisInvoice(code, 10000);
    fixture.sql.prepare("UPDATE payment_transactions SET expires_at=datetime('now','-1 minute') WHERE order_code=?").run(code);
    // Invoice creation establishes the order window; expire the ORDER too.
    fixture.sql.prepare("UPDATE orders SET expires_at=datetime('now','-1 minute') WHERE code=?").run(code);
  }
}

async function run() {
  fixture.control.queries = 0;
  const { POST } = await import("@/app/api/cron/operations/route");
  const { NextRequest } = await import("next/server");
  const before = fixture.control.queries;
  const res = await POST(new NextRequest("http://localhost/api/cron/operations", {
    method: "POST", headers: { authorization: "Bearer c" },
  }));
  return { queries: fixture.control.queries - before, status: res.status, body: await res.json() };
}

// Paid plan: per-invocation runaway guard is 300 statements with EXPIRY_PER_RUN=30.
// Cron still bounds work across runs, marks deferred honestly when queue > cap,
// and drains without losing work or leaving wrong status.
describe("R12 cron fits the per-invocation query budget", () => {
  it("thirty-five expired orders drain in two runs (30 + 5), each under Paid budget", async () => {
    await seedExpired(35, "EXP");
    const r1 = await run();
    expect(r1.status).toBe(200);
    expect(r1.queries).toBeLessThanOrEqual(300);
    expect(r1.body.expired_payments).toBe(30);
    expect(r1.body.deferred).toContain("expiry");
    const r2 = await run();
    expect(r2.status).toBe(200);
    expect(r2.queries).toBeLessThanOrEqual(300);
    expect(r2.body.expired_payments).toBe(5);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE status='pending'").get()?.n).toBe(0);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders WHERE status='kadaluarsa'").get()?.n).toBe(35);
  });

  it("a 300-query Paid budget ceiling does not abort the run", async () => {
    await seedExpired(35, "LIM");
    fixture.control.limit = 300;
    const r1 = await run();
    expect(r1.status).toBe(200);
    expect(r1.body.error).toBeUndefined();
    const r2 = await run();
    expect(r2.status).toBe(200);
    fixture.control.limit = Infinity;
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE status='pending'").get()?.n).toBe(0);
  });

  it("mixed expiry + WA outbox + fulfillment drains across runs under budget", async () => {
    // Campuran: 4 expiry + 4 notifikasi WA + 1 fulfillment job.
    // RR3-01/03: AUTO_FULFILLMENT_ENABLED=true (pengiriman aktif — mematikan
    // auto-fulfillment dalam skenario pengiriman dilarang) dan gateway WA
    // sukses via mock, sehingga acceptance memeriksa STATUS AKHIR bisnis
    // (job delivered, WA sent) — bukan sekadar HTTP 200 / deferred.
    vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
    await seedExpired(4, "MIXE");
    const { enqueueWhatsAppMessage } = await import("@/lib/whatsapp/outbox");
    for (let i = 0; i < 4; i++) {
      await enqueueWhatsAppMessage(`mix-wa-${i}`, "628000000000", "DUMMY NOTICE");
    }
    fixture.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status)
      VALUES ('MIXF','X','6280',?,10000,'qris','lunas','paid','web','queued')`)
      .run(JSON.stringify([{ product_id: 1, variant_id: 1, name: "F", price: 10000, qty: 1 }]));
    fixture.sql.prepare(`INSERT INTO fulfillment_jobs(order_code,variant_id,sales_channel,status,attempt_count,next_attempt_at)
      VALUES('MIXF',1,'web','queued',0,datetime('now','-1 minute'))`).run();
    let runs = 0;
    let last: { queries: number; status: number; body: Record<string, unknown> } | null = null;
    for (let i = 0; i < 8; i++) {
      runs++;
      last = await run();
      expect(last.status).toBe(200);
      expect(last.queries).toBeLessThanOrEqual(300);
      expect(last.body.error).toBeUndefined();
      const pendingExpiry = Number(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE status='pending'").get()?.n ?? 0);
      const pendingWa = Number(fixture.sql.prepare("SELECT COUNT(*) n FROM whatsapp_outbox WHERE status IN ('pending','failed')").get()?.n ?? 0);
      const pendingJob = Number(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE status IN ('queued','retry')").get()?.n ?? 0);
      if (pendingExpiry === 0 && pendingWa === 0 && pendingJob === 0) break;
    }
    expect(Number(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE status='pending'").get()?.n ?? 0)).toBe(0);
    // WA sukses terkirim via mock (bukan dead/tertunda selamanya).
    expect(Number(fixture.sql.prepare("SELECT COUNT(*) n FROM whatsapp_outbox WHERE status='sent'").get()?.n ?? 0)).toBe(4);
    // Job fulfillment selesai delivered (web manual → manual_required adalah
    // status akhir yang sah untuk item manual).
    const jobStatus = String(fixture.sql.prepare("SELECT status FROM fulfillment_jobs WHERE order_code='MIXF'").get()?.status ?? "");
    expect(["delivered", "manual_required"]).toContain(jobStatus);
    expect(runs).toBeLessThanOrEqual(8);
    expect(Number(last?.body.query_budget_used ?? 999)).toBeLessThanOrEqual(300);
  });

  it("continuous expiry stream still gives other channels their turn (no starvation)", async () => {
    // Antrean expiry diisi ulang tiap run (simulasi kedatangan terus) —
    // kanal notify/fulfillment harus tetap dapat giliran via fase deferred.
    // RR3-01: auto-fulfillment AKTIF dan gateway WA sukses (mock di atas)
    // agar "kemajuan" berarti pekerjaan selesai, bukan sekadar deferred.
    vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
    await seedExpired(4, "STARVE-E");
    const { enqueueWhatsAppMessage } = await import("@/lib/whatsapp/outbox");
    await enqueueWhatsAppMessage("starve-wa-0", "628000000000", "DUMMY");
    const seenPhases = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const r = await run();
      expect(r.status).toBe(200);
      expect(r.queries).toBeLessThanOrEqual(300);
      if (Array.isArray(r.body.deferred)) {
        for (const d of r.body.deferred) seenPhases.add(String(d));
      }
      // Isi ulang expiry agar selalu ada (arus terus-menerus).
      await seedExpired(2, `STARVE-R${i}`);
      if (Number(r.body.whatsapp_outbox_sent) > 0 || Number(r.body.whatsapp_outbox_dead) > 0) break;
    }
    // WA mendapat giliran walau expiry tak pernah habis — atau deferred
    // mencatatnya jujur untuk run berikutnya.
    const waDone = fixture.sql.prepare("SELECT COUNT(*) n FROM whatsapp_outbox WHERE status IN ('sent','dead')").get()?.n as number;
    const waDeferred = seenPhases.has("notify");
    expect(waDone > 0 || waDeferred).toBe(true);
    // RR3: bila WA selesai, ia harus SENT (gateway sukses) — bukan dead.
    if (waDone > 0) {
      expect(Number(fixture.sql.prepare("SELECT COUNT(*) n FROM whatsapp_outbox WHERE status='sent'").get()?.n ?? 0)).toBeGreaterThan(0);
    }
  });

  it("no lost work and no false completion across mixed runs", async () => {
    await seedExpired(2, "LOSS");
    const { enqueueWhatsAppMessage } = await import("@/lib/whatsapp/outbox");
    await enqueueWhatsAppMessage("loss-wa-0", "628000000000", "DUMMY");
    for (let i = 0; i < 4; i++) {
      const r = await run();
      expect(r.status).toBe(200);
      expect(r.body.error).toBeUndefined();
    }
    // Semua expiry tuntas; WA dalam status yang jelas (bukan hilang).
    // RR3: gateway sukses via mock → WA harus SENT (bukan pending selamanya).
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE status='pending'").get()?.n).toBe(0);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM whatsapp_outbox").get()?.n).toBe(1);
    const waStatus = String(fixture.sql.prepare("SELECT status FROM whatsapp_outbox").get()?.status ?? "");
    expect(waStatus).toBe("sent");
  });
});
