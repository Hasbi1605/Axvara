// Start with actionable rows, then look up paid orders by their unique code.
// DISTINCT preserves one attention count for a job + multiple failing items.
export const OVERVIEW_ATTENTION_SQL = `SELECT COUNT(DISTINCT o.code) AS count FROM (
  SELECT order_code FROM fulfillment_jobs INDEXED BY idx_fulfillment_jobs_status WHERE status IN ('manual_required','retry','failed')
  UNION ALL
  SELECT order_code FROM fulfillment_items INDEXED BY idx_fulfillment_items_next WHERE status IN ('manual_required','retry','failed')
) attention CROSS JOIN orders o ON o.code=attention.order_code
WHERE o.status='lunas' AND o.payment_status='paid'`;

// summarizeQueue consumes only active/actionable states; completed history is
// not a health signal. Last successful sends are measured separately.
export const OVERVIEW_JOB_QUEUE_SQL = `SELECT fj.status AS status,COUNT(*) AS count
FROM fulfillment_jobs fj INDEXED BY idx_fulfillment_jobs_status CROSS JOIN orders o ON o.code=fj.order_code
WHERE fj.status IN ('queued','sending','retry','failed','manual_required')
  AND o.status='lunas' AND o.payment_status='paid' GROUP BY fj.status`;
