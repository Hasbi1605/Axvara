import { purchasableStockSql } from "@/lib/catalog-availability";
import { getD1, queryAll } from "@/lib/db";
import { mergedGroupCardJoinSql, notLoserSlotVariantSql } from "@/lib/product-groups";
import { wrNewSaleSql } from "@/lib/warung-rebahan/new-sales";

/** Sitemap keeps visible sold-out PDPs; the AI price list only includes offers buyers can order. */
export async function listIndexableProducts(availableOnly = false) {
  if (!getD1()) return [];
  return queryAll(
    `SELECT p.slug, p.updated_at, p.name, MIN(pv.price) AS price, c.name AS category
     FROM products p
     ${mergedGroupCardJoinSql("p", "gmap")}
     JOIN product_variants pv ON pv.product_id=gmap.member_id AND pv.is_active=1 AND ${wrNewSaleSql("pv")} AND ${notLoserSlotVariantSql("pv")}
       ${availableOnly ? `AND ${purchasableStockSql("pv")}` : ""}
     LEFT JOIN categories c ON c.id=p.category_id
     WHERE p.is_active=1 AND p.archived_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM product_group_members m
         JOIN product_groups g ON g.id=m.group_id
         JOIN products w ON w.id=g.winner_product_id
         WHERE m.product_id=p.id AND w.id<>m.product_id AND w.id>0
           AND w.is_active=1 AND w.archived_at IS NULL AND w.slug<>''
       )
     GROUP BY p.id
     ORDER BY p.sort_order ASC, ${availableOnly ? "p.name" : "p.id"} ASC`,
  );
}
