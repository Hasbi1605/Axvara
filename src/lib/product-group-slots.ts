// src/lib/product-group-slots.ts — Pure variant-slot decision & auto-match helpers.
//
// Shared by server (product-groups.ts) and client (ProductGroupsManager.tsx)
// so admin auto-suggest is instant and deterministic with zero external calls.
import type { ProductGroupSupplier } from "@/lib/product-groups";

export type SlotVariantStats = {
  variantId: number;
  productId: number;
  supplier: ProductGroupSupplier;
  label: string;
  price: number;
  stock: number;
  minQty: number;
  modal: number | null;
  position: number;
  isActive: boolean;
  parentActive: boolean;
  parentArchived: boolean;
  newSaleAllowed: boolean;
};

export type SlotDecision = {
  winnerVariantId: number | null;
  reason: string;
};

export type SuggestableGroupVariant = {
  variant_id: number;
  product_id: number;
  supplier: ProductGroupSupplier;
  label: string;
  is_active: boolean;
  parent_active: boolean;
  parent_archived: boolean;
  duration_value: number | null;
  duration_unit: string | null;
  duration_label: string | null;
  warranty_type: string;
  warranty_value: number | null;
  warranty_unit: string | null;
};

export type SuggestedVariantSlot = {
  name: string;
  variant_ids: number[];
};

function money(value: number): string {
  return `Rp${Math.round(value).toLocaleString("id-ID")}`;
}

function byPosition(a: SlotVariantStats, b: SlotVariantStats): number {
  return a.position - b.position || a.price - b.price || a.variantId - b.variantId;
}

function isBuyable(variant: SlotVariantStats): boolean {
  if (!variant.parentActive || variant.parentArchived || !variant.isActive || !variant.newSaleAllowed) {
    return false;
  }
  const minQty = Math.max(1, Number(variant.minQty ?? 1) || 1);
  return variant.stock === -1 || variant.stock >= minQty;
}

function representative(
  active: SlotVariantStats[],
  group: { preferProductId: number | null },
): SlotVariantStats {
  if (group.preferProductId != null) {
    const prefer = active.filter((m) => m.productId === group.preferProductId).sort(byPosition)[0];
    if (prefer) return prefer;
  }
  const manual = active.filter((m) => m.supplier === "Manual").sort(byPosition)[0];
  return manual ?? [...active].sort(byPosition)[0];
}

/**
 * Pure slot winner decision mirroring `decideGroupFromStats`:
 * 0. Manual live always wins (highest stock, lowest modal/price, position).
 * 1. Buyable stock beats out-of-stock.
 * 2. Lowest normalized modal/30d wins (respecting group prefer/margin); falls
 *    back to selling price when modal is unreadable.
 * 3. All out-of-stock -> 1 active representative stays visible (prefer -> Manual -> position).
 * 4. All inactive/archived -> null.
 */
export function decideSlotFromStats(
  group: { preferProductId: number | null; preferMargin: number },
  members: SlotVariantStats[],
): SlotDecision {
  const active = members.filter((m) => m.parentActive && !m.parentArchived && m.isActive && m.newSaleAllowed);
  if (!active.length) return { winnerVariantId: null, reason: "semua varian nonaktif" };

  // 0. Manual live always wins over supplier variants.
  const manualLive = active.filter((m) => m.supplier === "Manual" && isBuyable(m));
  if (manualLive.length) {
    const maxStock = Math.max(...manualLive.map((m) => (m.stock === -1 ? Number.POSITIVE_INFINITY : m.stock)));
    let pool = manualLive.filter((m) => (m.stock === -1 ? Number.POSITIVE_INFINITY : m.stock) === maxStock);
    const readable = pool.filter((m) => m.modal != null && Number.isFinite(m.modal));
    if (readable.length) {
      const min = Math.min(...readable.map((m) => Number(m.modal)));
      pool = readable.filter((m) => Number(m.modal) === min);
    }
    const chosen = [...pool].sort(byPosition)[0];
    return { winnerVariantId: chosen.variantId, reason: `Manual live (${chosen.label})`.slice(0, 300) };
  }

  // 1-2. Stock available first, then modal/30d (or selling price if modal unavailable).
  const available = active.filter(isBuyable);
  if (available.length) {
    const readable = available.filter((m) => m.modal != null && Number.isFinite(m.modal));
    if (!readable.length) {
      const sorted = [...available].sort((a, b) => a.price - b.price || byPosition(a, b));
      const chosen = sorted[0];
      const runner = sorted.find((m) => m.variantId !== chosen.variantId);
      const reason = runner
        ? `harga ${chosen.supplier} ${money(chosen.price)} ≤ ${runner.supplier} ${money(runner.price)}`
        : `harga ${chosen.supplier} ${money(chosen.price)} termurah`;
      return { winnerVariantId: chosen.variantId, reason: reason.slice(0, 300) };
    }
    const min = Math.min(...readable.map((m) => Number(m.modal)));
    const cheapest = readable.filter((m) => Number(m.modal) === min).sort(byPosition);
    const prefer = group.preferProductId == null
      ? null
      : readable
          .filter((m) => m.productId === group.preferProductId)
          .sort((a, b) => Number(a.modal) - Number(b.modal) || byPosition(a, b))[0] ?? null;
    if (prefer && prefer.modal != null && Math.abs(Number(prefer.modal) - min) <= group.preferMargin) {
      return {
        winnerVariantId: prefer.variantId,
        reason: `prefer ${prefer.supplier} (selisih ${money(Math.abs(Number(prefer.modal) - min))} ≤ margin ${money(group.preferMargin)})`.slice(0, 300),
      };
    }
    const chosen = cheapest.length > 1 && prefer && cheapest.some((m) => m.variantId === prefer.variantId)
      ? prefer
      : cheapest[0];
    const runner = readable
      .filter((m) => m.variantId !== chosen.variantId)
      .sort((a, b) => Number(a.modal) - Number(b.modal) || byPosition(a, b))[0];
    const reason = runner
      ? `modal/30 hari ${chosen.supplier} ${money(min)} < ${runner.supplier} ${money(Number(runner.modal))}`
      : `modal/30 hari ${chosen.supplier} ${money(min)} termurah`;
    return { winnerVariantId: chosen.variantId, reason: reason.slice(0, 300) };
  }

  // 3. All variants in the slot are out of stock -> 1 representative stays visible.
  const rep = representative(active, group);
  return {
    winnerVariantId: rep.variantId,
    reason: `semua habis — wakil ${rep.supplier} (${rep.label})`.slice(0, 300),
  };
}

