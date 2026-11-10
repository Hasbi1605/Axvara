export type CheckoutApprovalLine = {
  buyerFields?: { muse_invite_code?: string };
  buyerFieldKey?: "muse_invite_code" | null;
  maxQty?: number | null;
  productId: number;
  variantId: number;
  qty: number;
  price: number;
};

/** Public stale-state check, not an authorization token. Never include contacts. */
export async function checkoutApprovalTag(lines: readonly CheckoutApprovalLine[]): Promise<string> {
  if (!lines.length || lines.length > 20 || lines.some(line =>
    ![line.productId, line.variantId, line.qty, line.price].every(Number.isSafeInteger)
    || line.productId <= 0 || line.variantId <= 0 || line.qty <= 0 || line.price < 0)) {
    throw new Error("invalid_checkout_snapshot");
  }
  const canonical = [...lines].sort((a,b) => a.productId-b.productId || a.variantId-b.variantId)
    .map(line => [line.productId,line.variantId,line.qty,line.price,...(line.buyerFieldKey || line.maxQty != null ? [line.buyerFieldKey ?? null,line.maxQty ?? null,line.buyerFields?.muse_invite_code ?? null] : [])]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical)));
  return Array.from(new Uint8Array(digest).slice(0, 6), byte => byte.toString(16).padStart(2, "0")).join("");
}
