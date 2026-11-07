import { cookies } from "next/headers";
import { localeFromCookieHeader, type Locale } from "./locale";

/**
 * Locale pembeli dari cookie `axv_locale` untuk Server Component Market.
 * Hanya baca cookie (tanpa Accept-Language/negara) agar halaman statis tidak
 * menebak; gagal baca = ID (default).
 */
export async function requestLocale(): Promise<Locale> {
  try {
    return localeFromCookieHeader((await cookies()).toString());
  } catch {
    return "id";
  }
}
