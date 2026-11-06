import { escapeHtml, escapeItemSummary, formatRupiah, truncate, paymentLabels, fulfillmentLabels } from "./format";
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
import { SITE } from "@/lib/site";
import { credentialMessages } from "./credential";

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
  needsWhatsApp = false,
  delivery: TelegramPaidDelivery = "manual",
  opts?: TgLocaleOpts,
): string {
  const en = opts?.locale === "en";
  const name = escapeItemSummary(productName, 2800);
  const deliveryLines = delivery === "instant"
    ? en
      ? [
          "Product is sent automatically to this chat once ready.",
          "Details are also available via <b>Fetch Product Details</b>.",
        ]
      : [
        "Produk dikirim otomatis ke chat ini setelah siap.",
        "Detail juga tersedia lewat <b>Ambil Detail Produk</b>.",
      ]
    : delivery === "queued"
      ? en
        ? [
            "Made By Order. Your order is being processed in queue, up to 12 hours during service hours.",
            "Product details are sent automatically to this chat once ready.",
            "Details are also available via <b>Fetch Product Details</b>.",
          ]
        : [
            "Made By Order. Pesanan sedang dikerjakan sesuai antrean, maksimal 12 jam pada jam layanan.",
            "Detail produk dikirim otomatis ke chat ini setelah siap.",
            "Detail juga tersedia lewat <b>Ambil Detail Produk</b>.",
          ]
      : en ? ["An admin will send the product to this private chat."] : ["Produk akan dikirim admin ke chat pribadi ini."];
  const lines = [
    en ? "<b>✅ Payment confirmed</b>" : "<b>✅ Pembayaran lunas</b>",
    "",
    name,
    `<code>${escapeHtml(truncate(orderCode, 120))}</code>`,
    "",
    en ? "Payment verified." : "Pembayaran sudah terverifikasi.",
    ...deliveryLines,
  ];
  if (needsWhatsApp) {
    lines.push(
      "",
      ...(en
        ? [
            "You can send an active WhatsApp number here as a backup delivery channel.",
            "Example: <code>08123456789</code>",
          ]
        : [
            "Nomor WhatsApp aktif dapat dikirim di sini sebagai jalur pengiriman cadangan.",
            "Contoh: <code>08123456789</code>",
          ]),
    );
  }
  lines.push(
    "",
    // 2026-10-10: WA via hub /wa (pilih nomor aktif) — bukan wa.me langsung.
    `WhatsApp admin: ${SITE.webUrl}/wa`,
    `Telegram: @${SITE.supportTelegram}`,
  );
  return lines.join("\n");
}

export function deliveryMessage(secret: string, opts?: TgLocaleOpts): string {
  return credentialMessages({ plaintext: secret, secretTag: "code", locale: opts?.locale ?? "id" }).join("\n\n");
}

/**
 * Detail produk hasil auto-order (WR/SK) ke chat pribadi pembeli Telegram.
 * Satu template untuk dua sumber agar pembeli melihat format yang sama
 * dengan produk stok sendiri (`deliveryMessage`) + nama produk + kode order.
 */
export function supplierCredentialMessage(orderCode: string, productName: string, plaintext: string, opts?: TgLocaleOpts): string {
  return credentialMessages({ orderCode, productName, plaintext, locale: opts?.locale ?? "id" }).join("\n\n");
}

export function whatsAppInputPromptMessage(orderCode: string, opts?: TgLocaleOpts): string {
  const en = opts?.locale === "en";
  return [
    en ? "<b>Delivery WhatsApp number</b>" : "<b>Nomor WhatsApp pengiriman</b>",
    "",
    `<code>${escapeHtml(orderCode)}</code>`,
    "",
    ...(en
      ? ["Payment is complete. Reply here with an active WhatsApp number so the admin can deliver the product.", "", "Example: <code>08123456789</code>"]
      : ["Pembayaran sudah lunas. Balas chat ini dengan nomor WhatsApp aktif agar admin dapat mengirim produk.", "", "Contoh: <code>08123456789</code>"]),
    "",
    // 2026-10-10: WA via hub /wa (pilih nomor aktif) — bukan wa.me langsung.
    `WhatsApp admin: ${SITE.webUrl}/wa`,
    `Telegram: @${SITE.supportTelegram}`,
  ].join("\n");
}

export function orderExpiredMessage(orderCode: string, opts?: TgLocaleOpts): string {
  const en = opts?.locale === "en";
  return [
    en ? "<b>⌛ Invoice expired</b>" : "<b>⌛ Invoice kedaluwarsa</b>",
    "",
    `<code>${escapeHtml(orderCode)}</code>`,
    "",
    ...(en
      ? ["The payment deadline has passed.", "Create a new order from /katalog"]
      : ["Batas waktu pembayaran sudah habis.", "Buat pesanan baru dari /katalog"]),
  ].join("\n");
}

