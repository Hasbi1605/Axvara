/**
 * Rumus harga jual AXVARA Games (keputusan owner 9 November 2026, docs/GAMES.md §1).
 *
 * harga jual = harga referensi (Oura Store) − 2%, tetapi tidak boleh di bawah
 * batas bawah = harga minimum P yang setelah dipotong biaya kanal pembayaran
 * masih menyisakan modal × (1 + margin minimum 3%):
 *   P − (P × feePercent/100 + feeFlat) ≥ cost × (1 + minMarginPercent/100)
 * SKU tanpa referensi memakai batas bawah. Semua nilai rupiah dibulatkan ke atas.
 */

export interface ChannelFee {
  /** Biaya persen kanal, mis. 0.7 untuk 0,7%. */
  percent?: number;
  /** Biaya tetap kanal dalam rupiah. */
  flat?: number;
}

export interface GamesPriceInput {
  /** Modal Digiflazz per item (rupiah). */
  cost: number;
  /** Harga pembanding (Oura Store); null/undefined bila tidak ada. */
  referencePrice?: number | null;
  fee?: ChannelFee;
  /** Default 2 (persen di bawah referensi). */
  referenceDiscountPercent?: number;
  /** Default 3 (persen margin minimum di atas modal, setelah biaya kanal). */
  minMarginPercent?: number;
}

export interface GamesPriceResult {
  price: number;
  floor: number;
  /** "reference" bila harga referensi −2% dipakai, "floor" bila batas bawah. */
  source: "reference" | "floor";
  /** true bila harga jual tidak lebih mahal dari harga referensi. */
  competitive: boolean | null;
}

/** Pembulatan harga yang diizinkan (keputusan owner OD1, dokumen GAMES §14). */
export const GAMES_PRICE_ROUNDINGS = [1, 100, 500, 1000] as const;
export type GamesPriceRounding = (typeof GAMES_PRICE_ROUNDINGS)[number];
export const GAMES_MARKUP_DEFAULT_PERCENT = 5;
export const GAMES_PRICE_DEFAULT_ROUNDING: GamesPriceRounding = 100;
export const GAMES_MARKUP_MAX_PERCENT = 100;
export const GAMES_MARKUP_MAX_FIXED = 1_000_000;

export interface GamesMarkupPriceInput {
  /** Modal supplier per item (rupiah, bilangan bulat positif). */
  cost: number;
  /** Markup persen 0–100, maksimal 2 desimal. Default 5. */
  markupPercent?: number;
  /** Markup tetap rupiah 0–1.000.000. Default 0. */
  markupFixed?: number;
  /** Pembulatan rupiah: 1 | 100 | 500 | 1000. Default 100. */
  rounding?: GamesPriceRounding;
}

/**
 * Harga jual Games (OD1, 14 November 2026), aritmetika bilangan bulat:
 *   bp    = round(pct × 100)
 *   harga = ceil(cost × (10000 + bp) / (10000 × R)) × R + fixed
 * Contoh 5 %/R100: 11750 → 12400, 321115 → 337200.
 */
export function computeGamesMarkupPrice(input: GamesMarkupPriceInput): number {
  const cost = input.cost;
  if (!Number.isSafeInteger(cost) || cost <= 0) throw new RangeError("cost tidak valid");
  const percent = input.markupPercent ?? GAMES_MARKUP_DEFAULT_PERCENT;
  if (!Number.isFinite(percent) || percent < 0 || percent > GAMES_MARKUP_MAX_PERCENT) {
    throw new RangeError("markupPercent tidak valid");
  }
  const basisPoints = Math.round(percent * 100);
  // Lebih dari 2 desimal (0,005 %) tidak bisa direpresentasikan basis point.
  if (Math.abs(basisPoints - percent * 100) > 1e-6) throw new RangeError("markupPercent maksimal 2 desimal");
  const fixed = input.markupFixed ?? 0;
  if (!Number.isSafeInteger(fixed) || fixed < 0 || fixed > GAMES_MARKUP_MAX_FIXED) {
    throw new RangeError("markupFixed tidak valid");
  }
  const rounding = input.rounding ?? GAMES_PRICE_DEFAULT_ROUNDING;
  if (!(GAMES_PRICE_ROUNDINGS as readonly number[]).includes(rounding)) throw new RangeError("rounding tidak valid");
  const denominator = 10_000 * rounding;
  const scaled = cost * (10_000 + basisPoints);
  if (!Number.isSafeInteger(scaled) || !Number.isSafeInteger(denominator)) throw new RangeError("cost terlalu besar");
  const price = Math.ceil(scaled / denominator) * rounding + fixed;
  if (!Number.isSafeInteger(price) || price <= 0) throw new RangeError("harga tidak valid");
  return price;
}

/** Markup persen yang benar-benar dipakai: varian → game → global. */
export function effectiveMarkupPercent(
  variant: number | null | undefined,
  game: number | null | undefined,
  global: number,
): number {
  for (const value of [variant, game]) {
    if (value !== null && value !== undefined && Number.isFinite(Number(value))) return Number(value);
  }
  return global;
}

function assertAmount(name: string, value: number, allowZero = false): void {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new RangeError(`${name} tidak valid`);
  }
}

export function gamesPriceFloor(cost: number, fee: ChannelFee = {}, minMarginPercent = 3): number {
  const percent = fee.percent ?? 0;
  const flat = fee.flat ?? 0;
  assertAmount("cost", cost);
  assertAmount("fee.percent", percent, true);
  assertAmount("fee.flat", flat, true);
  assertAmount("minMarginPercent", minMarginPercent, true);
  if (percent >= 100) throw new RangeError("fee.percent tidak valid");
  const net = cost * (1 + minMarginPercent / 100) + flat;
  return Math.ceil(net / (1 - percent / 100) - 1e-9);
}

export function computeGamesSellPrice(input: GamesPriceInput): GamesPriceResult {
  const floor = gamesPriceFloor(input.cost, input.fee, input.minMarginPercent ?? 3);
  const ref = input.referencePrice;
  if (ref === null || ref === undefined) {
    return { price: floor, floor, source: "floor", competitive: null };
  }
  assertAmount("referencePrice", ref);
  const discount = input.referenceDiscountPercent ?? 2;
  assertAmount("referenceDiscountPercent", discount, true);
  if (discount >= 100) throw new RangeError("referenceDiscountPercent tidak valid");
  const target = Math.ceil(ref * (1 - discount / 100) - 1e-9);
  const useReference = target >= floor;
  const price = useReference ? target : floor;
  return { price, floor, source: useReference ? "reference" : "floor", competitive: price <= ref };
}
