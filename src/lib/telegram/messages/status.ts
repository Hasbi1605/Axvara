import { escapeHtml, escapeItemSummary, formatRupiah, truncate, paymentLabels, fulfillmentLabels } from "./format";
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
): string {
  const name = escapeItemSummary(productName, 2800);
  const deliveryLines = delivery === "instant"
    ? [
        "Produk dikirim otomatis ke chat ini setelah siap.",
        "Detail juga tersedia lewat <b>Ambil Detail Produk</b>.",
      ]
    : delivery === "queued"
      ? [
          "Made By Order. Pesanan sedang dikerjakan sesuai antrean, maksimal 12 jam pada jam layanan.",
          "Detail produk dikirim otomatis ke chat ini setelah siap.",
          "Detail juga tersedia lewat <b>Ambil Detail Produk</b>.",
        ]
      : ["Produk akan dikirim admin ke chat pribadi ini."];
  const lines = [
    "<b>✅ Pembayaran lunas</b>",
    "",
    name,
    `<code>${escapeHtml(truncate(orderCode, 120))}</code>`,
    "",
    "Pembayaran sudah terverifikasi.",
    ...deliveryLines,
  ];
  if (needsWhatsApp) {
    lines.push(
      "",
      "Nomor WhatsApp aktif dapat dikirim di sini sebagai jalur pengiriman cadangan.",
      "Contoh: <code>08123456789</code>",
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

export function deliveryMessage(secret: string): string {
  return credentialMessages({ plaintext: secret, secretTag: "code" }).join("\n\n");
}

/**
 * Detail produk hasil auto-order (WR/SK) ke chat pribadi pembeli Telegram.
 * Satu template untuk dua sumber agar pembeli melihat format yang sama
 * dengan produk stok sendiri (`deliveryMessage`) + nama produk + kode order.
 */
export function supplierCredentialMessage(orderCode: string, productName: string, plaintext: string): string {
  return credentialMessages({ orderCode, productName, plaintext }).join("\n\n");
}

export function whatsAppInputPromptMessage(orderCode: string): string {
  return [
    "<b>Nomor WhatsApp pengiriman</b>",
    "",
    `<code>${escapeHtml(orderCode)}</code>`,
    "",
    "Pembayaran sudah lunas. Balas chat ini dengan nomor WhatsApp aktif agar admin dapat mengirim produk.",
    "",
    "Contoh: <code>08123456789</code>",
    "",
    // 2026-10-10: WA via hub /wa (pilih nomor aktif) — bukan wa.me langsung.
    `WhatsApp admin: ${SITE.webUrl}/wa`,
    `Telegram: @${SITE.supportTelegram}`,
  ].join("\n");
}

export function orderExpiredMessage(orderCode: string): string {
  return [
    "<b>⌛ Invoice kedaluwarsa</b>",
    "",
    `<code>${escapeHtml(orderCode)}</code>`,
    "",
    "Batas waktu pembayaran sudah habis.",
    "Buat pesanan baru dari /katalog",
  ].join("\n");
}

export function orderCancelledMessage(orderCode: string): string {
  return [
    "<b>❌ Pesanan dibatalkan</b>",
    "",
    `<code>${escapeHtml(orderCode)}</code>`,
    "",
    "Buat pesanan baru dari /katalog",
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
}): string {
  const { orderCode, productName, paymentStatus, fulfillmentStatus, payableAmount } = params;
  const header = [
    "<b>📦 Status pesanan</b>",
    `<code>${escapeItemSummary(orderCode, 120)}</code>`,
  ].join("\n");
  const footer = [
    ...(payableAmount != null ? [`Total bayar: ${formatRupiah(payableAmount)}`] : []),
    "",
    `Pembayaran: ${paymentLabels[paymentStatus] ?? "Belum diketahui"}`,
    `Pengiriman: ${fulfillmentLabels[fulfillmentStatus] ?? "Belum diketahui"}`,
  ].join("\n");
  return [header, escapeItemSummary(productName, 4096 - header.length - footer.length - 4), footer].join("\n\n");
}

/**
 * Alasan penolakan permintaan QRIS baru, dijelaskan dalam bahasa pembeli.
 * Tiap alasan punya tindak lanjut yang jelas — bukan "terjadi kesalahan".
 */
export function qrisRenewRejectedMessage(
  reason: "order_not_reissuable" | "invoice_still_active" | "reissue_limit_reached" | "amount_unavailable",
): string {
  if (reason === "invoice_still_active") {
    return [
      "<b>QRIS masih berlaku</b>",
      "",
      "Gunakan QRIS yang sudah dikirim sesuai nominal dan batas waktunya.",
    ].join("\n");
  }
  if (reason === "reissue_limit_reached") {
    return [
      "<b>Batas perpanjangan habis</b>",
      "",
      "QRIS pesanan ini sudah diperpanjang maksimal 1 kali.",
      "Silakan buat pesanan baru lewat /katalog.",
    ].join("\n");
  }
  if (reason === "amount_unavailable") {
    return [
      "<b>Nominal pembayaran belum tersedia</b>",
      "",
      "Nominal unik untuk harga ini sedang penuh. Coba lagi beberapa saat.",
    ].join("\n");
  }
  return [
    "<b>Pesanan tidak bisa diperpanjang</b>",
    "",
    "Pesanan ini sudah lunas, dibatalkan, atau kedaluwarsa.",
    "Buat pesanan baru lewat /katalog.",
  ].join("\n");
}

export function outOfStockMessage(): string {
  return [
    "<b>📭 Stok habis</b>",
    "",
    "Maaf, produk ini sedang tidak tersedia.",
    "Cek produk lain di /katalog",
  ].join("\n");
}

export function alreadyPendingMessage(orderCode: string): string {
  return [
    "<b>Pesanan aktif</b>",
    "",
    "Kamu masih punya pesanan untuk produk ini.",
    `<code>${escapeHtml(orderCode)}</code>`,
    "",
    "Bayar atau batalkan dulu sebelum order baru.",
  ].join("\n");
}

export function errorMessage(): string {
  return [
    "<b>⚠️ Terjadi kesalahan</b>",
    "",
    "Silakan coba lagi.",
    "Kalau terus gagal, hubungi /bantuan",
  ].join("\n");
}

export function waSavedAfterPaymentMessage(orderCode: string): string {
  return [
    "<b>Nomor WhatsApp tersimpan</b>",
    "",
    `<code>${escapeHtml(orderCode)}</code>`,
    "",
    "Pembayaran sudah lunas. Admin akan menghubungimu untuk pengiriman.",
  ].join("\n");
}

export function invalidWhatsAppMessage(): string {
  return [
    "<b>Nomor WhatsApp tidak valid</b>",
    "",
    "Format: 08xxx / +628xxx (10-15 digit)",
    "Contoh: <code>08123456789</code>",
    "",
    "Coba lagi atau ketik /katalog untuk batal.",
  ].join("\n");
}

export function qrisExpiredMessage(orderCode: string): string {
  return ["<b>QRIS kedaluwarsa</b>", "", `<code>${escapeHtml(orderCode)}</code>`, "",
    "QRIS pertama sudah hangus setelah 15 menit. Jangan bayar QRIS lama.",
    "Kamu dapat meminta QRIS baru 1 kali lewat tombol di bawah selama pesanan masih aktif.",
    "Jika QRIS pengganti juga tidak dibayar sampai batas waktunya, pesanan kedaluwarsa dan harus order ulang.",
  ].join("\n");
}
