/** Log costly reads without SQL, bind parameters or row contents, and without
 * spending D1 writes on telemetry. Query Insights covers other call methods. */
export function logD1ReadCost(sql: string, meta?: { rows_read?: number; rows_written?: number }) {
  if (!meta || Number(meta.rows_read) < 1000 || !Number.isFinite(meta.rows_read)) return;
  const scope = sql.includes("paid AS MATERIALIZED") ? "financial_report"
    : sql.includes("attention JOIN orders") ? "overview_attention"
    : sql.includes("telegram_chat_id") || sql.includes("recipient_target") ? "telegram_recipient"
    : sql.includes("total_orders") || sql.includes("fj.status AS status") ? "overview_metrics"
    : sql.includes("FROM products p") ? "market_catalog"
    : sql.includes("pedia_supplier_services") ? "pedia_catalog"
    : sql.includes("FROM supplier_pairs sp") || sql.includes("supplier_pair_dirty") ? "supplier_pairs" : "other";
  try { console.info("[d1-read]", JSON.stringify({ scope, rows_read: meta.rows_read, rows_written: meta.rows_written ?? 0 })); }
  catch { /* Observability cannot fail a database read. */ }
}
