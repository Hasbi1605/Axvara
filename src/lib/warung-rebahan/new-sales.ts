/** Sale policy only. Historical fulfillment must never use this predicate. */
export function wrNewSaleSql(alias = "pv"): string {
  return `(${alias}.wr_variant_id IS NULL OR ${alias}.wr_variant_id LIKE 'jaspay:%'
    OR EXISTS (SELECT 1 FROM wr_variants wr_sale
      WHERE wr_sale.wr_variant_id=${alias}.wr_variant_id
        AND wr_sale.wr_delivery_class='restock'))`;
}

export function wrNewSaleAllowed(row: { wr_variant_id?: unknown; wr_delivery_class?: unknown }): boolean {
  const id = String(row.wr_variant_id ?? "");
  return !id || id.startsWith("jaspay:") || row.wr_delivery_class === "restock";
}

/** Trusted SQL expressions only; used inside the reservation transaction. */
export function wrSaleQuantitySql(alias: string, quantity: string): string {
  return `${wrNewSaleSql(alias)} AND (COALESCE(${alias}.wr_variant_id,'') NOT LIKE 'jaspay:%'
    OR EXISTS (SELECT 1 FROM wr_variants wr_cap WHERE wr_cap.wr_variant_id=${alias}.wr_variant_id
      AND wr_cap.wr_max_quantity >= ${quantity}))`;
}
