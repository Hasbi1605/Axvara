import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { sendMessage } from "@/lib/telegram/api";
import { paymentExpiredKeyboard, qrisExpiredKeyboard } from "@/lib/telegram/keyboards";
import { orderCancelledMessage, orderExpiredMessage, qrisExpiredMessage } from "@/lib/telegram/messages/status";
import { invoiceItemSummary } from "@/lib/telegram/messages/format";
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
// R3: gateway/crypto (nowpayments/sekalipay_gateway) terminal notice. Provider is
// the saved TX provider, else (no TX) the saved order payment_method. Delivery
// state lives in the existing buyer_notice_log CAS marker (same fence/backoff as
// the paid notice: <5 attempts, failed or stale-sending rows after retry_at).
// Review-sticky and paid orders are never announced as expired.
const TERMINAL_NOTICE_KEY = "telegram:terminal:";
const TERMINAL_NOTICE_DUE = `b.access_attempts < 5
  AND (b.access_retry_at IS NULL OR datetime(b.access_retry_at) <= datetime('now'))
  AND (b.status='failed' OR (b.status='sending' AND julianday(b.updated_at) <= julianday('now','-10 minutes')))`;
const NEW_RAIL_TERMINAL_NOTICE_WHERE = `(o.sales_channel='telegram' AND COALESCE(o.telegram_chat_id,'')!=''
  AND o.status IN ('kadaluarsa','dibatalkan') AND COALESCE(o.payment_status,'')!='paid'
  AND julianday(o.expires_at)>julianday('now','-1 day')
  AND (pt.provider IN ('nowpayments','sekalipay_gateway')
    OR (pt.order_code IS NULL AND (o.payment_method LIKE 'nowpayments:%' OR o.payment_method LIKE 'sekalipay_gateway:%')))
  AND COALESCE(pt.status,'')!='paid'
  AND COALESCE(pt.last_error,'') NOT LIKE '%manual_review%'
  AND (NOT EXISTS (SELECT 1 FROM buyer_notice_log b WHERE b.idempotency_key='${TERMINAL_NOTICE_KEY}' || o.code)
    OR EXISTS (SELECT 1 FROM buyer_notice_log b WHERE b.idempotency_key='${TERMINAL_NOTICE_KEY}' || o.code AND ${TERMINAL_NOTICE_DUE})))`;

/** Shared by the notifier and the cron-operations queue probe (`orders o LEFT JOIN
 * payment_transactions pt`): QRIS branches need a TX row, the new-rail branch
 * also covers terminal orders that never got one. */
export const QRIS_EXPIRY_NOTICE_WHERE = `((pt.provider IN ('dana','gopay')
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
        AND COALESCE(pt.expiry_notice_state,'')!='terminal')))
  OR ${NEW_RAIL_TERMINAL_NOTICE_WHERE})`;

