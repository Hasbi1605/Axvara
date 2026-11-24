// src/lib/telegram/handlers/payment-lines.ts — R2 current-line resolver.
// Narrow: re-read the CURRENT single variant for a frozen payq1 source and bind
// price/tag/buyer-input BEFORE create. Drift => explicit requote (never create).
// No order/provider writes; no UI.
import { queryFirst } from "@/lib/db";
import { getActiveVariant, formatVariantLabel, effectiveVariantStock } from "@/lib/catalog";
import { resolveBulkPrice } from "@/lib/bulk-pricing";
import { validateBuyerFields, type BuyerFields } from "@/lib/buyer-fields";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import type { Payq1State, Payq1CartSource } from "@/lib/telegram/payment-quote";
import type { CartLineLike } from "@/lib/telegram/payment-create";

export type Payq1LinesResolved =
  | { ok: true; cartLines: CartLineLike[]; cartLinesForEmail: { productId: number; variantId: number }[] }
  | { ok: false; reason: "bad_subtotal" | "subtotal_changed" | "tag_changed" | "variant_changed" | "price_unavailable" | "stock" };

export async function resolveCurrentPayq1Lines(ownerUserId: string, state: Payq1State): Promise<Payq1LinesResolved> {
  if (!Number.isSafeInteger(state.idrSubtotal) || state.idrSubtotal <= 0) return { ok: false, reason: "bad_subtotal" };
  const source: Payq1CartSource = state.source;
  if (source.kind !== "single") return { ok: false, reason: "variant_changed" };
  // Single: re-read the CURRENT live variant and re-derive the effective
  // price (aggregate tiers) — caller tag + subtotal must still match.
  const variant = await getActiveVariant(source.variantId);
  if (!variant || variant.product_id !== source.productId) return { ok: false, reason: "variant_changed" };
  const stock = effectiveVariantStock(variant);
  if (stock !== -1 && stock < source.qty) return { ok: false, reason: "stock" };
  let resolved: ReturnType<typeof resolveBulkPrice>;
  try {
    resolved = resolveBulkPrice(Number(variant.price), source.qty, variant.bulk_pricing_enabled ? 1 : 0, JSON.stringify(variant.bulk_pricing_tiers ?? []));
  } catch {
    return { ok: false, reason: "price_unavailable" };
  }
  const effective = resolved.price;
  if (!Number.isSafeInteger(effective) || effective <= 0) return { ok: false, reason: "price_unavailable" };
  if (effective * source.qty !== state.idrSubtotal) return { ok: false, reason: "subtotal_changed" };

  let buyerFields: BuyerFields | undefined;
  if (variant.pixelverif_input) {
    if (source.qty !== 1 || !source.pvFlowId || source.museInviteCode || source.inviteEmail) return { ok: false, reason: "variant_changed" };
    const { loadCompletedPixelverifStash } = await import("./buyer-input");
    const pv = await loadCompletedPixelverifStash(ownerUserId, source.variantId, source.pvFlowId);
    if (!pv) return { ok: false, reason: "variant_changed" };
    const { isPixelverifEmailBlocked } = await import("@/lib/pixelverif/blocklist");
    if (await isPixelverifEmailBlocked(pv.pv_email, 3)) return { ok: false, reason: "variant_changed" };
    buyerFields = pv;
  } else if (variant.buyer_field_key === "muse_invite_code") {
    if (!source.museInviteCode || source.inviteEmail || source.pvFlowId) return { ok: false, reason: "variant_changed" };
    try {
      buyerFields = validateBuyerFields(
        { buyer_field_key: variant.buyer_field_key, max_qty: variant.max_qty },
        { muse_invite_code: source.museInviteCode },
        source.qty,
      );
    } catch {
      return { ok: false, reason: "variant_changed" };
    }
  } else if (variant.buyer_field_key === "invite_email") {
    if (!source.inviteEmail || source.museInviteCode || source.pvFlowId) return { ok: false, reason: "variant_changed" };
    try {
      buyerFields = validateBuyerFields(
        { buyer_field_key: variant.buyer_field_key, max_qty: variant.max_qty },
        { invite_email: source.inviteEmail },
        source.qty,
      );
    } catch {
      return { ok: false, reason: "variant_changed" };
    }
  } else if (source.museInviteCode || source.inviteEmail || source.pvFlowId) {
    return { ok: false, reason: "variant_changed" };
  }

  const hasSpecialInput = Boolean(variant.buyer_field_key || variant.pixelverif_input);
  const tag = await checkoutApprovalTag([{
    productId: source.productId,
    variantId: source.variantId,
    qty: source.qty,
    price: effective,
    ...(hasSpecialInput ? {
      buyerFieldKey: variant.buyer_field_key,
      maxQty: variant.max_qty,
      buyerFields,
      pixelverifInput: variant.pixelverif_input,
    } : {}),
  }]);
  if (tag !== state.tag) return { ok: false, reason: "tag_changed" };
  const product = await queryFirst(`SELECT name FROM products WHERE id=?`, source.productId).catch(() => null);
  return {
    ok: true,
    cartLines: [{
      productId: source.productId, variantId: source.variantId, qty: source.qty,
      productName: String(product?.name ?? "Produk"),
      variantLabel: formatVariantLabel(variant),
      price: effective, basePrice: Number(variant.price), appliedTierMinQty: resolved.tier ?? null,
      buyerFieldKey: variant.buyer_field_key, maxQty: variant.max_qty,
      ...(buyerFields ? { buyerFields } : {}),
      pixelverifInput: variant.pixelverif_input,
      stock, fulfillmentMode: String(variant.fulfillment_mode || "manual"),
    }],
    cartLinesForEmail: [{ productId: source.productId, variantId: source.variantId }],
  };
}
