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
