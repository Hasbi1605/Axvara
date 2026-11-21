import type { DatabaseAccess } from "@/lib/db-access";

export function pediaManualResolutionText(code: string, locale: unknown) {
  return locale === "en"
    ? `Pedia order ${code} needs manual resolution. Contact admin with the order code via https://axvara.tech/wa. You do not need to place a new order.`
    : `Pesanan Pedia ${code} memerlukan penyelesaian manual. Hubungi admin dengan kode pesanan melalui https://axvara.tech/wa. Tidak perlu membuat pesanan ulang.`;
}

// The retry window stays inside the provider's 24-hour idempotency window.
// Do not retry legacy 'sending' rows (attempts=0): FX-11 never marked success.
const PLAIN_EMAIL_RETRY_DUE = `access_attempts BETWEEN 1 AND 2
  AND datetime(created_at)>datetime('now','-23 hours')
  AND datetime(access_retry_at)<=datetime('now')
  AND (status='failed' OR (status='sending' AND datetime(updated_at)<=datetime('now','-10 minutes')))`;

async function sendPlainPediaNeedsCheckEmail(db: DatabaseAccess, code: string, retry = false) {
  if (!db.canSpend(2)) return;
  const key = `pedia-manual:${code}`;
  const lease = crypto.randomUUID();
  try {
    const claimed = await db.queryFirst(`INSERT INTO buyer_notice_log
      (idempotency_key,order_code,channel,status,access_attempts,access_lease,access_retry_at)
      SELECT ?,o.code,'email','sending',1,?,datetime('now','+5 minutes')
      FROM orders o JOIN pedia_order_items i ON i.order_code=o.code
      WHERE o.code=? AND o.status='lunas' AND o.payment_status='paid' AND i.status='needs_check'
      ON CONFLICT(idempotency_key) DO ${retry ? `UPDATE SET status='sending',access_attempts=access_attempts+1,
        access_lease=excluded.access_lease,access_retry_at=excluded.access_retry_at,updated_at=datetime('now')
        WHERE ${PLAIN_EMAIL_RETRY_DUE}` : "NOTHING"}
      RETURNING (SELECT customer_email FROM orders WHERE code=?) AS email,
        (SELECT locale FROM orders WHERE code=?) AS locale`, key, lease, code, code, code);
    if (!claimed) return;
    const email = String(claimed.email ?? "").trim();
    let sent = false;
    if (email) {
      try {
        const { sendForwardEmail } = await import("@/lib/warung-rebahan/forward-sender");
        const text = pediaManualResolutionText(code, claimed.locale);
        const html = `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`;
        sent = (await sendForwardEmail({ to: email, subject: `Pedia — ${code}`, text, html, timeoutMs: 8_000, idempotencyKey: key })).ok;
      } catch { /* Settle as failed so a bounded retry can recover. */ }
    }
    const { settlePediaEmail } = await import("./notify-channel");
    await settlePediaEmail(db, key, lease, sent, email ? "send_failed" : "missing_email");
  } catch { /* No durable claim, no transport; the review state stays visible. */ }
}

/** Both direct and recovered needs_check transitions share the same claims. */
export async function notifyPlainPediaNeedsCheck(db: DatabaseAccess, code: string, reason: string) {
  await sendPlainPediaNeedsCheckEmail(db, code);
  if (!process.env.TELEGRAM_ADMIN_CHAT_ID || !db.canSpend(2)) return;
  try {
    const key = `admin:pedia-manual:${code}`;
    const claim = await db.execRun(`INSERT OR IGNORE INTO buyer_notice_log(idempotency_key,order_code,channel,status)
      SELECT ?,order_code,'telegram','sending' FROM pedia_order_items WHERE order_code=? AND status='needs_check'`, key, code);
    if (!claim.changes) return;
    const { notifyPediaNeedsCheck } = await import("./notify");
    const result = await notifyPediaNeedsCheck(db, code, reason).catch(() => "unknown");
    await db.execRun(`UPDATE buyer_notice_log SET status=?,error=?,updated_at=datetime('now')
      WHERE idempotency_key=? AND status='sending'`, result === "sent" ? "sent" : "failed", result === "sent" ? null : result, key);
  } catch { /* An ambiguous Telegram delivery must never resend. */ }
}