// ---- Deterministic auto-match suggestion ----

function durationBucket(v: Pick<SuggestableGroupVariant, "duration_value" | "duration_unit" | "duration_label" | "label">): string {
  const unit = String(v.duration_unit ?? "").trim().toLowerCase();
  const val = v.duration_value == null ? 0 : Math.floor(Number(v.duration_value));
  if (unit === "lifetime") return "lifetime";
  if (val > 0) {
    if (unit === "day") {
      if (val === 30 || val === 31) return "1m";
      return `${val}d`;
    }
    if (unit === "month") return `${val}m`;
    if (unit === "year") return `${val * 12}m`;
  }
  const source = `${v.duration_label ?? ""} ${v.label}`.toLowerCase();
  if (/\b(?:lifetime|selamanya|permanen)\b/.test(source)) return "lifetime";
  const yr = source.match(/\b(\d+)\s*(?:tahun|thn|years?|yrs?|t|y)\b/);
  if (yr) return `${Number(yr[1]) * 12}m`;
  const mo = source.match(/\b(\d+)\s*(?:bulan|bln|months?|mos?|b|m)\b/);
  if (mo) return `${Number(mo[1])}m`;
  const wk = source.match(/\b(\d+)\s*(?:minggu|weeks?|wks?)\b/);
  if (wk) return `${Number(wk[1]) * 7}d`;
  const day = source.match(/\b(\d+)\s*(?:hari|hr|days?|d)\b/);
  if (day) {
    const d = Number(day[1]);
    return d === 30 || d === 31 ? "1m" : `${d}d`;
  }
  return "unspecified";
}

function durationDisplay(bucket: string): string {
  if (bucket === "lifetime") return "Lifetime";
  if (bucket === "unspecified") return "";
  const mo = bucket.match(/^(\d+)m$/);
  if (mo) {
    const n = Number(mo[1]);
    return n >= 12 && n % 12 === 0 ? `${n / 12} Tahun` : `${n} Bulan`;
  }
  const d = bucket.match(/^(\d+)d$/);
  if (d) return `${Number(d[1])} Hari`;
  return "";
}

function warrantyTier(v: Pick<SuggestableGroupVariant, "warranty_type" | "warranty_value" | "warranty_unit" | "label">, durBucket: string): "full" | "standard" {
  const wt = String(v.warranty_type ?? "none").trim().toLowerCase();
  const label = v.label.toLowerCase();
  if (wt === "full") return "full";
  if (/\b(?:full\s*(?:garansi|warranty)|garansi\s*full|fw)\b/.test(label)) return "full";
  if (wt === "limited" && v.warranty_value != null && v.warranty_value > 0) {
    const wu = String(v.warranty_unit ?? "").trim().toLowerCase();
    const wVal = Math.floor(Number(v.warranty_value));
    if (durBucket === "1m" && wu === "day" && wVal >= 25) return "full";
    if (wu === "month" && durBucket === `${wVal}m`) return "full";
    if (wu === "year" && durBucket === `${wVal * 12}m`) return "full";
  }
  return "standard";
}

