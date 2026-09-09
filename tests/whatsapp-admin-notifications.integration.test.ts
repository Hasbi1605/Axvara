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
  it("formats created + paid admin messages for WhatsApp", async () => {
    const { adminWhatsAppOrderCreatedMessage, adminWhatsAppOrderPaidMessage } = await import("@/lib/telegram/messages");
    const created = adminWhatsAppOrderCreatedMessage({
      orderCode: "AXV-1", productNames: "Fixture ×1", amount: 10000,
      customerName: "628111", channelMember: "628111", paymentMethod: "qris",
    });
    expect(created).toContain("Order Baru — WhatsApp");
    expect(created).toContain("AXV-1");
    const paid = adminWhatsAppOrderPaidMessage({
      orderCode: "AXV-1", productNames: "Fixture ×1", amount: 10000,
      customerName: "628111", channelMember: "628111", paymentMethod: "qris",
    });
    expect(paid).toContain("Lunas — WhatsApp");
    expect(paid).toContain("AXV-1");
  });

  it("notifies order-created for a pending WhatsApp order and marks it once", async () => {
    seedWhatsAppOrder("WA-CREATED", "pending");
    const { notifyWhatsAppOrderCreated } = await import("@/lib/telegram/order-notifications");
    const { sendMessage } = await import("@/lib/telegram/api");
    vi.mocked(sendMessage).mockClear();
    expect(await notifyWhatsAppOrderCreated("WA-CREATED")).toBe(true);
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendMessage).mock.calls[0]?.[0]).toMatchObject({ chat_id: "999" });
    expect(String((vi.mocked(sendMessage).mock.calls[0]?.[0] as unknown as Record<string, unknown>)?.text || "")).toContain("Order Baru — WhatsApp");
    expect(fixture.sql.prepare("SELECT telegram_order_notified_at FROM orders WHERE code='WA-CREATED'").get()
      ?.telegram_order_notified_at).not.toBeNull();
    // Idempoten: panggilan kedua tidak mengirim lagi.
    vi.mocked(sendMessage).mockClear();
    expect(await notifyWhatsAppOrderCreated("WA-CREATED")).toBe(true);
    expect(vi.mocked(sendMessage)).not.toHaveBeenCalled();
  });

  it("cron retries a missed WhatsApp order-created via the durable marker", async () => {
    seedWhatsAppOrder("WA-CRON", "pending");
    const { sendMessage } = await import("@/lib/telegram/api");
    vi.mocked(sendMessage).mockClear();
    const BOUND = 8;
    let marked = false;
    for (let i = 0; i < BOUND; i++) {
      const r = await cronRun();
      expect(r.status).toBe(200);
      if (fixture.sql.prepare("SELECT telegram_order_notified_at FROM orders WHERE code='WA-CRON'").get()
        ?.telegram_order_notified_at != null) { marked = true; break; }
    }
    expect(marked).toBe(true);
    const texts = vi.mocked(sendMessage).mock.calls.map((c) => String(((c[0] as unknown) as Record<string, unknown>)?.text || ""));
    expect(texts.some((t) => t.includes("Order Baru — WhatsApp") && t.includes("WA-CRON"))).toBe(true);
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
    expect(texts.some((t) => t.includes("Lunas — WhatsApp") && t.includes("WA-PAID"))).toBe(true);
    vi.mocked(sendMessage).mockClear();
    await cronRun();
    expect(vi.mocked(sendMessage)).not.toHaveBeenCalled();
  });

  it("routes sends to the WhatsApp notifier for whatsapp rows and the Telegram one for telegram rows", async () => {
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
      const left = Number(fixture.sql.prepare(
        "SELECT COUNT(*) n FROM orders WHERE telegram_order_notified_at IS NULL").get()?.n ?? 0);
      if (left === 0) break;
    }
    const texts = vi.mocked(sendMessage).mock.calls.map((c) => String(((c[0] as unknown) as Record<string, unknown>)?.text || ""));
    expect(texts.some((t) => t.includes("Order Baru — WhatsApp") && t.includes("WA-ROUTE"))).toBe(true);
    expect(texts.some((t) => t.includes("Order Baru — Telegram") && t.includes("TG-ROUTE"))).toBe(true);
  });

  it("wires the WhatsApp webhook, DANA webhook, and proof approval to the admin group", async () => {
    // Refactor PURE MOVE: notif order-baru WA dipindah ke handler pembayaran WhatsApp.
    const wa = await import("node:fs").then((fs) => fs.readFileSync("src/lib/whatsapp/handlers/payment.ts", "utf8"));
    expect(wa).toContain("notifyWhatsAppOrderCreated");
    const dana = await import("node:fs").then((fs) => fs.readFileSync("src/app/api/webhook/dana/route.ts", "utf8"));
    expect(dana).toContain("notifyWhatsAppPaidAdmin");
    const proofs = await import("node:fs").then((fs) => fs.readFileSync("src/app/api/admin/proofs/[id]/route.ts", "utf8"));
    expect(proofs).toContain("notifyWhatsAppPaidAdmin");
    const cron = await import("node:fs").then((fs) => fs.readFileSync("src/app/api/cron/operations/route.ts", "utf8"));
    expect(cron).toContain("sales_channel IN ('telegram','whatsapp')");
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
