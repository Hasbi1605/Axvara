import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createChannelOrderAtomic } from "@/lib/commerce";
import { calculateCrc16, createDanaQrisInvoice, reissueDanaQrisInvoice } from "@/lib/payments/dana-qris";
import { sendQrisExpiryNotifications } from "@/lib/payments/qris-expiry-notifications";
import { qrisInvoiceKeyboard } from "@/lib/telegram/keyboards";
import { sendMessage, safeEditOrSend } from "@/lib/telegram/api";
vi.mock("@/lib/telegram/api", async (original) => ({
  ...await original<typeof import("@/lib/telegram/api")>(),
  sendMessage: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/whatsapp/handlers/shared", async (original) => ({
  ...await original<typeof import("@/lib/whatsapp/handlers/shared")>(),
  sendTextMessage: vi.fn(async () => ({ ok: true })),
  sendImageMessage: vi.fn(async () => ({ ok: true })),
}));
let fixture: ReturnType<typeof createD1Fixture>;
const code = "AXV-20260910-POLICY01";
beforeEach(async () => {
  fixture = createD1Fixture(); stubFulfillmentKey(); vi.clearAllMocks();
  const qr = "00020101021153033605802ID6304";
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("DANA_QRIS_ENABLED", "true"); vi.stubEnv("DANA_STATIC_QRIS", qr + calculateCrc16(qr));
  vi.stubEnv("DANA_WEBHOOK_SECRET", "fixture"); vi.stubEnv("CRON_SECRET", "fixture");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false"); vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
  await insertTestProduct(fixture.sql, "manual", 1);
});
afterEach(() => { fixture.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function checkout(channel: "telegram" | "whatsapp" = "telegram") {
  await createChannelOrderAtomic({ orderCode: code,
    lines: [{ productId: 1, variantId: 1, qty: 1, fulfillmentMode: "manual", stock: 100 }],
    items: [{ product_id: 1, variant_id: 1, qty: 1, price: 10000, name: "Fixture" }],
    variantSnapshot: "{}", subtotal: 10000, primaryVariantId: 1, customerName: "Fixture", salesChannel: channel,
    paymentMethod: "qris", paymentAccount: "DANA Business", fulfillmentStatus: "not_required" });
  fixture.sql.prepare("UPDATE orders SET telegram_chat_id='77', channel_conversation_id='fixture@g.us', telegram_order_notified_at=datetime('now') WHERE code=?").run(code);
  return createDanaQrisInvoice(code, 10000);
}
const row = () => fixture.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
function expire(final = false) {
  fixture.sql.prepare("UPDATE payment_transactions SET expires_at=datetime('now','-1 minute') WHERE order_code=?").run(code);
  if (final) fixture.sql.prepare("UPDATE orders SET expires_at=datetime('now','-1 minute') WHERE code=?").run(code);
}
async function cron() {
  const { POST } = await import("@/app/api/cron/operations/route");
  const res = await POST(new NextRequest("http://localhost/api/cron/operations", { method: "POST", headers: { authorization: "Bearer fixture" } }));
  expect(res.status).toBe(200); return res.json();
}
it("WA has exactly the invoice deadline and cannot renew even through the shared API", async () => {
  const invoice = await checkout("whatsapp");
  expect(row().expires_at).toBe(invoice.expiresAt);
  expire();
  expect(await reissueDanaQrisInvoice(code)).toEqual({ ok: false, reason: "order_not_reissuable" });
  const { GET } = await import("@/app/api/orders/[code]/route");
  const response = await GET(new NextRequest(`http://localhost/api/orders/${code}`), { params: Promise.resolve({ code }) });
  expect((await response.json()).order.qris_reissue_allowed).toBe(false);
});
it("offers renewal only in the first expired QR message, retries failed delivery, then stops repeating", async () => {
  await checkout();
  expect(JSON.stringify(qrisInvoiceKeyboard(code))).not.toContain("qrenew");
  expect((await sendQrisExpiryNotifications()).sent).toBe(0);
  expire();
  vi.mocked(sendMessage).mockResolvedValueOnce({ ok: false, description: "timeout" });
  expect((await sendQrisExpiryNotifications()).sent).toBe(0);
  expect((await sendQrisExpiryNotifications()).sent).toBe(1);
  expect(vi.mocked(sendMessage).mock.lastCall?.[0]).toMatchObject({ text: expect.stringContaining("QRIS Kedaluwarsa") });
  expect(JSON.stringify(vi.mocked(sendMessage).mock.lastCall?.[0].reply_markup)).toContain(`qrenew:${code}`);
  expect((await sendQrisExpiryNotifications()).sent).toBe(0);
  expect(row().status).toBe("pending");
});
it("the replacement is the final QR; its deadline closes the order and restores stock once", async () => {
  await checkout(); expire();
  const renewed = await reissueDanaQrisInvoice(code);
  expect(renewed.ok).toBe(true);
  if (!renewed.ok) throw new Error(renewed.reason);
  expect(renewed.remaining).toBe(0);
  expect(row().expires_at).toBe(renewed.invoice.expiresAt);
  expect(row().telegram_invoice_sent_at).toBeNull();
  expire();
  expect(await reissueDanaQrisInvoice(code)).toEqual({ ok: false, reason: "reissue_limit_reached" });
  expire(true); await cron(); await cron(); await sendQrisExpiryNotifications();
  expect(row().status).toBe("kadaluarsa");
  expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()!.stock).toBe(100);
  const terminal = vi.mocked(sendMessage).mock.calls.filter(([args]) => args.text.includes("Invoice Kedaluwarsa"));
  expect(terminal).toHaveLength(1); expect(terminal[0][0].reply_markup).toBeUndefined();
});
it("WA expiry creates a durable message once for the original conversation", async () => {
  await checkout("whatsapp"); expire(true); await cron();
  expect(row().status).toBe("kadaluarsa");
  await sendQrisExpiryNotifications(); await sendQrisExpiryNotifications();
  const notices = fixture.sql.prepare("SELECT * FROM whatsapp_outbox WHERE idempotency_key=?").all(`wa:qris-expired:${code}`);
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({ destination: "fixture@g.us", payload: expect.stringContaining("15 menit") });
  expect(String(notices[0].payload)).toContain("buat pesanan ulang");
});
it("migration shortens an existing active WA order to its invoice deadline", async () => {
  const invoice = await checkout("whatsapp");
  fixture.sql.prepare("UPDATE orders SET expires_at=datetime('now','+60 minutes')").run();
  fixture.sql.exec("ALTER TABLE payment_transactions DROP COLUMN expiry_notice_state");
  fixture.sql.exec(readFileSync("drizzle/migrations/0026_qris_channel_policy.sql", "utf8"));
  expect(row().expires_at).toBe(invoice.expiresAt);
  expect(fixture.sql.prepare("PRAGMA integrity_check").get()!.integrity_check).toBe("ok");
});
it("Telegram variant selection goes straight to quantity controls", async () => {
  fixture.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,first_name) VALUES ('77','77','Fixture')").run();
  const { handleVariantConfirm } = await import("@/lib/telegram/handlers/catalog");
  await handleVariantConfirm(77, 1, 1);
  const message = vi.mocked(safeEditOrSend).mock.lastCall?.[0];
  expect(message?.text).toContain("Tentukan Jumlah Pesanan");
  expect(message?.text).not.toContain("Konfirmasi Pembelian");
  expect(JSON.stringify(message?.reply_markup)).not.toContain("Saya Paham");
  expect(fixture.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id='77'").get()!.pending_action).toBe("qty_for:1:1");
});

it("a failed WA outbox insert is retried without losing the expiry notice", async () => {
  await checkout("whatsapp");
  fixture.sql.prepare("UPDATE orders SET status='kadaluarsa',payment_status='expired'").run();
  fixture.sql.prepare("UPDATE payment_transactions SET status='expired'").run();
  fixture.control.fail = query => query.includes("INSERT OR IGNORE INTO whatsapp_outbox");
  expect((await sendQrisExpiryNotifications()).sent).toBe(0);
  fixture.control.fail = null;
  expect((await sendQrisExpiryNotifications()).sent).toBe(1);
  expect((await sendQrisExpiryNotifications()).sent).toBe(0);
});
it("migration preserves first Telegram waiting window and leaves historical terminal messages suppressed", async () => {
  await checkout(); const deadline = row().expires_at;
  fixture.sql.exec("ALTER TABLE payment_transactions DROP COLUMN expiry_notice_state");
  fixture.sql.exec(readFileSync("drizzle/migrations/0026_qris_channel_policy.sql", "utf8"));
  expect(row().expires_at).toBe(deadline);
  fixture.sql.prepare("UPDATE orders SET status='kadaluarsa',payment_status='expired'").run();
  fixture.sql.prepare("UPDATE payment_transactions SET status='expired'").run();
  fixture.sql.exec("ALTER TABLE payment_transactions DROP COLUMN expiry_notice_state");
  fixture.sql.exec(readFileSync("drizzle/migrations/0026_qris_channel_policy.sql", "utf8"));
  expect((await sendQrisExpiryNotifications()).sent).toBe(0);
});
it("migration caps the legacy renewed Telegram order at its final QR deadline", async () => {
  const invoice = await checkout();
  fixture.sql.prepare("UPDATE orders SET qris_reissue_count=2").run();
  fixture.sql.exec("ALTER TABLE payment_transactions DROP COLUMN expiry_notice_state");
  fixture.sql.exec(readFileSync("drizzle/migrations/0026_qris_channel_policy.sql", "utf8"));
  expect(row().expires_at).toBe(invoice.expiresAt);
});

it("the page lookup API exposes the deadline and permission before and after the sole renewal", async () => {
  await checkout();
  const { GET } = await import("@/app/api/orders/route");
  const lookup = async () => (await (await GET(new NextRequest(`http://localhost/api/orders?code=${code}`))).json()).order;
  expect(await lookup()).toMatchObject({ expires_at: row().expires_at, qris_reissue_allowed: true });
  expire(); await reissueDanaQrisInvoice(code);
  expect(await lookup()).toMatchObject({ expires_at: row().expires_at, qris_reissue_allowed: false });
});

it("WA repeat payment command cannot resend an expired QR and clears selection for a fresh order", async () => {
  await checkout("whatsapp"); expire(true);
  const { upsertSession, getSession } = await import("@/lib/whatsapp/session");
  await upsertSession("baileys", "fixture@g.us", "628111", {
    selected_product_id: 1, selected_variant_id: 1, current_order_code: code });
  const { handlePay } = await import("@/lib/whatsapp/handlers/payment");
  const { sendTextMessage, sendImageMessage } = await import("@/lib/whatsapp/handlers/shared");
  await handlePay("fixture@g.us", "628111", "fixture-message", "QRIS");
  expect(vi.mocked(sendTextMessage).mock.lastCall?.[0].message).toContain("QRIS Hangus");
  expect(sendImageMessage).not.toHaveBeenCalled();
  expect((await getSession("baileys", "fixture@g.us", "628111"))?.selected_variant_id).toBeNull();
  expect(fixture.sql.prepare("SELECT count(*) AS n FROM payment_invoice_history WHERE order_code=?").get(code)!.n).toBe(1);
});
