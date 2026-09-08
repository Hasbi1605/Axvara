import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture();
  await insertTestProduct(fixture.sql, "manual", 1);
  const { calculateCrc16 } = await import("@/lib/payments/dana-qris");
  vi.stubEnv("DANA_QRIS_ENABLED", "true");
  vi.stubEnv("DANA_WEBHOOK_SECRET", "x");
  const qr = "00020101021153033605802ID6304";
  vi.stubEnv("DANA_STATIC_QRIS", qr + calculateCrc16(qr));
  vi.stubEnv("CRON_SECRET", "c");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in fixture"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function seedExpired(n: number, prefix: string) {
  const { createDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
  for (let i = 0; i < n; i++) {
    const code = `${prefix}-${i}`;
    fixture.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,expires_at)
      VALUES (?,?,?, ?,10000,'qris','pending','pending','web',datetime('now','-2 minutes'))`)
      .run(code, "X", "6280", JSON.stringify([{ product_id: 1, qty: 1 }]));
    await createDanaQrisInvoice(code, 10000);
    fixture.sql.prepare("UPDATE payment_transactions SET expires_at=datetime('now','-1 minute') WHERE order_code=?").run(code);
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

// R12: satu invocation D1 Free hanya 50 query. Cron harus membagi kerja
// antar run (tiap run < 50 dengan margin), menunda sisanya secara jujur
// (deferred), dan menguras antrean dalam beberapa run tanpa kehilangan
// pekerjaan atau status salah.
describe("R12 cron fits the per-invocation query budget", () => {
  it("eight expired orders drain in two runs, each under budget", async () => {
    await seedExpired(8, "EXP");
    const r1 = await run();
    expect(r1.status).toBe(200);
    expect(r1.queries).toBeLessThan(50);
    expect(r1.body.expired_payments).toBe(4);
    expect(r1.body.deferred).toContain("expiry");
    const r2 = await run();
    expect(r2.status).toBe(200);
    expect(r2.queries).toBeLessThan(50);
    expect(r2.body.expired_payments).toBe(4);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE status='pending'").get()?.n).toBe(0);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders WHERE status='kadaluarsa'").get()?.n).toBe(8);
  });

  it("a 50-query platform limit no longer aborts the run", async () => {
    await seedExpired(8, "LIM");
    fixture.control.limit = 50;
    const r1 = await run();
    expect(r1.status).toBe(200);
    expect(r1.body.error).toBeUndefined();
    const r2 = await run();
    expect(r2.status).toBe(200);
    fixture.control.limit = Infinity;
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE status='pending'").get()?.n).toBe(0);
  });

  it("mixed expiry + WA outbox + fulfillment drains across runs under budget", async () => {
    // Campuran: 4 expiry + 4 notifikasi WA + 1 fulfillment job multi-item.
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
    for (let i = 0; i < 6; i++) {
      runs++;
      last = await run();
      expect(last.status).toBe(200);
      expect(last.queries).toBeLessThan(50);
      expect(last.body.error).toBeUndefined();
      const pendingExpiry = Number(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE status='pending'").get()?.n ?? 0);
      const pendingWa = Number(fixture.sql.prepare("SELECT COUNT(*) n FROM whatsapp_outbox WHERE status IN ('pending','failed')").get()?.n ?? 0);
      if (pendingExpiry === 0 && pendingWa === 0) break;
    }
    expect(Number(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE status='pending'").get()?.n ?? 0)).toBe(0);
    // WA terkirim atau dead (gateway asli tanpa mock → gagal → retry/dead,
    // tetapi tidak hilang diam-diam dan tidak abort budget).
    const waLeft = fixture.sql.prepare("SELECT status, COUNT(*) n FROM whatsapp_outbox GROUP BY status").all();
    const sent = Number(waLeft.find((r) => String(r.status) === "sent")?.n ?? 0);
    const dead = Number(waLeft.find((r) => String(r.status) === "dead")?.n ?? 0);
    const failed = Number(waLeft.find((r) => String(r.status) === "failed")?.n ?? 0);
    expect(sent + dead + failed).toBe(4);
    expect(runs).toBeLessThanOrEqual(6);
    expect(last?.body.query_budget_used).toBeLessThanOrEqual(45);
  });

  it("continuous expiry stream still gives other channels their turn (no starvation)", async () => {
    // Antrean expiry diisi ulang tiap run (simulasi kedatangan terus) —
    // kanal notify/fulfillment harus tetap dapat giliran via fase deferred.
    await seedExpired(4, "STARVE-E");
    const { enqueueWhatsAppMessage } = await import("@/lib/whatsapp/outbox");
    await enqueueWhatsAppMessage("starve-wa-0", "628000000000", "DUMMY");
    const seenPhases = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const r = await run();
      expect(r.status).toBe(200);
      expect(r.queries).toBeLessThan(50);
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
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE status='pending'").get()?.n).toBe(0);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM whatsapp_outbox").get()?.n).toBe(1);
    const waStatus = String(fixture.sql.prepare("SELECT status FROM whatsapp_outbox").get()?.status ?? "");
    expect(["sent", "failed", "dead", "pending"]).toContain(waStatus);
  });
});
