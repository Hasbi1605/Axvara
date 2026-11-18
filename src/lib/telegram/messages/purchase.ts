import { marketRefundNotice } from "@/lib/warranty-policy";
import { QRIS_PAYMENT_DEADLINE_NOTICE } from "@/lib/payment-maintenance";
import { escapeHtml, escapeItemSummary, formatRupiah, truncate } from "./format";
import type { Locale } from "@/lib/i18n/locale";
import type { BulkTier } from "@/lib/bulk-pricing";
import { formatIdr } from "@/lib/i18n/format";

export type TgMoneyOpts = { locale?: Locale; usdEquivalentText?: string | null; usdUnavailable?: boolean };

// TG2b: tier display helpers (visual spec §7). Effective FIRST, base never
// misleads; unreachable tiers (min > stock/cap) never raise limits.
export type TgTierDisplay = {
  basePrice: number;
  appliedTierMinQty?: number | null;
  bulkTiers?: BulkTier[] | null;
  bulkEnabled?: boolean;
  stock?: number;
  maxQty?: number;
};

const TIER_RANGE_QTY_CAP = 100;

function tierRangeLabel(tier: BulkTier, next?: BulkTier, locale: Locale = "id"): string {
  const nextMin = next ? next.min_qty - 1 : TIER_RANGE_QTY_CAP;
  const end = Math.min(nextMin, TIER_RANGE_QTY_CAP);
  return tier.min_qty >= end ? `${tier.min_qty}+` : `${tier.min_qty}–${end}`;
}

export function tgTierPreview(params: {
  basePrice: number;
  bulkTiers?: BulkTier[] | null;
  bulkEnabled?: boolean;
  stock?: number;
  maxQty?: number;
  qty: number;
  locale?: Locale;
}): string[] {
  const locale = params.locale ?? "id";
  const en = locale === "en";
  if (params.bulkEnabled === false || !params.bulkTiers?.length) return [];
  const tiers = [...params.bulkTiers].sort((a, b) => a.min_qty - b.min_qty).slice(0, 5);
  const reachLimit = Math.min(
    params.maxQty ?? TIER_RANGE_QTY_CAP,
    TIER_RANGE_QTY_CAP,
    params.stock != null && params.stock !== -1 ? Math.max(1, params.stock) : TIER_RANGE_QTY_CAP,
  );
  const out = [en ? "Bulk price (per pcs, all units):" : "Harga grosir (per pcs, semua unit):"];
  for (const [index, tier] of tiers.entries()) {
    const unreachable = tier.min_qty > reachLimit;
    out.push(`• ${tierRangeLabel(tier, tiers[index + 1], locale)}: ${formatIdr(tier.unit_price, locale)}${unreachable ? (en ? " (exceeds stock)" : " (melebihi stok)") : ""}`);
  }
  return out;
}

export function tgTierAppliedLine(params: {
  price: number;
  basePrice?: number;
  appliedTierMinQty?: number | null;
  qty: number;
  bulkTiers?: BulkTier[] | null;
  stock?: number;
  maxQty?: number;
  locale?: Locale;
}): string[] {
  const locale = params.locale ?? "id";
  const en = locale === "en";
  const out: string[] = [];
  const base = Number(params.basePrice ?? NaN);
  const discounted = Number.isSafeInteger(base) && base > params.price;
  if (discounted) {
    const saved = base * params.qty - params.price * params.qty;
    out.push(en
      ? `<b>Subtotal: ${formatIdr(params.price * params.qty, locale)}</b> (save ${formatIdr(saved, locale)})`
      : `<b>Subtotal: ${formatIdr(params.price * params.qty, locale)}</b> (hemat ${formatIdr(saved, locale)})`);
    out.push(en
      ? `Unit price: <b>${formatIdr(params.price, locale)}</b> (bulk ${params.appliedTierMinQty ?? ""}+)`
      : `Harga satuan: <b>${formatIdr(params.price, locale)}</b> (grosir ${params.appliedTierMinQty ?? ""}+)`);
  }
  // Next reachable tier jump (only when a higher tier is still reachable).
  const tiers = (params.bulkTiers ?? []).filter((t) => Number.isSafeInteger(t.min_qty) && Number.isSafeInteger(t.unit_price));
  const reachLimit = Math.min(
    params.maxQty ?? TIER_RANGE_QTY_CAP,
    TIER_RANGE_QTY_CAP,
    params.stock != null && params.stock !== -1 ? Math.max(1, params.stock) : TIER_RANGE_QTY_CAP,
  );
  const next = [...tiers].sort((a, b) => a.min_qty - b.min_qty).find((t) => t.min_qty > params.qty && t.min_qty <= reachLimit);
  if (next) out.push(en ? `Add ${next.min_qty - params.qty} more → ${formatIdr(next.unit_price, locale)}/pcs.` : `Tambah ${next.min_qty - params.qty} lagi → ${formatIdr(next.unit_price, locale)}/pcs.`);
  return out;
}

