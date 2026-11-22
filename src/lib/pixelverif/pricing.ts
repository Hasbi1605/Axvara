import type { D1 } from "@/lib/db";
import { parseRateRational } from "@/lib/payments/fx";
import { loadCurrentFxSnapshot } from "@/lib/payments/market-snapshot";

export const PIXELVERIF_DEFAULT_MARKUP_PERCENT = 35;
export const PIXELVERIF_MARKUP_MIN = 0;
export const PIXELVERIF_MARKUP_MAX = 1000;

export function isValidPixelverifMarkup(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= PIXELVERIF_MARKUP_MIN && value <= PIXELVERIF_MARKUP_MAX;
}

/** Sell price IDR = ceil to Rp100 of cost_usd * fx_idr_per_usd * (1 + markup/100). */
export function pixelverifSellPriceIdr(
  costUsd: number,
  idrPerUsd: number,
  markupPercent = PIXELVERIF_DEFAULT_MARKUP_PERCENT,
): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0 || !Number.isFinite(idrPerUsd) || idrPerUsd <= 0 || !isValidPixelverifMarkup(markupPercent)) {
    throw new RangeError("invalid_pricing");
  }
  const raw = costUsd * idrPerUsd * (1 + markupPercent / 100);
  const sell = Math.ceil((Math.round(raw * 1e6) / 1e6) / 100) * 100;
  if (!Number.isSafeInteger(sell) || sell <= 0) {
    throw new RangeError("invalid_pricing");
  }
  return sell;
}

/** Read AXVARA's current USDT/IDR FX snapshot; returns null when unavailable (fail-closed). */
export async function loadPixelverifFxIdrPerUsd(db?: D1 | null, now?: number): Promise<number | null> {
  const fx = await loadCurrentFxSnapshot(db, now);
  const rational = fx ? parseRateRational(fx.rateText) : null;
  if (!rational) return null;
  const rate = Number(rational.num) / Number(rational.den);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}