export function orderCancelledMessage(orderCode: string, opts?: TgLocaleOpts): string {
  const en = opts?.locale === "en";
  return [
    en ? "<b>❌ Order cancelled</b>" : "<b>❌ Pesanan dibatalkan</b>",
    "",
    `<code>${escapeHtml(orderCode)}</code>`,
    "",
    en ? "Create a new order from /katalog" : "Buat pesanan baru dari /katalog",
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
      "",
      en ? "Use the QRIS already sent, with its amount and deadline." : "Gunakan QRIS yang sudah dikirim sesuai nominal dan batas waktunya.",
    ].join("\n");
  }
  if (reason === "reissue_limit_reached") {
    return [
      en ? "<b>Extension limit reached</b>" : "<b>Batas perpanjangan habis</b>",
      "",
      ...(en
        ? ["This order's QRIS was already extended the maximum 1 time.", "Please create a new order via /katalog."]
        : ["QRIS pesanan ini sudah diperpanjang maksimal 1 kali.", "Silakan buat pesanan baru lewat /katalog."]),
    ].join("\n");
  }
  if (reason === "amount_unavailable") {
    return [
      en ? "<b>Payment amount unavailable</b>" : "<b>Nominal pembayaran belum tersedia</b>",
      "",
      en ? "The unique amount for this price is currently full. Try again shortly." : "Nominal unik untuk harga ini sedang penuh. Coba lagi beberapa saat.",
    ].join("\n");
  }
  return [
    en ? "<b>Order cannot be extended</b>" : "<b>Pesanan tidak bisa diperpanjang</b>",
    "",
    ...(en
      ? ["This order is already paid, cancelled, or expired.", "Create a new order via /katalog."]
      : ["Pesanan ini sudah lunas, dibatalkan, atau kedaluwarsa.", "Buat pesanan baru lewat /katalog."]),
  ].join("\n");
}

export function outOfStockMessage(opts?: TgLocaleOpts): string {
  if (opts?.locale === "en") {
    return [
      "<b>📭 Out of stock</b>",
      "",
      "Sorry, this product is currently unavailable.",
      "Check other products in /katalog",
    ].join("\n");
  }
  return [
    "<b>📭 Stok habis</b>",
    "",
    "Maaf, produk ini sedang tidak tersedia.",
    "Cek produk lain di /katalog",
  ].join("\n");
}

export function alreadyPendingMessage(orderCode: string, opts?: TgLocaleOpts): string {
  if (opts?.locale === "en") {
    return [
      "<b>Active order</b>",
      "",
      `You still have a pending order for this product.`,
      `<code>${escapeHtml(orderCode)}</code>`,
      "",
      "Pay or cancel it before ordering again.",
    ].join("\n");
  }
  return [
    "<b>Pesanan aktif</b>",
    "",
    "Kamu masih punya pesanan untuk produk ini.",
    `<code>${escapeHtml(orderCode)}</code>`,
    "",
    "Bayar atau batalkan dulu sebelum order baru.",
  ].join("\n");
}

export function errorMessage(opts?: TgLocaleOpts): string {
  if (opts?.locale === "en") {
    return [
      "<b>⚠️ Something went wrong</b>",
      "",
      "Please try again.",
      "If it keeps failing, contact /bantuan",
    ].join("\n");
  }
  return [
    "<b>⚠️ Terjadi kesalahan</b>",
    "",
    "Silakan coba lagi.",
    "Kalau terus gagal, hubungi /bantuan",
  ].join("\n");
}

export function waSavedAfterPaymentMessage(orderCode: string, opts?: TgLocaleOpts): string {
  const en = opts?.locale === "en";
  return [
    en ? "<b>WhatsApp number saved</b>" : "<b>Nomor WhatsApp tersimpan</b>",
    "",
    `<code>${escapeHtml(orderCode)}</code>`,
    "",
    en ? "Payment is complete. The admin will contact you for delivery." : "Pembayaran sudah lunas. Admin akan menghubungimu untuk pengiriman.",
  ].join("\n");
}

export function invalidWhatsAppMessage(opts?: TgLocaleOpts): string {
  const en = opts?.locale === "en";
  return [
    en ? "<b>Invalid WhatsApp number</b>" : "<b>Nomor WhatsApp tidak valid</b>",
    "",
    en ? "Format: 08xxx / +628xxx (10-15 digits)" : "Format: 08xxx / +628xxx (10-15 digit)",
    en ? "Example: <code>08123456789</code>" : "Contoh: <code>08123456789</code>",
    "",
    en ? "Try again or type /katalog to cancel." : "Coba lagi atau ketik /katalog untuk batal.",
  ].join("\n");
}

export function qrisExpiredMessage(orderCode: string, opts?: TgLocaleOpts): string {
  const en = opts?.locale === "en";
  return [en ? "<b>QRIS expired</b>" : "<b>QRIS kedaluwarsa</b>", "", `<code>${escapeHtml(orderCode)}</code>`, "",
    ...(en
      ? [
          "The first QRIS expired after 15 minutes. Do not pay the old QRIS.",
          "You can request a new QRIS 1 time via the button below while the order is still active.",
          "If the replacement QRIS is also unpaid before its deadline, the order expires and must be reordered.",
        ]
      : [
          "QRIS pertama sudah hangus setelah 15 menit. Jangan bayar QRIS lama.",
          "Kamu dapat meminta QRIS baru 1 kali lewat tombol di bawah selama pesanan masih aktif.",
          "Jika QRIS pengganti juga tidak dibayar sampai batas waktunya, pesanan kedaluwarsa dan harus order ulang.",
        ]),
  ].join("\n");
}