export function confirmVariantBuyMessage(params: {
  productName: string;
  variantLabel: string;
  duration?: string | null;
  warranty?: string | null;
  price: number;
  step?: string | null;
}): string {
  const { productName, variantLabel, duration, warranty, price } = params;
  const name = escapeHtml(truncate(productName, 100));
  const lines = [
    "<b>Konfirmasi pembelian</b>",
    "",
    `<b>${name}</b>`,
    `Varian: ${escapeHtml(truncate(variantLabel, 100))}`,
  ];
  if (duration) lines.push(`Durasi: ${escapeHtml(duration)}`);
  if (warranty) lines.push(`Garansi: ${escapeHtml(warranty)}`);
  lines.push(`Harga satuan: ${formatRupiah(price)}`);
  lines.push("");
  lines.push("Setelah ini kamu dapat mengatur jumlah pesanan.");
  return lines.join("\n");
}

export function chooseVariantMessage(productName: string, opts?: { locale?: Locale }): string {
  const name = escapeHtml(truncate(productName, 100));
  const en = opts?.locale === "en";
  return [
    `<b>${name}</b>`,
    "",
    en ? "Choose a variant." : "Pilih varian.",
  ].join("\n");
}

export function confirmBuyMessage(productName: string, price: number, qty = 1, opts?: TgMoneyOpts): string {
  const name = escapeHtml(truncate(productName, 100));
  const quantity = Math.max(1, Math.min(100, Math.floor(qty)));
  const en = opts?.locale === "en";
  const unit = formatIdr(price, opts?.locale ?? "id");
  const sub = formatIdr(price * quantity, opts?.locale ?? "id");
  const lines = [
    en ? "<b>Confirm purchase</b>" : "<b>Konfirmasi pembelian</b>",
    "",
    name,
    en ? `Unit price: ${unit}` : `Harga satuan: ${unit}`,
    en ? `Quantity: ${quantity}` : `Jumlah: ${quantity}`,
    en ? `<b>Subtotal: ${sub}</b>` : `<b>Subtotal: ${sub}</b>`,
  ];
  if (opts?.usdEquivalentText) lines.push(`≈ ${opts.usdEquivalentText}`);
  if (opts?.usdUnavailable) lines.push(en ? "USD equivalent unavailable — shown in IDR." : "Perkiraan USD tidak tersedia — ditampilkan dalam IDR.");
  lines.push(
    "",
    en ? "Final payable total is on the invoice, including the payment unique code." : "Total bayar final tercantum pada invoice, termasuk kode unik pembayaran.",
    "",
    en ? "Third-party, not official. Warranty follows the chosen variant. By continuing you agree to /garansi terms." : "Third-party, bukan official. Garansi mengikuti varian yang dipilih. Dengan melanjutkan pembayaran, kamu setuju ketentuan /garansi.",
    marketRefundNotice[en ? "en" : "id"],
  );
  return lines.join("\n");
}

