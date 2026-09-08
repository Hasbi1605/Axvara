import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { NextRequest } from "next/server";

let fixture: ReturnType<typeof createD1Fixture>;

const SEND = vi.fn(async () => ({ ok: true, result: { message_id: 1 } }));
const PHOTO = vi.fn(async (..._args: unknown[]) => ({ ok: true, result: { message_id: 1 } }));

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: SEND,
  sendPhoto: PHOTO,
  answerCallbackQuery: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  showLoadingBar: vi.fn(async () => {}),
  sendChatAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/whatsapp/gateway", () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "wa-1" })),
}));

beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  SEND.mockReset().mockResolvedValue({ ok: true, result: { message_id: 1 } });
  PHOTO.mockReset().mockResolvedValue({ ok: true, result: { message_id: 1 } });
  const { calculateCrc16 } = await import("@/lib/payments/dana-qris");
  vi.stubEnv("DANA_QRIS_ENABLED", "true");
  vi.stubEnv("DANA_WEBHOOK_SECRET", "x");
  const qr = "00020101021153033605802ID6304";
  vi.stubEnv("DANA_STATIC_QRIS", qr + calculateCrc16(qr));
  vi.stubEnv("CRON_SECRET", "c");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "rr305");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "dummy");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function webhook(update: unknown) {
  return new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "rr305" },
    body: JSON.stringify(update),
  }) as unknown as import("next/server").NextRequest;
}

async function cron() {
  const { POST } = await import("@/app/api/cron/operations/route");
  return POST(new NextRequest("http://localhost/api/cron/operations", {
    method: "POST", headers: { authorization: "Bearer c" },
  }) as unknown as import("next/server").NextRequest);
}

// ─── RR3-05: foto invoice gagal → satu order, retry kirim foto yang sama ───
describe("RR3-05 failed invoice photo is durably retried without a second order", () => {
  it("cart checkout: first photo timeout, provider recovers, retry sends the same invoice", async () => {
    await insertTestProduct(fixture.sql, "shared", 1);
    fixture.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES('777',1,1,1)").run();
    const { POST } = await import("@/app/api/telegram/webhook/route");
    PHOTO.mockResolvedValueOnce({ ok: false, description: "Request timeout" } as never);
    const first = await POST(webhook({
      update_id: 77701,
      callback_query: { id: "cb777", from: { id: 777, first_name: "Dummy" }, message: { message_id: 77, chat: { id: 777, type: "private" } }, data: "cconfirm" },
    }));
    // Pekerjaan invoice tersimpan durable: respons boleh 500 (retry Telegram)
    // tetapi order/invoice/reservasi yang sama harus dipertahankan.
    expect([200, 500]).toContain(first.status);
    const orders = fixture.sql.prepare("SELECT code, status FROM orders").all();
    expect(orders).toHaveLength(1);
    const code = String(orders[0].code);
    const stockAfterFirst = Number(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock);
    const update = String(fixture.sql.prepare("SELECT status FROM telegram_updates WHERE update_id='77701'").get()?.status);
    // Provider pulih → jalur retry yang sama mengirim foto invoice yang sama.
    PHOTO.mockResolvedValueOnce({ ok: true, result: { message_id: 7 } } as never);
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    const retried = await retryTelegramInvoiceDelivery(code);
    expect(retried).toBe(true);
    expect(PHOTO).toHaveBeenCalled();
    // Tetap satu order/invoice/reservasi; stok dipotong tepat sekali.
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()?.n).toBe(1);
    expect(Number(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock)).toBe(stockAfterFirst);
    expect(String(fixture.sql.prepare("SELECT status FROM payment_transactions WHERE order_code=?").get(code)?.status)).toBe("pending");
    void update;
    // Duplicate update tidak membuat transaksi kedua.
    const dup = await POST(webhook({
      update_id: 77701,
      callback_query: { id: "cb777", from: { id: 777, first_name: "Dummy" }, message: { message_id: 77, chat: { id: 777, type: "private" } }, data: "cconfirm" },
    }));
    expect(await dup.json()).toMatchObject({ ok: true });
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
  });

  it("direct variant checkout: failed photo retried for the same order", async () => {
    await insertTestProduct(fixture.sql, "shared", 1);
    const { POST } = await import("@/app/api/telegram/webhook/route");
    PHOTO.mockResolvedValueOnce({ ok: false, description: "Request timeout" } as never);
    const first = await POST(webhook({
      update_id: 77801,
      callback_query: { id: "pay-1", from: { id: 778, first_name: "Dummy" }, message: { message_id: 78, chat: { id: 778, type: "private" } }, data: "pay:1:1:1" },
    }));
    expect([200, 500]).toContain(first.status);
    const orders = fixture.sql.prepare("SELECT code FROM orders").all();
    expect(orders).toHaveLength(1);
    const code = String(orders[0].code);
    PHOTO.mockResolvedValueOnce({ ok: true, result: { message_id: 8 } } as never);
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    expect(await retryTelegramInvoiceDelivery(code)).toBe(true);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
  });

  it("cron sweeps a pending invoice via the operations entrypoint (durable recovery)", async () => {
    await insertTestProduct(fixture.sql, "shared", 1);
    const { POST } = await import("@/app/api/telegram/webhook/route");
    PHOTO.mockResolvedValueOnce({ ok: false, description: "Request timeout" } as never);
    const first = await POST(webhook({
      update_id: 77901,
      callback_query: { id: "cb779", from: { id: 779, first_name: "Dummy" }, message: { message_id: 79, chat: { id: 779, type: "private" } }, data: "cconfirm" },
    }));
    // Siapkan cart dulu: callback cconfirm butuh cart berisi.
    void first;
    const codes = fixture.sql.prepare("SELECT code FROM orders").all();
    // Bila cart kosong (tanpa seed cart), buat order pending + invoice
    // langsung agar sapuan cron terbukti pada entrypoint yang benar.
    if (codes.length === 0) {
      fixture.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES('779',1,1,1)").run();
      PHOTO.mockResolvedValueOnce({ ok: false, description: "Request timeout" } as never);
      await POST(webhook({
        update_id: 77902,
        callback_query: { id: "cb779b", from: { id: 779, first_name: "Dummy" }, message: { message_id: 79, chat: { id: 779, type: "private" } }, data: "cconfirm" },
      }));
    }
    const orderCodes = fixture.sql.prepare("SELECT code FROM orders").all();
    expect(orderCodes.length).toBe(1);
    const code = String(orderCodes[0].code);
    expect(fixture.sql.prepare("SELECT telegram_invoice_sent_at FROM orders WHERE code=?").get(code)?.telegram_invoice_sent_at).toBeNull();
    // Provider pulih; cron menyapu dan mengirim foto yang sama.
    PHOTO.mockResolvedValue({ ok: true, result: { message_id: 9 } } as never);
    const { POST: cronPOST } = await import("@/app/api/cron/operations/route");
    let swept = false;
    for (let i = 0; i < 6; i++) {
      const r = await cronPOST(new NextRequest("http://localhost/api/cron/operations", {
        method: "POST", headers: { authorization: "Bearer c" },
      }) as unknown as import("next/server").NextRequest);
      expect(r.status).toBe(200);
      if (fixture.sql.prepare("SELECT telegram_invoice_sent_at FROM orders WHERE code=?").get(code)?.telegram_invoice_sent_at != null) {
        swept = true;
        break;
      }
    }
    expect(swept).toBe(true);
    expect(PHOTO).toHaveBeenCalled();
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()?.n).toBe(1);
  });
});
