// USD FX snapshot for display + crypto (LOCAL ONLY).
// Product subtotal stays integer IDR. Sumber utama kurs = snapshot D1 yang
// di-refresh cron dari NOWPayments /estimate (market-snapshot.ts, source
// "nowpayments-estimate"). `loadFxSnapshot` di bawah HANYA membaca pasangan
// env darurat (override manual operator):
//   USD_IDR_RATE            — positive decimal IDR per 1 USD, e.g. "16000" or "16002.5"
//   USD_FX_EFFECTIVE_AT     — strict ISO-8601 timestamp the rate took effect
// Konsumen memakai `loadCurrentFxSnapshot()` (market-snapshot.ts): D1 segar
// -> env darurat -> null. Freshness: fixed 24h ceiling (no extra env knob).
// Missing / unparseable / non-positive / stale (>24h) / future-dated =>
// null and crypto/USD UNAVAILABLE (fail closed: quote omits it, create
// rejects). No defaults, no float money math, no guesses.
// Test fixtures set the env vars LOCALLY inside tests only (never prod config).

import { parseDecimalParts } from "./decimal";

export const USD_FX_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type FxSource = "operator-fixed" | "nowpayments-estimate";
export const FX_SOURCES: readonly FxSource[] = ["operator-fixed", "nowpayments-estimate"];

export type FxSnapshot = {
  rateText: string; // canonical source string, e.g. "16000"
  rateNum: string; // rational numerator (integer text)
  rateDen: string; // rational denominator (integer text, >=1)
  effectiveAt: string; // strict ISO, <= now, within 24h
  source: FxSource;
};

const RATE_MAX_CHARS = 32;

/** Parse "16000", "16002.5", "1.60025e4" is NOT allowed: plain digits + one dot. */
export function parseRateRational(raw: string): { num: bigint; den: bigint } | null {
  const text = raw.trim();
  if (!text || text.length > RATE_MAX_CHARS) return null;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  if (frac.length > 12) return null;
  const digits = whole.replace(/^0+(?=\d)/, "") + frac;
  try {
    const num = BigInt(digits === "" ? "0" : digits);
    let den = BigInt(1);
    for (let i = 0; i < frac.length; i++) den *= BigInt(10);
    if (num <= BigInt(0) || den <= BigInt(0)) return null;
    return { num, den };
  } catch {
    return null;
  }
}

export function parseFxTimestamp(raw: string): string | null {
  const text = raw.trim();
  // strict ISO-8601 WITH timezone: date-only / no-zone / natural language
  // rejected — the comment promises strictness, parser must enforce it.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, zone] = match;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== `${year}-${month}-${day}` ||
      +hour > 23 || +minute > 59 || +second > 59 ||
      (zone !== "Z" && (+zone.slice(1, 3) > 23 || +zone.slice(4, 6) > 59))) return null;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** Read + validate the EMERGENCY env snapshot, or null. Bukan sumber utama:
 * konsumen memakai loadCurrentFxSnapshot() (D1 -> env -> null). */
export function loadFxSnapshot(now: number = Date.now()): FxSnapshot | null {
  const rateRaw = process.env.USD_IDR_RATE;
  const effectiveRaw = process.env.USD_FX_EFFECTIVE_AT;
  if (!rateRaw || !effectiveRaw) return null;
  const rational = parseRateRational(rateRaw);
  if (!rational) return null;
  const effectiveAt = parseFxTimestamp(effectiveRaw);
  if (!effectiveAt || Date.parse(effectiveAt) > now || now - Date.parse(effectiveAt) > USD_FX_MAX_AGE_MS) return null;
  const canonical = rateRaw.trim().replace(/^0+(?=\d)/, "");
  return {
    rateText: canonical,
    rateNum: String(rational.num),
    rateDen: String(rational.den),
    effectiveAt,
    source: "operator-fixed",
  };
}

/**
 * IDR subtotal (safe integer) -> USD cents (bigint), round half up, BigInt only:
 * cents = floor((2*idr*100*den + num) / (2*num)).
 * e.g. 250000 @16000 => floor((2*250000*100*1 + 16000)/(2*16000)) = 1563.
 */
