/**
 * Presentasi pembayaran web (checkout + halaman pesanan). Modul murni:
 * tidak ada fetch, tidak ada FX, tidak ada hitung biaya. Semua angka berasal
 * dari quote/lookup server (`paymentMethods`, `payment`) dan hanya DITAMPILKAN.
 * Kontrak dibaca dari main (read-only): method-options.ts, crypto-preflight.ts
 * dan payment-view.ts.
 */

import { formatRupiah } from "@/lib/utils";
import { parseExpiry } from "@/lib/expiry";

export type PayLocale = "id" | "en";
export const asPayLocale = (value: unknown): PayLocale => (value === "en" ? "en" : "id");

export type QrisOption = { id: "qris"; kind: "qris"; label: string; available: boolean };
export type GatewayGroup = "va" | "ewallet" | "other";
export type GatewayLimits = { min: number; max: number | null };
/**
 * Kanal gateway dari quote. Tersedia: biaya/total dari server. Tidak tersedia (mis. di luar batas min/max merchant): `feeIdr`/`totalIdr`
 * NULL (tidak pernah 0 palsu), alasan + `shortfall` apa adanya dari server; klien tidak berhitung finansial.
 */
export type GatewayOption = {
  id: string; kind: "gateway"; label: string; sublabel: string | null; available: boolean;
  feeIdr: number | null; totalIdr: number | null; subtotalIdr: number;
  group: GatewayGroup; limits: GatewayLimits | null;
  unavailableReason: "below_min" | "above_max" | null; shortfall: number | null;
};
/** Gateway yang bisa dipilih: biaya dan total dikenal. */
export type AvailableGatewayOption = GatewayOption & { available: true; feeIdr: number; totalIdr: number };
export const isAvailableGateway = (option: PayOption | null | undefined): option is AvailableGatewayOption =>
  !!option && option.kind === "gateway" && option.available && option.feeIdr !== null && option.totalIdr !== null;
export type CryptoGroup = "popular" | "stable";
/**
 * Koin crypto dari quote. Tersedia: `usdText` = TOTAL USD termasuk biaya layanan crypto AXVARA (server menghitung;
 * klien hanya menampilkan). Tidak tersedia (di bawah lantai/minimum): TANPA jumlah, `minTotalText` + `minIdr` dari server.
 */
