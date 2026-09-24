// Regresi F7 (2026-09-23): antrean notifikasi kedaluwarsa QRIS tersumbat.
//
// Kondisi produksi 13:06 UTC, 8 menit setelah F7 live: 8 order web lama
// (expired 15–23 Sep) ikut antre karena migrasi 0026 hanya menandai riwayat
// SEBELUM kanal web dimasukkan. Dua baris terdepan (urutan terlama-dulu,
// LIMIT 2) tidak punya email. Kode lama melewatinya tanpa menandai, jadi dua
// baris itu terpilih ulang setiap cron dan tidak ada notifikasi lain (termasuk
// Telegram) yang bisa lewat.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createChannelOrderAtomic } from "@/lib/commerce";
import { calculateCrc16, createDanaQrisInvoice } from "@/lib/payments/dana-qris";
import { QRIS_EXPIRY_NOTICE_WHERE, sendQrisExpiryNotifications } from "@/lib/payments/qris-expiry-notifications";
import { sendMessage } from "@/lib/telegram/api";

type MailArgs = { to: string; subject: string; html: string; text: string; timeoutMs?: number };
const sendForwardEmail = vi.fn(async (_params: MailArgs) => ({ ok: true as boolean, providerId: "res_1" }));
vi.mock("@/lib/warung-rebahan/forward-sender", () => ({ sendForwardEmail }));
vi.mock("@/lib/telegram/api", async (original) => ({
  ...await original<typeof import("@/lib/telegram/api")>(),
  sendMessage: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true })),
}));

/** Chat yang memblokir bot: Telegram menolak selamanya. */
const BLOCKED_CHATS = new Set(["901", "902"]);
let fixture: ReturnType<typeof createD1Fixture>;

beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  vi.clearAllMocks();
  sendForwardEmail.mockImplementation(async (_params: MailArgs) => ({ ok: true, providerId: "res_1" }));
  vi.mocked(sendMessage).mockImplementation(async (params) => (BLOCKED_CHATS.has(String(params.chat_id))
    ? { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }
    : { ok: true }));
  const qr = "00020101021153033605802ID6304";
  vi.stubEnv("DANA_QRIS_ENABLED", "true");
  vi.stubEnv("DANA_STATIC_QRIS", qr + calculateCrc16(qr));
  vi.stubEnv("DANA_WEBHOOK_SECRET", "fixture");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
  await insertTestProduct(fixture.sql, "manual", 1);
});

