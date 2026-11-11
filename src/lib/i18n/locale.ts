// Bilingual core: tiny shared Locale + cookie reader. No i18n dependency.
// Scope: commerce paths + Pedia storefront + AXVARA Market buyer surfaces
// (owner 7 Nov 2026: EN covers Market chrome, categories and static content;
// Pedia ikut axv_locale/axv_currency); admin/WA remain ID.
// Sumber kebenaran: cookie `axv_locale` untuk chrome/beranda dan `order.locale`
// untuk halaman pesanan/lacak. Cookie name frozen: axv_locale.
export type Locale = "id" | "en";
export const LOCALES = ["id", "en"] as const;
export const LOCALE_COOKIE = "axv_locale" as const;
export const CURRENCY_COOKIE = "axv_currency" as const;
export type DisplayCurrency = "IDR" | "USD";

function cookieValue(header: string | null | undefined, name: string, valid: readonly string[]): string | null {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { const value = decodeURIComponent(part.slice(index + 1).trim()); if (valid.includes(value)) return value; } catch { /* Ignore invalid preference. */ }
  }
  return null;
}

export function resolveBuyerPreferences(cookieHeader: string | null | undefined): { locale: Locale; currency: DisplayCurrency } {
  return {
    locale: (cookieValue(cookieHeader, LOCALE_COOKIE, LOCALES) ?? "id") as Locale,
    currency: (cookieValue(cookieHeader, CURRENCY_COOKIE, ["IDR", "USD"]) ?? "IDR") as DisplayCurrency,
  };
}

export function preferenceCookie(name: typeof LOCALE_COOKIE | typeof CURRENCY_COOKIE, value: Locale | DisplayCurrency, https: boolean): string {
  if (!(name === LOCALE_COOKIE ? LOCALES.includes(value as Locale) : ["IDR", "USD"].includes(value))) throw new Error("invalid_preference");
  return `${name}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${https ? "; Secure" : ""}`;
}

/** Normalize anything to id|en: /^en/i -> en, else id (default stays id). */
export function normalizeLocale(value: unknown): Locale {
  if (typeof value !== "string") return "id";
  return /^en/i.test(value.trim()) ? "en" : "id";
}

/**
 * Pure cookie-header reader (edge-safe, no next/headers import): extracts
 * axv_locale from a `cookie` header value. No browser or regional fallback.
 */
export function localeFromCookieHeader(cookieHeader: string | null | undefined): Locale {
  return resolveBuyerPreferences(cookieHeader).locale;
}
