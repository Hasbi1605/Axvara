// src/lib/pedia/pricing.ts — Rumus harga Pedia (PEDIA-PRD §7.2).
//
// Murni (tanpa I/O) agar bisa diuji + dipakai client & server dengan hasil
// yang SAMA (AC-04: quote server menyamai total client).
//
//   modal_per_unit = supplier_rate / 1000          (rate IDR per 1K dari API)
//   harga_mentah   = qty × modal_per_unit × (1 + markup_pct/100)
//   harga_mentah   = max(harga_mentah, qty × modal_per_unit + min_profit_rp)
//   harga_jual     = bulatkan_ke_atas(< Rp10.000 → Rp100 ; ≥ Rp10.000 → Rp500)
//   harga_jual     = max(harga_jual, PEDIA_MIN_ORDER_RP)  (default Rp1.000)

export const PEDIA_MIN_ORDER_RP_DEFAULT = 1000;

export type PriceGroup = "G1" | "G2" | "G3";

/** Default markup per kelompok (PEDIA-PRD §7.2; admin bisa override per tingkat). */
export const PRICE_GROUP_DEFAULTS: Record<PriceGroup, { markup_pct: number; min_profit_rp: number }> = {
  G1: { markup_pct: 150, min_profit_rp: 500 },
  G2: { markup_pct: 60, min_profit_rp: 2000 },
  G3: { markup_pct: 20, min_profit_rp: 1000 },
};

export function roundUpPedia(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const step = price < 10_000 ? 100 : 500;
  return Math.ceil(price / step) * step;
}

/** Harga jual untuk satu qty. Semua input rupiah/rate IDR per 1K. */
export function computePediaPrice(args: {
  supplierRatePer1k: number;
  quantity: number;
  markupPct: number;
  minProfitRp: number;
  minOrderRp?: number;
}): number {
  const { supplierRatePer1k, quantity, markupPct, minProfitRp } = args;
  const minOrderRp = args.minOrderRp ?? PEDIA_MIN_ORDER_RP_DEFAULT;
  if (!Number.isFinite(supplierRatePer1k) || supplierRatePer1k < 0) return minOrderRp;
  if (!Number.isFinite(quantity) || quantity <= 0) return minOrderRp;
  const modalPerUnit = supplierRatePer1k / 1000;
  const modal = quantity * modalPerUnit;
  const mentah = Math.max(modal * (1 + markupPct / 100), modal + minProfitRp);
  return Math.max(roundUpPedia(mentah), minOrderRp);
}

/** Margin per paket (untuk pratinjau admin; merah bila < min_profit). */
export function pediaMargin(args: {
  supplierRatePer1k: number;
  quantity: number;
  sellPrice: number;
}): number {
  const modal = (args.quantity * args.supplierRatePer1k) / 1000;
  return args.sellPrice - modal;
}

/** Guard margin PD-32: true bila harga jual masih menutup min profit. */
export function passesMarginGuard(args: {
  supplierRatePer1k: number;
  quantity: number;
  sellPrice: number;
  minProfitRp: number;
}): boolean {
  return pediaMargin(args) >= args.minProfitRp;
}
