import type { D1 } from "@/lib/db";

/** Each item commits its mirror and linked storefront price together. */
export async function saveSupplierMarkup(
  d1: D1, supplier: "warung" | "sekalipay", id: string,
  percent: number, fixed: number, price: number, now: string,
): Promise<void> {
  const [table, key] = supplier === "warung" ? ["wr_variants", "wr_variant_id"] : ["sk_products", "sk_variant_id"];
  const [mirror] = await d1.batch([
    d1.prepare(`UPDATE ${table} SET markup_percent=?, markup_fixed=?, axvara_sell_price=?,
      last_synced_at=?, updated_at=? WHERE ${key}=?`).bind(percent, fixed, price, now, now, id),
    // Resolve the link inside the transaction. Clear only invalid strike-through prices.
    d1.prepare(`UPDATE product_variants SET price=?,
      compare_price=CASE WHEN compare_price <= ? THEN NULL ELSE compare_price END,
      updated_at=datetime('now')
      WHERE id=(SELECT axvara_variant_id FROM ${table} WHERE ${key}=?)`).bind(price, price, id),
  ]);
  if (!mirror?.meta.changes) throw new Error("variant_not_found");
}