export function chooseQtyMessage(params: {
  productName: string;
  variantLabel: string;
  price: number;
  stock: number;
  qty: number;
  maxQty?: number;
  minQty?: number;
  requiresEmail?: boolean;
  /** TG2b: dasar untuk menghitung hemat; price = harga efektif server. */
  basePrice?: number;
  appliedTierMinQty?: number | null;
  bulkTiers?: BulkTier[] | null;
  bulkEnabled?: boolean;
}, opts?: TgMoneyOpts): string {
  const { productName, variantLabel, price, stock } = params;
  const en = opts?.locale === "en";
  // Telegram bulk cap is 100/order.
  const minQty = Math.max(1, Math.floor(Number(params.minQty ?? 1) || 1));
  const maxQty = Math.max(1, Math.min(100, stock === -1 ? 100 : Math.max(1, stock), Math.floor(params.maxQty ?? 100)));
  const qty = Math.min(Math.max(minQty, Math.floor(params.qty || minQty)), maxQty);
  const stockLine = stock === -1 ? (en ? "In stock" : "Stok tersedia") : stock > 0 ? (en ? `Stock: ${stock}` : `Stok: ${stock}`) : (en ? "Out of stock" : "Stok habis");
  const bulkExtra = [
    ...tgTierPreview({ basePrice: Number(params.basePrice ?? price), bulkTiers: params.bulkTiers, bulkEnabled: params.bulkEnabled, stock, maxQty, qty, locale: opts?.locale ?? "id" }),
    ...tgTierAppliedLine({ price, basePrice: params.basePrice, appliedTierMinQty: params.appliedTierMinQty, qty, bulkTiers: params.bulkTiers, stock, maxQty, locale: opts?.locale ?? "id" }),
  ];
  const hasBulkSavings = Number(params.basePrice ?? NaN) > price;
  const lines = [
    en ? "<b>🛒 Order quantity</b>" : "<b>🛒 Jumlah pesanan</b>",
    "",
    `<b>${escapeHtml(truncate(productName, 80))}</b>`,
    en ? `Variant: ${escapeHtml(truncate(variantLabel, 80))}` : `Varian: ${escapeHtml(truncate(variantLabel, 80))}`,
    "",
    ...(bulkExtra.length ? [...bulkExtra, ""] : []),
    ...(hasBulkSavings
      ? [en ? `Unit price: ${formatIdr(price, opts?.locale ?? "id")}` : `Harga satuan: ${formatIdr(price, opts?.locale ?? "id")}`, en ? `<b>Quantity: ${qty}</b>` : `<b>Jumlah: ${qty}</b>`]
      : [en ? `Unit price: ${formatIdr(price, opts?.locale ?? "id")}` : `Harga satuan: ${formatIdr(price, opts?.locale ?? "id")}`, en ? `<b>Quantity: ${qty}</b>` : `<b>Jumlah: ${qty}</b>`, en ? `<b>Subtotal: ${formatIdr(price * qty, opts?.locale ?? "id")}</b>` : `<b>Subtotal: ${formatIdr(price * qty, opts?.locale ?? "id")}</b>`]),
  ];
  if (opts?.usdEquivalentText) lines.push(`≈ ${opts.usdEquivalentText}`);
  if (opts?.usdUnavailable) lines.push(en ? "USD equivalent unavailable — shown in IDR." : "Perkiraan USD tidak tersedia — ditampilkan dalam IDR.");
  lines.push(
    "",
    stockLine,
    ...(minQty > 1 ? [en ? `Minimum purchase: ${minQty}` : `Minimal pembelian: ${minQty}`] : []),
    en ? `Maximum ${maxQty} per order.` : `Maksimal ${maxQty} per pesanan.`,
    "",
    ...(params.requiresEmail ? [en ? "An active email is required before paying." : "Email aktif diperlukan sebelum membayar."] : []),
  );
  return lines.join("\n");
}

export function emailConfirmationMessage(params: {
  productName: string;
  variantLabel: string;
  qty: number;
  total: number;
  maskedEmail: string;
  basePrice?: number;
  appliedTierMinQty?: number | null;
}, opts?: { locale?: Locale }): string {
  const en = opts?.locale === "en";
  const unit = Number.isSafeInteger(params.qty) && params.qty > 0 ? Math.round(params.total / params.qty) : params.total;
  const discounted = Number.isSafeInteger(params.basePrice) && Number(params.basePrice) > unit;
  return [
    en ? "<b>📧 Email confirmation</b>" : "<b>📧 Konfirmasi email</b>",
    "",
    `<b>${escapeHtml(truncate(params.productName, 80))}</b>`,
    en ? `Variant: ${escapeHtml(truncate(params.variantLabel, 80))}` : `Varian: ${escapeHtml(truncate(params.variantLabel, 80))}`,
    "",
    en ? `Quantity: ${params.qty}` : `Jumlah: ${params.qty}`,
    ...(discounted ? [en ? `Unit price: ${formatIdr(unit, opts?.locale ?? "id")} (bulk ${params.appliedTierMinQty ?? ""}+)` : `Harga satuan: ${formatIdr(unit, opts?.locale ?? "id")} (grosir ${params.appliedTierMinQty ?? ""}+)`] : []),
    `<b>${en ? "Subtotal" : "Subtotal"}: ${formatIdr(params.total, opts?.locale ?? "id")}</b>`,
    "",
    "<b>Email</b>",
    escapeHtml(params.maskedEmail),
    en ? "Double-check your email before paying." : "Periksa email sebelum membayar.",
  ].join("\n");
}

