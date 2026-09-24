// src/lib/notify-buyer.ts — Kabar untuk PEMBELI, lintas kanal.
//
// KENAPA ADA (audit ronde 2, 2026-09-23): keputusan sistem dan aksi admin
// selama ini berhenti di sisi admin. Tiga lubang yang ditutup modul ini:
//   1. Serah terima manual menandai item `delivered` tanpa satu pun pesan,
//      padahal pesan lunas Telegram sudah TERLANJUR berjanji "Produk akan
//      dikirim admin melalui DM Telegram pribadi ini".
//   2. Bukti pembayaran ditolak hanya menulis `status='rejected'` — pembeli
//      melihat "Pending" selamanya tanpa alasan dan tanpa jalan keluar.
//   3. Bukti QRIS disetujui membalas `payment_updated:false` (QRIS Hook tetap
//      otoritatif) sehingga order SENGAJA tetap pending — benar secara sistem,
//      tetapi pembeli tidak pernah diberi tahu harus menunggu apa.
//
// Kanal WEB lewat EMAIL (audit ronde 4, 2026-09-24). Dulu web memakai outbox
// WhatsApp seperti kanal WA, padahal bot WA mati (outbox produksi 18–19 Sep:
// `dead` / `whatsapp_not_connected`), sehingga keempat kabar di atas tidak
// pernah sampai ke pembeli web. Email wajib di checkout sejak 2026-09-23.
// Order web lama tanpa email tetap jatuh ke outbox WA.
//
// Pengiriman sengaja best-effort dan TIDAK PERNAH melempar: kabar yang gagal
// terkirim tidak boleh membatalkan serah terima atau review bukti yang sudah
// sah tercatat. Idempotensi: WA lewat `idempotency_key` outbox; email dan
// Telegram lewat `buyer_notice_log` (migrasi 0039), karena satu order bisa
// memicu kabar yang sama berkali-kali (beberapa item/link WR yang gagal).
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { escapeHtml } from "@/lib/telegram/messages/format";

type Notice = {
  subject: string;
  /** HTML sederhana (`<b>`, `<code>`, baris baru) — sah untuk Telegram & email. */
  body: string;
  /** Ajakan khusus chat, mis. "balas pesan ini" (tidak berlaku untuk email noreply). */
  chatCta?: string;
  refKey: string;
};

/** Batas kirim per kabar: dipanggil dari webhook/cron yang punya deadline. */
const NOTICE_EMAIL_TIMEOUT_MS = 8_000;

const EMAIL_CTA = "Butuh bantuan? Buka halaman pesanan di bawah lalu hubungi admin lewat tombol WA Admin atau Telegram.";

function siteUrl(): string {
  return (process.env.SITE_URL || "https://axvara.tech").replace(/\/$/, "");
}

/** true = pemanggil ini berhak mengirim; false = sudah terkirim / sedang dikirim worker lain. */
async function claimNotice(database: DatabaseAccess, key: string, orderCode: string, channel: "email" | "telegram"): Promise<boolean> {
  try {
    const result = await database.execRun(
      `INSERT INTO buyer_notice_log (idempotency_key, order_code, channel, status)
       VALUES (?, ?, ?, 'sending')
       ON CONFLICT(idempotency_key) DO UPDATE SET status='sending', error=NULL, updated_at=datetime('now')
       WHERE buyer_notice_log.status='failed'
          OR (buyer_notice_log.status='sending'
              AND julianday(buyer_notice_log.updated_at) < julianday('now','-10 minutes'))`,
      key, orderCode, channel,
    );
    return Number(result.changes ?? 0) > 0;
  } catch {
    // Ledger tak terbaca: lebih baik kabar berisiko ganda daripada hilang.
    return true;
  }
}

async function settleNotice(database: DatabaseAccess, key: string, ok: boolean, providerId?: string, error?: string) {
  await database.execRun(
    `UPDATE buyer_notice_log SET status=?, provider_id=?, error=?, updated_at=datetime('now') WHERE idempotency_key=?`,
    ok ? "sent" : "failed", providerId ?? null, ok ? null : String(error || "send_failed").slice(0, 300), key,
  ).catch(() => undefined);
}