export type CryptoOption = {
  id: string; kind: "crypto"; label: string; sublabel: string | null; available: boolean;
  group: CryptoGroup;
  usdText: string; payCurrency: string; network: string; rateText: string | null;
  baseText: string | null; surchargeText: string | null; surchargeBps: number | null;
  feePayer: "merchant" | "buyer" | null; senderGasExtra: boolean; fixedRate: boolean | null;
  unavailableReason: "below_min" | null; minTotalText: string | null; minIdr: number | null;
};
export type PayOption = QrisOption | GatewayOption | CryptoOption;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const safeInt = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);
const DECIMAL = /^\d{1,12}(\.\d{1,18})?$/;
/** Sen bilangan bulat dari server -> "2.25" (format saja, bukan hitungan finansial). */
const centsToText = (value: unknown): string | null => {
  const cents = safeInt(value);
  return cents === null ? null : `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
};

/**
 * Opsi dari `quote.paymentMethods`, apa adanya dari server. Metode manual
 * lama (id selain "qris" bertipe qris: e-wallet/bank) sudah pensiun dan TIDAK
 * dirender. Entri tak dikenal/cacat dibuang, tidak pernah dikarang. Kuote lama
 * tanpa `kind` untuk id "qris" tetap dikenali.
 */
export function parsePayOptions(raw: unknown): PayOption[] {
  if (!Array.isArray(raw)) return [];
  const out: PayOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const id = text(entry.id);
    if (!id) continue;
    const kind = text(entry.kind) || (id === "qris" ? "qris" : "");
    const available = entry.available !== false;
    if (kind === "qris") {
      if (id === "qris") out.push({ id: "qris", kind: "qris", label: text(entry.label) || "QRIS", available });
    } else if (kind === "gateway") {
      const gateway = entry.gateway as Record<string, unknown> | undefined;
      const subtotal = safeInt(gateway?.idr_subtotal);
      const label = text(entry.label);
      if (subtotal === null || !label) continue;
      const rawGroup = entry.group;
      const group: GatewayGroup = rawGroup === "va" || rawGroup === "ewallet" ? rawGroup : "other"; // hilang/tak dikenal: bukan tebakan merek
      const rawLimits = entry.limits as Record<string, unknown> | undefined;
      const min = safeInt(rawLimits?.min);
      const max = rawLimits?.max == null ? null : safeInt(rawLimits.max);
      const limits: GatewayLimits | null = min !== null && (rawLimits?.max == null || max !== null) ? { min, max } : null;
      if (available) {
        const fee = safeInt(gateway?.estimated_fee);
        const total = safeInt(gateway?.estimated_total);
        if (fee === null || total === null) continue; // biaya tak dikenal untuk kanal tersedia: tetap disembunyikan (fail closed)
        out.push({ id, kind: "gateway", label, sublabel: text(entry.sublabel) || null, available: true, feeIdr: fee, totalIdr: total, subtotalIdr: subtotal, group, limits, unavailableReason: null, shortfall: null });
      } else {
        const reason = entry.unavailable_reason === "below_min" || entry.unavailable_reason === "above_max" ? entry.unavailable_reason : null;
        out.push({ id, kind: "gateway", label, sublabel: text(entry.sublabel) || null, available: false, feeIdr: null, totalIdr: null, subtotalIdr: subtotal, group, limits, unavailableReason: reason, shortfall: reason === "below_min" ? safeInt(entry.shortfall) : null });
      }
    } else if (kind === "crypto") {
      const payCurrency = text(entry.pay_currency);
      const network = text(entry.network);
      const label = text(entry.label);
      const group: CryptoGroup = entry.group === "stable" ? "stable" : "popular";
      const usd = entry.usd as Record<string, unknown> | undefined;
      if (!payCurrency || !network || !label) continue;
      const common = { id, kind: "crypto" as const, label, sublabel: text(entry.sublabel) || null, group, payCurrency, network, rateText: text(usd?.rate_text) || null };
      if (available) {
        const amount = text(entry.amount_text);
        if (!DECIMAL.test(amount)) continue;
        const bps = safeInt(entry.surcharge_bps);
        out.push({
          ...common, available: true, usdText: amount,
          baseText: centsToText(entry.base_cents), surchargeText: centsToText(entry.surcharge_cents), surchargeBps: bps,
          feePayer: entry.fee_payer === "merchant" ? "merchant" : entry.fee_payer === "buyer" ? "buyer" : null,
          senderGasExtra: entry.sender_gas_extra === true, fixedRate: typeof entry.fixed_rate === "boolean" ? entry.fixed_rate : null,
          unavailableReason: null, minTotalText: null, minIdr: null,
        });
      } else {
        const minText = centsToText(entry.min_total_cents);
        if (minText === null) continue; // minimum tak dikenal untuk koin nonaktif: disembunyikan (fail closed)
        out.push({
          ...common, available: false, usdText: "", baseText: null, surchargeText: null, surchargeBps: null,
          feePayer: null, senderGasExtra: false, fixedRate: null,
          unavailableReason: "below_min", minTotalText: minText, minIdr: safeInt(entry.min_idr_subtotal),
        });
      }
    }
  }
  return out;
}

export type SelectionResult = { selectedId: string | null; notice: { kind: "fallback" | "cleared"; fromLabel: string; /** Metode masih ada tetapi tidak tersedia untuk total ini (mis. di bawah minimum). */ unavailable?: boolean } | null };

/**
 * Pilihan metode mengikuti ID yang ditandatangani quote: pilihan yang masih
 * ada dan tersedia dipertahankan; bila hilang, QRIS dipilih EKSPLISIT sebelum
 * pesanan dibuat (tidak ada fallback rel tersembunyi setelah pesanan ada);
 * tanpa QRIS pilihan dikosongkan agar pembeli memilih sendiri. Tidak pernah
 * memilih otomatis metode berbiaya.
 */
export function reconcileSelection(options: PayOption[], selectedId: string | null, previousLabel: string | null): SelectionResult {
  if (selectedId && options.some((option) => option.id === selectedId && option.available)) return { selectedId, notice: null };
  const qris = options.find((option) => option.id === "qris" && option.available);
  if (selectedId === null) return { selectedId: qris ? "qris" : null, notice: null };
  const existing = options.find((option) => option.id === selectedId);
  const fromLabel = existing?.label ?? previousLabel ?? selectedId;
  const unavailable = existing !== undefined && !existing.available;
  return qris ? { selectedId: "qris", notice: { kind: "fallback", fromLabel, ...(unavailable ? { unavailable } : {}) } } : { selectedId: null, notice: { kind: "cleared", fromLabel, ...(unavailable ? { unavailable } : {}) } };
}

export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export type GatewayState = "initializing" | "fee_consent_required" | "pending" | "paid" | "expired" | "manual_review";
export type CryptoState = "preparing" | "pending" | "confirming" | "paid" | "expired" | "failed" | "manual_review";
export type GatewayView = {
  kind: "gateway"; state: GatewayState; label: string; channel: string;
  subtotal: number; estimatedFee: number | null; fee: number | null; total: number | null;
  feeConsentRequired: boolean; expiresAt: string | null;
  paymentLink: string | null; checkoutUrl: string | null; virtualAccount: string | null;
};
export type CryptoView = {
  kind: "crypto"; state: CryptoState; label: string; sublabel: string; network: string | null;
  /** Simbol + label jaringan dari katalog kurasi server (mis. "USDT" / "BNB Smart Chain"). */
  symbol: string; networkLabel: string | null; logo: string | null;
  usdText: string; payAmountText: string; payCurrency: string; payAddress: string; expiresAt: string | null;
  baseText: string | null; surchargeText: string | null; surchargeBps: number | null;
  feePayer: "merchant" | "buyer" | null; senderGasExtra: boolean; fixedRate: boolean | null;
};
export type PaymentView = GatewayView | CryptoView;

const GATEWAY_STATES: GatewayState[] = ["initializing", "fee_consent_required", "pending", "paid", "expired", "manual_review"];
const CRYPTO_STATES: CryptoState[] = ["preparing", "pending", "confirming", "paid", "expired", "failed", "manual_review"];
const nullableInt = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) ? value : null);

/**
 * `order.payment` dari GET/lookup. Tahap tak dikenal = pemeriksaan manual
 * (gagal-tertutup: tanpa alamat, tautan atau tombol). Tautan/VA hanya dibawa
 * bila server mengizinkan (tahap pending); URL harus https.
 */
export function normalizePaymentView(raw: unknown): PaymentView | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (v.kind === "gateway") {
    const state = GATEWAY_STATES.includes(v.state as GatewayState) ? (v.state as GatewayState) : "manual_review";
    const live = state === "pending";
    const link = live && isHttpsUrl(v.payment_link) ? v.payment_link : null;
    const checkout = live && isHttpsUrl(v.checkout_url) ? v.checkout_url : null;
    return {
      kind: "gateway", state, label: text(v.label), channel: text(v.channel),
      subtotal: nullableInt(v.subtotal) ?? 0, estimatedFee: nullableInt(v.estimated_fee), fee: nullableInt(v.fee), total: nullableInt(v.total),
      feeConsentRequired: v.fee_consent_required === true, expiresAt: text(v.expires_at) || null,
      paymentLink: link, checkoutUrl: checkout, virtualAccount: live && text(v.virtual_account) ? text(v.virtual_account) : null,
    };
  }
  if (v.kind === "crypto") {
    const state = CRYPTO_STATES.includes(v.state as CryptoState) ? (v.state as CryptoState) : "manual_review";
    const payAmount = text(v.pay_amount_text);
    return {
      kind: "crypto", state, label: text(v.label), sublabel: text(v.sublabel), network: text(v.network) || null,
      symbol: text(v.symbol) || text(v.label), networkLabel: text(v.network_label) || null, logo: text(v.logo) || null,
      usdText: text(v.amount_text), payAmountText: payAmount, payCurrency: text(v.pay_currency),
      // Alamat hanya untuk tahap pending; tahap lain tidak pernah menampilkannya.
      payAddress: state === "pending" ? text(v.pay_address) : "",
      expiresAt: text(v.expires_at) || null,
      baseText: text(v.base_amount_text) || null, surchargeText: text(v.surcharge_amount_text) || null, surchargeBps: nullableInt(v.surcharge_bps),
      feePayer: v.fee_payer === "merchant" ? "merchant" : v.fee_payer === "buyer" ? "buyer" : null,
      senderGasExtra: v.sender_gas_extra === true,
      fixedRate: typeof v.fixed_rate === "boolean" ? v.fixed_rate : null,
    };
  }
  return null;
}

export type Copy = ReturnType<typeof payCopy>;
const rp = (n: number) => formatRupiah(n);
export const idr = rp;
export const usd = (amountText: string) => `US$${amountText}`;
/**
 * Nominal USD FIAT yang tampil ke pembeli mengikuti locale seperti seluruh situs ("US$3,60" id / "US$3.60" en): teks desimal 2-dp persis dari
 * server di-parse ke sen (BigInt, tanpa float) lalu diformat `formatUsdCentsText`. Gagal parse (bentuk lain) = `US$…` mentah apa adanya.
 * HANYA untuk USD fiat. Jumlah koin (pay_amount, mis. "5.62 USDT") dan apa pun yang disalin ke clipboard TIDAK dilokalkan.
 */
export function usdFor(amountText: string, locale: PayLocale): string {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(amountText.trim());
  if (!match) return usd(amountText);
  const cents = BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return formatUsdCentsText(cents.toString(), locale) ?? usd(amountText);
}

const numberLang = (locale: PayLocale) => (locale === "en" ? "en-US" : "id-ID");
/** "Rp 38.000" (id) / "Rp 38,000" (en): pemisah ribuan mengikuti locale; angka bulat dari server. */
export const rpLocale = (amount: number, locale: PayLocale) => `Rp ${new Intl.NumberFormat(numberLang(locale), { maximumFractionDigits: 0 }).format(amount)}`;
/** Teks kurs desimal dari server ("18087.80") -> "Rp 18.087,80/US$1" (id) / "Rp 18,087.80/US$1" (en). Teks tak berbentuk desimal tidak ditampilkan mentah. Hanya format. */
export function fxRateLabel(rateText: string | null, locale: PayLocale): string | null {
  if (!rateText || !/^\d{1,9}(\.\d{1,6})?$/.test(rateText.trim())) return null;
  return `Rp ${new Intl.NumberFormat(numberLang(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(rateText))}/US$1`;
}

export function payCopy(locale: PayLocale) {
  const id = locale === "id";
  return {
    fastest: id ? "Paling cepat" : "Fastest",
    qrisSub: id ? "Scan dari semua e-wallet & m-banking" : "Scan from any e-wallet or mobile banking app",
    legendMethod: id ? "Metode pembayaran" : "Payment method",
    groupVa: "Virtual Account",
    groupEwallet: "E-Wallet",
    groupOther: id ? "Lainnya" : "Other",
    groupCrypto: "Crypto",
    methodsCount: (n: number) => (id ? `${n} metode` : `${n} ${n === 1 ? "method" : "methods"}`),
    availableCount: (n: number) => (id ? `${n} tersedia` : `${n} available`),
    noneAvailable: id ? "Tidak tersedia untuk total ini" : "Not available for this total",
    selectedPrefix: id ? "Dipilih" : "Selected",
    moreChips: (n: number) => `+${n}`,
    gatewayCaptionFrom: (fee: number) => (id ? `Biaya mulai ${rpLocale(fee, locale)}` : `Fees from ${rpLocale(fee, locale)}`),
    gatewayCaptionFree: id ? "Tanpa biaya" : "No fees",
    gatewayCaptionNone: id ? "Belum tersedia untuk nominal ini" : "Not available for this amount yet",
    gatewayRowFee: (fee: number) => (fee > 0 ? (id ? `Biaya ${rpLocale(fee, locale)}` : `Fee ${rpLocale(fee, locale)}`) : id ? "Tanpa biaya" : "No fee"),
    gatewayRowMin: (min: number) => `Min. ${rpLocale(min, locale)}`,
    gatewayRowMax: (max: number) => (id ? `Maks. ${rpLocale(max, locale)}` : `Max ${rpLocale(max, locale)}`),
    cryptoCaption: (amountText: string) =>
      (id ? `${usdFor(amountText, locale)} · termasuk biaya layanan crypto` : `${usdFor(amountText, locale)} · incl. crypto service fee`),
    cryptoNetworks: (n: number) => (id ? `${n} jaringan` : `${n} networks`),
    cryptoNetworkGroup: (symbol: string) => (id ? `Jaringan ${symbol}` : `${symbol} network`),
    cryptoSubPopular: id ? "Populer" : "Popular",
    cryptoSubStable: "Stablecoin",
    cryptoMinApprox: (idrText: string) => `≈ ${idrText}`,
    // Ringkasan checkout crypto (revisi owner 6 Nov): cukup Subtotal + Biaya layanan, tanpa baris kurs/gas.
    cryptoSubtotalRow: "Subtotal",
    cryptoServiceFeeRow: id ? "Biaya layanan crypto" : "Crypto service fee",
    cryptoMin: (minUsdText: string) => `Min. ${usdFor(minUsdText, locale)}`,
    cryptoMinReason: (minUsdText: string, minIdr: number | null) =>
      (id ? `Belanja minimal ${usdFor(minUsdText, locale)}${minIdr !== null ? ` (± ${rp(minIdr)})` : ""} untuk koin ini` : `Spend at least ${usdFor(minUsdText, locale)}${minIdr !== null ? ` (≈ ${rp(minIdr)})` : ""} to use this coin`),
    gatewayTotal: (total: number) => rp(total),
    shortfallReason: (shortfall: number) => (id ? `Tambah ${rp(shortfall)} untuk metode ini` : `Add ${rp(shortfall)} to use this method`),
    aboveMaxReason: (max: number) => (id ? `Melebihi maks. ${rp(max)}` : `Above max. ${rp(max)}`),
    cryptoUsd: (amountText: string) => usdFor(amountText, locale),
    unavailable: id ? "Sedang tidak tersedia" : "Currently unavailable",
    unavailableForTotalNotice: (from: string) => (id ? `${from} tidak tersedia untuk total ini — dipilih QRIS.` : `${from} isn't available for this total — QRIS selected.`),
    fallbackNotice: (from: string) => (id ? `${from} tidak tersedia lagi. Metode diganti ke QRIS.` : `${from} is no longer available. Switched to QRIS.`),
    clearedNotice: id ? "Pilih metode pembayaran lain." : "Choose another payment method.",
    locked: id
      ? "Metode dikunci karena pesanan mungkin sudah dibuat. Tekan Bayar lagi untuk melanjutkan pesanan yang sama."
      : "Method locked because the order may already exist. Press Pay again to continue the same order.",
    noOptions: id ? "Pembayaran belum tersedia saat ini. Coba lagi beberapa saat lagi atau hubungi admin." : "Payment is not available right now. Try again shortly or contact the admin.",
    subtotalRow: "Subtotal",
    feeRow: (label: string) => (id ? `Biaya ${label}` : `${label} fee`),
    totalRow: "Total",
    gatewayFinalNote: id ? "Total akhir disetujui di halaman pesanan." : "Final total is approved on the order page.",
    usdTotal: id ? "Total dalam USD" : "Total in USD",
    usdFrom: (subtotal: number, rate: string | null) => {
      const rateLabel = fxRateLabel(rate, locale);
      return id ? `Dari ${rpLocale(subtotal, locale)}${rateLabel ? ` · kurs ${rateLabel}` : ""}` : `From ${rpLocale(subtotal, locale)}${rateLabel ? ` · rate ${rateLabel}` : ""}`;
    },
    ctaQris: (total: number) => (id ? `Bayar ${rp(total)} — Buat Pesanan` : `Pay ${rp(total)} — Place order`),
    ctaGateway: (total: number) => (id ? `Buat Pesanan — estimasi ${rp(total)}` : `Place order — estimated ${rp(total)}`),
    ctaCrypto: (amountText: string) => (id ? `Buat Pesanan — ${usdFor(amountText, locale)}` : `Place order — ${usdFor(amountText, locale)}`),
    stagePrepare: id ? "Menyiapkan pembayaran…" : "Preparing payment…",
    railFootnote: { qris: id ? "QRIS diverifikasi otomatis." : "QRIS is verified automatically.", gateway: id ? "Dibayar di halaman penyedia pembayaran." : "Paid on the payment provider page.", crypto: "" },
    redirect: id ? "Membuka halaman pesanan… Jangan tutup halaman atau buat pesanan ulang." : "Opening the order page… Do not close this page or create the order again.",
  };
}