export type TelegramCartLine = {
  productName: string;
  variantLabel: string;
  price: number;
  qty: number;
  basePrice?: number;
  appliedTierMinQty?: number | null;
};

export function cartMessage(lines: TelegramCartLine[], opts?: TgMoneyOpts): string {
  const en = opts?.locale === "en";
  if (lines.length === 0) {
    return [
      en ? "<b>Cart is empty</b>" : "<b>Keranjang kosong</b>",
      "",
      en ? "Browse products in /katalog." : "Pilih produk di /katalog.",
    ].join("\n");
  }
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  const bulkSaved = lines.reduce((sum, line) => {
    const base = Number(line.basePrice ?? NaN);
    return Number.isSafeInteger(base) && base > line.price ? sum + (base - line.price) * line.qty : sum;
  }, 0);
  const out = [
    en ? "<b>🛒 Cart</b>" : "<b>🛒 Keranjang</b>",
    "",
  ];
  lines.slice(0, 20).forEach((line, i) => {
    const discounted = Number.isSafeInteger(line.basePrice) && Number(line.basePrice) > line.price;
    out.push(
      `${i + 1}. ${escapeItemSummary(line.productName, 65)} / ${escapeItemSummary(line.variantLabel, 65)} x${line.qty}: ${formatIdr(line.price * line.qty, opts?.locale ?? "id")}${discounted ? (en ? ` (bulk ${line.appliedTierMinQty ?? ""}+)` : ` (grosir ${line.appliedTierMinQty ?? ""}+)`) : ""}`
    );
  });
  out.push("");
  if (bulkSaved > 0) out.push(en ? `Bulk savings: ${formatIdr(bulkSaved, opts?.locale ?? "id")}` : `Hemat grosir: ${formatIdr(bulkSaved, opts?.locale ?? "id")}`);
  out.push(`<b>${en ? "Subtotal" : "Subtotal"}: ${formatIdr(subtotal, opts?.locale ?? "id")}</b>`);
  if (opts?.usdEquivalentText) out.push(`≈ ${opts.usdEquivalentText}`);
  if (opts?.usdUnavailable) out.push(en ? "USD equivalent unavailable — shown in IDR." : "Perkiraan USD tidak tersedia — ditampilkan dalam IDR.");
  out.push("");
  out.push(en ? "One QRIS payment for all items." : "Satu pembayaran QRIS untuk semua item.");
  return out.join("\n");
}

export function cartAddedMessage(productName: string, variantLabel: string, qty: number, cartCount: number, opts?: { locale?: Locale }): string {
  const en = opts?.locale === "en";
  return [
    en ? "<b>Added to cart</b>" : "<b>Ditambahkan ke keranjang</b>",
    "",
    `<b>${escapeHtml(truncate(productName, 60))}</b>`,
    `${escapeHtml(truncate(variantLabel, 60))} x${qty}`,
    "",
    en ? `Cart: ${cartCount} items` : `Keranjang: ${cartCount} item`,
  ].join("\n");
}