const TIER_SYNONYMS: Record<string, string> = {
  sharing: "sharing", shared: "sharing", share: "sharing",
  private: "private", privat: "private", pribadi: "private",
  invite: "invite", undangan: "invite",
  head: "head", owner: "owner", admin: "admin",
  edu: "edu", student: "student",
  business: "business", bisnis: "business", team: "team", enterprise: "enterprise",
  family: "family", famplan: "family",
  individual: "individual", indplan: "individual", personal: "individual",
  duo: "duo",
  pro: "pro", plus: "plus", go: "go", ultra: "ultra", max: "max",
  basic: "basic", vip: "vip", creator: "creator", starter: "starter",
  cdk: "cdk", redeem: "redeem", voucher: "voucher",
  buff: "buff", api: "api", credit: "credit",
};

const TIER_DISPLAY: Record<string, string> = {
  sharing: "Sharing", private: "Private", invite: "Invite", head: "Head", owner: "Owner", admin: "Admin",
  edu: "Edu", student: "Student", business: "Business", team: "Team", enterprise: "Enterprise",
  family: "Family", individual: "Individual", duo: "Duo", pro: "Pro", plus: "Plus", go: "Go",
  ultra: "Ultra", max: "Max", basic: "Basic", vip: "VIP", creator: "Creator", starter: "Starter",
  cdk: "CDK", redeem: "Redeem", voucher: "Voucher", buff: "Buff", api: "API", credit: "Credit",
};

function accessTierTokens(label: string): string[] {
  // Strip explicit warranty/noise phrases before scanning tier tokens so
  // "Full Garansi" or "Garansi 24 Jam" never pollute access tier matching.
  const cleaned = label
    .toLowerCase()
    .replace(/\b(?:full\s*(?:garansi|warranty)|garansi\s*full|non\s*garansi|tanpa\s*garansi|no\s*warranty|non\s*warranty|garansi\s*\d+\s*(?:jam|hari|bulan|tahun|day|days|month|months|hour|hours|h|d|m))\b/g, " ")
    .replace(/\b(?:apple\s*pay|upi|auto|instan|instant|tunvn|storebat|aivault|nw|fw)\b/g, " ");
  const words = cleaned.match(/[a-z0-9]+/g) ?? [];
  const tiers = new Set<string>();
  for (const w of words) {
    const mapped = TIER_SYNONYMS[w];
    if (mapped) tiers.add(mapped);
  }
  return [...tiers].sort();
}

function buildSlotName(tiers: string[], durBucket: string, wt: "full" | "standard", fallbackLabel: string): string {
  const parts: string[] = [];
  if (tiers.length > 0) parts.push(tiers.map((t) => TIER_DISPLAY[t] ?? t).join(" "));
  const dur = durationDisplay(durBucket);
  if (dur) parts.push(dur);
  let base = parts.join(" ").trim();
  if (!base) {
    base = fallbackLabel.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim().slice(0, 50) || "Varian";
  }
  if (wt === "full") base = `${base} (Full Garansi)`;
  return base.slice(0, 80);
}

/**
 * Deterministic auto-suggest for variant slots within a group.
 * Groups active variants of active non-archived members when they share the
 * exact same `(accessTier, durationBucket, warrantyTier)` and span >= 2
 * distinct member products (never mixes Full Warranty with Non-Warranty or
 * Sharing with Private).
 */
export function suggestVariantSlots(variants: SuggestableGroupVariant[]): SuggestedVariantSlot[] {
  const eligible = variants.filter((v) => v.is_active && v.parent_active && !v.parent_archived);
  const buckets = new Map<string, { tiers: string[]; dur: string; wt: "full" | "standard"; items: SuggestableGroupVariant[] }>();

  for (const v of eligible) {
    const dur = durationBucket(v);
    const wt = warrantyTier(v, dur);
    const tiers = accessTierTokens(v.label);
    const key = `${tiers.join("+") || "default"}|${dur}|${wt}`;
    const bucket = buckets.get(key) ?? { tiers, dur, wt, items: [] };
    bucket.items.push(v);
    buckets.set(key, bucket);
  }

  const usedNames = new Set<string>();
  const suggestions: SuggestedVariantSlot[] = [];
  for (const bucket of buckets.values()) {
    const distinctProducts = new Set(bucket.items.map((item) => item.product_id));
    if (bucket.items.length < 2 || distinctProducts.size < 2) continue;
    let name = buildSlotName(bucket.tiers, bucket.dur, bucket.wt, bucket.items[0].label);
    let suffix = 2;
    while (usedNames.has(name.toLowerCase())) {
      name = `${name.slice(0, 74)} #${suffix++}`;
    }
    usedNames.add(name.toLowerCase());
    suggestions.push({
      name,
      variant_ids: bucket.items.map((item) => item.variant_id),
    });
  }
  return suggestions;
}
