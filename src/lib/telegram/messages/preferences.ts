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
    choose_language: "Pilih bahasa / Choose your language:",
    language_saved: "Bahasa disimpan: Bahasa Indonesia. Mata uang tampilan tidak berubah.",
    currency_saved: "Mata uang tampilan disimpan.",
    invalid_choice: "Pilihan tidak valid. Silakan pilih lagi.",
    settings_title: "Pengaturan",
    welcome_resume: "Lanjut:",
  },
  en: {
    choose_language: "Pilih bahasa / Choose your language:",
    language_saved: "Language saved: English. Display currency unchanged.",
    currency_saved: "Display currency saved.",
    invalid_choice: "Invalid choice. Please choose again.",
    settings_title: "Settings",
    welcome_resume: "Continue:",
  },
};

export function tgPrefText(locale: Locale, key: TgPrefTextKey): string {
  return TEXTS[locale][key];
}

export function languageChooserMessage(): string {
  // One bubble, both scripts visible — same string for id/en surface.
  return [
    "<b>Pilih bahasa / Choose your language</b>",
    "",
    "Ketuk salah satu tombol di bawah / Tap one of the buttons below.",
  ].join("\n");
}

export function welcomeMessageLocalized(
  locale: Locale,
  firstName: string,
  bestsellers: { name: string; price: number }[] = [],
): string {
  const name = escapeHtml(truncate(firstName, 50));
  if (locale === "en") {
    const lines = [`<b>Hello, ${name}.</b>`, "Welcome to AXVARA.", ""];
    if (bestsellers.length > 0) {
      lines.push("<b>Best sellers</b>");
      bestsellers.slice(0, 3).forEach((item, i) => {
        lines.push(`${i + 1}. ${escapeHtml(truncate(item.name, 50))}`);
      });
      lines.push("");
    }
    lines.push("Browse products with /katalog or search via /cari.");
    return lines.join("\n");
  }
  const lines = [`<b>Halo, ${name}.</b>`, "Selamat datang di AXVARA.", ""];
  if (bestsellers.length > 0) {
    lines.push("<b>Paling laris</b>");
    bestsellers.slice(0, 3).forEach((item, i) => {
      lines.push(`${i + 1}. ${escapeHtml(truncate(item.name, 50))}`);
    });
    lines.push("");
  }
  lines.push("Lihat produk di /katalog atau cari lewat /cari.");
  return lines.join("\n");
}

/** Dedicated display-currency picker copy. `null` is reported as unset with
 * the honest IDR fallback used by render-prefs — never a locale-based default. */
export function currencyChooserMessage(locale: Locale, currency: DisplayCurrency | null): string {
  const current = currency == null
    ? (locale === "en" ? "Not set — prices show in IDR." : "Belum dipilih — harga tampil dalam IDR.")
    : currency;
  if (locale === "en") {
    return [
      "<b>Display Currency</b>",
      "",
      `Current: ${current}`,
      "",
      "Display only — order totals and payment amounts keep their original currency.",
    ].join("\n");
  }
  return [
    "<b>Mata Uang Tampilan</b>",
    "",
    `Saat ini: ${current}`,
    "",
    "Hanya tampilan — total pesanan dan nominal pembayaran tetap memakai mata uang aslinya.",
  ].join("\n");
}

export function settingsMessage(locale: Locale, currency: DisplayCurrency | null): string {
  const cur = currency ?? "IDR";
  if (locale === "en") {
    return [
      "<b>Settings</b>",
      "",
      `Language: English`,
      `Display currency: ${cur} (display only — invoices stay IDR until TG2)`,
      "",
      "Change below. Language never changes currency; currency never changes language.",
    ].join("\n");
  }
  return [
    "<b>Pengaturan</b>",
    "",
    `Bahasa: Indonesia`,
    `Mata uang tampilan: ${cur} (hanya tampilan — invoice tetap IDR sampai TG2)`,
    "",
    "Ubah di bawah. Bahasa tidak mengubah mata uang; mata uang tidak mengubah bahasa.",
  ].join("\n");
}

/** Resume line after language choice when a deep-link payload was preserved. */
export function resumePayloadMessage(locale: Locale, payload: string): string {
  const safe = escapeHtml(truncate(payload, 80));
  return locale === "en"
    ? `Continue: <code>/start ${safe}</code> — tap to resume where you left off. Nothing was ordered yet.`
    : `Lanjut: <code>/start ${safe}</code> — ketuk untuk melanjutkan. Belum ada order dibuat.`;
}