/**
 * Alur batal mandiri (halaman pesanan + lacak): semua teks mengikuti locale PESANAN. Teks Indonesia tidak berubah.
 * Pesan galat server (Indonesia, tetap sebagai kontrak API) dipetakan ke EN hanya untuk kalimat yang dikenal;
 * pesan tak dikenal ditampilkan apa adanya.
 */
const CANCEL_SERVER_EN: Record<string, string> = {
  "Terlalu sering, coba lagi 1 menit.": "Too many attempts, try again in 1 minute.",
  "Kode pesanan tidak valid": "Invalid order code.",
  "No. WA atau email checkout wajib diisi.": "The checkout WhatsApp number or email is required.",
  "Format kontak tidak valid.": "Invalid contact format.",
  "Pesanan tidak ditemukan atau kontak tidak cocok.": "Order not found or the contact does not match.",
  "Pembayaran sedang diperiksa; pembatalan tidak tersedia.": "Payment is being checked; cancellation is not available.",
  "Pesanan tidak dapat dibatalkan — statusnya sudah berubah (mungkin baru saja dibayar).": "The order can't be cancelled — its status has changed (it may have just been paid).",
  "Pembatalan gagal. Coba lagi.": "Cancellation failed. Try again.",
};
export function cancelCopy(locale: PayLocale | string | null | undefined) {
  const en = locale === "en";
  return {
    button: en ? "Cancel this order" : "Batalkan Pesanan Ini",
    buttonCompact: en ? "Cancel order" : "Batalkan Pesanan",
    dialogLabel: en ? "Confirm order cancellation" : "Konfirmasi pembatalan pesanan",
    title: (code: string) => (en ? `Cancel order ${code}?` : `Batalkan pesanan ${code}?`),
    body: en
      ? "Stock is released immediately and can be ordered by others. Make sure you have not paid — if funds already went through, contact the admin with the order code."
      : "Stok langsung kembali dan bisa dipesan orang lain. Pastikan kamu belum membayar — bila dana sudah masuk, hubungi admin dengan kode pesanan.",
    contactLabel: en ? "Checkout WhatsApp number or email *" : "No. WA atau email checkout *",
    contactPlaceholder: en ? "0812… or name@email.com" : "0812… atau nama@email.com",
    needContact: en ? "Enter the WhatsApp number or email used at checkout." : "Isi No. WA atau email checkout yang dipakai saat memesan.",
    back: en ? "Back" : "Kembali",
    confirm: en ? "Yes, cancel" : "Ya, Batalkan",
    cancelling: en ? "Cancelling…" : "Membatalkan…",
    failed: en ? "Cancellation failed." : "Pembatalan gagal.",
    serverError: (message: string) => (en ? CANCEL_SERVER_EN[message] ?? message : message),
  };
}

