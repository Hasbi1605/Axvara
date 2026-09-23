import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { sendMessage } from "@/lib/telegram/api";
import { qrisExpiredKeyboard } from "@/lib/telegram/keyboards";
import { orderExpiredMessage, qrisExpiredMessage } from "@/lib/telegram/messages/status";
import { qrisExpiredMessage as waExpiredMessage } from "@/lib/whatsapp/messages";

// Separate invoice expiry (one renewal available) from terminal order expiry.
// A persisted marker retries failed Telegram sends; WA uses its durable outbox.
//
// Kanal WEB disertakan sejak 2026-09-23 (F7). Sebelumnya filter hanya
// `('telegram','whatsapp')` sehingga pembeli web TIDAK PERNAH diingatkan —
// padahal justru merekalah yang boleh memperpanjang QRIS (`reissue` hanya
// mengecualikan WhatsApp). Mereka baru tahu QR-nya hangus bila kebetulan
// membuka halaman lagi; tab yang sudah ditutup = tidak tahu sama sekali.
// Jalurnya email (Resend), yang sejak revamp checkout 2026-09-23 selalu
// terisi untuk order web karena email kini wajib di form.
export const QRIS_EXPIRY_NOTICE_WHERE = `pt.provider='dana'
  AND o.sales_channel IN ('telegram','whatsapp','web')
  AND ((o.status='pending' AND pt.status='pending' AND o.sales_channel IN ('telegram','web')
        AND o.qris_reissue_count=0 AND julianday(o.expires_at)>julianday('now')
        AND julianday(pt.expires_at)<=julianday('now')
        AND COALESCE(pt.expiry_notice_state,'')!='renewable')
    OR (o.status='kadaluarsa' AND pt.status='expired'
        AND COALESCE(pt.expiry_notice_state,'')!='terminal'))`;

/**
 * Email kedaluwarsa QRIS untuk pembeli WEB.
 *
 * Dua nada berbeda, sesuai apa yang masih bisa dilakukan pembeli:
 * - `terminal`: pesanan sudah mati, arahkan belanja ulang.
 * - renewable: QR lama hangus TAPI pesanan masih hidup dan pembeli boleh
 *   menerbitkan QR baru sekali (MAX_QRIS_REISSUES) dari halaman pesanan —
 *   inilah kabar yang selama ini tidak pernah sampai ke kanal web.
 */
async function sendWebQrisExpiryEmail(
  to: string,
  orderCode: string,
  terminal: boolean,
): Promise<{ ok: boolean }> {
  const siteUrl = (process.env.SITE_URL || "https://axvara.tech").replace(/\/$/, "");
  const orderUrl = `${siteUrl}/pesanan/${encodeURIComponent(orderCode)}`;
  const subject = terminal
    ? `Pesanan ${orderCode} kedaluwarsa`
    : `Kode QRIS pesanan ${orderCode} sudah hangus — perpanjang sekarang`;
  const headline = terminal
    ? "Pesanan kamu kedaluwarsa karena pembayaran tidak diterima sampai batas waktu."
    : "Kode QRIS-mu sudah hangus, tetapi pesanan masih bisa diselamatkan.";
  const action = terminal
    ? "Silakan pesan ulang bila masih membutuhkan produknya."
    : "Buka halaman pesanan lalu tekan <b>Perpanjang QRIS</b> untuk mendapatkan kode baru. Perpanjangan tersedia satu kali.";
  const actionText = terminal
    ? "Silakan pesan ulang bila masih membutuhkan produknya."
    : "Buka halaman pesanan lalu tekan \"Perpanjang QRIS\" untuk mendapatkan kode baru. Perpanjangan tersedia satu kali.";
  try {
    const { sendForwardEmail } = await import("@/lib/warung-rebahan/forward-sender");
    const result = await sendForwardEmail({
      to,
      subject,
      html: `<div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.6">
  <p>${headline}</p>
  <p>Kode pesanan: <b>${orderCode}</b></p>
  <p>${action}</p>
  <p><a href="${orderUrl}">${orderUrl}</a></p>
  <p style="color:#666;font-size:12px">Email otomatis dari Axvara. Balas email ini bila butuh bantuan.</p>
</div>`,
      text: `${headline}\n\nKode pesanan: ${orderCode}\n${actionText}\n${orderUrl}\n\nEmail otomatis dari Axvara.`,
    });
    return { ok: result.ok };
  } catch {
    return { ok: false };
  }
}

export async function sendQrisExpiryNotifications(limit = 2, database: DatabaseAccess = createDatabaseAccess()) {
  const rows = await database.queryAll(`SELECT o.code, o.status, o.sales_channel, o.telegram_chat_id,
    o.channel_conversation_id, o.customer_email, pt.expires_at FROM payment_transactions pt
    JOIN orders o ON o.code=pt.order_code WHERE ${QRIS_EXPIRY_NOTICE_WHERE}
    ORDER BY julianday(pt.expires_at), o.code LIMIT ?`, limit);
  let sent = 0;
  let whatsappQueued = 0;
  let emailSent = 0;
  for (const row of rows) {
    if (!database.canSpend(2)) break;
    const terminal = row.status === "kadaluarsa";
    const state = terminal ? "terminal" : "renewable";
    const code = String(row.code);
    try {
      if (row.sales_channel === "whatsapp") {
        if (!row.channel_conversation_id) continue;
        await database.execRun(`INSERT OR IGNORE INTO whatsapp_outbox
          (idempotency_key,channel,destination,message_type,payload,status,attempt_count,next_attempt_at)
          VALUES (?,'whatsapp',?,'text',?,'pending',0,datetime('now'))`,
          `wa:qris-expired:${code}`, String(row.channel_conversation_id), waExpiredMessage(code));
        whatsappQueued++;
      } else if (row.sales_channel === "web") {
        // Web tidak punya kanal chat: satu-satunya jalur push adalah email.
        // Tanpa email terisi, lewati TANPA menandai `expiry_notice_state` agar
        // tidak ada kabar yang hilang diam-diam (order lama pra-revamp).
        const to = String(row.customer_email || "").trim();
        if (!to) continue;
        const result = await sendWebQrisExpiryEmail(to, code, terminal);
        if (!result.ok) continue;
        emailSent++;
      } else {
        if (!row.telegram_chat_id) continue;
        const result = await sendMessage({ chat_id: String(row.telegram_chat_id), parse_mode: "HTML",
          text: terminal ? orderExpiredMessage(code) : qrisExpiredMessage(code),
          reply_markup: terminal ? undefined : qrisExpiredKeyboard(code) });
        if (!result.ok) continue;
      }
      // A renewal racing delivery must not mark the new invoice as notified.
      await database.execRun(`UPDATE payment_transactions SET expiry_notice_state=?
        WHERE order_code=? AND expires_at=? AND status=?`,
        state, code, row.expires_at, terminal ? "expired" : "pending");
      sent++;
    } catch { /* Leave marker unset: next cron retries. */ }
  }
  return { sent, whatsappQueued, emailSent };
}
