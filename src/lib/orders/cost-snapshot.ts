/** Run inside the winning payment batch. Replay never replaces a paid cost. */
export const PAID_ORDER_COST_SNAPSHOT_SQL = `INSERT OR IGNORE INTO order_item_costs
  (order_code,item_index,product_id,variant_id,source,supplier_variant_id,unit_cost)
  SELECT o.code, CAST(j.key AS INTEGER), json_extract(j.value,'$.product_id'), pv.id,
    CASE WHEN pv.wr_variant_id IS NOT NULL THEN 'wr'
         WHEN pv.sk_variant_id IS NOT NULL THEN 'sk' ELSE 'manual' END,
    COALESCE(pv.wr_variant_id,pv.sk_variant_id),
    CASE WHEN pv.wr_variant_id IS NOT NULL THEN wv.wr_price
         WHEN pv.sk_variant_id IS NOT NULL THEN sp.sk_price ELSE pv.manual_cost END
  FROM orders o
  JOIN json_each(CASE WHEN json_valid(o.items) THEN o.items ELSE '[]' END) j
  LEFT JOIN product_variants pv ON pv.id=COALESCE(json_extract(j.value,'$.variant_id'),o.variant_id)
    AND pv.product_id=json_extract(j.value,'$.product_id')
  LEFT JOIN wr_variants wv ON wv.wr_variant_id=pv.wr_variant_id
  LEFT JOIN sk_products sp ON sp.sk_variant_id=pv.sk_variant_id
  WHERE o.code=? AND o.status='lunas' AND o.payment_status='paid'
    AND COALESCE(o.order_kind,'market')!='pedia'`;