export function orderPanelCopy(locale: PayLocale) {
  const id = locale === "id";
  return {
    totalPay: id ? "Total bayar" : "Amount to pay",
    awaitingPay: id ? "Menunggu bayar" : "Awaiting payment",
    /** "Berlaku 12:34 · sebelum 10.30 WIB" — hitung mundur tahap pending. */
    expiresIn: (left: string, at: string) => (id ? `Berlaku ${left} · sebelum ${at}` : `Valid for ${left} · before ${at}`),
    /** Judul ringkas header halaman pesanan saat panel pending dipadatkan. */
    title: {
      qris: id ? "Pembayaran QRIS" : "QRIS Payment",
      crypto: id ? "Pembayaran Crypto" : "Crypto Payment",
      gateway: (label: string) => (id ? `Pembayaran ${label}` : `${label} Payment`),
    },
    subtotal: "Subtotal",
    fee: id ? "Biaya" : "Fee",
    feeFor: (label: string) => (label ? (id ? `Biaya ${label}` : `${label} fee`) : id ? "Biaya" : "Fee"),
    estFee: id ? "Estimasi biaya" : "Estimated fee",
    finalTotal: "Total",
    payBefore: (time: string) => (id ? `Bayar sebelum ${time}` : `Pay before ${time}`),
    check: id ? "Cek Pembayaran" : "Check payment",
    checking: id ? "Mengecek…" : "Checking…",
    autoStatus: id ? "Status diperbarui otomatis. Sudah bayar dan kembali ke sini? Tidak perlu membayar ulang." : "Status updates automatically. Already paid and back here? No need to pay again.",
    locked: id ? "Metode pembayaran tidak bisa diganti untuk pesanan ini. Ingin metode lain? Batalkan pesanan ini lalu buat pesanan baru." : "The payment method can't be changed for this order. Want another method? Cancel this order and place a new one.",
    h1: {
      preparing: id ? "Menyiapkan Pembayaran" : "Preparing Payment",
      consent: id ? "Setujui Total Pembayaran" : "Approve the Payment Total",
      pendingGateway: id ? "Selesaikan Pembayaran" : "Complete Payment",
      pendingCrypto: id ? "Selesaikan Pembayaran Crypto" : "Complete Crypto Payment",
      confirming: id ? "Menunggu Konfirmasi Jaringan" : "Waiting for Network Confirmation",
      review: id ? "Pembayaran Sedang Diperiksa" : "Payment Under Review",
      failed: id ? "Pembayaran Tidak Berhasil" : "Payment Unsuccessful",
    },
    badge: {
      pending: id ? "Pending — Menunggu Pembayaran" : "Pending — Awaiting Payment",
      consent: id ? "Perlu persetujuan total" : "Total approval needed",
      confirming: id ? "Konfirmasi jaringan" : "Network confirmation",
      review: id ? "Diperiksa manual" : "Manual review",
      failed: id ? "Tidak berhasil" : "Unsuccessful",
      expired: id ? "Kedaluwarsa" : "Expired",
    },
    lead: {
      preparing: id ? "Pesanan tersimpan, tetapi halaman pembayaran belum siap. Jangan membayar sebelum tombol atau alamat pembayaran muncul." : "Your order is saved, but the payment page is not ready. Do not pay until the payment button or address appears.",
      consent: id ? "Biaya akhir sudah dihitung. Periksa total di bawah; setelah kamu setujui, kamu langsung diarahkan ke halaman pembayaran." : "The final fee is calculated. Check the total below; once you approve, you go straight to the payment page.",
      pendingGateway: id ? "Lanjutkan pembayaran lewat tautan di bawah, lalu kembali ke halaman ini." : "Continue paying with the link below, then return to this page.",
      pendingCrypto: id ? "Kirim tepat sesuai nominal, aset, dan jaringan di bawah." : "Send exactly the amount, asset and network below.",
      confirming: id ? "Transaksi terdeteksi dan sedang menunggu konfirmasi blockchain. Jangan kirim ulang. Halaman ini memperbarui status sendiri." : "Your transaction was detected and is waiting for blockchain confirmation. Do not send it again. This page updates its own status.",
      review: id ? "Pembayaran untuk pesanan ini perlu dicek manual oleh admin. Jangan bayar atau kirim ulang. Kami menghubungi lewat email atau WA yang kamu isi saat checkout." : "This order's payment needs a manual check by the admin. Do not pay or send again. We will contact you at the email or WhatsApp you entered at checkout.",
      failed: id ? "Pembayaran untuk pesanan ini tidak berhasil. Bila dana sudah terpotong, hubungi admin dengan kode pesanan." : "Payment for this order was unsuccessful. If funds were already deducted, contact the admin with the order code.",
      expiredGateway: id ? "Batas pembayaran sudah habis. Jangan lanjutkan pembayaran di halaman lama. Silakan buat pesanan baru." : "The payment window has closed. Do not continue paying on the old page. Please place a new order.",
      expiredCrypto: id ? "Batas pembayaran sudah habis. Jangan kirim crypto ke alamat lama. Silakan buat pesanan baru." : "The payment window has closed. Do not send crypto to the old address. Please place a new order.",
    },
    gateway: {
      consentTitle: id ? "Persetujuan total akhir" : "Final total approval",
      contactLabel: id ? "No. WA atau email checkout" : "Checkout WhatsApp number or email",
      contactHelp: id ? "Dibutuhkan untuk memastikan ini pesananmu. Bukan PIN." : "Needed to confirm this is your order. Not a PIN.",
      approve: (total: string) => (id ? `Setujui ${total} & bayar` : `Approve ${total} & pay`),
      approving: id ? "Menyetujui…" : "Approving…",
      stale: id ? "Total berubah atau persetujuan tidak tersedia. Periksa total terbaru di bawah sebelum menyetujui lagi." : "The total changed or approval is unavailable. Check the latest total below before approving again.",
      totalUnavailable: id ? "Total akhir belum tersedia. Tekan Cek Pembayaran lalu coba lagi." : "The final total is not available yet. Press Check payment and try again.",
      needContact: id ? "Isi No. WA atau email checkout yang dipakai saat memesan." : "Enter the WhatsApp number or email used at checkout.",
      openLink: (label: string) => (id ? `Bayar via ${label}` : `Pay with ${label}`),
      virtualAccount: id ? "Nomor virtual account" : "Virtual account number",
      copy: id ? "Salin" : "Copy",
      copied: id ? "Tersalin" : "Copied",
      copyFailed: id ? "Gagal menyalin. Salin manual." : "Copy failed. Copy it manually.",
      noLink: id ? "Tautan pembayaran belum tersedia. Jangan bayar sebelum tautan muncul." : "The payment link is not available yet. Do not pay until it appears.",
    },
    crypto: {
      sendExactly: id ? "Kirim tepat" : "Send exactly",
      scanAddress: id ? "Scan alamat" : "Scan address",
      address: id ? "Alamat tujuan" : "Destination address",
      copy: id ? "Salin" : "Copy",
      copyAddress: id ? "Salin alamat" : "Copy address",
      copied: id ? "Tersalin" : "Copied",
      copyFailed: id ? "Gagal menyalin. Salin manual." : "Copy failed. Copy it manually.",
      /** Satu baris rincian di bawah nominal: "≈ US$15,95 · termasuk biaya layanan crypto". */
      approx: (usdText: string) => `≈ ${usdText}`,
      approxWithFee: (usdText: string) => (id
        ? `≈ ${usdText} · termasuk biaya layanan crypto`
        : `≈ ${usdText} · incl. crypto service fee`),
      totalWithFee: id ? "Total (USD, termasuk biaya layanan crypto)" : "Total (USD, incl. crypto service fee)",
      onlyAccepted: (symbol: string, networkLabel: string) => (id
        ? `Hanya ${symbol} di jaringan ${networkLabel} yang diterima. Koin atau jaringan lain dapat membuat dana hilang.`
        : `Only ${symbol} on the ${networkLabel} network is accepted. Other coins or networks may lose your funds.`),
      qrAlt: id ? "QR alamat tujuan" : "Destination address QR",
    },
  };
}

