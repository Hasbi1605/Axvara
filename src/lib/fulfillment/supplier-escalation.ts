import type { DatabaseAccess } from "@/lib/db-access";

/** One attempt per escalation key, including ambiguous Telegram timeouts.
 * The claim precedes transport: a timeout may already have delivered the page. */
export async function alertSupplierAdminOnce(db: DatabaseAccess, code: string, key: string, text: string) {
  if (!process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_BOT_ENABLED !== "true") return false;
  const claim = await db.execRun(`INSERT OR IGNORE INTO buyer_notice_log
    (idempotency_key,order_code,channel,status) VALUES (?,?,'telegram','sending')`, `admin:${key}`, code);
  if (!claim.changes) return false;
  const { notifyAdmin } = await import("@/lib/warung-rebahan/order");
  const outcome = await notifyAdmin(text);
  await db.execRun(`UPDATE buyer_notice_log SET status=?,error=?,updated_at=datetime('now') WHERE idempotency_key=?`,
    outcome?.ok ? "sent" : "failed", outcome?.description === "Request timeout" ? "Request timeout" : outcome?.ok ? null : "send_failed", `admin:${key}`);
  return true;
}

export async function escalateSupplierManual(db: DatabaseAccess, code: string, supplier: "tunvn" | "aivault" | "storebat" | "mirai" | "pixelverif", id: unknown, buyerReason?: string) {
  const manual = `EXISTS(SELECT 1 FROM fulfillment_items fi JOIN ${supplier}_order_links l ON l.id=fi.${supplier}_link_id
    WHERE fi.order_code=? AND l.id=? AND l.status='needs_admin' AND fi.status='manual_required'
      AND fi.last_error='supplier_needs_admin')`;
  if (!db.d1) return;
  const paid = `status='lunas' AND payment_status='paid'`;
  const terminal = `NOT EXISTS(SELECT 1 FROM fulfillment_items fi WHERE fi.order_code=orders.code AND fi.status NOT IN ('delivered','manual_required'))`;
  const [aggregate, job] = await db.d1.batch([
    db.d1.prepare(`UPDATE orders SET fulfillment_status='manual_required',updated_at=datetime('now')
      WHERE code=? AND ${paid} AND ${manual} AND ${terminal}`).bind(code, code, id),
    db.d1.prepare(`UPDATE fulfillment_jobs SET status='queued',attempt_count=0,next_attempt_at=datetime('now'),locked_until=NULL
      WHERE order_code=? AND status IN ('delivered','manual_required','failed') AND ${manual}
        AND EXISTS(SELECT 1 FROM orders WHERE code=? AND ${paid})`).bind(code, code, id, code),
  ]);
  // Mixed carts can still be in flight. Do not wait for the rest of the cart to notify.
  if (!aggregate.meta?.changes && !job.meta?.changes && !(await db.queryFirst(`SELECT 1 WHERE ${manual}
    AND EXISTS(SELECT 1 FROM orders WHERE code=? AND ${paid})`, code, id, code))) return;
  const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  await alertSupplierAdminOnce(db, code, `supplier-manual:${code}`,
    `⚠️ <b>Pesanan supplier perlu ditangani manual</b> <code>${esc(code)}</code>\nCek antrean ${supplier.toUpperCase()} #${esc(String(id))} sebelum beli ulang atau refund.`).catch(() => false);
  const { notifyBuyerDeliveryFailed } = await import("@/lib/notify-buyer");
  await notifyBuyerDeliveryFailed(code, db, undefined, buyerReason).catch(() => false);
}
