import type { Locale } from "./locale";

const UNIT: Record<string, string> = { hari: "day", bulan: "month", tahun: "year", minggu: "week" };

const PHRASES: [RegExp, string][] = [
  [/\bno garansi\b/gi, "No warranty"],
  [/\bpremium garansi\b/gi, "Premium warranty"],
  [/\bgaransi\b/gi, "warranty"],
  [/\bpro biasa\b/gi, "Pro standard"],
  [/^harian$/i, "Daily"],
  [/^mingguan$/i, "Weekly"],
  [/^bulanan$/i, "Monthly"],
  [/\bakun sendiri\b/gi, "Own account"],
  [/\bakun buyyer\b/gi, "Buyer account"],
  [/\bakun admin\b/gi, "Admin account"],
  [/\bakun\b/gi, "Account"],
  [/\bcustome username\b/gi, "Custom username"],
  [/\bcustom username\b/gi, "Custom username"],
  [/\bsewa bot\b/gi, "Bot rental"],
  [/\btambah komentar\b/gi, "Add comments"],
  [/\bcek tag\b/gi, "Check tag"],
  [/\bversi\b/gi, "Version"],
];

/**
 * Label varian untuk pembeli EN: hanya durasi/unit dan kata tier yang dikenal.
 * Brand/nama produk dan kata tak dikenal dibiarkan. Nilai tersimpan TIDAK
 * pernah diubah (routing/SKU/cart identity tetap memakai label asli).
 */
export function translateVariantLabel(label: string | null | undefined, locale: Locale): string {
  if (locale !== "en") return String(label ?? "");
  let out = String(label ?? "");
  out = out.replace(/\b(\d+(?:\s*-\s*\d+)?)\s*(hari|bulan|tahun|minggu)\b/gi, (_match, count: string, unit: string) => {
    const n = count.replace(/\s+/g, "");
    const singular = /^\d+$/.test(n) && Number(n) === 1;
    const base = UNIT[unit.toLowerCase()] ?? unit;
    const word = base.charAt(0).toUpperCase() + base.slice(1);
    return `${n} ${word}${singular ? "" : "s"}`;
  });
  for (const [pattern, replacement] of PHRASES) out = out.replace(pattern, replacement);
  return out.replace(/\s{2,}/g, " ").trim();
}
