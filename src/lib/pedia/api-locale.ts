// src/lib/pedia/api-locale.ts — bahasa pesan API Pedia untuk pembeli (2026-11-07).
// Sumber tunggal cookie `axv_locale` saja (resolver kanonis yang
// sama dengan Market). Tanpa cookie → Indonesia, sehingga kontrak lama tetap.
import type { NextRequest } from "next/server";
import { localeFromCookieHeader, type Locale } from "@/lib/i18n/locale";

export function pediaApiLocale(request: NextRequest): Locale {
  return localeFromCookieHeader(request.headers.get("cookie"));
}

/** Pilih teks ID/EN tanpa mengubah kode status atau field lain. */
export function pick(locale: Locale, id: string, en: string): string {
  return locale === "en" ? en : id;
}
