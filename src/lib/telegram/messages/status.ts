import { escapeHtml, escapeItemSummary, formatRupiah, truncate, paymentLabels, fulfillmentLabels } from "./format";
import { WR_QUEUED_MAX_HOURS } from "@/lib/warung-rebahan/delivery-class";
import type { Locale } from "@/lib/i18n/locale";

export type TgLocaleOpts = { locale?: Locale };

const PAYMENT_LABELS_EN: Record<string, string> = {
  unpaid: "Awaiting payment",
  pending: "Awaiting payment",
  paid: "Paid",
  expired: "Expired",
  failed: "Failed",
  cancelled: "Cancelled",
};

const FULFILLMENT_LABELS_EN: Record<string, string> = {
  not_required: "Not processed yet",
  reserved: "Reserved",
  queued: "In queue",
  sending: "Sending",
  delivered: "Delivered",
  manual_required: "Processed by admin",
  retry: "Awaiting redelivery",
  failed: "Delivery failed",
};

/**
 * Cara produk sampai ke pembeli Telegram, per order (2026-10-04, paritas Web):
 * - `instant`: semua baris kirim otomatis (stok sendiri shared/unique, WR
 *   restock, SK auto) → detail dikirim otomatis ke chat ini.
 * - `queued`: ada baris Made By Order otomatis (WR MBO / SK non-auto) →
 *   pembeli diminta menunggu; detail tetap dikirim OTOMATIS ke chat ini
 *   begitu selesai.
 * - `manual`: ada baris yang diserahkan admin (fulfillment manual lokal).
 * Tidak pernah menyebut pemasok/pihak ketiga (keputusan owner 2026-09-18).
 */
export type TelegramPaidDelivery = "instant" | "queued" | "manual";

export function orderPaidMessage(
  orderCode: string,
  productName: string,
  delivery: TelegramPaidDelivery = "manual",
  opts?: TgLocaleOpts,
): string {
  const en = opts?.locale === "en";
  const name = escapeItemSummary(productName, 2800);
  // ETA kanonis (satu sumber dengan halaman pesanan web, `WR_QUEUED_MAX_HOURS`):
  // "umumnya kurang dari 1 jam, maksimal 12 jam" — bukan janji tanpa waktu.
  const hours = WR_QUEUED_MAX_HOURS;
  const deliveryLine = delivery === "instant"
    ? (en ? "Product is sent automatically to this chat." : "Produk dikirim otomatis ke chat ini.")
    : delivery === "queued"
      ? (en ? `Made By Order — usually under 1 hour, up to ${hours} hours. Sent automatically to this chat.` : `Made By Order — umumnya kurang dari 1 jam, maksimal ${hours} jam. Dikirim otomatis ke chat ini.`)
      : (en ? `An admin will send the product to this private chat — usually under 1 hour, up to ${hours} hours.` : `Produk akan dikirim admin ke chat pribadi ini — umumnya kurang dari 1 jam, maksimal ${hours} jam.`);
  const lines = [
    en ? "<b>🎉 Payment confirmed</b>" : "<b>🎉 Pembayaran lunas</b>",
    ...(name ? [name] : []),
    `<code>${escapeHtml(truncate(orderCode, 120))}</code>`,
    "",
    deliveryLine,
  ];
  return lines.join("\n");
}

export function whatsAppInputPromptMessage(orderCode: string, opts?: TgLocaleOpts): string {
  const en = opts?.locale === "en";
  return [
    en ? "<b>Delivery WhatsApp number</b>" : "<b>Nomor WhatsApp pengiriman</b>",
    `<code>${escapeHtml(orderCode)}</code>`,
    en
      ? "Reply with an active WhatsApp number (e.g. <code>08123456789</code>)."
      : "Balas chat ini dengan nomor WhatsApp aktif (mis. <code>08123456789</code>).",
  ].join("\n");
}

export function orderExpiredMessage(orderCode: string, opts?: TgLocaleOpts & { productName?: string; qris?: boolean }): string {
  const en = opts?.locale === "en";
  return [
    en ? "⌛ <b>Payment expired</b>" : "⌛ <b>Pembayaran kedaluwarsa</b>",
    `${en ? "Code" : "Kode"}   : <code>${escapeItemSummary(orderCode, 120)}</code>`,
    `${en ? "Product" : "Produk"} : ${escapeItemSummary(opts?.productName || (en ? "Order" : "Pesanan"), 2800)}`,
    opts?.qris
      ? (en ? "This QR is no longer valid — do not pay it." : "QR ini sudah tidak berlaku — jangan dibayar.")
      : (en ? "This invoice is no longer valid — do not pay it." : "Tagihan ini sudah tidak berlaku — jangan dibayar."),
  ].join("\n");
}

export function orderCancelledMessage(orderCode: string, opts?: TgLocaleOpts): string {
  const en = opts?.locale === "en";
  return [
    en ? "<b>❌ Order cancelled</b>" : "<b>❌ Pesanan dibatalkan</b>",
    `<code>${escapeHtml(orderCode)}</code>`,
    en ? "Reorder via /katalog." : "Order ulang di /katalog.",
  ].join("\n");
}

