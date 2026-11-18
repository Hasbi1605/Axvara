import type { D1 } from "@/lib/db";
import { parseRateRational } from "@/lib/payments/fx";
import { loadCurrentFxSnapshot } from "@/lib/payments/market-snapshot";

/** Internal VND/USDT conversion baseline for MiraiAPI top-ups (owner decision 2026-11-18). */
export const MIRAI_VND_PER_USDT = 26000;
export const MIRAI_DEFAULT_MARKUP_PERCENT = 35;
export const MIRAI_MARKUP_MIN = 0;
export const MIRAI_MARKUP_MAX = 1000;

export function isValidMiraiMarkup(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= MIRAI_MARKUP_MIN && value <= MIRAI_MARKUP_MAX;
}

function roundUsdt6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Convert reseller wholesale VND price into USDT stored with <= 6 decimals. */
export function miraiCostUsdtFromVnd(resellerPriceVnd: number): number {
  if (!Number.isFinite(resellerPriceVnd) || resellerPriceVnd <= 0) {
    throw new RangeError("reseller_price_vnd_invalid");
  }
  const usdt = roundUsdt6(resellerPriceVnd / MIRAI_VND_PER_USDT);
  if (!Number.isFinite(usdt) || usdt <= 0) {
    throw new RangeError("cost_usdt_invalid");
  }
  return usdt;
}

/** Convert Mirai wallet balance VND into USDT for display and low-balance alerts. */
export function miraiBalanceVndToUsdt(balanceVnd: number): number {
  if (!Number.isFinite(balanceVnd) || balanceVnd < 0) {
    throw new RangeError("balance_vnd_invalid");
  }
  return roundUsdt6(balanceVnd / MIRAI_VND_PER_USDT);
}

/** Sell price IDR = ceil to Rp100 of cost_usdt * fx_idr_per_usdt * (1 + markup/100). */
export function miraiSellPriceIdr(
  costUsdt: number,
  idrPerUsdt: number,
  markupPercent = MIRAI_DEFAULT_MARKUP_PERCENT,
): number {
  if (!Number.isFinite(costUsdt) || costUsdt <= 0 || !Number.isFinite(idrPerUsdt) || idrPerUsdt <= 0 || !isValidMiraiMarkup(markupPercent)) {
    throw new RangeError("invalid_pricing");
  }
  const raw = costUsdt * idrPerUsdt * (1 + markupPercent / 100);
  const sell = Math.ceil(raw / 100) * 100;
  if (!Number.isSafeInteger(sell) || sell <= 0) {
    throw new RangeError("invalid_pricing");
  }
  return sell;
}

/** Read AXVARA's current USDT/IDR FX snapshot; returns null when unavailable (fail-closed). */
export async function loadMiraiFxIdrPerUsdt(db?: D1 | null, now?: number): Promise<number | null> {
  const fx = await loadCurrentFxSnapshot(db, now);
  const rational = fx ? parseRateRational(fx.rateText) : null;
  if (!rational) return null;
  const rate = Number(rational.num) / Number(rational.den);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}
