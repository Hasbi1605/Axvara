// F7 (2026-09-23) — pembeli WEB akhirnya diingatkan saat QRIS-nya hangus.
//
// Sebelumnya `QRIS_EXPIRY_NOTICE_WHERE` memfilter
// `sales_channel IN ('telegram','whatsapp')`, sehingga kanal web tidak pernah
// masuk hasil query — padahal justru pembeli web yang BOLEH memperpanjang
// QRIS (`reissue` hanya mengecualikan WhatsApp). Mereka baru tahu QR-nya
// hangus bila kebetulan membuka halaman lagi; tab yang sudah ditutup berarti
// tidak tahu sama sekali.
//
// Jalurnya email (Resend) karena web tidak punya kanal chat. Email selalu
// terisi untuk order web sejak revamp checkout 2026-09-23 mewajibkannya.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createChannelOrderAtomic } from "@/lib/commerce";
import { calculateCrc16, createDanaQrisInvoice } from "@/lib/payments/dana-qris";
import { sendQrisExpiryNotifications } from "@/lib/payments/qris-expiry-notifications";

type MailArgs = { to: string; subject: string; html: string; text: string };
const sendForwardEmail = vi.fn(async (_params: MailArgs) => ({ ok: true as boolean, providerId: "res_1" }));
vi.mock("@/lib/warung-rebahan/forward-sender", () => ({ sendForwardEmail }));
vi.mock("@/lib/telegram/api", async (original) => ({
  ...await original<typeof import("@/lib/telegram/api")>(),
  sendMessage: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true })),
}));

let fixture: ReturnType<typeof createD1Fixture>;
const code = "AXV-20260923-WEBMAIL1";

beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  vi.clearAllMocks();
  sendForwardEmail.mockImplementation(async (_params: MailArgs) => ({ ok: true, providerId: "res_1" }));
  const qr = "00020101021153033605802ID6304";
  vi.stubEnv("DANA_QRIS_ENABLED", "true");
  vi.stubEnv("DANA_STATIC_QRIS", qr + calculateCrc16(qr));
  vi.stubEnv("DANA_WEBHOOK_SECRET", "fixture");
  vi.stubEnv("RESEND_API_KEY", "re_fixture");
  vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@axvara.tech");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
  await insertTestProduct(fixture.sql, "manual", 1);
});

afterEach(() => { fixture.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function webCheckout(email: string | null) {
  await createChannelOrderAtomic({
    orderCode: code,
    lines: [{ productId: 1, variantId: 1, qty: 1, fulfillmentMode: "manual", stock: 100 }],
    items: [{ product_id: 1, variant_id: 1, qty: 1, price: 10000, name: "Fixture" }],
    variantSnapshot: "{}", subtotal: 10000, primaryVariantId: 1,
    customerName: "Fixture", salesChannel: "web",
    paymentMethod: "qris", paymentAccount: "DANA Business", fulfillmentStatus: "not_required",
  });
  fixture.sql.prepare("UPDATE orders SET customer_email=? WHERE code=?").run(email, code);
  return createDanaQrisInvoice(code, 10000);
}

/** QR hangus tapi pesanan masih hidup = masih bisa diperpanjang. */
function expireInvoiceOnly() {
  fixture.sql.prepare("UPDATE payment_transactions SET expires_at=datetime('now','-1 minute') WHERE order_code=?").run(code);
}

function expireOrderToo() {
  expireInvoiceOnly();
  fixture.sql.prepare("UPDATE orders SET status='kadaluarsa', expires_at=datetime('now','-1 minute') WHERE code=?").run(code);
  fixture.sql.prepare("UPDATE payment_transactions SET status='expired' WHERE order_code=?").run(code);
}

it("QR web hangus: pembeli diemail ajakan perpanjang, sekali saja", async () => {
  await webCheckout("buyer@example.test");
  expireInvoiceOnly();

  const first = await sendQrisExpiryNotifications(5);
  expect(first.sent).toBe(1);
  expect(first.emailSent).toBe(1);
  expect(sendForwardEmail).toHaveBeenCalledTimes(1);
  const payload = sendForwardEmail.mock.calls[0][0];
  expect(payload.to).toBe("buyer@example.test");
  expect(payload.subject).toContain(code);
  // Isi wajib menyebut aksi yang MASIH bisa dilakukan pembeli web.
  expect(payload.text).toContain("Perpanjang QRIS");
  expect(payload.text).toContain(`/pesanan/${code}`);

  // Penanda tersimpan → cron berikutnya tidak mengirim ulang.
  const again = await sendQrisExpiryNotifications(5);
  expect(again.sent).toBe(0);
  expect(sendForwardEmail).toHaveBeenCalledTimes(1);
});

it("pesanan web mati total: email bernada terminal, bukan ajakan perpanjang", async () => {
  await webCheckout("buyer@example.test");
  expireOrderToo();

  const result = await sendQrisExpiryNotifications(5);
  expect(result.emailSent).toBe(1);
  const payload = sendForwardEmail.mock.calls[0][0];
  expect(payload.subject).toContain("kedaluwarsa");
  expect(payload.text).not.toContain("Perpanjang QRIS");
});

it("tanpa email (order web lama pra-revamp): dilewati TANPA menandai, agar tidak hilang diam-diam", async () => {
  await webCheckout(null);
  expireInvoiceOnly();

  const result = await sendQrisExpiryNotifications(5);
  expect(result.sent).toBe(0);
  expect(sendForwardEmail).not.toHaveBeenCalled();
  // Penanda TIDAK boleh tertulis: bila email diisi kemudian, kabar tetap terkirim.
  const marker = fixture.sql
    .prepare("SELECT COALESCE(expiry_notice_state,'') AS state FROM payment_transactions WHERE order_code=?")
    .get(code) as { state: string };
  expect(marker.state).toBe("");
});

it("pengiriman email gagal tidak menandai notifikasi — cron berikutnya mencoba lagi", async () => {
  await webCheckout("buyer@example.test");
  expireInvoiceOnly();
  sendForwardEmail.mockImplementation(async (_params: MailArgs) => ({ ok: false, providerId: "" }));

  const failed = await sendQrisExpiryNotifications(5);
  expect(failed.sent).toBe(0);

  sendForwardEmail.mockImplementation(async (_params: MailArgs) => ({ ok: true, providerId: "res_2" }));
  const retried = await sendQrisExpiryNotifications(5);
  expect(retried.emailSent).toBe(1);
});
