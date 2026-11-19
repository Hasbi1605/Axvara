// src/lib/telegram/handlers/payment-lines.ts — R2 current-line resolver.
// Narrow: re-read the CURRENT cart/single for a frozen payq1 source and bind
// price/tag BEFORE create. Drift => explicit requote (never create).
// No order/provider writes; no UI.
import { queryFirst } from "@/lib/db";
import { getCartSummary } from "@/lib/telegram/cart";
import { getActiveVariant, formatVariantLabel } from "@/lib/catalog";
import { resolveBulkPrice } from "@/lib/bulk-pricing";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import type { Payq1State, Payq1CartSource } from "@/lib/telegram/payment-quote";
import type { CartLineLike } from "@/lib/telegram/payment-create";

export type Payq1LinesResolved =
  | { ok: true; cartLines: CartLineLike[]; cartLinesForEmail: { productId: number; variantId: number }[] }
  | { ok: false; reason: string };

export async function resolveCurrentPayq1Lines(ownerUserId: string, state: Payq1State): Promise<Payq1LinesResolved> {
  if (!Number.isSafeInteger(state.idrSubtotal) || state.idrSubtotal <= 0) return { ok: false, reason: "bad_subtotal" };
  const source: Payq1CartSource = state.source;
  if (source.kind === "cart") {
    const summary = await getCartSummary(ownerUserId);
    if (!summary.lines.length || summary.issues.length) return { ok: false, reason: "cart_changed" };
    if (summary.subtotal !== state.idrSubtotal) return { ok: false, reason: "subtotal_changed" };
    const tag = await checkoutApprovalTag(summary.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty, price: l.price })));
    if (tag !== state.tag) return { ok: false, reason: "tag_changed" };
    return {
      ok: true,
      cartLines: summary.lines.map((l) => ({
        productId: l.productId, variantId: l.variantId, qty: l.qty,
        productName: l.productName, variantLabel: l.variantLabel,
        price: l.price, basePrice: l.basePrice, appliedTierMinQty: l.appliedTierMinQty ?? null,
        stock: l.stock, fulfillmentMode: l.fulfillmentMode,
      })),
      cartLinesForEmail: summary.lines.map((l) => ({ productId: l.productId, variantId: l.variantId })),
    };
  }
  // Single: re-read the CURRENT live variant and re-derive the effective
  // price (aggregate tiers) — caller tag + subtotal must still match.
  const variant = await getActiveVariant(source.variantId);
  if (!variant || variant.product_id !== source.productId) return { ok: false, reason: "variant_changed" };
  let effective: number;
  try {
    effective = resolveBulkPrice(Number(variant.price), source.qty, variant.bulk_pricing_enabled ? 1 : 0, JSON.stringify(variant.bulk_pricing_tiers ?? [])).price;
  } catch {
    return { ok: false, reason: "price_unavailable" };
  }
  if (!Number.isSafeInteger(effective) || effective <= 0) return { ok: false, reason: "price_unavailable" };
  if (effective * source.qty !== state.idrSubtotal) return { ok: false, reason: "subtotal_changed" };
  const tag = await checkoutApprovalTag([{ productId: source.productId, variantId: source.variantId, qty: source.qty, price: effective }]);
  if (tag !== state.tag) return { ok: false, reason: "tag_changed" };
  const product = await queryFirst(`SELECT name FROM products WHERE id=?`, source.productId).catch(() => null);
  return {
    ok: true,
    cartLines: [{
      productId: source.productId, variantId: source.variantId, qty: source.qty,
      productName: String(product?.name ?? "Produk"),
      variantLabel: formatVariantLabel(variant),
      price: effective, basePrice: Number(variant.price), appliedTierMinQty: null,
      stock: Number(variant.stock), fulfillmentMode: String(variant.fulfillment_mode || "manual"),
    }],
    cartLinesForEmail: [{ productId: source.productId, variantId: source.variantId }],
  };
}