export function cartCheckoutSummaryMessage(lines: TelegramCartLine[], subtotal: number, opts?: TgMoneyOpts): string {
  const en = opts?.locale === "en";
  const bulkSaved = lines.reduce((sum, line) => {
    const base = Number(line.basePrice ?? NaN);
    return Number.isSafeInteger(base) && base > line.price ? sum + (base - line.price) * line.qty : sum;
  }, 0);
  const names = lines.slice(0, 20).map(line => {
    const discounted = Number.isSafeInteger(line.basePrice) && Number(line.basePrice) > line.price;
    return `• ${escapeItemSummary(line.productName, 75)} / ${escapeItemSummary(line.variantLabel, 75)} x${line.qty}${discounted ? (en ? ` (bulk ${line.appliedTierMinQty ?? ""}+)` : ` (grosir ${line.appliedTierMinQty ?? ""}+)`) : ""}`;
  }).join("\n");
  const out = [
    en ? "<b>🛒 Cart confirmation</b>" : "<b>🛒 Konfirmasi keranjang</b>",
    "",
    names,
    "",
  ];
  if (bulkSaved > 0) out.push(en ? `Bulk savings: ${formatIdr(bulkSaved, opts?.locale ?? "id")}` : `Hemat grosir: ${formatIdr(bulkSaved, opts?.locale ?? "id")}`);
  out.push(`<b>${en ? "Subtotal" : "Subtotal"}: ${formatIdr(subtotal, opts?.locale ?? "id")}</b>`);
  if (opts?.usdEquivalentText) out.push(`≈ ${opts.usdEquivalentText}`);
  if (opts?.usdUnavailable) out.push(en ? "USD equivalent unavailable — shown in IDR." : "Perkiraan USD tidak tersedia — ditampilkan dalam IDR.");
  out.push("");
  out.push(en ? "One QRIS payment for all items. Final total is on the invoice." : "Satu pembayaran QRIS untuk semua item. Total bayar final tercantum pada invoice.", marketRefundNotice[en ? "en" : "id"]);
  return out.join("\n");
}

export function orderReminderMessage(params: {
  orderCode: string;
  productName: string;
  payableAmount: number;
  attempt: number;
}, opts?: TgMoneyOpts): string {
  const { orderCode, productName, payableAmount, attempt } = params;
  const en = opts?.locale === "en";
  return [
    en ? (attempt > 1 ? "<b>Final payment reminder</b>" : "<b>Awaiting payment</b>") : (attempt > 1 ? "<b>Pengingat pembayaran terakhir</b>" : "<b>Menunggu pembayaran</b>"),
    "",
    escapeItemSummary(productName, 2800),
    `<code>${escapeHtml(truncate(orderCode, 120))}</code>`,
    en ? `<b>Total to pay: ${formatRupiah(payableAmount)} (IDR via QRIS)</b>` : `<b>Total bayar: ${formatRupiah(payableAmount)} (IDR via QRIS)</b>`,
    "",
    ...(en ? ["Pay the active QRIS for the exact amount before its deadline.", "", "Ignore this message if you already paid. The bot will notify you after payment is confirmed."] : ["Bayar QRIS yang masih aktif sesuai nominal sebelum batas waktunya.", "", "Abaikan pesan ini jika sudah bayar. Bot mengabari setelah pembayaran terkonfirmasi."]),
  ].join("\n");
}

/** R3 reminder for gateway/crypto orders: generic, saved-locale copy. No QRIS
 * wording and NO amount/address/link/VA — details (and a gateway fee consent)
 * only ever come from the saved status view behind the refresh button. */
export function providerOrderReminderMessage(params: {
  orderCode: string;
  productName: string;
  attempt: number;
}, opts?: TgMoneyOpts): string {
  const { orderCode, productName, attempt } = params;
  const en = opts?.locale === "en";
  return [
    en ? (attempt > 1 ? "<b>Final payment reminder</b>" : "<b>Awaiting payment</b>") : (attempt > 1 ? "<b>Pengingat pembayaran terakhir</b>" : "<b>Menunggu pembayaran</b>"),
    "",
    escapeItemSummary(productName, 2800),
    `<code>${escapeHtml(truncate(orderCode, 120))}</code>`,
    "",
    ...(en
      ? ["Open the payment details before the deadline with the button below.", "", "Ignore this message if you already paid. The bot will notify you after payment is confirmed."]
      : ["Buka detail pembayaran sebelum batas waktunya lewat tombol di bawah.", "", "Abaikan pesan ini jika sudah bayar. Bot mengabari setelah pembayaran terkonfirmasi."]),
  ].join("\n");
}

export type TgInvoiceOpts = TgMoneyOpts & { chargeNote?: boolean };