afterEach(() => { fixture.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function order(code: string, channel: "web" | "telegram", to: { email?: string; chatId?: string } = {}) {
  await createChannelOrderAtomic({
    orderCode: code,
    lines: [{ productId: 1, variantId: 1, qty: 1, fulfillmentMode: "manual", stock: 100 }],
    items: [{ product_id: 1, variant_id: 1, qty: 1, price: 10000, name: "Fixture" }],
    variantSnapshot: "{}", subtotal: 10000, primaryVariantId: 1,
    customerName: "Fixture", salesChannel: channel,
    paymentMethod: "qris", paymentAccount: "DANA Business", fulfillmentStatus: "not_required",
  });
  fixture.sql.prepare("UPDATE orders SET customer_email=?, telegram_chat_id=? WHERE code=?")
    .run(to.email ?? null, to.chatId ?? null, code);
  await createDanaQrisInvoice(code, 10000);
}

/** Format ISO-Z persis seperti yang ditulis produksi (`toISOString()`). */
const iso = (modifier: string) =>
  (fixture.sql.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now',?) AS t").get(modifier) as { t: string }).t;

/** QR hangus, pesanan masih hidup (cabang renewable). */
function expireInvoice(code: string, ago: string) {
  fixture.sql.prepare("UPDATE payment_transactions SET expires_at=? WHERE order_code=?").run(iso(ago), code);
}

/** Pesanan mati total (cabang terminal). */
function expireOrder(code: string, ago: string) {
  const at = iso(ago);
  fixture.sql.prepare("UPDATE orders SET status='kadaluarsa', expires_at=? WHERE code=?").run(at, code);
  fixture.sql.prepare("UPDATE payment_transactions SET status='expired', expires_at=? WHERE order_code=?").run(at, code);
}

const marker = (code: string) => (fixture.sql
  .prepare("SELECT COALESCE(expiry_notice_state,'') AS s FROM payment_transactions WHERE order_code=?")
  .get(code) as { s: string }).s;

const telegramSentTo = (chatId: string) =>
  vi.mocked(sendMessage).mock.calls.filter(([params]) => String(params.chat_id) === chatId).length;

const queued = () => (fixture.sql.prepare(`SELECT COUNT(*) AS n FROM payment_transactions pt
  JOIN orders o ON o.code=pt.order_code WHERE ${QRIS_EXPIRY_NOTICE_WHERE}`).get() as { n: number }).n;

it("order web tanpa email tidak masuk antrean sehingga tidak menyumbat notifikasi Telegram", async () => {
  await order("AXV-HOL-TG-OLD", "telegram", { chatId: "77" });
  expireOrder("AXV-HOL-TG-OLD", "-3 hours");
  await order("AXV-HOL-WEB-A", "web");
  expireOrder("AXV-HOL-WEB-A", "-2 hours");
  await order("AXV-HOL-WEB-B", "web");
  expireOrder("AXV-HOL-WEB-B", "-1 hours");

  // Hitungan cron (`qris_notice`) juga hanya melihat baris yang bisa dikirim.
  expect(queued()).toBe(1);
  // Batas cron produksi = 2: pembeli Telegram dikabari di putaran pertama,
  // walau dua baris tanpa email lebih baru darinya.
  const first = await sendQrisExpiryNotifications(2);
  expect(first.sent).toBe(1);
  expect(telegramSentTo("77")).toBe(1);
  expect(sendForwardEmail).not.toHaveBeenCalled();
  expect(queued()).toBe(0);
  // Tidak ditandai: bila email terisi kemudian, kabarnya tetap terkirim.
  expect(marker("AXV-HOL-WEB-A")).toBe("");
});

it("baris yang gagal terus (bot diblokir) tidak menahan kabar yang lebih baru", async () => {
  await order("AXV-HOL-BLOCK-1", "telegram", { chatId: "901" });
  expireOrder("AXV-HOL-BLOCK-1", "-4 hours");
  await order("AXV-HOL-BLOCK-2", "telegram", { chatId: "902" });
  expireOrder("AXV-HOL-BLOCK-2", "-3 hours");
  // Order web baru dengan email valid: kabarnya harus sampai di putaran pertama.
  await order("AXV-HOL-WEB-NEW", "web", { email: "buyer@example.test" });
  expireOrder("AXV-HOL-WEB-NEW", "-5 minutes");

  const result = await sendQrisExpiryNotifications(2);
  expect(result.emailSent).toBe(1);
  expect(sendForwardEmail.mock.calls[0][0].to).toBe("buyer@example.test");
  // Dulu 20 dtk per email: dua kiriman macet bisa melewati deadline run cron 45 dtk.
  expect(sendForwardEmail.mock.calls[0][0].timeoutMs).toBeLessThanOrEqual(8_000);
  expect(marker("AXV-HOL-WEB-NEW")).toBe("terminal");
  // Baris yang ditolak Telegram tetap tidak ditandai: masih dicoba ulang, tetapi dari belakang antrean.
  expect(marker("AXV-HOL-BLOCK-1")).toBe("");
  expect(marker("AXV-HOL-BLOCK-2")).toBe("");
});

it("QR yang masih bisa diperpanjang didahulukan di atas kabar terminal yang gagal terus", async () => {
  await order("AXV-HOL-RENEW", "telegram", { chatId: "55" });
  expireInvoice("AXV-HOL-RENEW", "-20 minutes");
  await order("AXV-HOL-BLOCK-1", "telegram", { chatId: "901" });
  expireOrder("AXV-HOL-BLOCK-1", "-2 minutes");
  await order("AXV-HOL-BLOCK-2", "telegram", { chatId: "902" });
  expireOrder("AXV-HOL-BLOCK-2", "-1 minutes");

  const result = await sendQrisExpiryNotifications(2);
  expect(result.sent).toBe(1);
  expect(telegramSentTo("55")).toBe(1);
  expect(marker("AXV-HOL-RENEW")).toBe("renewable");
});

it("riwayat order web yang kedaluwarsa berhari-hari tidak diemail sekarang (tidak ada spam kabar basi)", async () => {
  // Bentuk persis baris produksi: order web 15 Sep dengan email, dibuka 8 hari kemudian.
  await order("AXV-HOL-STALE", "web", { email: "old@example.test" });
  expireOrder("AXV-HOL-STALE", "-8 days");
  await order("AXV-HOL-FRESH", "web", { email: "fresh@example.test" });
  expireOrder("AXV-HOL-FRESH", "-30 minutes");

  // Hitungan cron (`qris_notice`) memakai WHERE yang sama, jadi baris basi juga tidak memicu fase notify.
  expect(queued()).toBe(1);
  const result = await sendQrisExpiryNotifications(5);
  expect(result.emailSent).toBe(1);
  expect(sendForwardEmail).toHaveBeenCalledTimes(1);
  expect(sendForwardEmail.mock.calls[0][0].to).toBe("fresh@example.test");
  expect(marker("AXV-HOL-STALE")).toBe("");
});

// Audit ronde 4 (B-H3): renewable-selalu-dulu membuat renewable yang gagal
// terus menahan kabar terminal sampai order-nya ikut kedaluwarsa (±45 menit).
it("renewable yang gagal terus tidak menahan kabar terminal: tiap jenis punya jalur sendiri", async () => {
  await order("AXV-HOL-RNW-1", "telegram", { chatId: "901" });
  expireInvoice("AXV-HOL-RNW-1", "-3 minutes");
  await order("AXV-HOL-RNW-2", "telegram", { chatId: "902" });
  expireInvoice("AXV-HOL-RNW-2", "-2 minutes");
  await order("AXV-HOL-TERM", "telegram", { chatId: "77" });
  expireOrder("AXV-HOL-TERM", "-30 minutes");

  const result = await sendQrisExpiryNotifications(2);
  expect(result.sent).toBe(1);
  expect(telegramSentTo("77")).toBe(1);
  expect(marker("AXV-HOL-TERM")).toBe("terminal");
});

// Audit ronde 4 (B-H2): gerbang waktu fase notify hanya dicek sekali di depan.
it("waktu run habis: berhenti sebelum kiriman berikutnya, sisanya untuk run berikutnya", async () => {
  await order("AXV-HOL-T-1", "telegram", { chatId: "71" });
  expireOrder("AXV-HOL-T-1", "-2 minutes");
  await order("AXV-HOL-T-2", "telegram", { chatId: "72" });
  expireOrder("AXV-HOL-T-2", "-1 minutes");

  let checks = 0;
  const result = await sendQrisExpiryNotifications(2, undefined, { hasTime: () => ++checks === 1 });
  expect(result.sent).toBe(1);
  expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);
  expect(queued()).toBe(1);
});
