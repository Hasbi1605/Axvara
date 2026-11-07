// Harga crypto multi-koin (LOCAL ONLY): biaya layanan AXVARA, lantai total, dan
// buffer minimum provider. Modul MURNI (BigInt, tanpa float, tanpa IO) agar quote,
// token, create web, Telegram dan tes memakai satu rumus.
//
// Keputusan owner 5 November 2026:
//  - Invoice baru memakai kurs mengambang dan fee provider ditanggung merchant
//    (is_fixed_rate:false, is_fee_paid_by_user:false) agar minimum provider rendah.
//  - Pembeli menanggung biayanya lewat biaya layanan crypto AXVARA 2% dari nilai USD:
//    surcharge = ceil(base * 200 / 10000), total = base + surcharge (sen USD).
//  - Keputusan owner 7 November 2026: TIDAK ADA lantai US$2 milik AXVARA. Ketersediaan
//    crypto hanya ditentukan minimum provider per koin x 1,15 (buffer) — lihat aturan
//    area `docs/agent-rules/payments.md`.
import { parseDecimalParts } from "./decimal";
import { idrToUsdCents, type FxSnapshot } from "./fx";

/** SEMENTARA 2% (keputusan owner 7 Nov 2026; kalibrasi ulang dari potongan dashboard NOWPayments). */
export const CRYPTO_SURCHARGE_BPS = 200;
/** Buffer minimum provider: 115/100 (naik 15%). */
export const CRYPTO_MIN_BUFFER_NUM = 115; // penyebut 100 tertanam di cryptoRequiredTotalCents

const BPS_DEN = 10_000;

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - BigInt(1)) / denominator;
}

/** Biaya layanan dalam sen USD: ceil(base * bps / 10000). */
export function cryptoSurchargeCents(baseCents: bigint, bps: number = CRYPTO_SURCHARGE_BPS): bigint {
  if (baseCents < BigInt(0)) throw new Error("crypto_invalid_base");
  return ceilDiv(baseCents * BigInt(bps), BigInt(BPS_DEN));
}

export type CryptoPricing = { baseCents: bigint; surchargeCents: bigint; totalCents: bigint; surchargeBps: number };

export function cryptoPricing(baseCents: bigint, bps: number = CRYPTO_SURCHARGE_BPS): CryptoPricing {
  const surchargeCents = cryptoSurchargeCents(baseCents, bps);
  return { baseCents, surchargeCents, totalCents: baseCents + surchargeCents, surchargeBps: bps };
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
 * Subtotal IDR terkecil yang total crypto-nya (base + biaya layanan) >= `requiredTotalCents`
 * pada kurs snapshot, atau null bila tidak terhitung aman. Hanya untuk tampilan "Min."
 * (server menghitung; klien tidak berhitung finansial).
 */
export function minIdrSubtotalForTotal(requiredTotalCents: bigint, fx: FxSnapshot): number | null {
  try {
    if (requiredTotalCents <= BigInt(0)) return null;
    let base = (requiredTotalCents * BigInt(BPS_DEN)) / BigInt(BPS_DEN + CRYPTO_SURCHARGE_BPS);
    while (cryptoPricing(base).totalCents < requiredTotalCents) base += BigInt(1);
    while (base > BigInt(0) && cryptoPricing(base - BigInt(1)).totalCents >= requiredTotalCents) base -= BigInt(1);
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

/** 200 -> "2" (id/en); 150 -> "1,5" (id) / "1.5" (en). Format saja (tampilan, termasuk invoice lama). */
export function bpsPercentText(bps: number, locale: "id" | "en"): string {
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}${locale === "id" ? "," : "."}${frac}` : String(whole);
}