async function sendEmailNotice(database: DatabaseAccess, orderCode: string, to: string, notice: Notice): Promise<boolean> {
  const key = `email:${notice.refKey}`;
  if (!(await claimNotice(database, key, orderCode, "email"))) return true;
  const orderUrl = `${siteUrl()}/pesanan/${encodeURIComponent(orderCode)}`;
  const plain = notice.body.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
  let result: { ok: boolean; providerId?: string; error?: string };
  try {
    const { sendForwardEmail } = await import("@/lib/warung-rebahan/forward-sender");
    result = await sendForwardEmail({
      to,
      subject: notice.subject,
      html: `<div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.6">
  <p>${notice.body.replace(/\n/g, "<br>")}</p>
  <p>${EMAIL_CTA}</p>
  <p><a href="${orderUrl}">${orderUrl}</a></p>
  <p style="color:#666;font-size:12px">Email otomatis dari Axvara.</p>
</div>`,
      text: `${plain}\n\n${EMAIL_CTA}\n${orderUrl}\n\nEmail otomatis dari Axvara.`,
      timeoutMs: NOTICE_EMAIL_TIMEOUT_MS,
    });
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : "resend_failed" };
  }
  await settleNotice(database, key, result.ok, result.providerId, result.error);
  return result.ok;
}

/** Kirim satu kabar ke pembeli lewat kanal asal order. */
async function sendToBuyer(
  orderCode: string,
  notice: Notice,
  database: DatabaseAccess,
  options: { whatsappFallback?: boolean } = {},
): Promise<boolean> {
  const { queryFirst } = database;
  const order = await queryFirst(
    `SELECT code, sales_channel, customer_wa, customer_email, telegram_user_id
     FROM orders WHERE code=?`,
    orderCode,
  ).catch(() => null);
  if (!order) return false;

  const channel = String(order.sales_channel || "web");
  const chatText = notice.chatCta ? `${notice.body}\n\n${notice.chatCta}` : notice.body;

  if (channel === "telegram") {
    // HANYA chat pribadi terverifikasi — tidak pernah ke id grup (issue #5).
    const buyerId = String(order.telegram_user_id || "");
    if (!buyerId) return false;
    const row = await queryFirst(`SELECT chat_id FROM telegram_users WHERE user_id=?`, buyerId).catch(() => null);
    const chatId = String(row?.chat_id || "");
    if (!chatId || Number(chatId) <= 0) return false;
    const key = `telegram:${notice.refKey}`;
    if (!(await claimNotice(database, key, orderCode, "telegram"))) return true;
    const { sendMessage } = await import("@/lib/telegram/api");
    const sent = await sendMessage({ chat_id: chatId, text: chatText, parse_mode: "HTML" })
      .catch(() => ({ ok: false, description: "telegram_send_failed" }));
    await settleNotice(database, key, Boolean(sent?.ok), undefined, sent?.description);
    return Boolean(sent?.ok);
  }

  if (channel === "web") {
    const email = String(order.customer_email || "").trim();
    if (email) return await sendEmailNotice(database, orderCode, email, notice);
  }

  if (options.whatsappFallback === false) return false;
  const target = String(order.customer_wa || "").trim();
  if (!target) return false;
  const { enqueueWhatsAppMessage, waOutboxKey } = await import("@/lib/whatsapp/outbox");
  return await enqueueWhatsAppMessage(waOutboxKey("text", notice.refKey), target, chatText).catch(() => false);
}

/** Pesan setelah admin menyerahkan produk secara manual. */
export async function notifyBuyerHandover(
  orderCode: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  return await sendToBuyer(orderCode, {
    subject: `Pesanan ${orderCode} sudah diserahkan`,
    body: `✅ <b>Pesanan selesai diserahkan</b>\nOrder: <code>${orderCode}</code>\n\nAdmin sudah mengirimkan produkmu.`,
    chatCta: "Jika belum menerimanya, balas pesan ini.",
    refKey: `handover:${orderCode}`,
  }, database).catch(() => false);
}