/** R1 frozen method offer copy (localized, QRIS first + Paling cepat/Fastest). */
export function paymentMethodOfferMessage(
  params: { productName: string; subtotal: number },
  opts?: TgMoneyOpts,
): string {
  const en = opts?.locale === "en";
  return [
    en ? "<b>Choose a payment method</b>" : "<b>Pilih metode pembayaran</b>",
    "",
    escapeItemSummary(params.productName, 220),
    en ? `Subtotal: ${formatIdr(params.subtotal, opts?.locale ?? "id")}` : `Subtotal: ${formatIdr(params.subtotal, opts?.locale ?? "id")}`,
    "",
    en
      ? "QRIS is the fastest option. Other methods show the estimated total before you choose."
      : "QRIS adalah opsi tercepat. Metode lain menampilkan estimasi total sebelum kamu memilih.",
  ].join("\n");
}

/** R1 frozen offer detail lines: gateway estimated fee/total; crypto = SATU
 * baris ringkas (total USD termasuk biaya layanan crypto, gas pengirim; koin
 * dipilih di sub-menu), tidak pernah satu baris per koin (batas 4096 karakter).
 * Gateway contact note when phone is missing (R2 collects it; R1 must NOT
 * collect/process phone). */
export function paymentMethodOfferDetails(
  methods: { kind?: string; label?: string; gateway?: { estimated_fee: number; estimated_total: number } | null; amount_text?: string; pay_currency?: string; network?: string }[],
  opts?: TgMoneyOpts,
): string[] {
  const en = opts?.locale === "en";
  const locale = opts?.locale ?? "id";
  let cryptoLineAdded = false;
  return methods.flatMap((method) => {
    if (method.kind === "crypto") {
      if (cryptoLineAdded) return [];
      cryptoLineAdded = true;
      const amount = escapeHtml(String(method.amount_text ?? "").slice(0, 32));
      return [en
        ? `• Crypto (USD): ${amount} USD, incl. crypto service fee. Pick a coin next; network gas is paid by the sender.`
        : `• Crypto (USD): ${amount} USD, termasuk biaya layanan crypto. Pilih koin berikutnya; gas jaringan ditanggung pengirim.`];
    }
    const label = escapeHtml(String(method.label ?? "").slice(0, 80) || "—");
    if (method.kind === "gateway" && method.gateway) {
      return [en
        ? `• ${label}: est. fee ${formatIdr(method.gateway.estimated_fee, locale)}, estimated total ${formatIdr(method.gateway.estimated_total, locale)}. Contact info is required before paying with this method.`
        : `• ${label}: estimasi biaya ${formatIdr(method.gateway.estimated_fee, locale)}, estimasi total ${formatIdr(method.gateway.estimated_total, locale)}. Info kontak dibutuhkan sebelum membayar dengan metode ini.`];
    }
    return [`• ${label}`];
  });
}

/** R2 selection + expiry/refresh notices (localized, honest, no fallback).
 * `selected_other` now carries the confirm entry (pgo:); legacy QRIS flow
 * untouched. Copy only — no prices here (state binds everything). */
