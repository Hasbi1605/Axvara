import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";

vi.mock("@/lib/telegram/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/telegram/api")>(),
  getMe: vi.fn(async () => ({ ok: true, result: { id: 17 } })),
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  sendPhoto: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  answerCallbackQuery: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  showLoadingBar: vi.fn(async () => {}),
  sendChatAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/whatsapp/gateway", () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "wa-admin-notif" })),
}));

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  await insertTestProduct(fixture.sql, "manual", 1);
  const { calculateCrc16 } = await import("@/lib/payments/dana-qris");
  vi.stubEnv("DANA_QRIS_ENABLED", "true");
  vi.stubEnv("DANA_WEBHOOK_SECRET", "x");
  const qr = "00020101021153033605802ID6304";
  vi.stubEnv("DANA_STATIC_QRIS", qr + calculateCrc16(qr));
  vi.stubEnv("CRON_SECRET", "c");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "dummy-no-network");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "999");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in fixture"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function seedWhatsAppOrder(code: string, status: "pending" | "lunas") {
  const items = [{ product_id: 1, variant_id: 1, name: "Fixture", price: 10000, qty: 1 }];
  const paid = status === "lunas";
  fixture.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
     sales_channel,channel_conversation_id,channel_member_id,fulfillment_status,variant_id,variant_snapshot)
    VALUES (?,?,?, ?,10000,'qris',?,?,'whatsapp','120363@g.us','628111',?,1,?)`)
    .run(code, "628111", "628111", JSON.stringify(items), status, paid ? "paid" : "pending",
      paid ? "manual_required" : "not_required",
      JSON.stringify({ product_name: "Fixture", label: "Variant 1", fulfillment_mode: "manual" }));
}

async function cronRun() {
  fixture.control.queries = 0;
  const { POST } = await import("@/app/api/cron/operations/route");
  const { NextRequest } = await import("next/server");
  const res = await POST(new NextRequest("http://localhost/api/cron/operations", {
    method: "POST", headers: { authorization: "Bearer c" },
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

// Order WA wajib masuk grup Telegram admin — judul WA, bukan judul Telegram,
// memakai marker idempoten yang sama agar redelivery/cron tidak ganda.
describe("WhatsApp orders notify the Telegram admin group", () => {
  it("formats paid admin message for WhatsApp", async () => {
    const { adminWhatsAppOrderPaidMessage } = await import("@/lib/telegram/messages");
    const paid = adminWhatsAppOrderPaidMessage({
      orderCode: "AXV-1", productNames: "Fixture ×1", amount: 10000,
      customerName: "628111", channelMember: "628111", paymentMethod: "qris",
    });
    expect(paid).toContain("Pembayaran diterima — WhatsApp");
    expect(paid).toContain("AXV-1");
  });

  it("order-created WhatsApp notice has no live path (owner 2026-10-10)", async () => {
    seedWhatsAppOrder("WA-CREATED", "pending");
    const { sendMessage } = await import("@/lib/telegram/api");
    vi.mocked(sendMessage).mockClear();
    const BOUND = 8;
    for (let i = 0; i < BOUND; i++) {
      const r = await cronRun();
      expect(r.status).toBe(200);
    }
    const texts = vi.mocked(sendMessage).mock.calls.map((c) => String(((c[0] as unknown) as Record<string, unknown>)?.text || ""));
    expect(texts.some((t) => t.includes("Order Baru — WhatsApp"))).toBe(false);
    expect(fixture.sql.prepare("SELECT telegram_order_notified_at FROM orders WHERE code='WA-CREATED'").get()
      ?.telegram_order_notified_at).toBeNull();
  });

  it("cron TIDAK mengirim Order Baru — hanya Lunas yang masuk grup (owner 2026-10-10, paritas Web)", async () => {
    seedWhatsAppOrder("WA-CRON", "pending");
    const { sendMessage } = await import("@/lib/telegram/api");
    vi.mocked(sendMessage).mockClear();
    const BOUND = 8;
    for (let i = 0; i < BOUND; i++) {
      const r = await cronRun();
      expect(r.status).toBe(200);
    }
    // Order pending TANPA lunas = tidak ada pesan Order Baru ke grup.
    const texts = vi.mocked(sendMessage).mock.calls.map((c) => String(((c[0] as unknown) as Record<string, unknown>)?.text || ""));
    expect(texts.some((t) => t.includes("Order Baru — WhatsApp") && t.includes("WA-CRON"))).toBe(false);
  });

  it("announces a paid WhatsApp order to the admin group via cron, then stays quiet", async () => {
    seedWhatsAppOrder("WA-PAID", "lunas");
    // created sudah terkirim agar cron hanya mengerjakan paid-admin.
    fixture.sql.prepare("UPDATE orders SET telegram_order_notified_at=datetime('now') WHERE code='WA-PAID'").run();
    const { sendMessage } = await import("@/lib/telegram/api");
    vi.mocked(sendMessage).mockClear();
    const BOUND = 8;
    let marked = false;
    for (let i = 0; i < BOUND; i++) {
      const r = await cronRun();
      expect(r.status).toBe(200);
      if (fixture.sql.prepare("SELECT telegram_paid_admin_notified_at FROM orders WHERE code='WA-PAID'").get()
        ?.telegram_paid_admin_notified_at != null) { marked = true; break; }
    }
    expect(marked).toBe(true);
    const texts = vi.mocked(sendMessage).mock.calls.map((c) => String(((c[0] as unknown) as Record<string, unknown>)?.text || ""));
    expect(texts.some((t) => t.includes("Pembayaran diterima — WhatsApp") && t.includes("WA-PAID"))).toBe(true);
    vi.mocked(sendMessage).mockClear();
    await cronRun();
    expect(vi.mocked(sendMessage)).not.toHaveBeenCalled();
  });

  it("timeout kirim notif Lunas → unknown, tidak diulang dalam 30 menit", async () => {
    seedWhatsAppOrder("WA-TO", "lunas");
    fixture.sql.prepare("UPDATE orders SET telegram_order_notified_at=datetime('now') WHERE code='WA-TO'").run();
    const { sendMessage } = await import("@/lib/telegram/api");
    const { createDatabaseAccess } = await import("@/lib/db-access");
    const { retryPendingTelegramNotifications } = await import("@/lib/telegram/order-notifications");
    const { operationQueueProbeSql } = await import("@/lib/cron-queues");
    const db = createDatabaseAccess(fixture.db);
    vi.mocked(sendMessage).mockClear();
    vi.mocked(sendMessage).mockResolvedValueOnce({ ok: false, description: "Request timeout" } as never);
    expect((await retryPendingTelegramNotifications(50, { paidAdmin: true }, db)).paidAdmin).toBe(0);
    expect(fixture.sql.prepare("SELECT status,error FROM buyer_notice_log WHERE idempotency_key='admin-paid:WA-TO'").get())
      .toMatchObject({ status: "unknown", error: "ambiguous" });
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);

    // Antrean dan retry sama-sama diam, termasuk lewat cooldown lama.
    const probe = operationQueueProbeSql("notify", "0", "0")!;
    expect(fixture.sql.prepare(probe).get()?.paid_admin).toBe(0);
    expect((await retryPendingTelegramNotifications(50, { paidAdmin: true }, db)).paidAdmin).toBe(0);
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);

    fixture.sql.prepare("UPDATE buyer_notice_log SET updated_at=datetime('now','-21 minutes') WHERE idempotency_key='admin-paid:WA-TO'").run();
    expect(fixture.sql.prepare(probe).get()?.paid_admin).toBe(0);
    expect((await retryPendingTelegramNotifications(50, { paidAdmin: true }, db)).paidAdmin).toBe(0);
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);
    expect(fixture.sql.prepare("SELECT telegram_paid_admin_notified_at FROM orders WHERE code='WA-TO'").get()?.telegram_paid_admin_notified_at).toBeNull();
  });

  it("gagal non-timeout (ditolak) tidak dicatat sebagai timeout dan tetap diulang run berikutnya", async () => {
    seedWhatsAppOrder("WA-REJ", "lunas");
    fixture.sql.prepare("UPDATE orders SET telegram_order_notified_at=datetime('now') WHERE code='WA-REJ'").run();
    const { sendMessage } = await import("@/lib/telegram/api");
    const { createDatabaseAccess } = await import("@/lib/db-access");
    const { retryPendingTelegramNotifications } = await import("@/lib/telegram/order-notifications");
    const db = createDatabaseAccess(fixture.db);
    vi.mocked(sendMessage).mockClear();
    vi.mocked(sendMessage).mockResolvedValueOnce({ ok: false, error_code: 400, description: "Bad Request: chat not found" });
    expect((await retryPendingTelegramNotifications(50, { paidAdmin: true }, db)).paidAdmin).toBe(0);
    expect(fixture.sql.prepare("SELECT 1 FROM buyer_notice_log WHERE idempotency_key='admin-paid-timeout:WA-REJ'").get()).toBeUndefined();
    expect(fixture.sql.prepare("SELECT status,error FROM buyer_notice_log WHERE idempotency_key='admin-paid:WA-REJ'").get())
      .toMatchObject({ status: "failed", error: "rejected:400" });
    expect((await retryPendingTelegramNotifications(50, { paidAdmin: true }, db)).paidAdmin).toBe(1);
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(2);
  });

  it("hanya Lunas yang masuk grup — pending Telegram/WA tidak membunyikan admin (owner 2026-10-10)", async () => {
    seedWhatsAppOrder("WA-ROUTE", "pending");
    const items = [{ product_id: 1, variant_id: 1, name: "Fixture", price: 10000, qty: 1 }];
    fixture.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
       sales_channel,telegram_chat_id,telegram_user_id,variant_id)
      VALUES ('TG-ROUTE','Buyer','6280',?,10000,'qris','pending','pending','telegram','12345','12345',1)`)
      .run(JSON.stringify(items));
    const { sendMessage } = await import("@/lib/telegram/api");
    vi.mocked(sendMessage).mockClear();
    const BOUND = 8;
    for (let i = 0; i < BOUND; i++) {
      const r = await cronRun();
      expect(r.status).toBe(200);
    }
    const texts = vi.mocked(sendMessage).mock.calls.map((c) => String(((c[0] as unknown) as Record<string, unknown>)?.text || ""));
    expect(texts.some((t) => t.includes("Order Baru — WhatsApp") && t.includes("WA-ROUTE"))).toBe(false);
    expect(texts.some((t) => t.includes("Order Baru — Telegram") && t.includes("TG-ROUTE"))).toBe(false);
  });

  it("wires the WhatsApp lunas path to the admin group (Order Baru dimatikan 2026-10-10)", async () => {
    // Alur pemesanan WhatsApp dipensiunkan 13 November 2026: notifikasi
    // "Order Baru" WA tidak punya jalur lagi. Notifikasi LUNAS untuk order
    // historis tetap dikirim dari webhook pembayaran dan ACC bukti admin.
    const fs = await import("node:fs");
    expect(fs.existsSync("src/lib/whatsapp/handlers/payment.ts")).toBe(false);
    const dana = fs.readFileSync("src/app/api/webhook/dana/route.ts", "utf8");
    expect(dana).toContain("notifyWhatsAppPaidAdmin");
    const proofs = fs.readFileSync("src/app/api/admin/proofs/[id]/route.ts", "utf8");
    expect(proofs).toContain("notifyWhatsAppPaidAdmin");
    const cron = fs.readFileSync("src/app/api/cron/operations/route.ts", "utf8")
      + fs.readFileSync("src/lib/cron-queues.ts", "utf8");
    expect(cron).toContain("sales_channel IN ('telegram','whatsapp')");
  });

  // AU-E2-7: reading the NULL marker then sending left a window where a slow
  // direct send and the cron retry both reached transport.
  it("a slow direct paid-admin send with a live lease is not duplicated by cron", async () => {
    seedWhatsAppOrder("WA-RACE", "lunas");
    fixture.sql.prepare("UPDATE orders SET telegram_order_notified_at=datetime('now') WHERE code='WA-RACE'").run();
    const { sendMessage } = await import("@/lib/telegram/api");
    const { createDatabaseAccess } = await import("@/lib/db-access");
    const { retryPendingTelegramNotifications, notifyWhatsAppPaidAdmin } = await import("@/lib/telegram/order-notifications");
    const db = createDatabaseAccess(fixture.db);
    vi.mocked(sendMessage).mockClear();

    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const enteredP = new Promise<void>((resolve) => { entered = resolve; });
    vi.mocked(sendMessage).mockImplementationOnce((async () => {
      entered();
      await gate;
      return { ok: true, result: { message_id: 1 } };
    }) as never);

    const direct = notifyWhatsAppPaidAdmin("WA-RACE", db);
    await enteredP;
    // Even when the recovery age is met, a live stored lease blocks takeover.
    fixture.sql.exec(`UPDATE buyer_notice_log SET updated_at=datetime('now','-31 minutes')
      WHERE idempotency_key='admin-paid:WA-RACE'`);
    const cron = await retryPendingTelegramNotifications(50, { paidAdmin: true }, db);
    release();
    expect(await direct).toBe(true);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(cron.paidAdmin).toBe(0);
    expect(fixture.sql.prepare("SELECT telegram_paid_admin_notified_at FROM orders WHERE code='WA-RACE'").get()
      ?.telegram_paid_admin_notified_at).not.toBeNull();
  });

  it("an expired lease alone does not recover a crashed paid-admin send; cron can recover it once after 30 minutes", async () => {
    seedWhatsAppOrder("WA-CRASH", "lunas");
    const { getMe, sendMessage } = await import("@/lib/telegram/api");
    const { createDatabaseAccess } = await import("@/lib/db-access");
    const { retryPendingTelegramNotifications, notifyWhatsAppPaidAdmin } = await import("@/lib/telegram/order-notifications");
    const db = createDatabaseAccess(fixture.db);
    vi.mocked(sendMessage).mockClear();
    vi.mocked(getMe).mockClear();
    await expect(notifyWhatsAppPaidAdmin("WA-CRASH", { ...db, execRun: async () => { throw new Error("worker interrupted"); } })).resolves.toBe(false);

    const readClaim = () => fixture.sql.prepare(`SELECT status, access_attempts FROM buyer_notice_log
      WHERE idempotency_key='admin-paid:WA-CRASH'`).get();
    expect(readClaim()).toMatchObject({ status: "sending", access_attempts: 0 });
    fixture.sql.exec(`UPDATE buyer_notice_log SET access_retry_at=datetime('now','-1 second')
      WHERE idempotency_key='admin-paid:WA-CRASH'`);
    expect((await retryPendingTelegramNotifications(50, { paidAdmin: true }, db)).paidAdmin).toBe(0);
    expect(getMe).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    fixture.sql.exec(`UPDATE buyer_notice_log SET updated_at=datetime('now','-31 minutes')
      WHERE idempotency_key='admin-paid:WA-CRASH'`);
    expect(await notifyWhatsAppPaidAdmin("WA-CRASH", db)).toBe(false);
    expect((await retryPendingTelegramNotifications(50, { paidAdmin: true }, db)).paidAdmin).toBe(1);
    expect((await retryPendingTelegramNotifications(50, { paidAdmin: true }, db)).paidAdmin).toBe(0);
    expect(getMe).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendMessage).mock.calls[1][0].text).toMatch(/^🔁 Kirim ulang otomatis/);
    expect(readClaim()).toMatchObject({ status: "sent", access_attempts: 1 });
  });

  it("migration 0023 backfills pre-existing WhatsApp orders so deploy does not replay history", async () => {
    const fs = await import("node:fs");
    const migration = fs.readFileSync("drizzle/migrations/0023_whatsapp_admin_notifications.sql", "utf8");
    expect(migration).toContain("sales_channel='whatsapp'");
    expect(migration).toContain("telegram_order_notified_at");
    expect(migration).toContain("telegram_paid_admin_notified_at");
    seedWhatsAppOrder("WA-OLD", "pending");
    fixture.sql.exec(migration);
    expect(fixture.sql.prepare("SELECT telegram_order_notified_at FROM orders WHERE code='WA-OLD'").get()
      ?.telegram_order_notified_at).not.toBeNull();
    const { sendMessage } = await import("@/lib/telegram/api");
    vi.mocked(sendMessage).mockClear();
    await cronRun();
    const texts = vi.mocked(sendMessage).mock.calls.map((c) => String(((c[0] as unknown) as Record<string, unknown>)?.text || ""));
    expect(texts.some((t) => t.includes("WA-OLD"))).toBe(false);
  });
});
