import type { Locale } from "./locale";
import { translateVariantLabel } from "./variant-copy";

/** Kata nama produk yang punya padanan aman; brand/nama tak dikenal dibiarkan. */
const NAME_WORDS: [RegExp, string][] = [
  [/\bmiliar\b/gi, "Billion"],
  [/\baplikasi\b/gi, "Applications"],
  [/\bkampus\b/gi, "Campus"],
  [/\bdomain murah\b/gi, "Cheap Domain"],
];

export function translateProductName(name: string | null | undefined, locale: Locale): string {
  const raw = String(name ?? "");
  if (locale !== "en") return raw;
  let out = translateVariantLabel(raw, "en");
  for (const [pattern, replacement] of NAME_WORDS) out = out.replace(pattern, replacement);
  return out.replace(/\s{2,}/g, " ").trim();
}

/**
 * Nama produk untuk pembeli EN: `name_en` admin bila terisi, selain itu
 * terjemahan token. Nilai tersimpan (order snapshot/email identity) tidak
 * pernah diubah oleh fungsi ini.
 */
export function productDisplayName(
  product: { name: string; nameEn?: string | null },
  locale: Locale,
): string {
  if (locale !== "en") return product.name;
  const admin = String(product.nameEn ?? "").trim();
  return admin || translateProductName(product.name, "en");
}
