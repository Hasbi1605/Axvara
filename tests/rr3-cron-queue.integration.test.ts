import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  sendPhoto: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  answerCallbackQuery: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  showLoadingBar: vi.fn(async () => {}),
  sendChatAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/whatsapp/gateway", () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "dummy-wa" })),
}));

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  const { calculateCrc16 } = await import("@/lib/payments/dana-qris");
  vi.stubEnv("DANA_QRIS_ENABLED", "true");
  vi.stubEnv("DANA_WEBHOOK_SECRET", "x");
  const qr = "00020101021153033605802ID6304";
  vi.stubEnv("DANA_STATIC_QRIS", qr + calculateCrc16(qr));
  vi.stubEnv("CRON_SECRET", "c");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "dummy-no-network");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "999");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in fixture"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function cronRun(limit: number | null = null) {
  if (limit !== null) fixture.control.limit = limit;
  fixture.control.queries = 0;
  const { POST } = await import("@/app/api/cron/operations/route");
  const { NextRequest } = await import("next/server");
  const before = fixture.control.queries;
  const res = await POST(new NextRequest("http://localhost/api/cron/operations", {
    method: "POST", headers: { authorization: "Bearer c" },
  }));
  const out = { queries: fixture.control.queries - before, status: res.status, body: await res.json() as Record<string, unknown> };
  fixture.control.limit = Infinity;
  return out;
}

