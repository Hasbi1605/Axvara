// Penawaran crypto multi-koin untuk quote + create (LOCAL ONLY).
// Satu opsi per koin dari snapshot segar (market-snapshot.ts: aktif di dashboard
// NOWPayments ∩ katalog kurasi crypto-assets.ts, dengan minimum provider USD).
// Harga: base USD dari snapshot kurs (idrToUsdCents) + biaya layanan AXVARA per koin
// (1% proporsional + biaya tetap ticker, crypto-pricing.ts); `amount_text` = TOTAL. Kebijakan provider: kurs mengambang,
// fee provider ditanggung merchant (pembeli menanggung lewat biaya layanan).
// Koin di bawah minimum provider = `available:false, unavailable_reason:"below_min"`
// (tampilan saja, tidak pernah ditandatangani). Tanpa kurs / koin kosong/basi =
// tidak ada opsi (fail closed). Kurs di-pass EKSPLISIT oleh pemanggil
// (loadCurrentFxSnapshot()); modul ini tidak memuat env kurs atau IO apa pun.
// Dipakai quote (katalog web), token, dan Telegram (buildMethodOptions).

import {
  idrToUsdCents,
  USD_FX_MAX_AGE_MS,
  isRateWithin,
  parseFxTimestamp,
  type FxSnapshot,
  type FxSource,
} from "./fx";
import { getCryptoAsset, CRYPTO_ASSETS, type CryptoAssetGroup } from "./crypto-assets";
import {
  centsToUsdText,
  cryptoPricing,
  cryptoRequiredTotalCents,
  minIdrSubtotalForTotal,
} from "./crypto-pricing";

export const CRYPTO_METHOD_PREFIX = "nowpayments:" as const;

/** Ticker dari id metode `nowpayments:<ticker>` atau null (bukan kurasi / bentuk salah). */
export function cryptoTickerOfMethodId(id: unknown): string | null {
  if (typeof id !== "string" || !id.startsWith(CRYPTO_METHOD_PREFIX)) return null;
  const ticker = id.slice(CRYPTO_METHOD_PREFIX.length);
  const asset = getCryptoAsset(ticker);
  return asset && asset.ticker === ticker ? ticker : null;
}

export type CryptoOfferUsd = {
  cents: string; // sen USD BASE (sebelum biaya layanan), string bigint
  rate_num: string;
  rate_den: string;
  rate_text: string;
  source: FxSource;
  effective_at: string;
  idr_subtotal: number;
  pay_currency: string;
  network: string;
};

type CryptoOfferIdentity = {
  id: string;
  kind: "crypto";
  label: string; // simbol, mis. "USDT"
  sublabel: string; // label jaringan, mis. "BNB Smart Chain"
  group: CryptoAssetGroup;
  logo: string;
  currency: "USD";
  pay_currency: string;
  network: string;
};

export type CryptoOffer = CryptoOfferIdentity & {
  available: true;
  amount_text: string; // TOTAL USD termasuk biaya layanan, desimal eksak
  base_cents: number;
  surcharge_cents: number;
  total_cents: number;
  surcharge_bps: number;
  fee_payer: "merchant"; // fee provider ditanggung merchant (kurs mengambang)
  fixed_rate: false;
  sender_gas_extra: true; // gas jaringan pengirim ditanggung pembeli
  usd: CryptoOfferUsd;
};

/** Koin aktif tetapi total di bawah lantai/minimum: tampilan nonaktif, TANPA jumlah. */
export type CryptoOfferUnavailable = CryptoOfferIdentity & {
  available: false;
  unavailable_reason: "below_min";
  min_total_cents: number;
  min_total_text: string;
  min_idr_subtotal: number | null;
};

export type CryptoCatalogEntry = CryptoOffer | CryptoOfferUnavailable;

export function nowpaymentsOutcomeCurrency(): string | null {
  const value = process.env.NOWPAYMENTS_OUTCOME_CURRENCY ?? "";
  return /^[a-z0-9]{1,32}$/.test(value) ? value : null;
}

/** Outcome (USDT BSC dsb.) terkonfigurasi. Koin dibatasi toggle dashboard ∩ kurasi (snapshot), bukan env. */
export function cryptoRailEnabled(): boolean {
  return !!nowpaymentsOutcomeCurrency();
}

function identityOf(ticker: string): CryptoOfferIdentity | null {
  const asset = getCryptoAsset(ticker);
  if (!asset) return null;
  return {
    id: `${CRYPTO_METHOD_PREFIX}${asset.ticker}`, kind: "crypto", label: asset.symbol, sublabel: asset.networkLabel,
    group: asset.group, logo: asset.logo, currency: "USD", pay_currency: asset.ticker, network: asset.network,
  };
}

