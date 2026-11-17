import type { Locale } from "@/lib/i18n/locale";

export type SnippetSectionKind = "proses" | "aturan" | "garansi";

export type CopySnippet = {
  label: string;
  text: string;
};

export const COPY_SNIPPETS: Record<Locale, Record<SnippetSectionKind, CopySnippet[]>> = {
  id: {
    proses: [
      {
        label: "+ Dikirim otomatis…",
        text: "Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan dan email.",
      },
    ],
    aturan: [
      {
        label: "+ Hubungi admin AXVARA…",
        text: "Ada kendala? Hubungi admin AXVARA dengan menyertakan kode pesanan.",
      },
    ],
    garansi: [
      {
        label: "+ Garansi selama masa aktif…",
        text: "Bergaransi selama masa aktif bila aturan dipatuhi.",
      },
    ],
  },
  en: {
    proses: [
      {
        label: "+ Sent automatically…",
        text: "Sent automatically after payment is confirmed; order details appear on the Track Order page and in email.",
      },
    ],
    aturan: [
      {
        label: "+ Contact AXVARA admin…",
        text: "Need help? Contact AXVARA admin and include your order code.",
      },
    ],
    garansi: [
      {
        label: "+ Active-period warranty…",
        text: "Warranty applies throughout the active period when rules are followed.",
      },
    ],
  },
};

/**
 * Sisipkan satu baris snippet di posisi kursor textarea (atau di baris baru
 * paling akhir bila kursor tidak berada di dalam textarea tersebut).
 */
export function insertLineAtCursor(
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  line: string,
): { value: string; caret: number } {
  if (!textarea || document.activeElement !== textarea) {
    const trimmed = currentValue.replace(/\n+$/, "");
    const value = trimmed ? `${trimmed}\n${line}` : line;
    return { value, caret: value.length };
  }

  const start = textarea.selectionStart ?? currentValue.length;
  const end = textarea.selectionEnd ?? start;
  const before = currentValue.slice(0, start);
  const after = currentValue.slice(end);
  const needsLeadingNewline = before.length > 0 && !before.endsWith("\n");
  const needsTrailingNewline = after.length > 0 && !after.startsWith("\n");
  const inserted = `${needsLeadingNewline ? "\n" : ""}${line}${needsTrailingNewline ? "\n" : ""}`;
  const value = `${before}${inserted}${after}`;
  const caret = before.length + (needsLeadingNewline ? 1 : 0) + line.length;
  return { value, caret };
}
