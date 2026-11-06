"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CURRENCY_COOKIE, LOCALE_COOKIE, LOCALES, preferenceCookie, type DisplayCurrency, type Locale } from "@/lib/i18n/locale";

/**
 * Preferensi tampilan EKSPLISIT pembeli (cookie `axv_locale` ID/EN dan
 * `axv_currency` IDR/USD) — dua pilihan yang saling bebas. Hook ini hanya
 * membaca cookie yang valid dan menulis cookie lewat `preferenceCookie` main
 * (Path=/, Max-Age=31536000, SameSite=Lax, Secure di HTTPS). Resolusi bawaan
 * (Accept-Language / negara tepercaya) HANYA di server; klien tidak pernah
 * menyimpulkan bahasa/mata uang dari zona waktu, geolokasi, atau navigator.
 * `null` = belum dipilih secara eksplisit.
 */
export const CHANGE_EVENT = "axvara-preferences-changed";
const CURRENCIES = ["IDR", "USD"] as const;

function readCookie<T extends string>(name: string, valid: readonly T[]): T | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try {
      const value = decodeURIComponent(part.slice(index + 1).trim());
      if ((valid as readonly string[]).includes(value)) return value as T;
    } catch { /* cookie rusak diabaikan */ }
  }
  return null;
}

export function readExplicitPreferences(): { locale: Locale | null; currency: DisplayCurrency | null } {
  return { locale: readCookie(LOCALE_COOKIE, LOCALES), currency: readCookie(CURRENCY_COOKIE, CURRENCIES) };
}

export function usePreferences() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<{ locale: Locale | null; currency: DisplayCurrency | null }>({ locale: null, currency: null });

  useEffect(() => {
    const sync = () => setPrefs(readExplicitPreferences());
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);

  const write = useCallback((name: typeof LOCALE_COOKIE | typeof CURRENCY_COOKIE, value: Locale | DisplayCurrency) => {
    // Hanya cookie preferensi yang valid ditulis; tidak menyentuh quote/pesanan/rel/bukti akses.
    document.cookie = preferenceCookie(name, value, window.location.protocol === "https:");
    if (name === LOCALE_COOKIE) document.documentElement.lang = value;
    window.dispatchEvent(new Event(CHANGE_EVENT));
    // Render ulang komponen server lewat API Next bawaan; state klien (keranjang, pilihan metode) tidak disentuh.
    router.refresh();
  }, [router]);

  return {
    ...prefs,
    setLocale: useCallback((value: Locale) => write(LOCALE_COOKIE, value), [write]),
    setCurrency: useCallback((value: DisplayCurrency) => write(CURRENCY_COOKIE, value), [write]),
  };
}
