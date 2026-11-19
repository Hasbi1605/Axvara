-- Retire the mirror publication switch; never activate a variant or change its parent.
DROP TRIGGER IF EXISTS tunvn_variant_publication;

UPDATE product_variants
   SET is_active = 0,
       updated_at = datetime('now')
 WHERE tunvn_source_product_id IS NOT NULL
   AND is_active = 1
   AND NOT EXISTS (
     SELECT 1 FROM tunvn_products t
      WHERE t.supplier_product_id = product_variants.tunvn_source_product_id
        AND t.publish_requested = 1
        AND t.supplier_product_id <> 60
   );

UPDATE tunvn_products
   SET visible = CASE WHEN EXISTS (
     SELECT 1 FROM product_variants pv JOIN products p ON p.id = pv.product_id
      WHERE pv.tunvn_source_product_id = tunvn_products.supplier_product_id
        AND pv.is_active = 1 AND p.is_active = 1 AND p.archived_at IS NULL
   ) THEN 1 ELSE 0 END;
