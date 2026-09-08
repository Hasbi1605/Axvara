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
});
