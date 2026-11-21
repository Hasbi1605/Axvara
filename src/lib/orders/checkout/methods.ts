import type { CheckoutQuotePayload, CheckoutQuotePaymentMethod } from "@/lib/auth";
import type { FxSnapshot } from "@/lib/payments/fx";
import type { CryptoMarketCoin } from "@/lib/payments/market-snapshot";
import type { NowpaymentsUsdExpected } from "@/lib/payments/nowpayments";

type MethodFlags = {
  isCryptoMethod: boolean;
  cryptoTicker: string | null;
  isGatewayMethod: boolean;
};

type ResolvedMethod =
  | { kind: "rejected"; body: Record<string, unknown>; status: number }
  | {
      kind: "ok";
      selected: CheckoutQuotePaymentMethod;
      cryptoUsd: NowpaymentsUsdExpected | null;
    };

type MethodDeps = {
  getCryptoAsset: (ticker: string) => { ticker: string; network: string } | null;
  cryptoPricing: (base: bigint, ticker: string) => {
    baseCents: bigint;
    surchargeCents: bigint;
    totalCents: bigint;
    surchargeBps: number;
  };
  centsToUsdText: (total: bigint) => string;
  cryptoSurchargeBps: number;
  isNowpaymentsConfigured: () => boolean;
  cryptoRailEnabled: () => boolean;
  getCryptoMarketSnapshot: () => Promise<{ fx: FxSnapshot | null; coins: CryptoMarketCoin[] }>;
  isCryptoTotalStillPayable: (
    total: number,
    ticker: string,
    coins: CryptoMarketCoin[],
  ) => boolean;
  isFxSnapshotAcceptable: (
    current: FxSnapshot | null,
    signed: { rate_num: string; rate_den: string; effective_at: string },
  ) => boolean;
  isSekalipayGatewayConfigured: () => boolean | Promise<boolean>;
  listSekalipayMethods: (subtotal: number) => Promise<{ code: string }[]>;
  readSameConfigQuote: (quoteId: string) => Promise<unknown>;
};

type MethodInputs = {
  paymentMethod: string;
  customer_email: string;
  customer_name?: string | null;
};