async function paidSharedOrder(code: string, n: number) {
  const hasProduct = fixture.sql.prepare("SELECT id FROM products WHERE id=1").get();
  if (!hasProduct) {
    await insertTestProduct(fixture.sql, "shared", n);
  } else {
    const { encryptSecret } = await import("@/lib/fulfillment/crypto");
    // Tambah varian hingga n (id 1..n) agar order multi-item valid.
    const have = Number(fixture.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE product_id=1").get()?.n ?? 0);
    for (let i = have + 1; i <= n; i++) {
      const secret = await encryptSecret(`RR3-SHARED-${code}-${i}`);
      fixture.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,shared_secret_ciphertext,shared_secret_iv) VALUES(?,1,?,?,10000,100,'shared',?,?)")
        .run(i, `SKU-${i}`, `Variant ${i}`, secret.ciphertext, secret.iv);
    }
  }
  const items = Array.from({ length: n }, (_, i) => ({
    product_id: 1, variant_id: i + 1, name: `Dummy ${i + 1}`, price: 10000, qty: 1,
  }));
  fixture.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
     sales_channel,telegram_chat_id,telegram_user_id,fulfillment_status,variant_id,variant_snapshot)
    VALUES (?,?,?, ?,?,?, 'lunas','paid','telegram','12345','12345','queued',1,?)`)
    .run(code, "Review", "628000000000", JSON.stringify(items), 10000 * n,
      JSON.stringify({ lines: items.map((it) => ({ variant_id: it.variant_id, fulfillment_mode: "shared" })) }));
  const { ensureFulfillmentItems, createFulfillmentJob } = await import("@/lib/fulfillment/deliver");
  const row = fixture.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
  await createFulfillmentJob(code, null, "shared", 1, "telegram");
  await ensureFulfillmentItems(row);
  fixture.sql.prepare("INSERT OR IGNORE INTO telegram_users(user_id,chat_id) VALUES('12345','12345')").run();
}

// ─── RR3-01: empat order dua item tidak boleh tertunda selamanya ───
describe("RR3-01 queue makes progress job by job", () => {
  it("four paid two-item orders all deliver within a small bounded number of cron runs", async () => {
    for (let i = 0; i < 4; i++) await paidSharedOrder(`RR301-${i}`, 2);
    const BOUND = 10; // dibenarkan: 8 item ÷ ≥1 job/run + fase bergiliran
    let runs = 0;
    for (; runs < BOUND; runs++) {
      const r = await cronRun();
      expect(r.status).toBe(200);
      expect(r.queries).toBeLessThan(50);
      const left = Number(fixture.sql.prepare(
        "SELECT COUNT(*) n FROM fulfillment_jobs WHERE status IN ('queued','retry')").get()?.n ?? 0);
      if (left === 0) break;
    }
    expect(Number(fixture.sql.prepare(
      "SELECT COUNT(*) n FROM fulfillment_jobs WHERE status IN ('queued','retry')").get()?.n ?? 0)).toBe(0);
    expect(Number(fixture.sql.prepare(
      "SELECT COUNT(*) n FROM fulfillment_jobs WHERE status='delivered'").get()?.n ?? 0)).toBe(4);
    expect(Number(fixture.sql.prepare(
      "SELECT COUNT(*) n FROM fulfillment_items WHERE status='delivered'").get()?.n ?? 0)).toBe(8);
  });

  it("a larger valid order still advances gradually instead of starving", async () => {
    for (let i = 0; i < 4; i++) await paidSharedOrder(`RR301B-${i}`, 2);
    await paidSharedOrder("RR301B-BIG", 4);
    const BOUND = 14;
    let processedTotal = 0;
    for (let i = 0; i < BOUND; i++) {
      const r = await cronRun();
      expect(r.status).toBe(200);
      processedTotal += Number(r.body.due_jobs_processed ?? 0);
      const left = Number(fixture.sql.prepare(
        "SELECT COUNT(*) n FROM fulfillment_jobs WHERE status IN ('queued','retry')").get()?.n ?? 0);
      if (left === 0) break;
    }
    expect(processedTotal).toBeGreaterThan(0);
    expect(Number(fixture.sql.prepare(
      "SELECT COUNT(*) n FROM fulfillment_jobs WHERE status IN ('queued','retry')").get()?.n ?? 0)).toBe(0);
  });
});

// ─── RR3-06: cron memulihkan sending basi walau tanpa pesan baru ───
describe("RR3-06 cron recovers an all-stale WA outbox", () => {
  it("one sending row with expired lease is recovered and sent via cron entrypoint", async () => {
    const { enqueueWhatsAppMessage } = await import("@/lib/whatsapp/outbox");
    await enqueueWhatsAppMessage("rr306-only", "628000000000", "DUMMY");
    fixture.sql.prepare(
      "UPDATE whatsapp_outbox SET status='sending', worker_id='dead', attempt_count=1, locked_until=datetime('now','-20 minutes')").run();
    const BOUND = 6;
    let sent = false;
    for (let i = 0; i < BOUND; i++) {
      const r = await cronRun();
      expect(r.status).toBe(200);
      if (String(fixture.sql.prepare("SELECT status FROM whatsapp_outbox").get()?.status) === "sent") { sent = true; break; }
    }
    expect(sent).toBe(true);
    expect(Number(fixture.sql.prepare("SELECT COUNT(*) n FROM whatsapp_outbox WHERE status='sent'").get()?.n ?? 0)).toBe(1);
  });

  it("does not steal an active lease", async () => {
    const { enqueueWhatsAppMessage } = await import("@/lib/whatsapp/outbox");
    await enqueueWhatsAppMessage("rr306-active", "628000000000", "DUMMY");
    fixture.sql.prepare(
      "UPDATE whatsapp_outbox SET status='sending', worker_id='alive', attempt_count=1, locked_until=datetime('now','+20 minutes')").run();
    await cronRun();
    // Lease aktif tak tersentuh: tetap sending milik worker alive.
    expect(fixture.sql.prepare("SELECT status, worker_id FROM whatsapp_outbox").get())
      .toMatchObject({ status: "sending", worker_id: "alive" });
  });
});

// ─── RR3-09: notifikasi paid buyer+admin terkirim walau created sudah sukses ───
describe("RR3-09 paid notifications are scheduled even when order-created already sent", () => {
  it("buyer and admin receive paid messages via the cron entrypoint", async () => {
    await insertTestProduct(fixture.sql, "manual", 1);
    const items = [{ product_id: 1, variant_id: 1, name: "Dummy", price: 10000, qty: 1 }];
    fixture.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
       sales_channel,telegram_chat_id,telegram_user_id,fulfillment_status,telegram_order_notified_at,variant_id,variant_snapshot)
      VALUES ('RR309-1','Buyer','628000000000',?,10000,'qris','lunas','paid','telegram','12345','12345','manual_required',datetime('now'),1,?)`)
      .run(JSON.stringify(items), JSON.stringify({ lines: [{ variant_id: 1, fulfillment_mode: "manual" }] }));
    fixture.sql.prepare("INSERT OR IGNORE INTO telegram_users(user_id,chat_id,first_name) VALUES('12345','12345','Dummy')").run();
    fixture.sql.prepare("INSERT INTO fulfillment_jobs(order_code,status) VALUES('RR309-1','manual_required')").run();
    fixture.sql.prepare(`INSERT INTO fulfillment_items
      (order_code,item_index,product_id,variant_id,fulfillment_mode,status) VALUES('RR309-1',0,1,1,'manual','manual_required')`).run();
    const { sendMessage } = await import("@/lib/telegram/api");
    vi.mocked(sendMessage).mockClear();
    const BOUND = 6;
    let buyer = false, admin = false;
    for (let i = 0; i < BOUND; i++) {
      await cronRun();
      const markers = fixture.sql.prepare(
        "SELECT telegram_paid_notified_at, telegram_paid_admin_notified_at FROM orders WHERE code='RR309-1'").get()!;
      buyer = buyer || markers.telegram_paid_notified_at != null;
      admin = admin || markers.telegram_paid_admin_notified_at != null;
      if (buyer && admin) break;
    }
    expect(buyer).toBe(true);
    expect(admin).toBe(true);
    expect(vi.mocked(sendMessage)).toHaveBeenCalled();
  });

  it("does not resend an already-recorded paid marker", async () => {
    await insertTestProduct(fixture.sql, "manual", 1);
    const items = [{ product_id: 1, variant_id: 1, name: "Dummy", price: 10000, qty: 1 }];
    fixture.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
       sales_channel,telegram_chat_id,telegram_user_id,fulfillment_status,
       telegram_order_notified_at,telegram_paid_notified_at,telegram_paid_admin_notified_at,variant_id,variant_snapshot)
      VALUES ('RR309-2','Buyer','628000000000',?,10000,'qris','lunas','paid','telegram','12345','12345','manual_required',
       datetime('now'),datetime('now'),datetime('now'),1,?)`)
      .run(JSON.stringify(items), JSON.stringify({ lines: [{ variant_id: 1, fulfillment_mode: "manual" }] }));
    const { sendMessage } = await import("@/lib/telegram/api");
    vi.mocked(sendMessage).mockClear();
    await cronRun();
    expect(vi.mocked(sendMessage)).not.toHaveBeenCalled();
  });
});

// ─── RR3-03: budget cron jujur di bawah 50 dengan margin ───
describe("RR3-03 cron stays under the platform query limit with measured accounting", () => {
  it("four-item unmaterialized order converges under the 50-query adapter without partial_failure", async () => {
    await paidSharedOrder("RR303-4ITEM", 4);
    // Hapus materialisasi agar cron harus materialisasi + kirim sendiri.
    fixture.sql.prepare("DELETE FROM fulfillment_items WHERE order_code='RR303-4ITEM'").run();
    const BOUND = 6;
    let ok = false;
    for (let i = 0; i < BOUND; i++) {
      const r = await cronRun(50);
      expect(r.body.error).toBeUndefined();
      expect(r.status).toBe(200);
      expect(r.queries).toBeLessThan(50);
      const o = String(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='RR303-4ITEM'").get()?.fulfillment_status);
      const j = String(fixture.sql.prepare("SELECT status FROM fulfillment_jobs WHERE order_code='RR303-4ITEM'").get()?.status);
      if (o === "delivered" && j === "delivered") { ok = true; break; }
    }
    expect(ok).toBe(true);
    expect(Number(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_items WHERE order_code='RR303-4ITEM' AND status='delivered'").get()?.n ?? 0)).toBe(4);
  });

  it("mixed expiry + WA + notify + orphan work drains without lost work", async () => {
    const { createDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
    const { enqueueWhatsAppMessage } = await import("@/lib/whatsapp/outbox");
    await insertTestProduct(fixture.sql, "shared", 2);
    for (let i = 0; i < 2; i++) {
      const code = `RR303-E${i}`;
      fixture.sql.prepare(`INSERT INTO orders
        (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,expires_at)
        VALUES (?,?,?, ?,10000,'qris','pending','pending','web',datetime('now','-2 minutes'))`)
        .run(code, "X", "6280", JSON.stringify([{ product_id: 1, qty: 1 }]));
      await createDanaQrisInvoice(code, 10000);
      fixture.sql.prepare("UPDATE payment_transactions SET expires_at=datetime('now','-1 minute') WHERE order_code=?").run(code);
      // Invoice creation establishes the order window; expire the ORDER too.
      fixture.sql.prepare("UPDATE orders SET expires_at=datetime('now','-1 minute') WHERE code=?").run(code);
    }
    await paidSharedOrder("RR303-F", 2);
    await enqueueWhatsAppMessage("rr303-wa", "628000000000", "DUMMY");
    const BOUND = 8;
    for (let i = 0; i < BOUND; i++) {
      const r = await cronRun(50);
      expect(r.status).toBe(200);
      expect(r.body.error).toBeUndefined();
      expect(r.queries).toBeLessThan(50);
    }
    expect(Number(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE status='pending'").get()?.n ?? 0)).toBe(0);
    expect(String(fixture.sql.prepare("SELECT status FROM fulfillment_jobs WHERE order_code='RR303-F'").get()?.status)).toBe("delivered");
    expect(String(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='RR303-F'").get()?.fulfillment_status)).toBe("delivered");
  });
});
