// Harga crypto multi-koin (LOCAL ONLY): biaya layanan AXVARA per koin, dan buffer
// minimum provider. Modul MURNI (BigInt, tanpa float, tanpa IO) agar quote, token,
// create web, Telegram dan tes memakai satu rumus.
//
// Keputusan owner 5 November 2026:
//  - Invoice baru memakai kurs mengambang dan fee provider ditanggung merchant
//    (is_fixed_rate:false, is_fee_paid_by_user:false) agar minimum provider rendah.
//  - Pembeli menanggung biayanya lewat biaya layanan crypto AXVARA.
//  - Keputusan owner 7 November 2026: TIDAK ADA lantai US$2 milik AXVARA. Ketersediaan
//    crypto hanya ditentukan minimum provider per koin x 1,15 (buffer) — lihat aturan
//    area `docs/agent-rules/payments.md`.
//
// Keputusan owner 7 November 2026 (menggantikan biaya layanan rata 2%):
//  - Biaya layanan = bagian proporsional 1% + biaya tetap per koin (USD sen) yang
//    menutup fee proses NOWPayments + fee payout, sehingga merchant menerima minimal
//    nilai barang. Angka tetap: usdtbsc 8, bnbbsc 8, eth 17, ticker lain 20 (cadangan
//    sampai dikalibrasi dari potongan nyata dashboard NOWPayments).
//  - total = ceil((base + fixed) * 10000 / (10000 - bps)); surcharge = total - base.
import { parseDecimalParts } from "./decimal";
import { idrToUsdCents, type FxSnapshot } from "./fx";

/** Bagian proporsional biaya layanan: 1% (keputusan owner 7 Nov 2026). */
export const CRYPTO_SURCHARGE_BPS = 100;
/** Biaya tetap per koin dalam sen USD (termasuk cadangan payout). Ticker lain: 20. */
export const CRYPTO_FIXED_FEE_CENTS: Readonly<Record<string, number>> = Object.freeze({
  usdtbsc: 8,
  bnbbsc: 8,
  eth: 17,
});
/** Biaya tetap cadangan untuk ticker yang belum dikalibrasi. */
export const CRYPTO_DEFAULT_FIXED_FEE_CENTS = 20;
/** Buffer minimum provider: 115/100 (naik 15%). */
export const CRYPTO_MIN_BUFFER_NUM = 115; // penyebut 100 tertanam di cryptoRequiredTotalCents

const BPS_DEN = 10_000;

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - BigInt(1)) / denominator;
}

/** Biaya tetap (sen USD) untuk satu ticker; case-insensitive, tak dikenal/kosong -> 20. */
export function cryptoFixedFeeCents(ticker: unknown): bigint {
  const key = typeof ticker === "string" ? ticker.trim().toLowerCase() : "";
  const cents = Object.prototype.hasOwnProperty.call(CRYPTO_FIXED_FEE_CENTS, key)
    ? CRYPTO_FIXED_FEE_CENTS[key]
    : CRYPTO_DEFAULT_FIXED_FEE_CENTS;
  return BigInt(cents);
}

export type CryptoPricing = {
  baseCents: bigint;
  fixedCents: bigint;
  surchargeCents: bigint;
  totalCents: bigint;
  surchargeBps: number;
};

/**
 * Rincian biaya satu koin: bagian proporsional + biaya tetap per koin.
 * total = ceil((base + fixed) * 10000 / (10000 - bps)); surcharge = total - base.
 */
export function cryptoPricing(baseCents: bigint, ticker: string, bps: number = CRYPTO_SURCHARGE_BPS): CryptoPricing {
  if (baseCents < BigInt(0)) throw new Error("crypto_invalid_base");
  if (!Number.isSafeInteger(bps) || bps < 0 || bps >= BPS_DEN) throw new Error("crypto_invalid_bps");
  const fixedCents = cryptoFixedFeeCents(ticker);
  const totalCents = ceilDiv((baseCents + fixedCents) * BigInt(BPS_DEN), BigInt(BPS_DEN - bps));
  return { baseCents, fixedCents, surchargeCents: totalCents - baseCents, totalCents, surchargeBps: bps };
}

/**
 * Total minimum (sen USD) agar sebuah koin boleh ditawarkan/dibuat:
 * ceil(minimum provider USD x 1,15) dibulatkan ke atas ke sen. Tanpa lantai AXVARA.
 * `minUsdText` = fiat_equivalent provider (teks desimal). null bila tidak valid (fail closed).
 */
export function cryptoRequiredTotalCents(minUsdText: unknown): bigint | null {
  const parts = parseDecimalParts(minUsdText);
  if (!parts || parts.scaled <= BigInt(0)) return null;
  let pow = BigInt(1);
  for (let i = 0; i < parts.scale; i++) pow *= BigInt(10);
  // value = scaled / 10^scale USD; sen = value * 100; buffered = sen * 115/100
  // = scaled * 115 / 10^scale (dibulatkan ke atas ke sen).
  return ceilDiv(parts.scaled * BigInt(CRYPTO_MIN_BUFFER_NUM), pow);
}

/** Sen USD -> teks 2 desimal eksak ("2.25"). */
export function centsToUsdText(cents: bigint): string {
  if (cents < BigInt(0)) throw new Error("crypto_invalid_cents");
  return `${(cents / BigInt(100)).toString()}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
}

/**
 * Subtotal IDR terkecil yang total crypto-nya (base + biaya layanan per koin) >= `requiredTotalCents`
 * pada kurs snapshot, atau null bila tidak terhitung aman. Hanya untuk tampilan "Min."
 * (server menghitung; klien tidak berhitung finansial).
 */
export function minIdrSubtotalForTotal(requiredTotalCents: bigint, ticker: string, fx: FxSnapshot): number | null {
  try {
    if (requiredTotalCents <= BigInt(0)) return null;
    // Perkiraan awal (base yang dibutuhkan bila tanpa pembulatan), lalu digeser eksak
    // oleh dua loop di bawah memakai rumus yang sama dengan quote.
    let base = (requiredTotalCents * BigInt(BPS_DEN - CRYPTO_SURCHARGE_BPS)) / BigInt(BPS_DEN) - cryptoFixedFeeCents(ticker);
    if (base < BigInt(0)) base = BigInt(0);
    while (cryptoPricing(base, ticker).totalCents < requiredTotalCents) base += BigInt(1);
    while (base > BigInt(0) && cryptoPricing(base - BigInt(1), ticker).totalCents >= requiredTotalCents) base -= BigInt(1);
    const num = BigInt(fx.rateNum);
    const den = BigInt(fx.rateDen);
    // idrToUsdCents = floor((2*idr*100*den + num) / (2*num)) >= base  <=>  idr >= (2*base - 1) * num / (200*den)
    let idr = base <= BigInt(0) ? BigInt(1) : ceilDiv((BigInt(2) * base - BigInt(1)) * num, BigInt(200) * den);
    if (idr < BigInt(1)) idr = BigInt(1);
    const centsOf = (value: bigint) => idrToUsdCents(Number(value), fx);
    if (idr > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    while (centsOf(idr) < base) idr += BigInt(1);
    while (idr > BigInt(1) && centsOf(idr - BigInt(1)) >= base) idr -= BigInt(1);
    return idr <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(idr) : null;
  } catch {
    return null;
  }
}