/** One due manual email per tick; never scan old orders for missing notices. */
export async function retryPlainPediaNeedsCheckEmail(db: DatabaseAccess) {
  const row = await db.queryFirst(`SELECT b.order_code FROM buyer_notice_log b
    WHERE b.idempotency_key GLOB 'pedia-manual:*' AND ${PLAIN_EMAIL_RETRY_DUE}
      AND EXISTS(SELECT 1 FROM orders o JOIN pedia_order_items i ON i.order_code=o.code WHERE o.code=b.order_code
        AND o.status='lunas' AND o.payment_status='paid' AND i.status='needs_check')
    ORDER BY b.access_retry_at LIMIT 1`).catch(() => null);
  if (row) await sendPlainPediaNeedsCheckEmail(db, String(row.order_code), true);
}

/** A work queue, never a customer balance or a claim that money was refunded.
 * Terminal state and its follow-up commit together; retries preserve resolution.
 */
export async function finishWithFollowup(db: DatabaseAccess, code: string, status: "partial" | "canceled", reason: string, preSubmit = false) {
  if (!db.d1) throw new Error("database_unavailable");
  const guard = preSubmit ? "status='needs_check' AND submit_attempts=0 AND supplier_order_id IS NULL" : "status IN ('submitted','in_progress')";
  const result = await db.d1.batch([
    db.d1.prepare(`UPDATE pedia_order_items SET status=?, completed_at=COALESCE(completed_at,datetime('now')),
      lease_until=NULL,updated_at=datetime('now') WHERE order_code=? AND ${guard}`).bind(status, code),
    db.d1.prepare(`INSERT INTO pedia_followups(order_code,reason)
      SELECT order_code,? FROM pedia_order_items WHERE order_code=? AND status=?
      ON CONFLICT(order_code) DO NOTHING`).bind(reason, code, status),
  ]);
  return Number(result[0]?.meta?.changes) === 1;
}

/** Existing cron drains a bounded outbox. Claim before sending: a crash or
 * ambiguous provider acknowledgement does not cause a message storm. The admin
 * queue remains durable even if delivery is unavailable. No historical broadcast.
 */
export async function notifyPendingPediaFollowups(db: DatabaseAccess) {
  if (!db.canSpend(3)) return;
  const rows = await db.queryAll(`SELECT f.order_code,f.reason,o.locale FROM pedia_followups f
    JOIN orders o ON o.code=f.order_code
    WHERE f.state='open' AND (buyer_notification_claimed_at IS NULL OR
      (${process.env.TELEGRAM_ADMIN_CHAT_ID ? 1 : 0}=1 AND notification_attempts<3 AND (notification_claimed_at IS NULL OR datetime(notification_retry_at)<=datetime('now'))))
    ORDER BY f.created_at LIMIT 2`);
  for (const row of rows) {
    if (!db.canSpend(3)) break;
    if (process.env.TELEGRAM_ADMIN_CHAT_ID) {
      const claim = await db.execRun(`UPDATE pedia_followups SET notification_claimed_at=datetime('now'),
        notification_attempts=notification_attempts+1,notification_retry_at=NULL
        WHERE order_code=? AND state='open' AND notification_attempts<3
          AND (notification_claimed_at IS NULL OR datetime(notification_retry_at)<=datetime('now'))`, row.order_code);
      if (claim.changes === 1) {
        const { notifyPediaNeedsCheck } = await import("./notify");
        const result = await notifyPediaNeedsCheck(db, String(row.order_code), String(row.reason)).catch(() => "unknown");
        // Retry only a conclusive rejection, never an ambiguous send; max 3.
        if (result === "rejected" && db.canSpend(1)) await db.execRun(`UPDATE pedia_followups
          SET notification_retry_at=datetime('now','+5 minutes') WHERE order_code=? AND notification_attempts<3`, row.order_code);
      }
    }
    if (!db.canSpend(2)) break;
    const buyer = await db.execRun(`UPDATE pedia_followups SET buyer_notification_claimed_at=datetime('now')
      WHERE order_code=? AND state='open' AND buyer_notification_claimed_at IS NULL`, row.order_code);
    if (buyer.changes === 1) {
      const { sendPediaBuyerMessage } = await import("./notify-channel");
      // Pesan pembeli mengikuti locale order tersimpan; notis admin di atas tetap ID.
      const text = pediaManualResolutionText(String(row.order_code), row.locale);
      await sendPediaBuyerMessage(db, String(row.order_code), text).catch(() => {});
    }
  }
}