// ---------------------------------------------------------------------------
// Resume surfaces (lacak-pesanan, PendingOrderReminder, DeviceOrders): satu
// pembaca tampilan aman `order.payment` agar tidak ada permukaan yang
// mengandaikan `order.qris` untuk rel baru. Tidak ada alamat/tautan/VA di sini;
// hanya status, jumlah (mata uang ASLI), batas waktu, dan CTA ke pesanan yang
// SAMA. Teks mengikuti locale tersimpan pesanan (tidak berubah mengikuti
// preferensi global).
// ---------------------------------------------------------------------------

export type ResumeTone = "gold" | "green" | "cyan" | "red" | "muted";
export type ResumeAction = "pay" | "consent" | "view";
export type ResumeInfo = { label: string; tone: ResumeTone; action: ResumeAction; cta: string; actionable: boolean };

/** Ringkas tahap tampilan + CTA. `actionable` = pembeli masih perlu bertindak (pengingat boleh tampil). */
export function resumeInfo(view: PaymentView, locale: PayLocale, orderExpired = false): ResumeInfo {
  const id = locale === "id";
  const view_ = { label: "", tone: "muted" as ResumeTone, action: "view" as ResumeAction, cta: id ? "Lihat pesanan" : "View order", actionable: false };
  if (orderExpired || view.state === "expired") return { ...view_, label: id ? "Kedaluwarsa" : "Expired" };
  if (view.state === "paid") return { ...view_, label: id ? "Lunas" : "Paid", tone: "green" };
  if (view.state === "manual_review") return { ...view_, label: id ? "Diperiksa manual" : "Manual review", tone: "gold" };
  if (view.kind === "crypto") {
    if (view.state === "failed") return { ...view_, label: id ? "Tidak berhasil" : "Unsuccessful", tone: "red" };
    if (view.state === "confirming") return { ...view_, label: id ? "Konfirmasi jaringan" : "Network confirmation", tone: "cyan" };
    if (view.state === "preparing") return { ...view_, label: id ? "Menyiapkan pembayaran" : "Preparing payment", tone: "gold" };
    return { label: id ? "Menunggu pembayaran crypto" : "Awaiting crypto payment", tone: "gold", action: "pay", cta: id ? "Bayar crypto" : "Pay with crypto", actionable: true };
  }
  if (view.state === "initializing") return { ...view_, label: id ? "Menyiapkan pembayaran" : "Preparing payment", tone: "gold" };
  if (view.state === "fee_consent_required") return { label: id ? "Perlu persetujuan total" : "Total approval needed", tone: "gold", action: "consent", cta: id ? "Setujui total" : "Approve total", actionable: true };
  return { label: id ? "Menunggu pembayaran" : "Awaiting payment", tone: "gold", action: "pay", cta: id ? "Lanjut bayar" : "Continue to pay", actionable: true };
}