/** Total/aturan satu koin untuk satu subtotal. Offer tersedia, nonaktif (below_min), atau null (tak dapat dihitung). */
export function buildCryptoCatalogEntry(
  idrSubtotal: number,
  snap: FxSnapshot | null,
  coin: { ticker: string; minUsdText: string },
): CryptoCatalogEntry | null {
  if (!snap || !Number.isSafeInteger(idrSubtotal) || idrSubtotal <= 0) return null;
  if (!cryptoRailEnabled()) return null;
  const identity = identityOf(coin.ticker);
  const required = cryptoRequiredTotalCents(coin.minUsdText);
  if (!identity || required === null) return null;
  let base: bigint;
  try {
    base = idrToUsdCents(idrSubtotal, snap);
  } catch {
    return null;
  }
  const pricing = cryptoPricing(base, coin.ticker);
  if (base <= BigInt(0) || pricing.totalCents < required) {
    // base 0 dianggap di bawah minimum (bukan error) agar pembeli melihat "Min." koin.
    return {
      ...identity, available: false, unavailable_reason: "below_min",
      min_total_cents: Number(required), min_total_text: centsToUsdText(required),
      min_idr_subtotal: minIdrSubtotalForTotal(required, coin.ticker, snap),
    };
  }
  return {
    ...identity,
    available: true,
    amount_text: centsToUsdText(pricing.totalCents),
    base_cents: Number(pricing.baseCents),
    surcharge_cents: Number(pricing.surchargeCents),
    total_cents: Number(pricing.totalCents),
    surcharge_bps: pricing.surchargeBps,
    fee_payer: "merchant",
    fixed_rate: false,
    sender_gas_extra: true,
    usd: {
      cents: pricing.baseCents.toString(),
      rate_num: snap.rateNum,
      rate_den: snap.rateDen,
      rate_text: snap.rateText,
      source: snap.source,
      effective_at: snap.effectiveAt,
      idr_subtotal: idrSubtotal,
      pay_currency: identity.pay_currency,
      network: identity.network,
    },
  };
}

/** Satu koin, hanya bila tersedia (null bila di bawah minimum / tak dapat dihitung). */
export function buildCryptoOffer(idrSubtotal: number, snap: FxSnapshot | null, coin: { ticker: string; minUsdText: string }): CryptoOffer | null {
  const entry = buildCryptoCatalogEntry(idrSubtotal, snap, coin);
  return entry && entry.available ? entry : null;
}

/**
 * Katalog semua koin snapshot segar: populer dulu lalu stablecoin (urutan kurasi `order`),
 * tersedia dan nonaktif bercampur menurut urutan itu. Koin yang tidak ada di snapshot tidak muncul.
 */
export function buildCryptoCatalog(
  idrSubtotal: number,
  snap: FxSnapshot | null,
  coins: readonly { ticker: string; minUsdText: string }[],
): CryptoCatalogEntry[] {
  if (!snap || coins.length === 0) return [];
  const byTicker = new Map(coins.map((coin) => [coin.ticker, coin]));
  const out: CryptoCatalogEntry[] = [];
  for (const asset of CRYPTO_ASSETS) {
    const coin = byTicker.get(asset.ticker);
    if (!coin) continue;
    const entry = buildCryptoCatalogEntry(idrSubtotal, snap, coin);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Cek create: koin ada di snapshot segar saat ini dan TOTAL bertanda masih memenuhi
 * minimum terbaru x 1,15. false => pemanggil menjawab 409 quote_stale / method_unavailable.
 */
export function isCryptoTotalStillPayable(
  totalCents: number,
  ticker: string,
  coins: readonly { ticker: string; minUsdText: string }[],
): boolean {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return false;
  const coin = coins.find((entry) => entry.ticker === ticker);
  if (!coin || !getCryptoAsset(ticker)) return false;
  const required = cryptoRequiredTotalCents(coin.minUsdText);
  return required !== null && BigInt(totalCents) >= required;
}

/** Toleransi kurs saat create: snapshot bertanda diterima bila selisih relatif
 * terhadap kurs saat ini <= 2% (kurs otomatis berubah tiap refresh). */
export const FX_CREATE_TOLERANCE = { num: 2, den: 100 } as const;
const FX_FUTURE_SKEW_MS = 60_000;

/**
 * Rotate check at create (web + siapa pun yang membandingkan): token quote yang
 * valid diterima bila snapshot saat ini ada, `effective_at` bertanda <= 24 jam
 * (tidak bertanggal masa depan di luar skew 60 dtk), dan |current - signed| /
 * signed <= 2%. Selain itu pemanggil menjawab 409 quote_stale. Harga USD yang
 * dibayar tetap angka bertanda (tidak dihitung ulang dengan kurs baru).
 */
export function isFxSnapshotAcceptable(
  current: FxSnapshot | null,
  signed: Pick<CryptoOfferUsd, "rate_num" | "rate_den" | "effective_at">,
  now: number = Date.now(),
): boolean {
  if (!current) return false;
  const signedAt = parseFxTimestamp(signed.effective_at);
  if (!signedAt) return false;
  const age = now - Date.parse(signedAt);
  if (age > USD_FX_MAX_AGE_MS || age < -FX_FUTURE_SKEW_MS) return false;
  try {
    const signedRate = { num: BigInt(signed.rate_num), den: BigInt(signed.rate_den) };
    const currentRate = { num: BigInt(current.rateNum), den: BigInt(current.rateDen) };
    if (signedRate.num <= BigInt(0) || signedRate.den <= BigInt(0) || currentRate.num <= BigInt(0) || currentRate.den <= BigInt(0)) return false;
    return isRateWithin(currentRate, signedRate, FX_CREATE_TOLERANCE.num, FX_CREATE_TOLERANCE.den);
  } catch {
    return false;
  }
}
