import type { DatabaseAccess } from "@/lib/db-access";

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
  const rows = await db.queryAll(`SELECT order_code,reason FROM pedia_followups
    WHERE state='open' AND (buyer_notification_claimed_at IS NULL OR
      (${process.env.TELEGRAM_ADMIN_CHAT_ID ? 1 : 0}=1 AND notification_attempts<3 AND (notification_claimed_at IS NULL OR datetime(notification_retry_at)<=datetime('now'))))
    ORDER BY created_at LIMIT 2`);
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
      await sendPediaBuyerMessage(db, String(row.order_code), `Pesanan Pedia ${row.order_code} memerlukan penyelesaian manual. Hubungi admin dengan kode pesanan melalui https://axvara.tech/wa. Tidak perlu membuat pesanan ulang.`).catch(() => {});
    }
  }
}