/** Validates the selected method against the signed quote before order creation. */
export async function resolveCheckoutMethod(
  quote: Pick<CheckoutQuotePayload, "quote_id" | "payment_methods" | "subtotal">,
  methodFlags: MethodFlags,
  inputs: MethodInputs,
  deps: MethodDeps,
): Promise<ResolvedMethod> {
  const { paymentMethod: payment_method, customer_email, customer_name } = inputs;
  const { isCryptoMethod, cryptoTicker, isGatewayMethod } = methodFlags;
  // Metode terpilih HARUS ada di token bertanda (anti-tamper client).
  const selected = quote.payment_methods.find((method) => method.id === payment_method);
  if (!selected) {
    return { kind: "rejected", body: { error: "Metode pembayaran berubah atau sudah tidak aktif. Muat ulang checkout." }, status: 409 };
  }
  // Metode nonaktif (mis. di luar batas min/max merchant) tidak pernah ditandatangani; jaga eksplisit bila payload aneh lolos verifikasi.
  if ((selected as { available?: unknown }).available === false) {
    return { kind: "rejected", body: { error: "Metode pembayaran berubah atau sudah tidak aktif. Muat ulang checkout." }, status: 409 };
  }
  const quoteHasQris = quote.payment_methods.some((method) => method.id === "qris");
  // Web crypto gate: NEW creation requires live config (keys+enabled+asset+
  // fresh FX). Saved retry (same quote_id) resolves BEFORE these checks —
  // same order, same binding, no re-gate, no provider switch.
  let cryptoUsd: NowpaymentsUsdExpected | null = null;
  if (isCryptoMethod && cryptoTicker) {
    const asset = deps.getCryptoAsset(cryptoTicker)!;
    const stale = (error = "Metode pembayaran berubah atau sudah tidak aktif. Muat ulang checkout.") =>
      ({ kind: "rejected", body: { error, code: "quote_stale" }, status: 409 }) as const;
    if (selected.fee_payer !== "merchant" || selected.fixed_rate !== false) return stale("Perbarui checkout untuk menyetujui biaya pembayaran.");
    const row = selected as unknown as Record<string, unknown>;
    const snap = row.usd as Record<string, unknown> | undefined;
    // Validated extraction, no blind casts: kind/currency/asset/network/
    // snapshot shape + exact USD price re-derived server-side from BASE cents
    // (+ biaya layanan crypto). Wrong body overrides (price/currency/FX) =>
    // rejected (409) or ignored (server values win); tampered token => verify
    // fails earlier.
    if (row.kind !== "crypto" || row.currency !== "USD" || !snap || typeof snap !== "object" || Array.isArray(snap)) return stale();
    if (String(row.pay_currency).toLowerCase() !== cryptoTicker || String(row.network).toLowerCase() !== asset.network
      || String(snap.pay_currency) !== cryptoTicker || String(snap.network) !== asset.network) return stale();
    if (typeof row.amount_text !== "string" || !/^[0-9]+\.[0-9]{2}$/.test(row.amount_text)) return stale();
    const snapCents = typeof snap.cents === "string" && /^[0-9]{1,20}$/.test(snap.cents) ? snap.cents : null;
    const snapRateNum = typeof snap.rate_num === "string" && /^[0-9]{1,32}$/.test(snap.rate_num) ? snap.rate_num : null;
    const snapRateDen = typeof snap.rate_den === "string" && /^[0-9]{1,32}$/.test(snap.rate_den) ? snap.rate_den : null;
    const snapRateText = typeof snap.rate_text === "string" && /^[0-9]+(\.[0-9]+)?$/.test(snap.rate_text.trim())
      && snap.rate_text.length <= 32 ? snap.rate_text.trim() : null;
    const snapEffective = typeof snap.effective_at === "string" && Number.isFinite(Date.parse(snap.effective_at)) ? snap.effective_at : null;
    const snapSubtotal = typeof snap.idr_subtotal === "number" && Number.isSafeInteger(snap.idr_subtotal) && snap.idr_subtotal > 0 ? snap.idr_subtotal : null;
    if (!snapCents || BigInt(snapCents) <= BigInt(0) || !snapRateNum || BigInt(snapRateNum) <= BigInt(0)
      || !snapRateDen || BigInt(snapRateDen) <= BigInt(0) || !snapRateText || !snapEffective || snapSubtotal === null) return stale();
    // Rincian harga diturunkan ulang di server dari base bertanda; field di token hanya dibandingkan.
    const pricing = deps.cryptoPricing(BigInt(snapCents), cryptoTicker);
    if (row.surcharge_bps !== deps.cryptoSurchargeBps || row.base_cents !== Number(pricing.baseCents)
      || row.surcharge_cents !== Number(pricing.surchargeCents) || row.total_cents !== Number(pricing.totalCents)
      || pricing.totalCents <= BigInt(0)) return stale();
    const sameConfigQuote = await deps.readSameConfigQuote(quote.quote_id);
    if (!sameConfigQuote) {
      // Pembuatan BARU: koin harus ada di snapshot segar sekarang dan total bertanda masih memenuhi
      // minimum terbaru x 1,15. Retry quote yang sama (sameConfigQuote) memakai binding tersimpan tanpa gate ulang.
      const market = await deps.getCryptoMarketSnapshot();
      const current = market.fx;
      const liveOk = deps.isNowpaymentsConfigured() && deps.cryptoRailEnabled() && current !== null;
      if (!liveOk) {
        return { kind: "rejected", body: { error: "Pembayaran crypto sedang tidak tersedia. Muat ulang checkout." }, status: 503 };
      }
      if (Number(snap.idr_subtotal) !== Number(quote.subtotal) || !Number.isSafeInteger(Number(snap.idr_subtotal))) {
        return { kind: "rejected", body: { error: "Harga berubah sejak checkout. Muat ulang checkout." }, status: 409 };
      }
      if (!deps.isCryptoTotalStillPayable(Number(pricing.totalCents), cryptoTicker, market.coins)) {
        return stale("Koin ini tidak tersedia atau minimumnya berubah. Muat ulang checkout.");
      }
      // Kurs otomatis berubah tiap refresh: toleransi 2% + snapshot bertanda <=24 jam
      // (bukan kesamaan ketat). Harga USD tetap dari cents bertanda di bawah.
      if (!deps.isFxSnapshotAcceptable(current, { rate_num: snapRateNum, rate_den: snapRateDen, effective_at: snapEffective })) {
        return stale("Kurs berubah sejak checkout. Muat ulang checkout.");
      }
    }
    // Exact USD re-derived server-side: signed base cents -> total canonical
    // price. Forged body price overrides ignored (mismatch => tamper => 409).
    const exactPrice = deps.centsToUsdText(pricing.totalCents);
    if (exactPrice !== String(row.amount_text)) return stale();
    cryptoUsd = {
      cents: snapCents, priceText: exactPrice, rateText: snapRateText,
      surchargeBps: pricing.surchargeBps, surchargeCents: pricing.surchargeCents.toString(), totalCents: pricing.totalCents.toString(),
      rateNum: snapRateNum, rateDen: snapRateDen, effectiveAt: snapEffective,
      idrSubtotal: Number(quote.subtotal), payCurrency: cryptoTicker, network: asset.network,
    };
  } else if (isGatewayMethod) {
    const gateway = selected.gateway;
    if (selected.kind !== "gateway" || !gateway || selected.currency !== "IDR") {
      return { kind: "rejected", body: { error: "Metode pembayaran berubah." }, status: 409 };
    }
    if (!(await deps.isSekalipayGatewayConfigured())) {
      return { kind: "rejected", body: { error: "Metode pembayaran tidak tersedia." }, status: 503 };
    }
    const methods = await deps.listSekalipayMethods(quote.subtotal).catch(() => []);
    if (!methods.some((m) => m.code === gateway.channel)) {
      return { kind: "rejected", body: { error: "Metode pembayaran tidak tersedia." }, status: 503 };
    }
    if (customer_email.length > 100 || (customer_name?.length ?? 0) > 100) {
      return { kind: "rejected", body: { error: "Data pembeli tidak valid." }, status: 400 };
    }
  } else if (payment_method !== "qris") {
    return { kind: "rejected", body: { error: "E-Wallet & Transfer Bank sedang maintenance. Muat ulang checkout dan bayar via QRIS." }, status: 503 };
  } else if (!quoteHasQris) {
    return { kind: "rejected", body: { error: "E-Wallet & Transfer Bank sedang maintenance. Muat ulang checkout dan bayar via QRIS." }, status: 503 };
  }
  return { kind: "ok", selected, cryptoUsd };
}
