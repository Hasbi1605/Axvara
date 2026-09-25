// tests/nonwr-web-delivery.integration.test.ts — Produk non-WR untuk pembeli
// WEB dikirim otomatis lewat email (laporan owner 2026-09-25).
//
// Dulu setiap item non-WR kanal web dipaksa `manual_required`
// (web_channel_requires_manual_handover), jadi badge "Kirim otomatis" tidak
// pernah benar untuk web. Yang dikunci di sini, lewat jalur pembayaran asli
// (ensureFulfillmentForPaidOrder) di atas D1 nyata:
//  - shared/unique + email valid → SATU email "Pesanan Siap" berisi isi
//    produk DAN tanda terima; tanda terima terpisah tidak dikirim.
//  - Isi yang dikirim tersimpan terenkripsi (salinan ciphertext sumber).
//  - Made By Order → antrean admin + tanda terima + ping admin sekali.
//  - Resend gagal → retry (bukan delivered palsu); email yang sudah `sent`
//    tidak dikirim ulang saat retry.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createOrderWithStock } from "@/lib/db";
import { ensureFulfillmentForPaidOrder } from "@/lib/fulfillment/deliver";
import { decryptSecret, encryptSecret } from "@/lib/fulfillment/crypto";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
}));
vi.mock("@/lib/whatsapp/gateway", () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "wa-1" })),
}));

type Sent = { to: string[]; subject: string; html: string; text: string };
let fixture: ReturnType<typeof createD1Fixture>;
let emails: Sent[];
let resendOk: boolean;