export function paymentMethodNoticeMessage(
  kind: "selected_other" | "expired" | "refreshed" | "deferred" | "unavailable" | "creating" | "create_failed" | "contact_needed" | "not_ready" | "method_unavailable" | "crypto_pick_coin",
  opts?: TgMoneyOpts,
): string {
  const en = opts?.locale === "en";
  switch (kind) {
    case "selected_other":
      return en
        ? "Method selected. Press Continue to create the payment — prices stay exactly as shown."
        : "Metode dipilih. Tekan Lanjut untuk membuat pembayaran — harga tetap persis seperti yang ditampilkan.";
    case "creating":
      return en
        ? "Creating your payment — do not tap again. This message updates automatically."
        : "Pembayaran sedang dibuat — jangan tekan lagi. Pesan ini diperbarui otomatis.";
    case "create_failed":
      return en
        ? "This payment method is having problems. Please try another payment method."
        : "Metode pembayaran ini sedang gangguan. Silakan coba metode pembayaran lain.";
    case "contact_needed":
      return en
        ? "This method needs contact info first. Reply with the requested detail, then choose the method again."
        : "Metode ini butuh info kontak dulu. Balas dengan detail yang diminta, lalu pilih metodenya lagi.";
    case "method_unavailable":
      return en
        ? "That payment method can't be used right now. Please choose another payment method."
        : "Metode pembayaran itu belum bisa dipakai saat ini. Silakan pilih metode pembayaran lain.";
    case "crypto_pick_coin":
      return en
        ? "<b>Crypto (USD)</b>\nPick the coin you will pay with. The USD total is the same for every coin and includes the crypto service fee. You send the exact coin amount on the matching network only; network gas is paid by the sender."
        : "<b>Crypto (USD)</b>\nPilih koin yang akan kamu pakai. Total USD sama untuk semua koin dan sudah termasuk biaya layanan crypto. Kirim nominal koin yang tepat hanya lewat jaringan yang sesuai; gas jaringan ditanggung pengirim.";
    case "not_ready":
      return en
        ? "This offer is being prepared. Wait a moment, then tap the method again."
        : "Penawaran ini sedang disiapkan. Tunggu sebentar, lalu ketuk metodenya lagi.";
    case "expired":
      return en
        ? "This offer expired. Showing the latest offer — prices may have changed."
        : "Penawaran ini kedaluwarsa. Menampilkan penawaran terbaru — harga bisa berubah.";
    case "refreshed":
      return en
        ? "Showing the latest offer — prices may have changed."
        : "Menampilkan penawaran terbaru — harga bisa berubah.";
    case "deferred":
      return en
        ? "Finish the current step first, then choose a payment method."
        : "Selesaikan langkah saat ini dulu, lalu pilih metode pembayaran.";
    case "unavailable":
      return en
        ? "Payment methods are unavailable right now. QRIS checkout still works — try again."
        : "Metode pembayaran belum tersedia saat ini. Checkout QRIS tetap berjalan — coba lagi.";
  }
}

export function invoiceMessage(params: {
  orderCode: string;
  productName: string;
  payableAmount: number;
  expiresAt: string;
  paymentMethod?: string;
  /** Legacy field, never rendered: buyer PINs are email-only. */
  buyerAccessCode?: string;
}, opts?: TgInvoiceOpts): string {
  const { orderCode, productName, payableAmount, expiresAt, paymentMethod } = params;
  const isQris = !paymentMethod || paymentMethod === "qris";
  const en = opts?.locale === "en";
  let expiryText: string;
  try {
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime())) throw new Error("invalid_expiry");
    expiryText = d.toLocaleString(en ? "en-US" : "id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
  } catch {
    expiryText = expiresAt;
  }

  const header = [
    en ? "<b>⏳ Awaiting payment</b>" : "<b>⏳ Menunggu pembayaran</b>",
    `<code>${escapeItemSummary(orderCode, 120)}</code>`,
  ].join("\n");
  const footer = [
    // QRIS charge is ALWAYS actual IDR payable (incl. unique-code rules).
    en ? `<b>Total to pay: ${formatRupiah(payableAmount)} (IDR via QRIS)</b>` : `<b>Total bayar: ${formatRupiah(payableAmount)} (IDR via QRIS)</b>`,
    ...(opts?.chargeNote ? [en ? "Charged in IDR, even when your display currency is USD." : "Ditagih dalam IDR, walau mata uang tampilanmu USD."] : []),
    isQris ? (en ? "Pay the QRIS for this exact amount." : "Bayar QRIS sesuai nominal ini.") : (en ? "Transfer this exact amount." : "Transfer sesuai nominal ini."),
    "",
    en ? `Pay before: ${escapeItemSummary(expiryText, 80)}` : `Batas bayar: ${escapeItemSummary(expiryText, 80)}`,
    ...(isQris ? [QRIS_PAYMENT_DEADLINE_NOTICE] : []),
    "",
    en ? "Use Check Payment for status. The bot notifies you automatically after payment is confirmed." : "Periksa Pembayaran untuk cek status. Bot otomatis mengabari setelah pembayaran terkonfirmasi.",
  ].join("\n");
  // Invoices are also photo captions, whose HTML budget is 1024 characters.
  return [header, escapeItemSummary(productName, 1023 - header.length - footer.length - 4), footer].join("\n\n");
}
