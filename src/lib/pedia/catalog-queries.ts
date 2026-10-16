// Start from the curated catalog, never the complete supplier mirror.
// Supplier is part of the key: the two providers may reuse service IDs.
export const PEDIA_CATALOG_BOUNDS_SQL = `SELECT DISTINCT
    s.supplier, s.service_id, s.min_qty, s.max_qty, s.rate_idr_per_1k
  FROM pedia_tiers t
  JOIN pedia_products p ON p.id=t.product_id AND p.is_active=1
  JOIN pedia_supplier_services s
    ON s.supplier=t.supplier AND s.service_id=t.supplier_service_id
  WHERE t.is_active=1 AND s.present=1 AND s.type='Default'
    AND s.rate_idr_per_1k>0`;
