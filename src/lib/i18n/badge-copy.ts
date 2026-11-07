import type { Locale } from "./locale";

const EN: Record<string, string> = {
  Terlaris: "Best seller",
  Baru: "New",
  Hemat: "Save",
  "Paling Dicari": "Most wanted",
  Promo: "Promo",
};

/**
 * Badge admin untuk pembeli. EN hanya menerjemahkan kata yang dikenal;
 * unknown dikembalikan apa adanya. Stored badge tidak pernah diubah.
 */
export function badgeLabel(badge: string | null | undefined, locale: Locale): string {
  const raw = String(badge ?? "").trim();
  if (!raw) return "";
  if (locale !== "en") return raw;
  const percent = raw.match(/^hemat\s+(\d+)\s*%$/i);
  if (percent) return `Save ${percent[1]}%`;
  return EN[raw] ?? raw;
}
