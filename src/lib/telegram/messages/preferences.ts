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
    language_saved: "Bahasa disimpan: Indonesia (Rupiah).",
    currency_saved: "Mata uang mengikuti bahasa.",
    invalid_choice: "Pilihan tidak valid.",
    settings_title: "Bahasa",
    welcome_resume: "Lanjut:",
  },
  en: {
    choose_language: "Pilih bahasa / Choose language:",
    language_saved: "Language saved: English (USD).",
    currency_saved: "Currency follows language.",
    invalid_choice: "Invalid choice.",
    settings_title: "Language",
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
  _bestsellers: { name: string; price?: number }[] = [],
): string {
  const name = escapeHtml(truncate(firstName, 50));
  if (locale === "en") {
    return [
      `Hi, ${name} 👋`,
      "Welcome to <b>AXVARA</b> — premium apps &amp; tools with 24/7 automatic delivery.",
      "",
      "🛍 Tap <b>Catalog</b> to start shopping, or type a product name to search.",
    ].join("\n");
  }
  return [
    `Halo, ${name} 👋`,
    "Selamat datang di <b>AXVARA</b>, toko aplikasi &amp; tools premium dengan pengiriman otomatis 24 jam.",
    "",
    "🛍 Ketuk <b>Katalog</b> untuk mulai belanja, atau ketik nama produk untuk mencari.",
  ].join("\n");
}

/** Legacy currency-chooser entrypoint: redirects to language screen with notice. */
export function currencyChooserMessage(locale: Locale, _currency?: DisplayCurrency | null): string {
  return settingsMessage(locale, null, { currencyNote: true });
}

export function settingsMessage(
  locale: Locale,
  _currency?: DisplayCurrency | null,
  opts?: { currencyNote?: boolean },
): string {
  const lines = locale === "en"
    ? [
        ...(opts?.currencyNote ? ["Currency follows language.", ""] : []),
        "<b>Language</b>",
        "Current: English (USD)",
      ]
    : [
        ...(opts?.currencyNote ? ["Mata uang mengikuti bahasa.", ""] : []),
        "<b>Bahasa</b>",
        "Saat ini: Indonesia (Rupiah)",
      ];
  return lines.join("\n");
}

/** Resume line after language choice when a deep-link payload was preserved. */
export function resumePayloadMessage(locale: Locale, payload: string): string {
  const safe = escapeHtml(truncate(payload, 80));
  return locale === "en"
    ? `Continue: <code>/start ${safe}</code>`
    : `Lanjut: <code>/start ${safe}</code>`;
}