beforeEach(async () => {
  fixture = createD1Fixture();
  emails = [];
  resendOk = true;
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@axvara.test");
  vi.stubEnv("SITE_URL", "https://axvara.test");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-test");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100200");
  stubFulfillmentKey();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url) !== "https://api.resend.com/emails") throw new Error(`Network disabled: ${url}`);
    if (!resendOk) return new Response(JSON.stringify({ message: "resend_down" }), { status: 503 });
    emails.push(JSON.parse(String(init?.body)) as Sent);
    return new Response(JSON.stringify({ id: `email-${emails.length}` }), { status: 200 });
  }));
  const { sendMessage } = await import("@/lib/telegram/api");
  (sendMessage as unknown as ReturnType<typeof vi.fn>).mockClear();
  fixture.sql.exec("INSERT INTO products(id,name,slug,price,stock,source) VALUES(1,'Canva Pro','canva-premium',2000,100,'manual')");
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function seedVariant(id: number, mode: "shared" | "unique" | "manual", sharedSecret?: string) {
  const sealed = sharedSecret ? await encryptSecret(sharedSecret) : null;
  fixture.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,shared_secret_ciphertext,shared_secret_iv)
    VALUES(?,1,?,?,2000,-1,?,?,?)`).run(id, `SKU-${id}`, `Varian ${id}`, mode, sealed?.ciphertext ?? null, sealed?.iv ?? null);
}

async function paidWebOrder(code: string, variantIds: number[], email: string | null = "pembeli@contoh.test") {
  const items = variantIds.map((variant_id) => ({ product_id: 1, variant_id, name: `Canva Pro — Varian ${variant_id}`, price: 2000, qty: 1 }));
  await createOrderWithStock({
    code, quoteId: `q-${code}`, customerName: "Rani Putri", customerWa: "628000000000",
    customerEmail: email, items, subtotal: items.length * 2000,
    paymentMethod: "qris", paymentAccount: "DANA Business", proofUrl: null,
  });
  fixture.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid' WHERE code=?").run(code);
}

const itemRow = (code: string) => fixture.sql.prepare(
  "SELECT status, last_error, delivered_message_id, delivered_ciphertext, delivered_iv FROM fulfillment_items WHERE order_code=? ORDER BY item_index",
).all(code) as { status: string; last_error: string | null; delivered_message_id: string | null; delivered_ciphertext: string | null; delivered_iv: string | null }[];

async function adminPings() {
  const { sendMessage } = await import("@/lib/telegram/api");
  return (sendMessage as unknown as ReturnType<typeof vi.fn>).mock.calls
    .map(([arg]) => arg as { chat_id: string; text: string })
    .filter((m) => m.chat_id === "-100200");
}

describe("non-WR kanal web: kirim otomatis lewat email", () => {
  it("shared + email → satu email Pesanan Siap berisi isi + tanda terima; isi tersimpan terenkripsi", async () => {
    await seedVariant(1, "shared", "https://canva.com/brand/join?token=UNDANGAN-123");
    await paidWebOrder("AXV-20260925-AAAAAAA1", [1]);
    await ensureFulfillmentForPaidOrder("AXV-20260925-AAAAAAA1");

    const [row] = itemRow("AXV-20260925-AAAAAAA1");
    expect(row.status).toBe("delivered");
    expect(row.delivered_message_id).toMatch(/^item:/);
    // Salinan ciphertext pesan bersama, bukan teks polos.
    expect(row.delivered_ciphertext).not.toContain("UNDANGAN-123");
    expect(await decryptSecret(String(row.delivered_ciphertext), String(row.delivered_iv))).toBe("https://canva.com/brand/join?token=UNDANGAN-123");

    expect(emails).toHaveLength(1);
    const [mail] = emails;
    expect(mail.to).toEqual(["pembeli@contoh.test"]);
    expect(mail.subject).toBe("Pembayaran diterima, Canva Pro — Varian 1 sudah siap — AXVARA AXV-20260925-AAAAAAA1");
    expect(mail.html).toContain("UNDANGAN-123");
    expect(mail.html).toContain("PEMBAYARAN DITERIMA");
    expect(mail.html).toContain("/brand/axvara-email-mark.png");
    expect(mail.text).toContain("UNDANGAN-123");
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code=?").get("AXV-20260925-AAAAAAA1")?.fulfillment_status).toBe("delivered");
    // Admin menerima satu notif "Lunas — Web" berstatus terkirim otomatis.
    const [ping] = await adminPings();
    expect(ping.text).toContain("Lunas — Web");
    expect(ping.text).toContain("1 item terkirim otomatis ke email pembeli");
    expect(ping.text).not.toContain("perlu dikirim");

    // Panggilan ulang (webhook ulang / konfirmasi admin) tidak mengirim apa pun lagi.
    await ensureFulfillmentForPaidOrder("AXV-20260925-AAAAAAA1");
    expect(emails).toHaveLength(1);
    expect(await adminPings()).toHaveLength(1);
  });

  it("unique + email → unit stok terkirim, unit ditandai delivered, salinan = ciphertext unit", async () => {
    await seedVariant(1, "unique");
    const unit = await encryptSecret("akun: rani@canva.test / sandi: Rahasia#1");
    fixture.sql.prepare("INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(1,1,?,?,'fp-1')")
      .run(unit.ciphertext, unit.iv);
    await paidWebOrder("AXV-20260925-AAAAAAA2", [1]);
    await ensureFulfillmentForPaidOrder("AXV-20260925-AAAAAAA2");

    const [row] = itemRow("AXV-20260925-AAAAAAA2");
    expect(row.status).toBe("delivered");
    expect(row.delivered_ciphertext).toBe(unit.ciphertext);
    expect(fixture.sql.prepare("SELECT status FROM fulfillment_inventory WHERE id=1").get()?.status).toBe("delivered");
    expect(emails).toHaveLength(1);
    expect(emails[0].html).toContain("rani@canva.test / sandi: Rahasia#1");
  });

  it("Made By Order → antrean admin, tanda terima terpisah, ping admin sekali", async () => {
    await seedVariant(2, "manual");
    await paidWebOrder("AXV-20260925-AAAAAAA3", [2]);
    await ensureFulfillmentForPaidOrder("AXV-20260925-AAAAAAA3");

    const [row] = itemRow("AXV-20260925-AAAAAAA3");
    expect(row.status).toBe("manual_required");
    expect(row.delivered_ciphertext).toBeNull();
    expect(emails.map((m) => m.subject)).toEqual(["Pembayaran pesanan AXV-20260925-AAAAAAA3 diterima"]);
    expect(emails[0].html).toContain("Pembayaran Diterima");
    const pings = await adminPings();
    expect(pings).toHaveLength(1);
    expect(pings[0].text).toContain("AXV-20260925-AAAAAAA3");
    expect(pings[0].text).toContain("pembeli@contoh.test");
    expect(pings[0].text).toContain("Lunas — Web · perlu dikirim admin");
    expect(pings[0].text).toContain("Kirim ke pembeli");

    await ensureFulfillmentForPaidOrder("AXV-20260925-AAAAAAA3");
    expect(await adminPings()).toHaveLength(1);
    expect(emails).toHaveLength(1);
  });

  it("order campuran (kirim otomatis + Made By Order) → tanda terima tetap dikirim terpisah", async () => {
    await seedVariant(1, "shared", "LINK-BERSAMA");
    await seedVariant(2, "manual");
    await paidWebOrder("AXV-20260925-AAAAAAA4", [1, 2]);
    await ensureFulfillmentForPaidOrder("AXV-20260925-AAAAAAA4");
    expect(itemRow("AXV-20260925-AAAAAAA4").map((r) => r.status)).toEqual(["delivered", "manual_required"]);
    expect(emails.map((m) => m.subject).sort()).toEqual([
      "Pembayaran diterima, Canva Pro — Varian 1 sudah siap — AXVARA AXV-20260925-AAAAAAA4",
      "Pembayaran pesanan AXV-20260925-AAAAAAA4 diterima",
    ].sort());
    expect(await adminPings()).toHaveLength(1);
  });

  it("shared tanpa email (order lama) → antrean admin, tanpa email", async () => {
    await seedVariant(1, "shared", "LINK-BERSAMA");
    await paidWebOrder("AXV-20260925-AAAAAAA5", [1], null);
    await ensureFulfillmentForPaidOrder("AXV-20260925-AAAAAAA5");
    const [row] = itemRow("AXV-20260925-AAAAAAA5");
    expect(row.status).toBe("manual_required");
    expect(String(row.last_error)).toContain("web_no_buyer_email");
    expect(emails).toHaveLength(0);
    expect(await adminPings()).toHaveLength(1);
  });

  it("Resend gagal → retry, bukan delivered; pulih pada percobaan berikutnya tanpa email ganda", async () => {
    await seedVariant(1, "shared", "LINK-BERSAMA");
    await paidWebOrder("AXV-20260925-AAAAAAA6", [1]);
    resendOk = false;
    await ensureFulfillmentForPaidOrder("AXV-20260925-AAAAAAA6");
    let [row] = itemRow("AXV-20260925-AAAAAAA6");
    expect(row.status).toBe("retry");
    expect(String(row.last_error)).toContain("delivery_email_failed");
    expect(row.delivered_ciphertext).toBeNull();

    // Resend pulih; pemanggilan berikutnya (cron/webhook ulang) langsung
    // mengklaim baris retry. Email gabungan kini memuat tanda terima, jadi
    // tanda terima terpisah (yang tadi gagal) tidak perlu dikirim lagi.
    resendOk = true;
    await ensureFulfillmentForPaidOrder("AXV-20260925-AAAAAAA6");
    [row] = itemRow("AXV-20260925-AAAAAAA6");
    expect(row.status).toBe("delivered");
    expect(emails.map((m) => m.subject)).toEqual(["Pembayaran diterima, Canva Pro — Varian 1 sudah siap — AXVARA AXV-20260925-AAAAAAA6"]);
  });

  it("email item yang sudah tercatat terkirim tidak dikirim ulang saat retry", async () => {
    await seedVariant(1, "shared", "LINK-BERSAMA");
    await paidWebOrder("AXV-20260925-AAAAAAA7", [1]);
    // Materialisasi baris item tanpa menjalankan pengiriman.
    vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
    await ensureFulfillmentForPaidOrder("AXV-20260925-AAAAAAA7");
    const item = fixture.sql.prepare("SELECT id FROM fulfillment_items WHERE order_code=?").get("AXV-20260925-AAAAAAA7") as { id: number };
    // Simulasi: kirim sukses di percobaan sebelumnya, tetapi status gagal ditulis.
    fixture.sql.prepare("INSERT INTO buyer_notice_log(idempotency_key, order_code, channel, status) VALUES(?, ?, 'email', 'sent')")
      .run(`email:fulfillment-item:${item.id}`, "AXV-20260925-AAAAAAA7");
    emails = [];
    vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
    await ensureFulfillmentForPaidOrder("AXV-20260925-AAAAAAA7");
    expect(itemRow("AXV-20260925-AAAAAAA7")[0].status).toBe("delivered");
    expect(emails.filter((m) => m.subject.startsWith("Pembayaran diterima, Canva Pro"))).toHaveLength(0);
  });
});
