import { idrToUsdCents, parseFxTimestamp, USD_FX_MAX_AGE_MS, type FxSnapshot } from "@/lib/payments/fx";
import type { Locale } from "./locale";

export function formatIdr(amount: number, locale: Locale): string {
  if (!Number.isSafeInteger(amount)) throw new Error("invalid_idr");
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);
}
export function formatUsdCents(cents: bigint, locale: Locale): string {
  const negative = cents < BigInt(0), absolute = negative ? -cents : cents;
  const lang = locale === "en" ? "en-US" : "id-ID";
  const integer = new Intl.NumberFormat(lang).format(absolute / BigInt(100));
  const parts = new Intl.NumberFormat(lang, { style: "currency", currency: "USD", minimumFractionDigits: 2 }).formatToParts(negative ? BigInt(-1) : BigInt(1));
  return parts.map((part) => part.type === "integer" ? integer : part.type === "fraction" ? (absolute % BigInt(100)).toString().padStart(2, "0") : part.value).join("");
}
export function formatCryptoAmount(amountText: string, symbol: string): string { return `${amountText} ${symbol}`; }
export function formatBuyerDate(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(value);
}
export function displayUsdCents(idr: number, fx: FxSnapshot | null): bigint | null {
  if (!fx) return null;
  const timestamp = parseFxTimestamp(fx.effectiveAt);
  if (!timestamp || Date.parse(timestamp) > Date.now() || Date.now() - Date.parse(timestamp) > USD_FX_MAX_AGE_MS) return null;
  return idrToUsdCents(idr, fx);
}
