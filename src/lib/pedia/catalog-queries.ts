// Start from the curated catalog, never the complete supplier mirror.
// Supplier is part of the key: the two providers may reuse service IDs.
export const PEDIA_CATALOG_BOUNDS_SQL = `SELECT DISTINCT
    s.supplier, s.service_id, s.min_qty, s.max_qty, s.rate_idr_per_1k, s.api_refill,
    st.avg_time, st.orders_7d, st.success_rate, st.refill_rate
  FROM pedia_tiers t
  JOIN pedia_products p ON p.id=t.product_id AND p.is_active=1
  JOIN pedia_supplier_services s
    ON s.supplier=t.supplier AND s.service_id=t.supplier_service_id
  LEFT JOIN pedia_service_stats st
    ON st.supplier=s.supplier AND st.service_id=s.service_id
  WHERE t.is_active=1 AND s.present=1
    AND s.type=(CASE WHEN t.input_kind='comments' THEN 'Custom Comments' ELSE 'Default' END)
    AND s.rate_idr_per_1k>0`;