/** Jumlah dalam mata uang ASLI pesanan: crypto = USD server (teks persis), gateway = total akhir bila ada, selain itu subtotal IDR. */
export function resumeAmount(view: PaymentView | null, subtotalIdr: number, locale: PayLocale = "id"): { text: string; currency: "IDR" | "USD" } {
  if (view?.kind === "crypto" && view.usdText) return { text: usdFor(view.usdText, locale), currency: "USD" };
  if (view?.kind === "gateway" && view.total !== null) return { text: idr(view.total), currency: "IDR" };
  return { text: idr(subtotalIdr), currency: "IDR" };
}

/** Batas bayar paling awal (ms epoch) dari tampilan non-QRIS dan batas pesanan; null bila tak diketahui. */
export function resumeDeadline(view: PaymentView | null, orderExpiresAt: number | null): number | null {
  const own = parseExpiry(view?.expiresAt);
  const candidates = [own, orderExpiresAt].filter((value): value is number => value !== null);
  return candidates.length ? Math.min(...candidates) : null;
}

/** Label metode untuk ringkasan: label server (bukan id mentah huruf besar). */
export function paymentMethodLabel(view: PaymentView | null, rawMethod: string): string {
  return view?.label || rawMethod.toUpperCase();
}

export type PaymentHeading = { h1: string; badge: string; tone: "pending" | "review" | "neutral" | "info"; lead: string };

