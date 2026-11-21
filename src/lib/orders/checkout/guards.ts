// src/lib/orders/checkout/guards.ts — POST checkout guard computations
// (3B-3, class E: pure move, no behavior change).
//
// BEFORE: the email-required, min_qty/max-cap, and price_changed guard
// computations lived inline in src/app/api/orders/route.ts (POST handler).
// AFTER: this module owns the PURE computations over already-fetched rows
// (quote items + DB row objects + scalar params). DB READS STAY IN THE ROUTE:
// no query moved, merged, split, or reordered; the route still performs the
// exact same queries and passes the rows in. Guard ORDER and early-return
// points are unchanged: cart (sameItems) → buyer-field → email → min/cap →
// price_changed, all before createOrderWithStock. The route still builds the
// 409/422 NextResponse bodies itself (identical keys/order/values/status);
// this module only returns decisions. Leaf module: no new lib/* imports
// (bulk-pricing helpers arrive via injected callback, same as response.ts
// RouteDeps pattern).

export type QuoteLine = {
  product_id?: number | null;
  variant_id?: number | null;
  qty?: number | null;
  price?: number | null;
  base_price?: number | null;
  applied_tier_min_qty?: number | null;
  buyer_fields?: { muse_invite_code?: string | null } | null;
};

export type EmailVariantRow = Record<string, unknown>;
export type EmailProductRow = Record<string, unknown>;

export type EmailNeedInput = {
  /** Rows from the variant branch query (wr_type / require_email). */
  variantRows: EmailVariantRow[];
  /** Rows from the product fallback query (require_email). */
  productRows: EmailProductRow[];
  hasVariants: boolean;
  customerEmail: unknown;
};

export type EmailNeedDecision = { emailNeeded: boolean; emailOk: boolean };

/**
 * Pure over already-fetched rows (verbatim logic from the route's email
 * guard): variant branch when variantIds exist, product fallback otherwise.
 */
export function decideEmailNeed(
  input: EmailNeedInput,
  needsEmailForVariant: (args: { wrType: string | null; requireEmail: number }) => boolean,
): EmailNeedDecision {
  let emailNeeded = false;
  if (input.hasVariants) {
    for (const r of input.variantRows) {
      if (needsEmailForVariant({
        wrType: r.wr_type != null ? String(r.wr_type) : null,
        requireEmail: Number(r.require_email ?? 0),
      })) { emailNeeded = true; break; }
    }
  } else {
    emailNeeded = input.productRows.some((r) => Number(r.require_email ?? 0) === 1);
  }
  const emailRaw = typeof input.customerEmail === "string" ? input.customerEmail : "";
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw.trim());
  return { emailNeeded, emailOk };
}

export type MinCapRow = Record<string, unknown>;

export type MinCapViolation =
  | { kind: "unavailable"; variantId: number; name: string }
  | { kind: "below_min"; variantId: number; name: string; need: number; qty: number }
  | { kind: "above_cap"; variantId: number; name: string; cap: number; qty: number };

export type MinCapInput = {
  rows: MinCapRow[];
  quoteItems: QuoteLine[];
  /** Verbatim route predicate (wrNewSaleAllowed) — injected to keep leaf-only. */
  isNewSaleAllowed: (row: MinCapRow) => boolean;
};

export type MinCapDecision = { violation?: MinCapViolation; detail: { checked: number } };

function displayName(r: MinCapRow): string {
  return `${String(r.product_name ?? "Produk")} — ${String(r.label ?? "")}`.trim();
}

/**
 * Pure over the already-fetched variant rows (verbatim logic: new-sale gate
 * first per row, then per-variant aggregate min, then jaspay cap).
 */
export function decideMinCap(input: MinCapInput): MinCapDecision {
  const minById = new Map<number, { min: number; name: string }>();
  const capById = new Map<number, { cap: number | null; jaspay: boolean; name: string }>();
  for (const r of input.rows) {
    if (!input.isNewSaleAllowed(r)) {
      return { violation: { kind: "unavailable", variantId: Number(r.id), name: displayName(r) }, detail: { checked: minById.size } };
    }
    minById.set(Number(r.id), {
      min: Math.max(1, Number(r.min_qty ?? 1) || 1),
      name: displayName(r),
    });
    const wrId = r.wr_variant_id == null ? "" : String(r.wr_variant_id).trim();
    if (wrId.startsWith("jaspay:")) {
      const capRaw = r.wr_max_quantity;
      const cap = capRaw == null ? null : Math.floor(Number(capRaw));
      capById.set(Number(r.id), {
        cap: cap != null && Number.isFinite(cap) && cap >= 1 ? cap : null,
        jaspay: true,
        name: displayName(r),
      });
    }
  }
  const qtyByVariant = new Map<number, number>();
  for (const qi of input.quoteItems) {
    const vid = Number(qi.variant_id || 0);
    if (vid > 0) qtyByVariant.set(vid, (qtyByVariant.get(vid) ?? 0) + Number(qi.qty || 0));
  }
  for (const [vid, qty] of qtyByVariant) {
    const rule = minById.get(vid);
    const need = rule?.min ?? 1;
    if (need > 1 && qty < need) {
      return { violation: { kind: "below_min", variantId: vid, name: rule?.name ?? "Produk ini", need, qty }, detail: { checked: minById.size } };
    }
    const capRule = capById.get(vid);
    if (capRule) {
      if (capRule.cap == null) {
        return { violation: { kind: "above_cap", variantId: vid, name: capRule.name, cap: -1, qty }, detail: { checked: minById.size } };
      }
      if (qty > capRule.cap) {
        return { violation: { kind: "above_cap", variantId: vid, name: capRule.name, cap: capRule.cap, qty }, detail: { checked: minById.size } };
      }
    }
  }
  return { detail: { checked: minById.size } };
}

export type PriceRow = Record<string, unknown>;

export type PriceStaleInput<TBulkOwner = never> = {
  rows: PriceRow[];
  quoteItems: QuoteLine[];
  bulkOwnerFromJoinedRow: (row: PriceRow) => TBulkOwner;
  resolveBulkPriceForProduct: (
    price: number,
    qty: number,
    enabled: unknown,
    tiers: unknown,
    owner: TBulkOwner,
  ) => { price: number; tier?: unknown };
};

/** Pure stale-price scan (verbatim predicate from the route). */
export function findStalePriceItem<TBulkOwner>(input: PriceStaleInput<TBulkOwner>): QuoteLine | null {
  const priceById = new Map(input.rows.map((r) => [Number(r.id), r]));
  const stale = input.quoteItems.find((qi) => {
    const vid = Number(qi.variant_id || 0);
    if (vid <= 0) return false;
    const live = priceById.get(vid);
    if (!live) return true;
    try {
      const qty = input.quoteItems.filter((item) => item.variant_id === vid).reduce((n, item) => n + (item.qty ?? 0), 0);
      const current = input.resolveBulkPriceForProduct(Number(live.price), qty, live.bulk_pricing_enabled, live.bulk_pricing_tiers, input.bulkOwnerFromJoinedRow(live));
      return current.price !== qi.price || (qi.base_price !== undefined && qi.base_price !== Number(live.price)) || current.tier !== qi.applied_tier_min_qty;
    } catch { return true; }
  });
  return stale ?? null;
}
