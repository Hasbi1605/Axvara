export const ADMIN_PAID_PREFIX = "admin-paid:";
export const LEGACY_ADMIN_PAID_TIMEOUT_PREFIX = "admin-paid-timeout:";
// A retry timestamp is only written for a proven Bot API rejection. Old
// 'failed' rows have none: they may have been accepted and are quarantined.
export const ADMIN_PAID_RETRY_DUE = `b.status='failed' AND julianday(b.access_retry_at) <= julianday('now')`;
const PAID_ADMIN_PENDING = `o.status='lunas' AND o.payment_status='paid'
  AND julianday(COALESCE(o.paid_at, o.updated_at)) >= julianday('now','-6 hours')
  AND NOT EXISTS(SELECT 1 FROM buyer_notice_log bt WHERE bt.idempotency_key='${LEGACY_ADMIN_PAID_TIMEOUT_PREFIX}' || o.code)
  AND NOT EXISTS(SELECT 1 FROM buyer_notice_log b WHERE b.idempotency_key='${ADMIN_PAID_PREFIX}' || o.code
    AND (${ADMIN_PAID_RETRY_DUE}) IS NOT TRUE)`;
export const WEB_PAID_ADMIN_PENDING_WHERE = `o.sales_channel='web' AND ${PAID_ADMIN_PENDING}`;
export const CHAT_PAID_ADMIN_PENDING_WHERE = `o.sales_channel IN ('telegram','whatsapp')
  AND o.telegram_paid_admin_notified_at IS NULL AND ${PAID_ADMIN_PENDING}`;

/** A forced phase needs only its own probes. The legacy rotation still reads
 * every signal, preserving its admission and anti-starvation decisions. */
export function operationQueueProbeSql(phase: string | null, qrisWhere: string, webPaidWhere: string): string | null {
  const probes: [string, string][] = [
    ["expiry", "(SELECT COUNT(*) FROM payment_transactions WHERE status='pending') AS expiry"],
    ["notify", `(SELECT COUNT(*) FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code WHERE ${qrisWhere}) AS qris_notice`],
    ["expiry", "(SELECT COUNT(*) FROM payment_transactions WHERE status='initializing' AND created_at < datetime('now', '-5 minutes')) AS expiry_init"],
    ["expiry", `(SELECT COUNT(*) FROM orders WHERE sales_channel='whatsapp' AND status='pending' AND expires_at IS NOT NULL
      AND datetime(expires_at) <= datetime('now')
      AND NOT EXISTS(SELECT 1 FROM payment_transactions pt WHERE pt.order_code=orders.code)) AS expiry_manual_wa`],
    ["notify", "(SELECT COUNT(*) FROM whatsapp_outbox WHERE status IN ('pending','failed') AND attempt_count < 5 AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))) AS wa"],
    ["notify", "(SELECT COUNT(*) FROM whatsapp_outbox WHERE status='sending' AND (locked_until IS NULL OR datetime(locked_until) <= datetime('now'))) AS wa_stale"],
    ["fulfillment", "(SELECT COUNT(*) FROM fulfillment_jobs fj JOIN orders o ON o.code=fj.order_code WHERE fj.status IN ('queued','retry') AND o.status='lunas' AND o.payment_status='paid') AS jobs"],
    ["notify", "(SELECT COUNT(*) FROM orders WHERE sales_channel IN ('telegram','whatsapp') AND telegram_order_notified_at IS NULL) AS created"],
    ["notify", "(SELECT COUNT(*) FROM orders WHERE sales_channel='telegram' AND status='lunas' AND payment_status='paid' AND telegram_paid_notified_at IS NULL) AS paid"],
    ["notify", `(SELECT COUNT(*) FROM orders o WHERE ${CHAT_PAID_ADMIN_PENDING_WHERE}) AS paid_admin`],
    ["notify", `(SELECT COUNT(*) FROM orders o WHERE ${webPaidWhere}) AS paid_admin_web`],
    ["notify", `(SELECT EXISTS(SELECT 1 FROM buyer_notice_log
      WHERE idempotency_key >= 'email:credential_access:' AND idempotency_key < 'email:credential_access;'
        AND access_attempts < 5
        AND ((status='failed' AND (access_retry_at IS NULL OR datetime(access_retry_at)<=datetime('now')))
          OR (status='sending' AND julianday(updated_at)<julianday('now','-10 minutes'))))) AS pin_due`],
    ["fulfillment", "(SELECT COUNT(*) FROM fulfillment_jobs WHERE status='sending') AS stale"],
  ];
  const selected = probes.filter(([owner]) => phase == null || owner === phase);
  return selected.length ? `SELECT\n${selected.map(([, sql]) => sql).join(",\n")}` : null;
}
