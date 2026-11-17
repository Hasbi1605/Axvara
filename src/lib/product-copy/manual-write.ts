/** Legacy product clients may still send own-stock copy explicitly. Omitted
 * fields preserve copy edited through variant-copy (including EN/fingerprint). */
export function manualCopyUpdate(productId: number | string, sku: string, value: { admin_terms?: string; admin_activation?: string }, bySlug = false) {
  if (value.admin_terms === undefined && value.admin_activation === undefined) return null;
  return { sql: `UPDATE product_variants SET
    admin_terms=CASE WHEN ?=1 THEN ? ELSE admin_terms END,
    admin_activation=CASE WHEN ?=1 THEN ? ELSE admin_activation END,
    admin_copy_fingerprint='', updated_at=datetime('now')
    WHERE product_id=${bySlug ? "(SELECT id FROM products WHERE slug=?)" : "?"} AND sku=? AND wr_variant_id IS NULL AND sk_variant_id IS NULL`,
    params: [value.admin_terms === undefined ? 0 : 1, value.admin_terms?.replace(/\r\n?/g,'\n').trim() || null,
      value.admin_activation === undefined ? 0 : 1, value.admin_activation?.replace(/\r\n?/g,'\n').trim() || null,productId,sku] };
}
