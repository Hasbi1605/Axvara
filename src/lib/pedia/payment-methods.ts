// src/lib/pedia/payment-methods.ts — pemilihan rail pembayaran Pedia (fase B, 2026-11-07).
//
// Glue tipis di atas mesin Market: katalog metode dibangun `buildMethodCatalog`,
// baris yang ditandatangani memakai bentuk token Market dan divalidasi ulang
// `isCanonicalMethodOption`. Angka finansial (surcharge crypto, total gateway,
// batas kanal) TIDAK dihitung ulang di modul ini — hanya dibandingkan dengan
// helper kanonis (`cryptoPricing`, `isCryptoTotalStillPayable`,
// `isFxSnapshotAcceptable`, `listSekalipayMethods`).
import type { CheckoutQuotePaymentMethod } from "@/lib/auth";
import { isCanonicalMethodOption } from "@/lib/auth";
import type { MethodOption } from "@/lib/payments/method-options";
import { centsToUsdText, CRYPTO_SURCHARGE_BPS, cryptoPricing } from "@/lib/payments/crypto-pricing";
import { cryptoRailEnabled, cryptoTickerOfMethodId, isCryptoTotalStillPayable, isFxSnapshotAcceptable } from "@/lib/payments/crypto-preflight";
import { getCryptoAsset } from "@/lib/payments/crypto-assets";
import { getCryptoMarketSnapshot } from "@/lib/payments/market-snapshot";
import type { NowpaymentsUsdExpected } from "@/lib/payments/nowpayments";
import type { Locale } from "@/lib/i18n/locale";

/** Copy 503/409 untuk kegagalan rail pembayaran (sama dengan kontrak Market). */
export function pediaPaymentMethodProblem(locale: Locale): string {
  return locale === "en"
    ? "This payment method is having problems. Please try another payment method."
    : "Metode pembayaran ini sedang gangguan. Silakan coba metode pembayaran lain.";
}

/**
 * Baris metode untuk token Pedia. Persis pemetaan token Market: hanya opsi
 * tersedia yang ditandatangani; field tampilan (label/group/logo/limits) tidak
 * ikut token.
 */
export function serializePediaQuoteMethods(methods: MethodOption[]): CheckoutQuotePaymentMethod[] {
  return methods.map((method) => ({
    id: method.id,
    account_number: method.account_number,
    kind: method.kind,
    ...(method.kind === "gateway" ? { currency: method.currency, sublabel: method.sublabel, available: true, gateway: method.gateway } : {}),
    ...(method.kind === "crypto"
      ? {
          sublabel: method.sublabel ?? undefined,
          available: true,
          currency: "USD" as const,
          amount_text: method.amount_text,
          pay_currency: method.pay_currency,
          network: method.network,
          fee_payer: method.fee_payer,
          fixed_rate: method.fixed_rate,
          base_cents: method.base_cents,
          surcharge_cents: method.surcharge_cents,
          total_cents: method.total_cents,
          surcharge_bps: method.surcharge_bps,
          sender_gas_extra: method.sender_gas_extra,
          usd: method.usd,
        }
      : {}),
  }));
}

export type PediaMethodSelection =
  | {
      ok: true;
      /** Baris bertanda tangan yang dipilih (null hanya untuk quote lama tanpa metode — QRIS). */
      method: CheckoutQuotePaymentMethod | null;
      kind: "qris" | "gateway" | "crypto";
      idrAmount: number;
      cryptoUsd: NowpaymentsUsdExpected | null;
      gateway: { channel: string; estimated_fee: number } | null;
      paymentAccount: string;
    }
  | { ok: false; status: 409 | 503; code?: "quote_stale"; message: string };

const stale = (locale: Locale, message?: string): PediaMethodSelection => ({
  ok: false,
  status: 409,
  code: "quote_stale",
  message: message ?? (locale === "en" ? "The payment method changed or is no longer active. Reload checkout." : "Metode pembayaran berubah atau sudah tidak aktif. Muat ulang checkout."),
});

/**
 * Validasi pilihan metode saat POST order. `methods` = daftar bertanda tangan
 * di token (undefined untuk quote lama = QRIS saja). Tidak ada fallback diam-diam
 * ke rail lain: metode yang tidak ada/tidak sah = 409 quote_stale.
 */
