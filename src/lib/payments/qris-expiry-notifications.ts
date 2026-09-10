import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { sendMessage } from "@/lib/telegram/api";
import { qrisExpiredKeyboard } from "@/lib/telegram/keyboards";
import { orderExpiredMessage, qrisExpiredMessage } from "@/lib/telegram/messages/status";
import { qrisExpiredMessage as waExpiredMessage } from "@/lib/whatsapp/messages";

// Separate invoice expiry (one renewal available) from terminal order expiry.
// A persisted marker retries failed Telegram sends; WA uses its durable outbox.
export const QRIS_EXPIRY_NOTICE_WHERE = `pt.provider='dana'
  AND o.sales_channel IN ('telegram','whatsapp')
  AND ((o.status='pending' AND pt.status='pending' AND o.sales_channel='telegram'
        AND o.qris_reissue_count=0 AND julianday(o.expires_at)>julianday('now')
        AND julianday(pt.expires_at)<=julianday('now')
        AND COALESCE(pt.expiry_notice_state,'')!='renewable')
    OR (o.status='kadaluarsa' AND pt.status='expired'
        AND COALESCE(pt.expiry_notice_state,'')!='terminal'))`;

export async function sendQrisExpiryNotifications(limit = 2, database: DatabaseAccess = createDatabaseAccess()) {
  const rows = await database.queryAll(`SELECT o.code, o.status, o.sales_channel, o.telegram_chat_id,
    o.channel_conversation_id, pt.expires_at FROM payment_transactions pt
    JOIN orders o ON o.code=pt.order_code WHERE ${QRIS_EXPIRY_NOTICE_WHERE}
    ORDER BY julianday(pt.expires_at), o.code LIMIT ?`, limit);
  let sent = 0;
  let whatsappQueued = 0;
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
  return { sent, whatsappQueued };
}
