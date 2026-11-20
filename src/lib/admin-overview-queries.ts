// Start with actionable rows, then look up paid orders by their unique code.
// DISTINCT preserves one attention count for a job + multiple failing items.
export const OVERVIEW_ATTENTION_SQL = `SELECT COUNT(DISTINCT o.code) AS count FROM (
  SELECT order_code FROM fulfillment_jobs INDEXED BY idx_fulfillment_jobs_status WHERE status IN ('manual_required','retry','failed')
  UNION ALL
  SELECT order_code FROM fulfillment_items INDEXED BY idx_fulfillment_items_next WHERE status IN ('manual_required','retry','failed')
) attention CROSS JOIN orders o ON o.code=attention.order_code
WHERE o.status='lunas' AND o.payment_status='paid'
  AND COALESCE(o.order_kind,'apps') NOT IN ('pedia','games')`;

export const AGED_MANUAL_REQUIRED_WHERE = `o.fulfillment_status='manual_required'
  AND datetime(COALESCE(o.paid_at,o.created_at)) < datetime('now','-24 hours')`;

export const OVERVIEW_MANUAL_ATTENTION_SQL = `SELECT
  (SELECT COUNT(*) FROM orders o WHERE o.status='lunas' AND o.payment_status='paid' AND ${AGED_MANUAL_REQUIRED_WHERE}) AS aged_manual_required,
  (SELECT COUNT(*) FROM games_order_items i CROSS JOIN orders o ON o.code=i.order_code
   WHERE i.status='needs_check' AND o.order_kind='games' AND o.status='lunas' AND o.payment_status='paid') AS games_needs_check`;

// SATU definisi "Perlu dicek" untuk Rekonsiliasi dan badge overview
// (keputusan owner 13 November 2026): event QRIS yang masih menunggu tindakan
// admin. Event yang sudah ditandai "sudah dicek" (reviewed_by terisi lewat
// aksi mark_reviewed) keluar dari hitungan sehingga badge berhenti. Tanpa
// jendela waktu — definisi ini HARUS sama di kedua endpoint.
export const PAYMENT_ATTENTION_WHERE = `status IN ('received','ignored','failed') AND reviewed_by IS NULL`;
export const PAYMENT_ATTENTION_SQL = `SELECT COUNT(*) AS count FROM dana_webhook_events WHERE ${PAYMENT_ATTENTION_WHERE}`;


// summarizeQueue consumes only active/actionable states; completed history is
// not a health signal. Last successful sends are measured separately.
export const OVERVIEW_JOB_QUEUE_SQL = `SELECT fj.status AS status,COUNT(*) AS count
FROM fulfillment_jobs fj INDEXED BY idx_fulfillment_jobs_status CROSS JOIN orders o ON o.code=fj.order_code
WHERE fj.status IN ('queued','sending','retry','failed','manual_required')
  AND o.status='lunas' AND o.payment_status='paid'
  AND COALESCE(o.order_kind,'apps') NOT IN ('pedia','games') GROUP BY fj.status`;