export async function resolvePediaMethodSelection(input: {
  methods: CheckoutQuotePaymentMethod[] | undefined;
  methodId: string;
  idrSubtotal: number;
  locale: Locale;
}): Promise<PediaMethodSelection> {
  const { methods, methodId, idrSubtotal, locale } = input;
  if (methodId !== "qris" && !methods) return stale(locale);
  if (methods && !methods.some((method) => method.id === methodId)) return stale(locale);
  // Quote lama (tanpa metode) tetap boleh QRIS selama masa 30 menit.
  if (!methods && methodId === "qris") {
    return { ok: true, method: null, kind: "qris", idrAmount: idrSubtotal, cryptoUsd: null, gateway: null, paymentAccount: "QRIS" };
  }
  const selected = methods!.find((method) => method.id === methodId)!;
  if ((selected as { available?: unknown }).available === false) return stale(locale);
  if (!isCanonicalMethodOption(selected, idrSubtotal)) return stale(locale);
  if (methodId === "qris") {
    return { ok: true, method: selected, kind: "qris", idrAmount: idrSubtotal, cryptoUsd: null, gateway: null, paymentAccount: "QRIS" };
  }

  const ticker = cryptoTickerOfMethodId(methodId);
  if (ticker) {
    const asset = getCryptoAsset(ticker);
    const row = selected as unknown as Record<string, unknown>;
    const snap = row.usd as Record<string, unknown> | undefined;
    if (!asset || row.kind !== "crypto" || row.currency !== "USD" || !snap) return stale(locale);
    if (selected.fee_payer !== "merchant" || selected.fixed_rate !== false) return stale(locale, locale === "en" ? "Refresh checkout to accept the payment fee." : "Perbarui checkout untuk menyetujui biaya pembayaran.");
    if (String(row.pay_currency).toLowerCase() !== ticker || String(row.network).toLowerCase() !== asset.network
      || String(snap.pay_currency) !== ticker || String(snap.network) !== asset.network) return stale(locale);
    if (typeof row.amount_text !== "string" || !/^[0-9]+\.[0-9]{2}$/.test(row.amount_text)) return stale(locale);
    const cents = typeof snap.cents === "string" && /^[0-9]{1,20}$/.test(snap.cents) ? snap.cents : null;
    const rateNum = typeof snap.rate_num === "string" && /^[0-9]{1,32}$/.test(snap.rate_num) ? snap.rate_num : null;
    const rateDen = typeof snap.rate_den === "string" && /^[0-9]{1,32}$/.test(snap.rate_den) ? snap.rate_den : null;
    const rateText = typeof snap.rate_text === "string" && /^[0-9]+(\.[0-9]+)?$/.test(snap.rate_text.trim()) && snap.rate_text.length <= 32 ? snap.rate_text.trim() : null;
    const effectiveAt = typeof snap.effective_at === "string" && Number.isFinite(Date.parse(snap.effective_at)) ? snap.effective_at : null;
    if (!cents || BigInt(cents) <= BigInt(0) || !rateNum || BigInt(rateNum) <= BigInt(0)
      || !rateDen || BigInt(rateDen) <= BigInt(0) || !rateText || !effectiveAt) return stale(locale);
    const pricing = cryptoPricing(BigInt(cents), ticker);
    if (row.surcharge_bps !== CRYPTO_SURCHARGE_BPS || row.base_cents !== Number(pricing.baseCents)
      || row.surcharge_cents !== Number(pricing.surchargeCents) || row.total_cents !== Number(pricing.totalCents)
      || pricing.totalCents <= BigInt(0)) return stale(locale);
    const market = await getCryptoMarketSnapshot();
    const { isNowpaymentsConfigured } = await import("@/lib/payments/rails");
    if (!cryptoRailEnabled() || !isNowpaymentsConfigured() || !market.fx) {
      return { ok: false, status: 503, message: locale === "en" ? "Crypto payments are temporarily unavailable. Reload checkout." : "Pembayaran crypto sedang tidak tersedia. Muat ulang checkout." };
    }
    if (!isCryptoTotalStillPayable(Number(pricing.totalCents), ticker, market.coins)) {
      return stale(locale, locale === "en" ? "This coin is unavailable or its minimum changed. Reload checkout." : "Koin ini tidak tersedia atau minimumnya berubah. Muat ulang checkout.");
    }
    if (!isFxSnapshotAcceptable(market.fx, { rate_num: rateNum, rate_den: rateDen, effective_at: effectiveAt })) {
      return stale(locale, locale === "en" ? "The exchange rate changed since checkout. Reload checkout." : "Kurs berubah sejak checkout. Muat ulang checkout.");
    }
    const priceText = centsToUsdText(pricing.totalCents);
    if (priceText !== String(row.amount_text)) return stale(locale);
    return {
      ok: true,
      method: selected,
      kind: "crypto",
      idrAmount: idrSubtotal,
      cryptoUsd: {
        cents, priceText, rateText,
        surchargeBps: pricing.surchargeBps, surchargeCents: pricing.surchargeCents.toString(),
        totalCents: pricing.totalCents.toString(), rateNum, rateDen, effectiveAt,
        idrSubtotal, payCurrency: ticker, network: asset.network,
      },
      gateway: null,
      paymentAccount: "NOWPayments",
    };
  }

  if (selected.kind === "gateway" && selected.gateway && selected.currency === "IDR") {
    const { isSekalipayGatewayConfigured } = await import("@/lib/payments/rails");
    if (!isSekalipayGatewayConfigured()) {
      return { ok: false, status: 503, message: locale === "en" ? "This payment method is unavailable." : "Metode pembayaran tidak tersedia." };
    }
    const { listSekalipayMethods } = await import("@/lib/payments/sekalipay-gateway");
    const methods = await listSekalipayMethods(idrSubtotal).catch(() => []);
    if (!methods.some((method) => method.code === selected.gateway!.channel)) {
      return { ok: false, status: 503, message: locale === "en" ? "This payment method is unavailable." : "Metode pembayaran tidak tersedia." };
    }
    return {
      ok: true,
      method: selected,
      kind: "gateway",
      idrAmount: idrSubtotal,
      cryptoUsd: null,
      gateway: { channel: selected.gateway.channel, estimated_fee: selected.gateway.estimated_fee },
      paymentAccount: "Sekalipay",
    };
  }

  return stale(locale);
}
