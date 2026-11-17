import { validateBulkPricing, type BulkTier } from "@/lib/bulk-pricing";
import { aivaultSellPrice } from "./families";

export type AivaultBulkMarkupTier = { min_qty: number; markup_percent: number };

const MAX_AIVAULT_BULK_TIERS = 5;
const MIN_AIVAULT_BULK_QTY = 2;
const MAX_AIVAULT_BULK_QTY = 100;
const MAX_AIVAULT_BULK_MARKUP = 1000;

/**
 * Validasi input tier grosir AIVault berbasis markup (JSON string atau array).
 * 1..5 tier, tepat 2 key (`min_qty`, `markup_percent`), `min_qty` integer 2..100
 * naik ketat, dan `markup_percent` finite 0..1000 turun ketat.
 */
export function parseAivaultBulkMarkup(input: unknown): AivaultBulkMarkupTier[] | null {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_AIVAULT_BULK_TIERS) {
    return null;
  }

  let prevQty = MIN_AIVAULT_BULK_QTY - 1;
  let prevMarkup = Infinity;
  const parsed: AivaultBulkMarkupTier[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const keys = Object.keys(row);
    if (
      keys.length !== 2 ||
      !Object.prototype.hasOwnProperty.call(row, "min_qty") ||
      !Object.prototype.hasOwnProperty.call(row, "markup_percent")
    ) {
      return null;
    }

    const minQty = row.min_qty;
    const markupPercent = row.markup_percent;
    if (
      typeof minQty !== "number" ||
      !Number.isSafeInteger(minQty) ||
      minQty < MIN_AIVAULT_BULK_QTY ||
      minQty > MAX_AIVAULT_BULK_QTY ||
      minQty <= prevQty
    ) {
      return null;
    }

    if (
      typeof markupPercent !== "number" ||
      !Number.isFinite(markupPercent) ||
      markupPercent < 0 ||
      markupPercent > MAX_AIVAULT_BULK_MARKUP ||
      markupPercent >= prevMarkup
    ) {
      return null;
    }

    prevQty = minQty;
    prevMarkup = markupPercent;
    parsed.push({ min_qty: minQty, markup_percent: markupPercent });
  }

  return parsed;
}

/**
 * Turunkan harga grosir rupiah dari tier markup dan biaya supplier terkini.
 * Tier dengan harga >= basePrice dibuang, sisanya diklem agar non-increasing,
 * lalu diverifikasi terhadap kontrak `validateBulkPricing`.
 */
export function deriveAivaultBulkTiers(
  costUsd: number,
  fx: number,
  basePrice: number,
  tiers: readonly AivaultBulkMarkupTier[] | null | undefined,
): BulkTier[] {
  if (
    !tiers ||
    tiers.length === 0 ||
    !Number.isFinite(costUsd) ||
    costUsd <= 0 ||
    !Number.isFinite(fx) ||
    fx <= 0 ||
    !Number.isSafeInteger(basePrice) ||
    basePrice <= 0
  ) {
    return [];
  }

  const derived: BulkTier[] = [];
  let maxAllowed = basePrice - 1;

  for (const tier of tiers) {
    let unit: number;
    try {
      unit = aivaultSellPrice(costUsd, fx, tier.markup_percent);
    } catch {
      return [];
    }
    if (unit >= basePrice) continue;
    const clamped = Math.min(unit, maxAllowed);
    if (!Number.isSafeInteger(clamped) || clamped <= 0) return [];
    maxAllowed = clamped;
    derived.push({ min_qty: tier.min_qty, unit_price: clamped });
  }

  if (derived.length === 0) return [];
  const checked = validateBulkPricing({ enabled: true, tiers: derived }, basePrice);
  return checked ? checked.tiers : [];
}

/**
 * Ketika harga dasar memakai rumus (manualPrice == null), setiap tier grosir
 * wajib memiliki markup lebih rendah daripada markup dasar.
 */
export function validateAivaultBulkAgainstBase(
  tiers: readonly AivaultBulkMarkupTier[],
  baseMarkup: number,
  manualPrice: number | null | undefined,
): "ok" | "bulk_markup_not_below_base" {
  if (manualPrice != null) return "ok";
  if (!Number.isFinite(baseMarkup)) {
    return tiers.length === 0 ? "ok" : "bulk_markup_not_below_base";
  }
  return tiers.every((tier) => tier.markup_percent < baseMarkup)
    ? "ok"
    : "bulk_markup_not_below_base";
}