/** Judul/lencana/lead tahap non-QRIS (dipakai halaman pesanan dan hasil lacak); null bila tak berlaku. */
export function paymentHeading(view: PaymentView, locale: PayLocale, orderExpired: boolean): PaymentHeading {
  const pc = orderPanelCopy(locale);
  if (orderExpired || view.state === "expired") return { h1: locale === "id" ? "Pesanan Kedaluwarsa" : "Order Expired", badge: pc.badge.expired, tone: "neutral", lead: view.kind === "crypto" ? pc.lead.expiredCrypto : pc.lead.expiredGateway };
  switch (view.state) {
    case "preparing":
    case "initializing": return { h1: pc.h1.preparing, badge: pc.badge.pending, tone: "pending", lead: pc.lead.preparing };
    case "fee_consent_required": return { h1: pc.h1.consent, badge: pc.badge.consent, tone: "pending", lead: pc.lead.consent };
    case "pending": return { h1: view.kind === "crypto" ? pc.h1.pendingCrypto : pc.h1.pendingGateway, badge: pc.badge.pending, tone: "pending", lead: view.kind === "crypto" ? pc.lead.pendingCrypto : pc.lead.pendingGateway };
    case "confirming": return { h1: pc.h1.confirming, badge: pc.badge.confirming, tone: "info", lead: pc.lead.confirming };
    case "failed": return { h1: pc.h1.failed, badge: pc.badge.failed, tone: "neutral", lead: pc.lead.failed };
    default: return { h1: pc.h1.review, badge: pc.badge.review, tone: "review", lead: pc.lead.review };
  }
}