async function sendNewRailTerminalNotice(database: DatabaseAccess, row: Record<string, unknown>): Promise<boolean> {
  const code = String(row.code);
  const key = `${TERMINAL_NOTICE_KEY}${code}`;
  const lease = crypto.randomUUID();
  const claimed = await database.execRun(
    `INSERT INTO buyer_notice_log AS b
       (idempotency_key, order_code, channel, status, access_attempts, access_lease, access_retry_at)
     SELECT ?, o.code, 'telegram', 'sending', 1, ?, datetime('now','+1 minute')
     FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
     WHERE o.code=? AND o.status=? AND ${NEW_RAIL_TERMINAL_NOTICE_WHERE}
     ON CONFLICT(idempotency_key) DO UPDATE SET
       status='sending', access_attempts=b.access_attempts+1, access_lease=excluded.access_lease,
       access_retry_at=datetime('now', CASE b.access_attempts
         WHEN 0 THEN '+1 minute' WHEN 1 THEN '+5 minutes'
         WHEN 2 THEN '+15 minutes' ELSE '+60 minutes' END),
       error=NULL, updated_at=datetime('now')
     WHERE ${TERMINAL_NOTICE_DUE}`,
     key, lease, code, row.status,
  ).catch(() => ({ changes: 0 }));
  if (!claimed.changes) return false;
  const locale = String(row.locale ?? "") === "en" ? "en" as const : "id" as const;
  const en = locale === "en";
  const result = await sendMessage({
    chat_id: String(row.telegram_chat_id), parse_mode: "HTML",
    text: row.status === "dibatalkan" ? orderCancelledMessage(code, { locale })
      : orderExpiredMessage(code, { locale, productName: invoiceItemSummary(row.items, en) }),
    reply_markup: row.status !== "dibatalkan" ? paymentExpiredKeyboard(row.items, { locale }) : { inline_keyboard: [
      [{ text: en ? "📦 View order" : "📦 Lihat pesanan", callback_data: `order:${code}` }],
      [{ text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: "catalog:0" }],
    ] },
  }).catch(() => ({ ok: false }));
  await database.execRun(
    `UPDATE buyer_notice_log SET status=?, error=?, access_lease=NULL, updated_at=datetime('now')
     WHERE idempotency_key=? AND status='sending' AND access_lease=?`,
    result.ok ? "sent" : "failed", result.ok ? null : "telegram_send_failed", key, lease,
  ).catch(() => undefined);
  return result.ok === true;
}

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
  locale: "id" | "en" = "id",
): Promise<{ ok: boolean }> {
  const siteUrl = (process.env.SITE_URL || "https://axvara.tech").replace(/\/$/, "");
  const orderUrl = `${siteUrl}/pesanan/${encodeURIComponent(orderCode)}`;
  const en = locale === "en";
  const subject = terminal
    ? (en ? `Order ${orderCode} expired` : `Pesanan ${orderCode} kedaluwarsa`)
    : (en ? `QRIS code for order ${orderCode} expired — renew now` : `Kode QRIS pesanan ${orderCode} sudah hangus — perpanjang sekarang`);
  try {
    const { sendForwardEmail } = await import("@/lib/warung-rebahan/forward-sender");
    const { renderBrandedNotice } = await import("@/lib/warung-rebahan/email-forward");
    const { SITE } = await import("@/lib/site");
    // Shell bermerek yang sama dengan email pembeli lain (2026-09-25).
    const rendered = renderBrandedNotice(terminal
      ? {
          orderCode, orderUrl, supportWa: SITE.adminWaLocal,
          locale,
          title: en ? "Order Expired" : "Pesanan Kedaluwarsa",
          subtitle: en ? "Payment was not received before the deadline." : "Pembayaran tidak diterima sampai batas waktu.",
          paragraphs: en ? [
            `Order ${orderCode} expired because payment was not received before the deadline.`,
            "Please place a new order if you still need the product.",
          ] : [
            `Pesanan ${orderCode} kedaluwarsa karena pembayaran tidak diterima sampai batas waktu.`,
            "Silakan pesan ulang bila masih membutuhkan produknya.",
          ],
        }
      : {
          orderCode, orderUrl, supportWa: SITE.adminWaLocal,
          locale,
          title: en ? "QRIS Code Expired" : "Kode QRIS Hangus",
          subtitle: en ? "Your order can still be saved." : "Pesananmu masih bisa diselamatkan.",
          paragraphs: en ? [
            `The QRIS code for order ${orderCode} has expired, but the order is still active.`,
            "Open the order page and press Renew QRIS to get a new code.",
          ] : [
            `Kode QRIS untuk pesanan ${orderCode} sudah hangus, tetapi pesanannya masih aktif.`,
            "Buka halaman pesanan lalu tekan Perpanjang QRIS untuk mendapatkan kode baru.",
          ],
          callout: { text: en ? "QRIS renewal is available once." : "Perpanjangan QRIS tersedia satu kali.", tone: "info" },
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
  limit = 15,
  database: DatabaseAccess = createDatabaseAccess(),
  options: { hasTime?: () => boolean; paceMs?: number; sleepImpl?: (ms: number) => Promise<void> } = {},
) {
  // Satu jalur per jenis kabar: peringkat dihitung per cabang (renewable /
  // terminal), lalu diambil bergiliran, jadi masing-masing jalur tetap mendapat
  // giliran adil. Di dalam jalur, yang TERBARU dulu agar baris gagal tenggelam.
  const rows = await database.queryAll(`SELECT * FROM (
      SELECT o.code, o.status, o.sales_channel, o.telegram_chat_id, o.items,
        o.channel_conversation_id, o.customer_email, pt.expires_at, pt.provider, o.payment_method, o.locale,
        ROW_NUMBER() OVER (PARTITION BY o.status='pending'
                           ORDER BY julianday(COALESCE(pt.expires_at,o.expires_at)) DESC, o.code) AS lane_rank
      FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
      WHERE ${QRIS_EXPIRY_NOTICE_WHERE})
    ORDER BY lane_rank, CASE WHEN status='pending' THEN 0 ELSE 1 END, code
    LIMIT ?`, limit);
  const paceMs = options.paceMs ?? (process.env.NODE_ENV === "test" ? 0 : 1_000);
  const sleep = options.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let sent = 0;
  let whatsappQueued = 0;
  let emailSent = 0;
  let emailCalls = 0;
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
        if (emailCalls > 0 && paceMs > 0) await sleep(paceMs);
        emailCalls++;
        const result = await sendWebQrisExpiryEmail(to, code, terminal, String(row.locale ?? "") === "en" ? "en" : "id");
        if (!result.ok) continue;
        emailSent++;
      } else if (["nowpayments", "sekalipay_gateway"].includes(String(row.provider ?? ""))
        || (!row.provider && /^(nowpayments|sekalipay_gateway):/.test(String(row.payment_method ?? "")))) {
        // R3: gateway/crypto terminal order — generic localized notice, no QRIS
        // copy, no renew button/photo/details. The log row is the sent marker.
        if (!await sendNewRailTerminalNotice(database, row)) continue;
        sent++;
        continue;
      } else {
        if (!row.telegram_chat_id) continue;
        const locale = row.locale === "en" ? "en" : "id";
        const productName = invoiceItemSummary(row.items, locale === "en");
        const result = await sendMessage({ chat_id: String(row.telegram_chat_id), parse_mode: "HTML",
          text: qrisExpiredMessage(code, { locale, productName }),
          reply_markup: terminal ? paymentExpiredKeyboard(row.items, { locale }) : qrisExpiredKeyboard(code, { locale }, row.items) });
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
