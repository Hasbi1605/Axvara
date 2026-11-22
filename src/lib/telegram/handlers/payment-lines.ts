// src/lib/telegram/handlers/payment-lines.ts — R2 current-line resolver.
// Narrow: re-read the CURRENT cart/single for a frozen payq1 source and bind
// price/tag BEFORE create. Drift => explicit requote (never create).
// No order/provider writes; no UI.
import { queryFirst } from "@/lib/db";
import { getCartSummary } from "@/lib/telegram/cart";
import { getActiveVariant, formatVariantLabel, effectiveVariantStock } from "@/lib/catalog";
import { resolveBulkPrice } from "@/lib/bulk-pricing";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import type { Payq1State, Payq1CartSource } from "@/lib/telegram/payment-quote";
import type { CartLineLike } from "@/lib/telegram/payment-create";

export type Payq1LinesResolved =
  | { ok: true; cartLines: CartLineLike[]; cartLinesForEmail: { productId: number; variantId: number }[] }
  | { ok: false; reason: "bad_subtotal" | "cart_changed" | "subtotal_changed" | "tag_changed" | "variant_changed" | "price_unavailable" | "stock" };

export async function resolveCurrentPayq1Lines(ownerUserId: string, state: Payq1State): Promise<Payq1LinesResolved> {
  if (!Number.isSafeInteger(state.idrSubtotal) || state.idrSubtotal <= 0) return { ok: false, reason: "bad_subtotal" };
  const source: Payq1CartSource = state.source;
  if (source.kind === "cart") {
    const summary = await getCartSummary(ownerUserId);
    if (!summary.lines.length || summary.issues.length) return { ok: false, reason: "cart_changed" };
    if (summary.subtotal !== state.idrSubtotal) return { ok: false, reason: "subtotal_changed" };
    const tag = await checkoutApprovalTag(summary.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty, price: l.price, buyerFieldKey: l.buyerFieldKey, maxQty: l.maxQty, buyerFields: l.buyerFields, pixelverifInput: l.pixelverifInput })));
    if (tag !== state.tag) return { ok: false, reason: "tag_changed" };
    return {
      ok: true,
      cartLines: summary.lines.map((l) => ({
        productId: l.productId, variantId: l.variantId, qty: l.qty,
        productName: l.productName, variantLabel: l.variantLabel,
        price: l.price, basePrice: l.basePrice, appliedTierMinQty: l.appliedTierMinQty ?? null,
        buyerFieldKey: l.buyerFieldKey, maxQty: l.maxQty, buyerFields: l.buyerFields, pixelverifInput: l.pixelverifInput,
        stock: l.stock, fulfillmentMode: l.fulfillmentMode,
      })),
      cartLinesForEmail: summary.lines.map((l) => ({ productId: l.productId, variantId: l.variantId })),
    };
  }
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
  // Must mirror the single-path tag creator (callback.ts qty approval), which
  // hashes product/variant/qty/price only. buyer_field_key and Pixel variants
  // never reach the single path (requestBuyerInput intercepts them), so a
  // Pixel variant here deliberately fails closed via pixelverifInput.
  const tag = await checkoutApprovalTag([{ productId: source.productId, variantId: source.variantId, qty: source.qty, price: effective, pixelverifInput: variant.pixelverif_input }]);
  if (tag !== state.tag) return { ok: false, reason: "tag_changed" };
  const product = await queryFirst(`SELECT name FROM products WHERE id=?`, source.productId).catch(() => null);
  return {
    ok: true,
    cartLines: [{
      productId: source.productId, variantId: source.variantId, qty: source.qty,
      productName: String(product?.name ?? "Produk"),
      variantLabel: formatVariantLabel(variant),
      price: effective, basePrice: Number(variant.price), appliedTierMinQty: resolved.tier ?? null,
      buyerFieldKey: variant.buyer_field_key, maxQty: variant.max_qty, pixelverifInput: variant.pixelverif_input,
      stock, fulfillmentMode: String(variant.fulfillment_mode || "manual"),
    }],
    cartLinesForEmail: [{ productId: source.productId, variantId: source.variantId }],
  };
}
