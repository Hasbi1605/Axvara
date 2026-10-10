// src/lib/telegram/messages/status.ts — Copy status order, pengiriman, & error.
//
// MENGAPA dipisah: pesan pasca-order (lunas, kirim kredensial, kedaluwarsa,
// dibatalkan, status, input WA, serta pesan error/stok pendek) membentuk satu
// kelompok "state setelah invoice". Memisahkannya dari copy pembelian membuat
// jelas mana teks yang tampil SEBELUM vs SESUDAH uang masuk. Pemindahan murni.

import { escapeHtml, formatRupiah, truncate } from "./format";
import { SITE } from "@/lib/site";

/**
 * Cara produk sampai ke pembeli Telegram, per order (2026-10-04, paritas Web):
 * - `instant`: semua baris kirim otomatis (stok sendiri shared/unique, WR
 *   restock, SK auto) → detail dikirim otomatis ke chat ini dalam hitungan
 *   detik–menit.
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
  const name = escapeHtml(truncate(productName, 100));
  const deliveryLines = delivery === "instant"
    ? [
        "⚡ Produk dikirim otomatis ke chat ini dalam beberapa saat — tidak perlu balas apa pun.",
        "📦 Belum masuk? Tekan <b>Ambil Detail Produk</b> di bawah.",
      ]
    : delivery === "queued"
      ? [
          "⏳ <b>Made By Order</b> — pesananmu sedang dikerjakan sesuai antrean, umumnya lebih cepat, maksimal 12 jam pada jam layanan.",
          "📩 Detail produk dikirim <b>otomatis ke chat ini</b> begitu siap. Tidak perlu membuka chat terus — kamu akan dapat notifikasi.",
          "📦 Bisa juga cek kapan saja lewat tombol <b>Ambil Detail Produk</b>.",
        ]
      : ["📩 Produk akan dikirim admin melalui DM Telegram pribadi ini."];
  const lines = [
    "🎉 <b>Pembayaran Berhasil!</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${name}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    "",
    "✅ Dana sudah diterima dan terverifikasi otomatis.",
    ...deliveryLines,
  ];
  if (needsWhatsApp) {
    lines.push(
      "",
      "📱 <i>Untuk jaga-jaga:</i> balas chat ini dengan nomor WhatsApp aktif sebagai jalur pengiriman cadangan.",
      "Contoh: <code>08123456789</code>",
    );
  }
  lines.push(
    "",
    "Butuh bantuan?",
    // 2026-10-10: WA via hub /wa (pilih nomor aktif) — bukan wa.me langsung.
    `📞 WhatsApp Admin: ${SITE.webUrl}/wa`,
    `✈️ Telegram Support: @${SITE.supportTelegram}`,
  );
  return lines.join("\n");
}

export function deliveryMessage(secret: string): string {
  return [
    "🎁 <b>Produk Siap!</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "Detail akses/lisensi kamu:",
    "",
    `<code>${escapeHtml(secret)}</code>`,
    "",
    "👆 <i>Tap untuk copy</i>",
    "",
    "━━━━━━━━━━━━━━━━━━━━━",
    "🔒 Simpan baik-baik, jangan dibagikan",
    "🛡 Garansi aktif sesuai deskripsi produk. Simpan invoice untuk klaim. Refund tidak berlaku, hanya penggantian. /garansi",
    "❓ Ada kendala? Ketik /bantuan",
  ].join("\n");
}

/**
 * Detail produk hasil auto-order (WR/SK) ke chat pribadi pembeli Telegram.
 * Satu template untuk dua sumber agar pembeli melihat format yang sama
 * dengan produk stok sendiri (`deliveryMessage`) + nama produk + kode order.
 */
export function supplierCredentialMessage(orderCode: string, productName: string, plaintext: string): string {
  return [
    "🎁 <b>Produk Siap!</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${escapeHtml(truncate(productName, 120))}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    "",
    "Detail akses/lisensi kamu:",
    "",
    `<pre>${escapeHtml(plaintext)}</pre>`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━",
    "🔒 Simpan baik-baik, jangan dibagikan",
    "🛡 Garansi mengikuti ketentuan produk. Simpan invoice untuk klaim. /garansi",
    "❓ Ada kendala? Ketik /bantuan",
  ].join("\n");
}

export function whatsAppInputPromptMessage(orderCode: string): string {
  return [
    "📱 <b>Nomor WhatsApp Pengiriman</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    "",
    "Pembayaran sudah lunas. Balas chat ini dengan nomor WhatsApp aktif agar admin dapat mengirim produk.",
    "",
    "Contoh: <code>08123456789</code>",
    "",
    // 2026-10-10: WA via hub /wa (pilih nomor aktif) — bukan wa.me langsung.
    `📞 WhatsApp Admin: ${SITE.webUrl}/wa`,
    `✈️ Telegram Support: @${SITE.supportTelegram}`,
  ].join("\n");
}

