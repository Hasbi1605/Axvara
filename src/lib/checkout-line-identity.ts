export type CheckoutRowIdentity = { id: unknown; slug?: unknown; variantId?: unknown };
export type CheckoutIssueIdentity = { product_id?: number; slug?: string; variant_id?: number };

/**
 * Pencocokan baris keranjang/direct-buy ke issue quote (F10).
 * variant_id adalah kunci utama bila ada; product_id-atau-slug dipakai bila
 * tersedia — TANPA pernah mewajibkan slug yang hilang (issue product_id-only
 * tanpa slug tetap pulih; repro: dua varian id numerik sama + issue
 * {product_id:1,variant_id:2} tanpa slug hanya mengubah B).
 */
export function rowMatchesIssue(
  it: CheckoutRowIdentity,
  issue: CheckoutIssueIdentity,
): boolean {
  const issueVariant = String(issue.variant_id ?? "");
  if (issueVariant) {
    if (String(it.variantId ?? "") !== issueVariant) return false;
    const issueProduct = issue.product_id != null ? String(issue.product_id) : "";
    const issueSlug = String(issue.slug ?? "");
    if (!issueProduct && !issueSlug) return true;
    if (issueProduct && String(it.id) === issueProduct) return true;
    if (issueSlug && String(it.slug) === issueSlug) return true;
    return false;
  }
  const product = issue.product_id != null ? String(issue.product_id) : "";
  const slug = String(issue.slug ?? "");
  return Boolean((product && String(it.id) === product) || (slug && String(it.slug) === slug));
}
