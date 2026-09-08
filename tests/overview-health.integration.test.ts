import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { NextRequest } from "next/server";

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fixture = createD1Fixture();
  process.env.ADMIN_EMAIL = "admin@axvara.tech";
  process.env.ADMIN_JWT_SECRET = "r11-secret-0123456789";
  process.env.ADMIN_PASSWORD_SHA256 = "a".repeat(64);
  process.env.DANA_QRIS_ENABLED = "true";
  process.env.DANA_WEBHOOK_SECRET = "x";
  process.env.DANA_STATIC_QRIS = "x";
  process.env.TELEGRAM_BOT_TOKEN = "x";
  process.env.TELEGRAM_BOT_ENABLED = "true";
  process.env.WHATSAPP_GATEWAY_URL = "https://wa.example";
  process.env.WHATSAPP_ENABLED = "true";
  process.env.FULFILLMENT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});
afterEach(() => { fixture.close(); });

async function overview() {
  const { createAdminToken, createIdleToken } = await import("@/lib/auth");
  const { token, sid } = await createAdminToken("admin@axvara.tech");
  const idle = await createIdleToken(sid);
  const { GET } = await import("@/app/api/admin/overview/route");
  const res = await GET(new NextRequest("http://localhost/api/admin/overview", {
    headers: { cookie: `axvara_admin_token=${token}; axvara_idle=${idle}` },
  }));
  const body = await res.json();
  if (res.status !== 200) throw new Error(`overview ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

// R11: sinyal health harus mencerminkan database aktual — matched terkini
// ikut dihitung, antrean macet tak tertutup kirim baru, kanal nonaktif jujur.
describe("R11 overview reflects the real database state", () => {
  it("recent matched event marks qris healthy, not silent null", async () => {
    fixture.sql.prepare(`INSERT INTO dana_webhook_events(event_key,payload_hash,amount,status,processed_at)
      VALUES('m1','h',10000,'matched',datetime('now'))`).run();
    const body = await overview();
    expect(body.system_details.qris.level).toBe("healthy");
  });

  it("failed event degrades qris even with a recent match", async () => {
    fixture.sql.prepare(`INSERT INTO dana_webhook_events(event_key,payload_hash,amount,status,processed_at)
      VALUES('m1','h',10000,'matched',datetime('now'))`).run();
    fixture.sql.prepare(`INSERT INTO dana_webhook_events(event_key,payload_hash,amount,status)
      VALUES('f1','h',20000,'failed')`).run();
    const body = await overview();
    expect(body.system_details.qris.level).toBe("degraded");
  });

  it("stuck item queue degrades fulfillment despite empty job queue", async () => {
    const body0 = await overview();
    expect(body0.system_details.fulfillment.level).toBe("healthy");
    fixture.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel)
      VALUES('STUCK','X','6280','[]',10000,'qris','lunas','paid','web')`).run();
    fixture.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,status,next_attempt_at)
      VALUES('STUCK',0,1,'retry',datetime('now','-3 hours'))`).run();
    const body = await overview();
    expect(body.system_details.fulfillment.level).toBe("degraded");
    expect(body.fulfillment_attention).toBeGreaterThan(0);
  });

  it("disabled channel reports unknown, not healthy", async () => {
    process.env.TELEGRAM_BOT_ENABLED = "false";
    const body = await overview();
    expect(body.system_details.telegram.level).toBe("unknown");
    expect(body.systems.telegram).toBe(false);
  });

  it("all settled: one delivered job+item counts zero attention", async () => {
    fixture.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status)
      VALUES('DONE','X','6280','[]',10000,'qris','lunas','paid','web','delivered')`).run();
    fixture.sql.prepare(`INSERT INTO fulfillment_jobs(order_code,status) VALUES('DONE','delivered')`).run();
    fixture.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,fulfillment_mode,status)
      VALUES('DONE',0,1,1,'shared','delivered')`).run();
    const body = await overview();
    // Unit hitung = order butuh tindakan: tidak ada → 0 (bukan 1+1=2,
    // bukan 1). Item delivered TIDAK dihitung sebagai perlu perhatian.
    expect(body.fulfillment_attention).toBe(0);
    expect(body.system_details.fulfillment.level).toBe("healthy");
  });

  it("manual_required order counts exactly one attention with breakdown", async () => {
    fixture.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status)
      VALUES('NEED','X','6280','[]',10000,'qris','lunas','paid','web','manual_required')`).run();
    fixture.sql.prepare(`INSERT INTO fulfillment_jobs(order_code,status) VALUES('NEED','manual_required')`).run();
    fixture.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,fulfillment_mode,status)
      VALUES('NEED',0,1,1,'manual','manual_required'),('NEED',1,1,2,'manual','manual_required')`).run();
    const body = await overview();
    // Satu order butuh tindakan → 1 (bukan 1 job + 2 item = 3).
    expect(body.fulfillment_attention).toBe(1);
    expect(body.fulfillment_attention_by_status?.manual_required).toBe(2);
    expect(body.system_details.fulfillment.level).toBe("degraded");
  });

  it("failed item counts attention and degrades health", async () => {
    fixture.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status)
      VALUES('FAIL','X','6280','[]',10000,'qris','lunas','paid','web','failed')`).run();
    fixture.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,fulfillment_mode,status)
      VALUES('FAIL',0,1,1,'shared','failed')`).run();
    const body = await overview();
    expect(body.fulfillment_attention).toBe(1);
    expect(body.system_details.fulfillment.level).toBe("degraded");
  });

  it("stale queued channel degrades telegram even after a recent success", async () => {
    // Kirim sukses baru + antrean job macet 3 jam: verdict antrean menang.
    fixture.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,telegram_paid_notified_at)
      VALUES('TG','X','6280','[]',10000,'qris','lunas','paid','telegram',datetime('now'))`).run();
    fixture.sql.prepare(`INSERT INTO fulfillment_jobs(order_code,status,next_attempt_at)
      VALUES('TG','queued',datetime('now','-3 hours'))`).run();
    const body = await overview();
    expect(body.system_details.telegram.level).toBe("degraded");
  });
});