export function orderExpiredMessage(orderCode: string): string {
  return [
    "⏰ <b>Invoice Kedaluwarsa</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    "",
    "Batas waktu pembayaran sudah habis.",
    "Buat pesanan baru dari /katalog",
  ].join("\n");
}

export function orderCancelledMessage(orderCode: string): string {
  return [
    "❌ <b>Pesanan Dibatalkan</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    "",
    "Pesanan berhasil dibatalkan.",
    "Buat pesanan baru dari /katalog",
  ].join("\n");
}

export function orderStatusMessage(params: {
  orderCode: string;
  productName: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  payableAmount?: number;
}): string {
  const { orderCode, productName, paymentStatus, fulfillmentStatus, payableAmount } = params;
  const name = escapeHtml(truncate(productName, 100));

  const paymentLabel: Record<string, string> = {
    unpaid: "⏳ Menunggu bayar",
    pending: "⏳ Menunggu bayar",
    paid: "✅ Lunas",
    expired: "⏰ Kedaluwarsa",
    failed: "❌ Gagal",
  };

  const fulfillLabel: Record<string, string> = {
    not_required: "",
    reserved: "🔒 Disiapkan",
    queued: "📤 Dalam antrian",
    sending: "📤 Mengirim...",
    delivered: "✅ Terkirim",
    manual_required: "👤 Proses admin",
    retry: "🔄 Mengulangi",
    failed: "❌ Gagal kirim",
  };

  const lines = [
    "📋 <b>Status Pesanan</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${name}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
  ];

  if (payableAmount) lines.push(`💰 ${formatRupiah(payableAmount)}`);
  lines.push("");
  lines.push(paymentLabel[paymentStatus] ?? `❓ ${paymentStatus}`);
  const fl = fulfillLabel[fulfillmentStatus];
  if (fl) lines.push(fl);

  return lines.join("\n");
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
      "ℹ️ <b>QRIS Kamu Masih Berlaku</b>",
      "",
      "Pakai QR yang sudah dikirim di atas ya — nominalnya masih aktif.",
    ].join("\n");
  }
  if (reason === "reissue_limit_reached") {
    return [
      "⌛ <b>Batas Perpanjangan Habis</b>",
      "",
      "QRIS pesanan ini sudah diperpanjang maksimal 1 kali.",
      "Silakan buat pesanan baru lewat /katalog.",
    ].join("\n");
  }
  if (reason === "amount_unavailable") {
    return [
      "⏳ <b>Sedang Ramai</b>",
      "",
      "Nominal unik untuk harga ini sedang penuh. Coba lagi beberapa saat.",
    ].join("\n");
  }
  return [
    "❌ <b>Pesanan Tidak Bisa Diperpanjang</b>",
    "",
    "Pesanan ini sudah lunas, dibatalkan, atau kedaluwarsa.",
    "Buat pesanan baru lewat /katalog ya.",
  ].join("\n");
}

export function outOfStockMessage(): string {  return [
    "❌ <b>Stok Habis</b>",
    "",
    "Maaf, produk ini sedang tidak tersedia.",
    "Cek produk lain di /katalog",
  ].join("\n");
}

export function alreadyPendingMessage(orderCode: string): string {
  return [
    "⚠️ <b>Pesanan Aktif</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "Kamu masih punya pesanan untuk produk ini.",
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    "",
    "Bayar atau batalkan dulu sebelum order baru.",
  ].join("\n");
}

export function errorMessage(): string {
  return [
    "⚠️ <b>Terjadi Kesalahan</b>",
    "",
    "Silakan coba lagi.",
    "Kalau terus gagal, hubungi /bantuan",
  ].join("\n");
}

export function waSavedAfterPaymentMessage(orderCode: string): string {
  return [
    "✅ <b>Nomor WA Tersimpan</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    "",
    "Pembayaran sudah lunas dan admin akan menghubungimu untuk pengiriman. 🙏",
  ].join("\n");
}

export function invalidWhatsAppMessage(): string {
  return [
    "❌ <b>Nomor WA Tidak Valid</b>",
    "",
    "Format: 08xxx / +628xxx (10-15 digit)",
    "Contoh: <code>08123456789</code>",
    "",
    "Coba lagi atau ketik /katalog untuk batal.",
  ].join("\n");
}

export function qrisExpiredMessage(orderCode: string): string {
  return ["⏰ <b>QRIS Kedaluwarsa</b>", "", `<code>${escapeHtml(orderCode)}</code>`, "",
    "QRIS pertama sudah hangus setelah 15 menit. Jangan bayar QRIS lama.",
    "Kamu dapat meminta QRIS baru 1 kali lewat tombol di bawah selama pesanan masih aktif.",
    "Jika QRIS pengganti juga tidak dibayar sampai batas waktunya, pesanan kedaluwarsa dan harus order ulang.",
  ].join("\n");
}