/** Pesan saat bukti pembayaran ditolak — alasan WAJIB disertakan. */
export async function notifyBuyerProofRejected(
  orderCode: string,
  reason: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  const clean = String(reason || "").trim();
  return await sendToBuyer(orderCode, {
    subject: `Bukti pembayaran pesanan ${orderCode} ditolak`,
    body: `⚠️ <b>Bukti pembayaran ditolak</b>\nOrder: <code>${orderCode}</code>\n`
      + (clean ? `Alasan: ${escapeHtml(clean)}\n` : "")
      + "\nPesananmu belum lunas. Silakan bayar ulang lewat QRIS atau hubungi admin bila merasa ini keliru.",
    // Alasan ikut kunci: penolakan kedua dengan alasan berbeda tetap terkirim.
    refKey: `proof-rejected:${orderCode}:${clean.slice(0, 40)}`,
  }, database).catch(() => false);
}

/**
 * Pesan saat screenshot QRIS disetujui admin TETAPI status lunas masih
 * menunggu QRIS Hook. Order sengaja tetap pending — tanpa pesan ini pembeli
 * mengira sudah beres.
 */
export async function notifyBuyerProofPendingHook(
  orderCode: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  return await sendToBuyer(orderCode, {
    subject: `Bukti pembayaran pesanan ${orderCode} diterima`,
    body: `ℹ️ <b>Bukti diterima</b>\nOrder: <code>${orderCode}</code>\n\n`
      + "Pembayaran QRIS dikonfirmasi otomatis oleh sistem, jadi statusnya masih "
      + "menunggu verifikasi. Kamu akan dikabari lagi begitu pembayaran tercatat lunas.",
    refKey: `proof-pending-hook:${orderCode}`,
  }, database).catch(() => false);
}

/**
 * Pesan saat pengiriman produk GAGAL permanen padahal order sudah lunas.
 *
 * Dulu kegagalan terminal hanya membunyikan Telegram ADMIN
 * (`adminDeliveryFailedNotification`); pembeli yang sudah membayar tidak
 * pernah diberi tahu dan menunggu tanpa batas — pasangan alami dari
 * ketiadaan alur refund. Nada pesan sengaja menjanjikan tindak lanjut manual
 * (admin memang sudah dapat notifikasi + tombol "Serahkan manual").
 * Dipanggil dari jalur fulfillment biasa DAN jalur Warung Rebahan; kunci
 * idempoten per order menjaga pembeli hanya menerima satu kabar.
 */
export async function notifyBuyerDeliveryFailed(
  orderCode: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  return await sendToBuyer(orderCode, {
    subject: `Pengiriman pesanan ${orderCode} bermasalah`,
    body: `⚠️ <b>Pengiriman produk bermasalah</b>\nOrder: <code>${orderCode}</code>\n\n`
      + "Pembayaranmu sudah kami terima, tetapi produk gagal dikirim otomatis. "
      + "Admin sudah mendapat notifikasi dan akan menyerahkannya manual.",
    chatCta: "Balas pesan ini bila belum ada kabar.",
    refKey: `delivery-failed:${orderCode}`,
  }, database).catch(() => false);
}

/**
 * Tanda terima pembayaran untuk pembeli WEB (audit ronde 4, B-H1).
 *
 * Telegram sudah punya `notifyTelegramBuyerPaid`. Pembeli web dulu tidak
 * menerima apa pun sampai produknya terkirim — untuk produk Made By Order
 * bisa sampai 12 jam — jadi yang menutup tab setelah bayar tidak tahu
 * uangnya sudah tercatat. Tanpa fallback WA: bot WA mati.
 */
export async function notifyBuyerPaymentReceived(
  orderCode: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  return await sendToBuyer(orderCode, {
    subject: `Pembayaran pesanan ${orderCode} diterima`,
    body: `✅ <b>Pembayaran diterima</b>\nOrder: <code>${orderCode}</code>\n\n`
      + "Pembayaranmu sudah tercatat dan pesanan sedang diproses. Detail produk dikirim "
      + "ke email ini dan juga tampil di halaman pesanan.",
    refKey: `payment-received:${orderCode}`,
  }, database, { whatsappFallback: false }).catch(() => false);
}
