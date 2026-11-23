/** Shared by the admin list and DELETE. Never infer ownership from a badge/slug. */
export const ARCHIVED_MESSAGE = "Pulihkan dari Arsip dulu";

const variantIds = "SELECT id FROM product_variants WHERE product_id=p.id";
const variantRef = (column: string) => `${column} IN (${variantIds})`;
const graphRef = (table: string) => `EXISTS(SELECT 1 FROM ${table} r WHERE r.product_id=p.id OR ${variantRef("r.variant_id")})`;

export const supplierIdentitySql = `p.source<>'manual' OR p.wr_product_id IS NOT NULL OR p.sk_product_id IS NOT NULL
  OR p.wr_auto_managed<>0 OR p.sk_auto_managed<>0 OR p.tunvn_family IS NOT NULL OR p.aivault_family IS NOT NULL OR p.storebat_family IS NOT NULL OR p.mirai_family IS NOT NULL OR p.pixelverif_family IS NOT NULL
  OR EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND
    (v.wr_variant_id IS NOT NULL OR v.sk_variant_id IS NOT NULL OR v.wr_auto_managed<>0 OR v.sk_auto_managed<>0
      OR v.tunvn_source_product_id IS NOT NULL OR v.tunvn_buff_quantity_b IS NOT NULL OR v.aivault_service_id IS NOT NULL OR v.storebat_product_id IS NOT NULL OR v.mirai_package_code IS NOT NULL OR v.pixelverif_flow_type IS NOT NULL))`;

// Include non-FK history as well as FKs. Invalid historical JSON fails closed.
export const productHistorySql = `EXISTS(SELECT 1 FROM orders o WHERE ${variantRef("o.variant_id")}
    OR NOT json_valid(o.items) OR EXISTS(SELECT 1 FROM json_tree(CASE WHEN json_valid(o.items) THEN o.items ELSE '[]' END) j
      WHERE (j.key='product_id' AND CAST(j.atom AS TEXT)=CAST(p.id AS TEXT))
        OR (j.key='variant_id' AND CAST(j.atom AS TEXT) IN (SELECT CAST(id AS TEXT) FROM product_variants WHERE product_id=p.id))))
  OR ${graphRef("fulfillment_items")} OR ${graphRef("fulfillment_inventory")} OR ${graphRef("order_item_costs")}
  OR ${graphRef("tunvn_order_links")} OR ${graphRef("aivault_order_links")} OR ${graphRef("storebat_order_links")} OR ${graphRef("mirai_order_links")} OR ${graphRef("pixelverif_order_links")}
  OR EXISTS(SELECT 1 FROM fulfillment_jobs r WHERE ${variantRef("r.variant_id")})
  OR EXISTS(SELECT 1 FROM wr_products r WHERE r.axvara_product_id=p.id)
  OR EXISTS(SELECT 1 FROM wr_variants r WHERE ${variantRef("r.axvara_variant_id")})
  OR EXISTS(SELECT 1 FROM sk_products r WHERE r.axvara_product_id=p.id OR ${variantRef("r.axvara_variant_id")})
  OR EXISTS(SELECT 1 FROM tunvn_products r WHERE r.axvara_product_id=p.id)
  OR EXISTS(SELECT 1 FROM aivault_products r WHERE r.axvara_product_id=p.id)
  OR EXISTS(SELECT 1 FROM mirai_packages r WHERE r.axvara_product_id=p.id)
  OR EXISTS(SELECT 1 FROM product_group_members r WHERE r.product_id=p.id)
  OR EXISTS(SELECT 1 FROM supplier_pairs r WHERE r.wr_product_id=p.id OR r.sk_product_id=p.id)
  OR EXISTS(SELECT 1 FROM whatsapp_sessions r WHERE r.selected_product_id=p.id OR ${variantRef("r.selected_variant_id")})`;

export const hardDeleteReasonSql = `CASE WHEN p.archived_at IS NULL THEN 'Arsipkan produk dulu.'
  WHEN ${supplierIdentitySql} THEN 'Produk supplier harus tetap di Arsip agar tidak dibuat ulang oleh sync.'
  WHEN ${productHistorySql} THEN 'Produk memiliki riwayat pesanan, stok, atau relasi yang harus dipertahankan.'
  ELSE NULL END`;
export const hardDeleteEligibleSql = `p.archived_at IS NOT NULL AND NOT (${supplierIdentitySql}) AND NOT (${productHistorySql})`;
