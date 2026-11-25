import { computeCustomFieldsFingerprint, type BuyerFieldKey } from "@/lib/buyer-fields";

export type CheckoutApprovalLine = {
  buyerFields?: { muse_invite_code?: string; invite_email?: string; custom_values?: Record<string, string>; pv_email?: string; pv_password?: string; pv_totp_secret?: string };
  buyerFieldKey?: BuyerFieldKey | null;
  pixelverifInput?: boolean;
  maxQty?: number | null;
  productId: number;
  variantId: number;
  qty: number;
  price: number;
};

/** Public stale-state check, not an authorization token. Never include contacts.
 *  Pixel & custom-field lines bind a SHA-256 fingerprint — never raw values/passwords. */
export async function checkoutApprovalTag(lines: readonly CheckoutApprovalLine[]): Promise<string> {
  if (!lines.length || lines.length > 20 || lines.some(line =>
    ![line.productId, line.variantId, line.qty, line.price].every(Number.isSafeInteger)
    || line.productId <= 0 || line.variantId <= 0 || line.qty <= 0 || line.price < 0)) {
    throw new Error("invalid_checkout_snapshot");
  }
  const canonical = [...lines].sort((a,b) => a.productId-b.productId || a.variantId-b.variantId)
    .map(async line => {
      const fieldValue = line.buyerFieldKey === "invite_email"
        ? (line.buyerFields?.invite_email?.trim().toLowerCase() ?? null)
        : line.buyerFieldKey === "custom"
          ? await computeCustomFieldsFingerprint(line.buyerFields?.custom_values ?? {})
          : (line.buyerFields?.muse_invite_code ?? null);
      const base = [line.productId,line.variantId,line.qty,line.price,...(line.buyerFieldKey || line.maxQty != null ? [line.buyerFieldKey ?? null,line.maxQty ?? null,fieldValue] : [])];
      if (!line.pixelverifInput) return base;
      const { computeFingerprint } = await import("@/lib/fulfillment/crypto");
      const fingerprint = await computeFingerprint(`${line.buyerFields?.pv_email ?? ""}\n${line.buyerFields?.pv_password ?? ""}\n${line.buyerFields?.pv_totp_secret ?? ""}`);
      return [...base, "pixelverif", fingerprint];
    });
  const canonicalResolved = await Promise.all(canonical);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonicalResolved)));
  return Array.from(new Uint8Array(digest).slice(0, 6), byte => byte.toString(16).padStart(2, "0")).join("");
}