/** Pembatalan mandiri disembunyikan saat pembayaran sedang dikonfirmasi/diperiksa atau sudah kedaluwarsa menurut server. */
export function paymentCancelHidden(view: PaymentView | null, orderExpired: boolean): boolean {
  if (!view) return false;
  return orderExpired || view.state === "expired" || view.state === "manual_review" || (view.kind === "crypto" && view.state === "confirming");
}

// ---------------------------------------------------------------------------
// Preferensi mata uang di checkout: HANYA menampilkan angka USD terkonversi
// yang disuplai server (`displayPreferences.usdCents`, sen dalam string). Tidak
// ada kurs, FX, atau pembagian di klien; IDR tidak pernah diberi label USD.
// ---------------------------------------------------------------------------

/** Sen USD (string bilangan bulat dari server) -> "US$1,234.56" tanpa float. */
export function formatUsdCentsText(cents: unknown, locale: PayLocale): string | null {
  if (typeof cents !== "string" || !/^\d{1,15}$/.test(cents)) return null;
  const value = BigInt(cents);
  const dollars = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID").format(value / BigInt(100));
  const fraction = (value % BigInt(100)).toString().padStart(2, "0");
  return `US$${dollars}${locale === "en" ? "." : ","}${fraction}`;
}

export type UsdPreferenceView = { kind: "equivalent"; text: string } | { kind: "unavailable" } | null;

export function usdPreferenceView(displayPreferences: unknown, locale: PayLocale): UsdPreferenceView {
  if (!displayPreferences || typeof displayPreferences !== "object") return null;
  const prefs = displayPreferences as Record<string, unknown>;
  if (prefs.currency !== "USD") return null;
  const text = prefs.usdAvailable === true ? formatUsdCentsText(prefs.usdCents, locale) : null;
  return text ? { kind: "equivalent", text } : { kind: "unavailable" };
}

export function usdPreferenceCopy(locale: PayLocale) {
  const id = locale === "id";
  return {
    equivalent: (text: string) => (id ? `Subtotal pesanan ≈ ${text} (konversi dari server)` : `Order subtotal ≈ ${text} (converted by the server)`),
    unavailable: id ? "Harga ditampilkan dalam Rupiah. Konversi USD belum tersedia." : "Prices are shown in Rupiah. USD conversion is not available yet.",
  };
}
