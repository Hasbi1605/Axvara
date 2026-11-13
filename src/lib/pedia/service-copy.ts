import { whiteLabel } from "@/lib/pedia/terms";
import { pediaServiceName, pediaServiceText } from "@/lib/pedia/copy";
import type { Locale } from "@/lib/i18n/locale";
/** Hanya copy publik yang boleh disalin ke quote dan respons pesanan. */
export type PediaServiceCopy = {
  product_name: string;
  service_name: string;
  description: string;
  terms: string;
  instructions: string;
};

export function capturePediaServiceCopy(product: Record<string, unknown>, tier: Record<string, unknown>): PediaServiceCopy {
  return {
    product_name: whiteLabel(String(product.name ?? "")).slice(0, 120),
    service_name: whiteLabel(String(tier.public_name || tier.label_note || product.name || "")).slice(0, 200),
    description: whiteLabel(String(tier.description_md ?? "")).slice(0, 3000),
    terms: String(tier.terms_md ?? "").slice(0, 3000),
    instructions: String(tier.instructions_md ?? "").slice(0, 3000),
  };
}

export function readPediaServiceCopy(value: unknown): PediaServiceCopy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const copy = value as Record<string, unknown>;
  const limits = { product_name: 120, service_name: 200, description: 3000, terms: 3000, instructions: 3000 };
  if (Object.entries(limits).some(([key, max]) => typeof copy[key] !== "string" || (copy[key] as string).length > max)) return null;
  // Whitelist fields even when reading historical snapshots.
  // White label: snapshot lama bisa memuat kata supplier; disaring saat dibaca.
  return Object.fromEntries(Object.keys(limits).map((key) => [key, whiteLabel(copy[key] as string)])) as PediaServiceCopy;
}

/**
 * Terjemahan tampilan EN untuk snapshot copy Indonesia (2026-11-07).
 * Snapshot tersimpan dan fakta (angka/batas) TIDAK diubah; teks tak dikenal
 * tetap memakai versi Indonesia apa adanya.
 */
export function localizePediaServiceCopy(copy: PediaServiceCopy | null | undefined, locale: Locale): PediaServiceCopy | null {
  if (!copy) return null;
  if (locale !== "en") return copy;
  return {
    product_name: copy.product_name,
    service_name: pediaServiceName(copy.service_name, locale),
    description: pediaServiceText(copy.description, locale),
    terms: pediaServiceText(copy.terms, locale),
    instructions: pediaServiceText(copy.instructions, locale),
  };
}
