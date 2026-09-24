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
//
// Antrean hanya berisi baris yang BISA dikirim. Baris tanpa tujuan (order web
// pra-revamp tanpa email) dulu terpilih ulang tiap cron lalu dilewati; dengan
// LIMIT 2 dua baris seperti itu menyumbat seluruh antrean, termasuk Telegram.
// Karena disaring di sini, bila email terisi kemudian kabarnya tetap terkirim.
// Cabang terminal dibatasi order yang kedaluwarsa <24 jam: migrasi 0026 hanya
// menandai riwayat saat kolom dibuat, jadi tanpa batas ini seluruh riwayat
// web sesudahnya ikut antre, dan kabar yang telat berhari-hari hanyalah spam.
export const QRIS_EXPIRY_NOTICE_WHERE = `pt.provider='dana'
  AND o.sales_channel IN ('telegram','whatsapp','web')
  AND CASE o.sales_channel
        WHEN 'web' THEN TRIM(COALESCE(o.customer_email,''))!=''
        WHEN 'telegram' THEN COALESCE(o.telegram_chat_id,'')!=''
        ELSE COALESCE(o.channel_conversation_id,'')!='' END
  AND ((o.status='pending' AND pt.status='pending' AND o.sales_channel IN ('telegram','web')
        AND o.qris_reissue_count=0 AND julianday(o.expires_at)>julianday('now')
        AND julianday(pt.expires_at)<=julianday('now')
        AND COALESCE(pt.expiry_notice_state,'')!='renewable')
    OR (o.status='kadaluarsa' AND pt.status='expired'
        AND julianday(o.expires_at)>julianday('now','-1 day')
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
  try {
    const { sendForwardEmail } = await import("@/lib/warung-rebahan/forward-sender");
    const { renderBrandedNotice } = await import("@/lib/warung-rebahan/email-forward");
    const { SITE } = await import("@/lib/site");
    // Shell bermerek yang sama dengan email pembeli lain (2026-09-25).
    const rendered = renderBrandedNotice(terminal
      ? {
          orderCode, orderUrl, supportWa: SITE.adminWaLocal,
          title: "Pesanan Kedaluwarsa",
          subtitle: "Pembayaran tidak diterima sampai batas waktu.",
          paragraphs: [
            `Pesanan ${orderCode} kedaluwarsa karena pembayaran tidak diterima sampai batas waktu.`,
            "Silakan pesan ulang bila masih membutuhkan produknya.",
          ],
        }
      : {
          orderCode, orderUrl, supportWa: SITE.adminWaLocal,
          title: "Kode QRIS Hangus",
          subtitle: "Pesananmu masih bisa diselamatkan.",
          paragraphs: [
            `Kode QRIS untuk pesanan ${orderCode} sudah hangus, tetapi pesanannya masih aktif.`,
            "Buka halaman pesanan lalu tekan Perpanjang QRIS untuk mendapatkan kode baru.",
          ],
          callout: { text: "Perpanjangan QRIS tersedia satu kali.", tone: "info" },
        });
    const result = await sendForwardEmail({
      to,
      subject,
      // Cron: dua kiriman × 20 dtk dulu bisa melewati deadline run 45 dtk.
      timeoutMs: 8_000,
      html: rendered.html,
      text: rendered.text,
    });
    return { ok: result.ok };
  } catch {
    return { ok: false };
  }
}

export async function sendQrisExpiryNotifications(
  limit = 2,
  database: DatabaseAccess = createDatabaseAccess(),
  options: { hasTime?: () => boolean } = {},
) {
  // Satu jalur per jenis kabar: peringkat dihitung per cabang (renewable /
  // terminal), lalu diambil bergiliran, jadi dengan LIMIT 2 masing-masing
  // dapat satu slot bila keduanya ada. Dulu renewable-selalu-dulu membuat
  // renewable yang gagal terus (bot diblokir) menahan kabar terminal sampai
  // ±45 menit. Di dalam jalur, yang TERBARU dulu agar baris gagal tenggelam.
  const rows = await database.queryAll(`SELECT * FROM (
      SELECT o.code, o.status, o.sales_channel, o.telegram_chat_id,
        o.channel_conversation_id, o.customer_email, pt.expires_at,
        ROW_NUMBER() OVER (PARTITION BY o.status='pending'
                           ORDER BY julianday(pt.expires_at) DESC, o.code) AS lane_rank
      FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code
      WHERE ${QRIS_EXPIRY_NOTICE_WHERE})
    ORDER BY lane_rank, CASE WHEN status='pending' THEN 0 ELSE 1 END, code
    LIMIT ?`, limit);
  let sent = 0;
  let whatsappQueued = 0;
  let emailSent = 0;
  for (const row of rows) {
    if (!database.canSpend(2)) break;
    // Gerbang fase hanya dicek sekali di depan; tiap kiriman bisa menunggu
    // jaringan sampai ±10 dtk, jadi cek ulang sebelum baris berikutnya.
    if (options.hasTime && !options.hasTime()) break;
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
        // Baris tanpa email sudah disaring WHERE; guard ini hanya pengaman.
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
