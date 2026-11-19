// TG1 minimal onboarding copy (LOCAL ONLY): language chooser + welcome/
// settings text in id/en. Typed literal keys only — no large dictionary.
// Existing commerce messages stay ID until TG2; this file only covers
// onboarding + preference surfaces.
import type { DisplayCurrency, Locale } from "@/lib/i18n/locale";
import { escapeHtml, truncate } from "./format";

export type TgPrefTextKey =
  | "choose_language"
  | "language_saved"
  | "currency_saved"
  | "invalid_choice"
  | "settings_title"
  | "welcome_resume";

const TEXTS: Record<Locale, Record<TgPrefTextKey, string>> = {
  id: {
    choose_language: "Pilih bahasa / Choose language:",
    language_saved: "Bahasa disimpan: Bahasa Indonesia. Mata uang tampilan tidak berubah.",
    currency_saved: "Mata uang tampilan disimpan.",
    invalid_choice: "Pilihan tidak valid.",
    settings_title: "Pengaturan",
    welcome_resume: "Lanjut:",
  },
  en: {
    choose_language: "Pilih bahasa / Choose language:",
    language_saved: "Language saved: English. Display currency unchanged.",
    currency_saved: "Display currency saved.",
    invalid_choice: "Invalid choice.",
    settings_title: "Settings",
    welcome_resume: "Continue:",
  },
};

export function tgPrefText(locale: Locale, key: TgPrefTextKey): string {
  return TEXTS[locale][key];
}

export function languageChooserMessage(): string {
  // One bubble, both scripts visible — same string for id/en surface.
  return "<b>Pilih bahasa / Choose your language</b>";
}

export function welcomeCaption(locale: Locale): string {
  return locale === "en"
    ? "<b>AXVARA</b> · Type a product name to search."
    : "<b>AXVARA</b> · Ketik nama produk untuk mencari.";
}

export function welcomeMessageLocalized(
  locale: Locale,
  firstName: string,
  bestsellers: { name: string; price?: number }[] = [],
): string {
  const name = escapeHtml(truncate(firstName, 50));
  if (locale === "en") {
    return bestsellers.length > 0
      ? `Hello, ${name} 👋\n🔥 <b>Best sellers</b>`
      : `Hello, ${name} 👋\nType a product name to search.`;
  }
  return bestsellers.length > 0
    ? `Halo, ${name} 👋\n🔥 <b>Paling laris</b>`
    : `Halo, ${name} 👋\nKetik nama produk untuk mencari.`;
}

/** Dedicated display-currency picker copy. `null` is reported as unset with
 * the honest IDR fallback used by render-prefs — never a locale-based default. */
export function currencyChooserMessage(locale: Locale, currency: DisplayCurrency | null): string {
  const current = currency == null
    ? (locale === "en" ? "Not set — IDR." : "Belum dipilih — IDR.")
    : currency;
  if (locale === "en") {
    return [
      "<b>Display Currency</b>",
      `Current: ${current}`,
      "Display only — invoices keep their original currency.",
    ].join("\n");
  }
  return [
    "<b>Mata Uang Tampilan</b>",
    `Saat ini: ${current}`,
    "Hanya tampilan — tagihan tetap memakai mata uang aslinya.",
  ].join("\n");
}

export function settingsMessage(locale: Locale, currency: DisplayCurrency | null): string {
  const cur = currency ?? "IDR";
  if (locale === "en") {
    return [
      "<b>Settings</b>",
      `Language: English · Display: ${cur}`,
      "Language and currency are independent.",
    ].join("\n");
  }
  return [
    "<b>Pengaturan</b>",
    `Bahasa: Indonesia · Tampilan: ${cur}`,
    "Bahasa dan mata uang terpisah.",
  ].join("\n");
}

/** Resume line after language choice when a deep-link payload was preserved. */
export function resumePayloadMessage(locale: Locale, payload: string): string {
  const safe = escapeHtml(truncate(payload, 80));
  return locale === "en"
    ? `Continue: <code>/start ${safe}</code>`
    : `Lanjut: <code>/start ${safe}</code>`;
}