export function orderStatusMessage(params: {
  orderCode: string;
  productName: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  payableAmount?: number;
  /** Legacy field, never rendered: buyer PINs are email-only. */
  buyerAccessCode?: string;
}, opts?: TgLocaleOpts): string {
  const { orderCode, productName, paymentStatus, fulfillmentStatus, payableAmount } = params;
  const en = opts?.locale === "en";
  const payLabels = en ? PAYMENT_LABELS_EN : paymentLabels;
  const fulfillLabels = en ? FULFILLMENT_LABELS_EN : fulfillmentLabels;
  const header = [
    en ? "<b>📦 Order status</b>" : "<b>📦 Status pesanan</b>",
    `<code>${escapeItemSummary(orderCode, 120)}</code>`,
  ].join("\n");
  const footer = [
    ...(payableAmount != null ? [en ? `Total: ${formatRupiah(payableAmount)}` : `Total bayar: ${formatRupiah(payableAmount)}`] : []),
    "",
    `${en ? "Payment" : "Pembayaran"}: ${payLabels[paymentStatus] ?? (en ? "Unknown" : "Belum diketahui")}`,
    `${en ? "Delivery" : "Pengiriman"}: ${fulfillLabels[fulfillmentStatus] ?? (en ? "Unknown" : "Belum diketahui")}`,
  ].join("\n");
  return [header, escapeItemSummary(productName, 4096 - header.length - footer.length - 4), footer].join("\n\n");
}

/**
 * Alasan penolakan permintaan QRIS baru, dijelaskan dalam bahasa pembeli.
 * Tiap alasan punya tindak lanjut yang jelas — bukan "terjadi kesalahan".
 */
export function qrisRenewRejectedMessage(
  reason: "order_not_reissuable" | "invoice_still_active" | "reissue_limit_reached" | "amount_unavailable",
  opts?: TgLocaleOpts,
): string {
  const en = opts?.locale === "en";
  if (reason === "invoice_still_active") {
    return [
      en ? "<b>QRIS still valid</b>" : "<b>QRIS masih berlaku</b>",
      en ? "Use the QRIS already sent." : "Pakai QRIS yang sudah dikirim.",
    ].join("\n");
  }
  if (reason === "reissue_limit_reached") {
    return [
      en ? "<b>Extension limit reached</b>" : "<b>Batas perpanjangan habis</b>",
      en ? "Max 1 QRIS extension reached. Reorder via /katalog." : "Perpanjangan QRIS maks 1 kali. Order ulang di /katalog.",
    ].join("\n");
  }
  if (reason === "amount_unavailable") {
    return [
      en ? "<b>Amount unavailable</b>" : "<b>Nominal belum tersedia</b>",
      en ? "Unique amount is full. Try again shortly." : "Nominal unik sedang penuh. Coba lagi sebentar.",
    ].join("\n");
  }
  return [
    en ? "<b>Cannot extend order</b>" : "<b>Pesanan tidak bisa diperpanjang</b>",
    en ? "Order is already paid, cancelled, or expired. Reorder via /katalog." : "Pesanan sudah lunas/batal/kedaluwarsa. Order ulang di /katalog.",
  ].join("\n");
}

export function outOfStockMessage(opts?: TgLocaleOpts): string {
  if (opts?.locale === "en") {
    return "<b>📭 Out of stock</b>\nBrowse other products in /katalog.";
  }
  return "<b>📭 Stok habis</b>\nCek produk lain di /katalog.";
}

export function alreadyPendingMessage(orderCode: string, opts?: TgLocaleOpts): string {
  if (opts?.locale === "en") {
    return `<b>Active order</b>\n<code>${escapeHtml(orderCode)}</code>\nPay or cancel it first.`;
  }
  return `<b>Pesanan aktif</b>\n<code>${escapeHtml(orderCode)}</code>\nBayar atau batalkan dulu.`;
}

export function errorMessage(opts?: TgLocaleOpts): string {
  if (opts?.locale === "en") {
    return "<b>⚠️ Something went wrong</b>\nTry again or contact /bantuan.";
  }
  return "<b>⚠️ Terjadi kesalahan</b>\nCoba lagi atau hubungi /bantuan.";
}

export function waSavedAfterPaymentMessage(orderCode: string, opts?: TgLocaleOpts): string {
  const en = opts?.locale === "en";
  return [
    en ? "<b>WhatsApp number saved</b>" : "<b>Nomor WhatsApp tersimpan</b>",
    `<code>${escapeHtml(orderCode)}</code>`,
    en ? "Paid. Admin will contact you." : "Lunas. Admin akan menghubungimu.",
  ].join("\n");
}

export function invalidWhatsAppMessage(opts?: TgLocaleOpts): string {
  const en = opts?.locale === "en";
  return [
    en ? "<b>Invalid WhatsApp number</b>" : "<b>Nomor WhatsApp tidak valid</b>",
    en ? "Format: 08xxx / +628xxx (e.g. <code>08123456789</code>). /katalog to cancel." : "Format: 08xxx / +628xxx (mis. <code>08123456789</code>). /katalog untuk batal.",
  ].join("\n");
}

export function qrisExpiredMessage(orderCode: string, opts?: TgLocaleOpts & { productName?: string }): string {
  return orderExpiredMessage(orderCode, { ...opts, qris: true });
}
