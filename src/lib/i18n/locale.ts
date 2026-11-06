// Bilingual core (W3, LOCAL ONLY): tiny shared Locale + cookie reader.
// No i18n dependency. Scope: commerce paths ONLY (web/TG buyer flows);
// admin/pedia/WA remain ID (see payments.md + locale map proposal).
// Cookie name frozen for UI packet: axv_locale.
export type Locale = "id" | "en";
export const LOCALES = ["id", "en"] as const;
export const LOCALE_COOKIE = "axv_locale" as const;
export const CURRENCY_COOKIE = "axv_currency" as const;
export type DisplayCurrency = "IDR" | "USD";
const COUNTRIES = new Set(`AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(" "));

function cookieValue(header: string | null | undefined, name: string, valid: readonly string[]): string | null {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { const value = decodeURIComponent(part.slice(index + 1).trim()); if (valid.includes(value)) return value; } catch { /* Ignore invalid preference. */ }
  }
  return null;
}

export function normalizeCountry(value: unknown): string | null {
  return typeof value === "string" && COUNTRIES.has(value.toUpperCase()) ? value.toUpperCase() : null;
}

export function resolveBuyerPreferences(cookieHeader: string | null | undefined, acceptLanguage: string | null | undefined, country: unknown) {
  const location = normalizeCountry(country);
  const cookieLocale = cookieValue(cookieHeader, LOCALE_COOKIE, LOCALES) as Locale | null;
  const currency = (cookieValue(cookieHeader, CURRENCY_COOKIE, ["IDR", "USD"]) ?? (location && location !== "ID" ? "USD" : "IDR")) as DisplayCurrency;
  const languages = (acceptLanguage ?? "").split(",").flatMap((entry, index) => {
    const match = /^\s*(id|en)(?:-[a-z0-9]{1,8})*(?:\s*;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/i.exec(entry);
    if (!match) return [];
    const quality = match[2] === undefined ? 1 : Number(match[2]);
    return quality > 0 ? [{ locale: match[1].toLowerCase() as Locale, quality, index }] : [];
  }).sort((a, b) => b.quality - a.quality || a.index - b.index);
  return { locale: cookieLocale ?? languages[0]?.locale ?? (location && location !== "ID" ? "en" : "id"), currency };
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
 * axv_locale from a `cookie` header value. `Accept-Language` fallback only
 * when `acceptLanguage` is passed explicitly (route decides to pass it).
 */
export function localeFromCookieHeader(cookieHeader: string | null | undefined, acceptLanguage?: string | null): Locale {
  return resolveBuyerPreferences(cookieHeader, acceptLanguage, null).locale;
}
