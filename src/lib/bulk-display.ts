import { validateBulkPricing, type BulkTier } from "@/lib/bulk-pricing";

/**
 * Tampilan harga grosir untuk pembeli (PDP, modal beli cepat, keranjang,
 * checkout). Semua angka di sini hanyalah ESTIMASI tampilan dari daftar tier
 * yang dikirim server; harga otoritatif selalu dari quote/order server dan
 * klien tidak pernah mengirim harga tier sebagai override.
 *
 * Aturan pemilik: all-units (tier tertinggi yang tercapai berlaku untuk SEMUA
 * unit), kuantitas dijumlah per VARIAN yang sama, tier dihitung dalam IDR
 * sebelum konversi mata uang apa pun (tidak ada FX di klien).
 */

export type BulkLocale = "id" | "en";

/** Field katalog varian yang relevan (kontrak `VariantSummary` di main). */
export type BulkVariantFields = {
  bulk_pricing_enabled?: boolean;
  bulk_pricing_tiers?: BulkTier[];
  bulk_pricing_invalid?: boolean;
};

/**
 * Tier yang boleh dipakai untuk tampilan: hanya bila enabled, tidak ditandai
 * invalid, dan LOLOS validator kanonis terhadap harga dasar saat ini. Config
 * basi/rusak/di atas harga dasar tidak pernah menghasilkan harga atau hemat
 * palsu (hasilnya kosong = harga dasar).
 */
export function safeBulkTiers(base: number, tiers: unknown): BulkTier[] {
  if (!Array.isArray(tiers) || tiers.length === 0) return [];
  const checked = validateBulkPricing({ enabled: true, tiers }, base);
  return checked ? checked.tiers : [];
}

export function usableBulkTiers(variant: BulkVariantFields | null | undefined, base: number): BulkTier[] {
  if (!variant || variant.bulk_pricing_invalid || variant.bulk_pricing_enabled !== true) return [];
  return safeBulkTiers(base, variant.bulk_pricing_tiers);
}

export function activeTier(tiers: BulkTier[], qty: number): BulkTier | null {
  let found: BulkTier | null = null;
  for (const tier of tiers) if (qty >= tier.min_qty) found = tier;
  return found;
}

/** Harga satuan estimasi untuk kuantitas (sudah teragregasi per varian). */
export function bulkUnitEstimate(base: number, tiers: unknown, qty: number): number {
  const safe = safeBulkTiers(base, tiers);
  return activeTier(safe, Math.floor(qty))?.unit_price ?? base;
}

/** Tier berikutnya yang BISA dicapai dalam batas beli; tier di luar batas tidak dipromosikan. */
export function nextReachableTier(tiers: BulkTier[], qty: number, maxQty: number): BulkTier | null {
  return tiers.find((tier) => tier.min_qty > qty && tier.min_qty <= maxQty) ?? null;
}

/** Alasan tier tak tercapai: stok terbatas atau plafon per pesanan (unik 10, baris 100). */
export function tierLimitReason(tier: BulkTier, limits: { stockMax: number; capMax: number }): "stock" | "cap" | null {
  const { stockMax, capMax } = limits;
  const effective = stockMax === -1 ? capMax : Math.min(capMax, stockMax);
  if (tier.min_qty <= effective) return null;
  return stockMax !== -1 && stockMax <= capMax ? "stock" : "cap";
}

export type BulkRow =
  | { kind: "base"; start: number; end: number; price: number }
  | { kind: "tier"; start: number; end: number | null; price: number; threshold: number };

/**
 * Baris rentang untuk daftar tier. Baris dasar mulai dari Min. beli varian dan
 * hilang bila tier pertama sudah mulai di/di bawah Min. beli. Tier di bawah
 * Min. beli dipotong ke Min. beli; rentang yang seluruhnya di bawah dibuang.
 */
export function bulkRows(base: number, tiers: BulkTier[], minQty: number): BulkRow[] {
  const rows: BulkRow[] = [];
  const first = tiers[0]?.min_qty;
  if (first === undefined) return rows;
  if (first > minQty) rows.push({ kind: "base", start: minQty, end: first - 1, price: base });
  tiers.forEach((tier, index) => {
    const next = tiers[index + 1];
    const end = next ? next.min_qty - 1 : null;
    const start = Math.max(tier.min_qty, minQty);
    if (end !== null && end < start) return;
    rows.push({ kind: "tier", start, end, price: tier.unit_price, threshold: tier.min_qty });
  });
  return rows;
}

export function savePercent(base: number, price: number): number {
  if (!(base > 0) || price >= base) return 0;
  return Math.round(((base - price) / base) * 100);
}

type CopySet = {
  title: string;
  heading: string;
  perUnit: string;
  list: string;
  footnote: string;
  activeMark: string;
  nextLead: (n: number) => string;
  nextCart: (n: number, price: string) => string;
  liveOn: (price: string) => string;
  liveOff: (price: string) => string;
  unreachStock: string;
  unreachCap: (cap: number) => string;
  variantHint: (n: number) => string;
  total: (total: string, save: string | null) => string;
  saved: (save: string) => string;
  totalLabel: string;
  savedSummary: (save: string) => string;
  /** Baris item checkout: info tier saja (jumlah hemat hanya di baris agregat di bawah total). */
  line: (n: number) => string;
  aggregated: (n: number) => string;
  included: (save: string) => string;
  cartFootnote: string;
  disclosure: string;
  unitGrosir: (price: string, n: number) => string;
  range: (start: number, end: number | null) => string;
};