export function idrToUsdCents(idr: number, fx: FxSnapshot): bigint {
  if (!Number.isSafeInteger(idr) || idr < 0) throw new Error("fx_invalid_subtotal");
  const num = BigInt(fx.rateNum);
  const den = BigInt(fx.rateDen);
  const sub = BigInt(idr);
  return (BigInt(2) * sub * BigInt(100) * den + num) / (BigInt(2) * num);
}

/** USD cents bigint -> provider price_amount exact 2dp, e.g. 1563n => "15.63". */
export function usdCentsToProviderAmount(cents: bigint): string {
  if (cents < BigInt(0)) throw new Error("fx_invalid_cents");
  const whole = cents / BigInt(100);
  const frac = cents % BigInt(100);
  return `${whole.toString()}.${frac.toString().padStart(2, "0")}`;
}

/** Exact comparison of a provider price string against expected USD cents. */
export function isExactUsdPrice(priceText: unknown, expectedCents: bigint): boolean {
  const parts = parseDecimalParts(priceText);
  if (!parts) return false;
  const asCents = ((): bigint | null => {
    let scaled = parts.scaled;
    if (parts.scale > 2) {
      const extra = parts.scale - 2;
      let div = BigInt(1);
      for (let i = 0; i < extra; i++) div *= BigInt(10);
      if (scaled % div !== BigInt(0)) return null; // more precision than cents => not exact
      scaled /= div;
    } else if (parts.scale < 2) {
      let mul = BigInt(1);
      for (let i = 0; i < 2 - parts.scale; i++) mul *= BigInt(10);
      scaled *= mul;
    }
    return scaled;
  })();
  return asCents !== null && asCents === expectedCents;
}

// ---- Kurs otomatis dari NOWPayments /estimate (exact decimal, tanpa float) ----

export const FX_RATE_MIN_IDR_PER_USD = 5000;
export const FX_RATE_MAX_IDR_PER_USD = 50000;

/**
 * IDR per 1 USD dari dua estimasi ke aset referensi yang sama:
 *   estIdr = jumlah aset untuk 1.000.000 IDR, estUsd = jumlah aset untuk 100 USD.
 *   rate = (1.000.000 / estIdr) * (estUsd / 100) = 10000 * estUsd / estIdr.
 * Dibulatkan half-up ke 2 desimal, mengembalikan teks kanonik ("18087.80")
 * atau null bila input tidak valid / di luar 5000-50000.
 */
export function computeIdrPerUsd(estIdrText: unknown, estUsdText: unknown): string | null {
  const idr = parseDecimalParts(estIdrText);
  const usd = parseDecimalParts(estUsdText);
  if (!idr || !usd || idr.scaled <= BigInt(0) || usd.scaled <= BigInt(0)) return null;
  const pow = (n: number) => { let r = BigInt(1); for (let i = 0; i < n; i++) r *= BigInt(10); return r; };
  // rate = 10000 * (usd.scaled/10^su) / (idr.scaled/10^si)
  const numerator = BigInt(10000) * usd.scaled * pow(idr.scale);
  const denominator = idr.scaled * pow(usd.scale);
  // centi-rate = floor((2*100*num + den) / (2*den)) (half up)
  const centi = (BigInt(200) * numerator + denominator) / (BigInt(2) * denominator);
  if (centi < BigInt(FX_RATE_MIN_IDR_PER_USD) * BigInt(100) || centi > BigInt(FX_RATE_MAX_IDR_PER_USD) * BigInt(100)) return null;
  return `${(centi / BigInt(100)).toString()}.${(centi % BigInt(100)).toString().padStart(2, "0")}`;
}

/** |a - ref| / ref <= tolNum/tolDen, exact rational compare (ref > 0). */
export function isRateWithin(
  a: { num: bigint; den: bigint },
  ref: { num: bigint; den: bigint },
  tolNum: number,
  tolDen: number,
): boolean {
  const lhs = a.num * ref.den; // a * ref.den*a.den scaled
  const rhs = ref.num * a.den;
  const diff = lhs > rhs ? lhs - rhs : rhs - lhs;
  // diff / (ref.num*a.den) <= tolNum/tolDen
  return diff * BigInt(tolDen) <= BigInt(tolNum) * rhs;
}
