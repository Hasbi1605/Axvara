/** A forced phase needs only its own probes. The legacy rotation still reads
 * every signal, preserving its admission and anti-starvation decisions. */
export function operationQueueProbeSql(phase: string | null, qrisWhere: string, webPaidWhere: string): string | null {
  const probes: [string, string][] = [
    ["expiry", "(SELECT COUNT(*) FROM payment_transactions WHERE status='pending') AS expiry"],
    ["notify", `(SELECT COUNT(*) FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code WHERE ${qrisWhere}) AS qris_notice`],
    ["expiry", "(SELECT COUNT(*) FROM payment_transactions WHERE status='initializing' AND created_at < datetime('now', '-5 minutes')) AS expiry_init"],
    ["expiry", `(SELECT COUNT(*) FROM orders WHERE sales_channel='whatsapp' AND status='pending' AND expires_at IS NOT NULL
      AND datetime(expires_at) <= datetime('now')
      AND NOT EXISTS(SELECT 1 FROM payment_transactions pt WHERE pt.order_code=orders.code)) AS expiry_manual_wa`],
    ["notify", "(SELECT COUNT(*) FROM whatsapp_outbox WHERE status IN ('pending','failed') AND attempt_count < 5 AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))) AS wa"],
    ["notify", "(SELECT COUNT(*) FROM whatsapp_outbox WHERE status='sending' AND (locked_until IS NULL OR datetime(locked_until) <= datetime('now'))) AS wa_stale"],
    ["fulfillment", "(SELECT COUNT(*) FROM fulfillment_jobs fj JOIN orders o ON o.code=fj.order_code WHERE fj.status IN ('queued','retry') AND o.status='lunas' AND o.payment_status='paid') AS jobs"],
    ["notify", "(SELECT COUNT(*) FROM orders WHERE sales_channel IN ('telegram','whatsapp') AND telegram_order_notified_at IS NULL) AS created"],
    ["notify", "(SELECT COUNT(*) FROM orders WHERE sales_channel='telegram' AND status='lunas' AND payment_status='paid' AND telegram_paid_notified_at IS NULL) AS paid"],
    ["notify", "(SELECT COUNT(*) FROM orders WHERE sales_channel IN ('telegram','whatsapp') AND status='lunas' AND payment_status='paid' AND telegram_paid_admin_notified_at IS NULL) AS paid_admin"],
    ["notify", `(SELECT COUNT(*) FROM orders o WHERE ${webPaidWhere}) AS paid_admin_web`],
    ["fulfillment", "(SELECT COUNT(*) FROM fulfillment_jobs WHERE status='sending') AS stale"],
  ];
  const selected = probes.filter(([owner]) => phase == null || owner === phase);
  return selected.length ? `SELECT\n${selected.map(([, sql]) => sql).join(",\n")}` : null;
}