const COPY: Record<BulkLocale, CopySet> = {
  id: {
    title: "Harga grosir · per pcs",
    heading: "Harga grosir",
    perUnit: "per pcs",
    list: "Harga grosir",
    footnote: "Berlaku untuk semua unit varian ini.",
    activeMark: "Jumlahmu",
    nextLead: (n) => `Tambah ${n} pcs lagi`,
    nextCart: (n, price) => `Tambah ${n} pcs varian ini untuk ${price}/pcs`,
    liveOn: (price) => `Harga grosir berlaku: ${price} per pcs.`,
    liveOff: (price) => `Harga normal: ${price} per pcs.`,
    unreachStock: "Melebihi stok saat ini",
    unreachCap: (cap) => `Maks. ${cap} per pesanan`,
    variantHint: (n) => `Grosir mulai ${n} pcs`,
    total: (total, save) => `Total ${total}${save ? ` · hemat ${save}` : ""}`,
    saved: (save) => `hemat ${save}`,
    totalLabel: "Total",
    savedSummary: (save) => `Hemat ${save}`,
    line: (n) => `Harga grosir ${n}+`,
    aggregated: (n) => `Grosir dihitung dari total ${n} pcs varian ini`,
    included: (save) => `Hemat grosir ${save}`,
    cartFootnote: "Total final dikonfirmasi di checkout.",
    disclosure: "Lihat harga grosir",
    unitGrosir: (price, n) => `${price}/pcs · grosir ${n}+`,
    range: (start, end) => (end === null ? `${start}+ pcs` : start === end ? `${start} pcs` : `${start}–${end} pcs`),
  },
  en: {
    title: "Bulk pricing · per pcs",
    heading: "Bulk pricing",
    perUnit: "per pcs",
    list: "Bulk pricing",
    footnote: "Applies to every unit of this variant.",
    activeMark: "Your qty",
    nextLead: (n) => `Add ${n} more`,
    nextCart: (n, price) => `Add ${n} more of this variant for ${price}/pcs`,
    liveOn: (price) => `Bulk price applied: ${price} per pcs.`,
    liveOff: (price) => `Regular price: ${price} per pcs.`,
    unreachStock: "Exceeds current stock",
    unreachCap: (cap) => `Max ${cap} per order`,
    variantHint: (n) => `Bulk from ${n} pcs`,
    total: (total, save) => `Total ${total}${save ? ` · save ${save}` : ""}`,
    saved: (save) => `save ${save}`,
    totalLabel: "Total",
    savedSummary: (save) => `You save ${save}`,
    line: (n) => `Bulk price ${n}+`,
    aggregated: (n) => `Bulk price based on ${n} pcs of this variant in total`,
    included: (save) => `Bulk savings ${save}`,
    cartFootnote: "Final total is confirmed at checkout.",
    disclosure: "View bulk pricing",
    unitGrosir: (price, n) => `${price}/pcs · bulk ${n}+`,
    range: (start, end) => (end === null ? `${start}+ pcs` : start === end ? `${start} pcs` : `${start}–${end} pcs`),
  },
};

export function bulkCopy(locale: BulkLocale = "id"): CopySet {
  return COPY[locale] ?? COPY.id;
}

export type QuotedBulkLine = { product_id?: number; variant_id?: number; price: number; base_price?: number; applied_tier_min_qty?: number; qty: number };

/** Hemat per baris dari quote SERVER (base_price hadir hanya bila tier berlaku). */
export function quoteLineSavings(line: QuotedBulkLine): number {
  if (!line.applied_tier_min_qty || line.base_price === undefined || line.base_price <= line.price) return 0;
  return (line.base_price - line.price) * line.qty;
}

export function quoteTotalSavings(lines: QuotedBulkLine[]): number {
  return lines.reduce((sum, line) => sum + quoteLineSavings(line), 0);
}

/** Total qty varian yang sama dalam quote (server normalnya sudah satu baris per varian). */
export function quoteVariantQty(lines: QuotedBulkLine[], line: QuotedBulkLine): number {
  if (line.variant_id === undefined) return line.qty;
  return lines.filter((other) => other.variant_id === line.variant_id).reduce((sum, other) => sum + other.qty, 0);
}

export type TierExpectation = { variantId: number; unit: number };
export type TierPriceChange = { product_id: number; variant_id: number; name: string; previous_price: number; current_price: number; message: string; tier: true };

/**
 * Perubahan harga TIER yang benar-benar terjadi di server sejak pembeli melihat
 * harga. `expectations` = satuan estimasi dari tier yang tersimpan di keranjang
 * untuk qty teragregasi SAAT INI, jadi sekadar melewati ambang tier (qty
 * berubah) tidak pernah menghasilkan perubahan: estimasi dan server sama-sama
 * mengikuti qty baru. Hanya bila satuan server berbeda dari estimasi (config
 * tier diubah admin) muncul entri. Perubahan harga DASAR sudah dilaporkan quote
 * sendiri (`existing`) dan tidak digandakan.
 */
export function tierPriceChanges(
  expectations: TierExpectation[],
  quoted: Array<{ product_id: number; variant_id?: number; name: string; price: number }>,
  existing: Array<{ variant_id?: number }>,
): TierPriceChange[] {
  const out: TierPriceChange[] = [];
  for (const line of quoted) {
    if (line.variant_id === undefined) continue;
    if (existing.some((change) => change.variant_id === line.variant_id)) continue;
    const expected = expectations.find((item) => item.variantId === line.variant_id);
    if (!expected || expected.unit === line.price) continue;
    out.push({
      product_id: line.product_id,
      variant_id: line.variant_id,
      name: line.name,
      previous_price: expected.unit,
      current_price: line.price,
      message: `Harga ${line.name} berubah.`,
      tier: true,
    });
  }
  return out;
}
