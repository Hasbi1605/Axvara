import type { Locale } from "./locale";

/**
 * Nama kategori Market untuk pembeli. EN dipetakan dari SLUG produksi (bukan
 * diterjemahkan runtime); slug tak dikenal tetap memakai nama DB (ID) supaya
 * tidak ada tebakan. `semua` adalah filter UI, bukan kategori DB.
 */
export const MARKET_CATEGORY_NAMES: Record<string, { id: string; en: string }> = {
  semua: { id: "Semua Produk", en: "All Products" },
  "ai-chatbot": { id: "AI & Chatbot", en: "AI & Chatbot" },
  "streaming-hiburan": { id: "Streaming & Hiburan", en: "Streaming & Entertainment" },
  "produktivitas-office": { id: "Produktivitas & Office", en: "Productivity & Office" },
  "desain-video": { id: "Desain & Video", en: "Design & Video" },
  "developer-tools": { id: "Developer & Tools", en: "Developer & Tools" },
  "bundle-hemat": { id: "Bundle Hemat", en: "Value Bundles" },
};

/** Label kategori: map EN by slug; fallback = nama DB (ID) atau slug yang dirapikan. */
export function marketCategoryName(slug: string, locale: Locale, dbName?: string | null): string {
  const key = String(slug ?? "").trim().toLowerCase();
  const mapped = MARKET_CATEGORY_NAMES[key];
  if (mapped) return locale === "en" ? mapped.en : mapped.id;
  const fallback = String(dbName ?? "").trim() || key.replace(/-/g, " ");
  return fallback || (locale === "en" ? "Uncategorized" : "Tanpa kategori");
}

/** Ikon/kelas filter "semua" tetap slug; label memakai map di atas. */
export function isAllCategory(slug: string): boolean {
  return String(slug ?? "").trim().toLowerCase() === "semua";
}
