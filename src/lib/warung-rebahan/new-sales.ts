// Explicit supplier identities from the reviewed 14-Nov catalog, never display-name matching.
// Jaspay key → legacy WR Premium (MBO) product id it replaces. Sync uses it to
// attach/inherit imagery; sale policy uses it to keep the replaced MBO paused.
export const JASPAY_LEGACY_PRODUCTS: Record<string, string> = {
  zoom: "38eda557-044d-11f1-bf18-bc241112a182",
  scribd: "07ca3373-133e-11f1-bf18-bc241112a182",
  hma: "69282bbf-045f-11f1-bf18-bc241112a182",
  expressvpn: "a86ef8b6-045f-11f1-bf18-bc241112a182",
  picsart: "ea549518-12ee-11f1-bf18-bc241112a182",
  wink: "b563be16-1337-11f1-bf18-bc241112a182",
  meitu: "5f0e4cb2-1338-11f1-97d9-bc241112a182",
  remini: "1522e51e-8d1b-11f1-97d9-bc241112a182",
  crunchyroll: "a5b0d8fd-133f-11f1-bf18-bc241112a182",
  surfshark: "b3526693-0460-11f1-bf18-bc241112a182",
};

const COVERED_WR_IDS_SQL = Object.values(JASPAY_LEGACY_PRODUCTS)
  .map((id) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error(`invalid Jaspay legacy id ${id}`);
    return `'${id}'`;
  })
  .join(",");

/**
 * Owner 16 Nov 2026: a WR product is "covered by Jaspay" when it is an explicitly
 * mapped legacy MBO product, or a parent that carries any Jaspay package (any
 * status). Covered MBO stays paused even when the Jaspay twin is sold out or
 * inactive (no fallback). `productIdExpr` is a trusted SQL expression.
 */
export function wrJaspayCoveredSql(productIdExpr: string): string {
  return `EXISTS (SELECT 1 FROM products wr_cov WHERE wr_cov.id=${productIdExpr}
      AND (wr_cov.wr_product_id IN (${COVERED_WR_IDS_SQL})
        OR EXISTS (SELECT 1 FROM product_variants wr_cov_j
          WHERE wr_cov_j.product_id=wr_cov.id AND wr_cov_j.wr_variant_id LIKE 'jaspay:%')))`;
}

/**
 * Sale policy only. Historical fulfillment must never use this predicate.
 * Allowed: non-WR, Jaspay, WR restock, and WR manual/MBO whose product has no
 * Jaspay replacement (owner 16 Nov 2026). Unknown class stays paused.
 */
export function wrNewSaleSql(alias = "pv"): string {
  return `(${alias}.wr_variant_id IS NULL OR ${alias}.wr_variant_id LIKE 'jaspay:%'
    OR EXISTS (SELECT 1 FROM wr_variants wr_sale
      WHERE wr_sale.wr_variant_id=${alias}.wr_variant_id
        AND (wr_sale.wr_delivery_class='restock'
          OR (wr_sale.wr_delivery_class='made_by_order' AND NOT ${wrJaspayCoveredSql(`${alias}.product_id`)}))))`;
}

/**
 * JS twin of wrNewSaleSql. Callers selecting WR manual rows MUST also select
 * `${wrJaspayCoveredSql(...)} AS wr_jaspay_covered`; a missing flag fails closed
 * (treated as covered = paused).
 */
export function wrNewSaleAllowed(row: { wr_variant_id?: unknown; wr_delivery_class?: unknown; wr_jaspay_covered?: unknown }): boolean {
  const id = String(row.wr_variant_id ?? "");
  if (!id || id.startsWith("jaspay:") || row.wr_delivery_class === "restock") return true;
  // Unknown class / missing mirror stays paused, mirroring the SQL.
  if (row.wr_delivery_class !== "made_by_order") return false;
  return row.wr_jaspay_covered != null && Number(row.wr_jaspay_covered) === 0;
}

/** Trusted SQL expressions only; used inside the reservation transaction. */
export function wrSaleQuantitySql(alias: string, quantity: string): string {
  return `${wrNewSaleSql(alias)} AND (COALESCE(${alias}.wr_variant_id,'') NOT LIKE 'jaspay:%'
    OR EXISTS (SELECT 1 FROM wr_variants wr_cap WHERE wr_cap.wr_variant_id=${alias}.wr_variant_id
      AND wr_cap.wr_max_quantity >= ${quantity}))`;
}
