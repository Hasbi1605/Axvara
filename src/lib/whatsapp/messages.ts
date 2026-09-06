// src/lib/whatsapp/messages.ts — WhatsApp message templates (plain text + *bold*)
// Uses WhatsApp formatting: *bold*, _italic_, ~strikethrough~, ```monospace```

import { type VariantSummary, formatWarranty, formatRupiah } from "@/lib/catalog";
import { SITE, adminTelegramLink } from "@/lib/site";
import { formatWarrantyWhatsApp } from "@/lib/warranty-policy";

export function formatWIBTime(): { greeting: string; tanggal: string; jam: string } {
  const d = new Date();
  const wibOffset = 7 * 60; // WIB is UTC+7
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const wibDate = new Date(utc + wibOffset * 60000);

  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  const day = wibDate.getDate();
  const month = months[wibDate.getMonth()];
  const year = wibDate.getFullYear();

  const hours = String(wibDate.getHours()).padStart(2, "0");
  const minutes = String(wibDate.getMinutes()).padStart(2, "0");
  const seconds = String(wibDate.getSeconds()).padStart(2, "0");

  const hourNum = wibDate.getHours();
  let greeting = "Selamat Malam 🌙";
  if (hourNum >= 4 && hourNum < 11) greeting = "Selamat Pagi ☀️";
  else if (hourNum >= 11 && hourNum < 15) greeting = "Selamat Siang 🌤️";
  else if (hourNum >= 15 && hourNum < 18) greeting = "Selamat Sore ⛅";

  return {
    greeting,
    tanggal: `${day} ${month} ${year}`,
    jam: `${hours}:${minutes}:${seconds} WIB`,
  };
}

export type WhatsAppProductLabel = { name: string; whatsappAlias?: string | null };

export type WhatsAppPaymentMethod = "QRIS" | "SEABANK" | "EWALLET";

/** A CMS alias is presentation-only; blank always falls back to the web name. */
export function getWhatsAppDisplayName(product: WhatsAppProductLabel): string {
  return (product.whatsappAlias?.trim() || product.name.trim()).toUpperCase();
}

export function listProductsMessage(products: WhatsAppProductLabel[]): string {
  const { greeting, tanggal, jam } = formatWIBTime();

  // Related products may deliberately share one WhatsApp display alias.
  const uniqueBrands = Array.from(
    new Set(products.map(getWhatsAppDisplayName))
  ).sort((a, b) => a.localeCompare(b));

  const lines = [
    "「 *LIST MENU AXVARA* 」",
    "彡.〰️〰️〰️〰️〰️.彡",
    `⊱┊ ${greeting}`,
    `⊱┊ Tanggal : ${tanggal}`,
    `⊱┊ Jam : ${jam}`,
    "┈┈┈┈┈┈┈┈┈┈",
    "",
  ];

  uniqueBrands.forEach((brand) => {
    lines.push(`꧁ঔৣ★ ${brand}`);
  });

  lines.push("");
  lines.push("Ketik nama produk untuk melihat pilihan varian.");
  lines.push("Ketik *garansi* untuk membaca ketentuan.");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("*Belanja & update produk AXVARA:*");
  lines.push(`✈️ Telegram: ${adminTelegramLink()}`);
  lines.push(`🌐 Website: ${SITE.webUrl}`);

  return lines.join("\n");
}

export function productDetailMessage(productName: string, _description: string | null, variants: VariantSummary[]): string {
  const lines = [
    "━━━━━━━━━━━━━━━━━━━━",
    `*${productName.toUpperCase()}*`,
    "━━━━━━━━━━━━━━━━━━━━",
    "",
  ];

  variants.forEach((v, i) => {
    const num = i + 1;
    const war = formatWarranty(v);
    lines.push(`${num}. *${v.label}*`);
    lines.push(`   🛡 ${war || "Tanpa Garansi"}`);
    lines.push(`   「 *${formatRupiah(v.price)}* 」`);
    if (v.stock === 0) lines.push("   ❌ *HABIS*");
    lines.push("");
  });

  const available = variants.filter(v => v.stock !== 0);
  if (available.length > 0) {
    lines.push("┈┈┈┈┈┈┈┈┈┈");
    lines.push(`Balas dengan angka *1-${variants.length}* untuk memilih.`);
  } else {
    lines.push("Semua varian sedang habis.");
  }

  return lines.join("\n");
}

export function variantSelectedMessage(productName: string, variant: VariantSummary): string {
  const war = formatWarranty(variant);
  const lines = [
    "━━━━━━━━━━━━━━━━━━━━",
    "*VARIAN DIPILIH*",
    "━━━━━━━━━━━━━━━━━━━━",
    `${productName.toUpperCase()} — *${variant.label}*`,
  ];
  lines.push(`🛡 ${war || "Tanpa Garansi"}`);
  lines.push(`「 *${formatRupiah(variant.price)}* 」`);
  lines.push("");
  lines.push("Pilih pembayaran dengan mengetik:");
  lines.push("*QRIS* · *SEABANK* · *EWALLET*");
  return lines.join("\n");
}

export function paymentChoiceMessage(): string {
  return [
    "━━━━━━━━━━━━━━━━━━━━",
    "*PILIH PEMBAYARAN*",
    "━━━━━━━━━━━━━━━━━━━━",
    "Ketik salah satu metode berikut:",
    "",
    "• *QRIS* — scan kode QR",
    "• *SEABANK* — transfer bank",
    "• *EWALLET* — transfer dompet digital",
  ].join("\n");
}

export function paymentMessage(params: {
  orderCode: string;
  productName: string;
  variantLabel: string;
  duration: string;
  warranty: string;
  total: number;
  method: WhatsAppPaymentMethod;
  qrisUrl?: string;
  seabankAccount?: string;
  seabankName?: string;
  ewalletAccount?: string;
  ewalletName?: string;
}): string {
  const lines = [
    "━━━━━━━━━━━━━━━━━━━━",
    "*PEMBAYARAN AXVARA*",
    "━━━━━━━━━━━━━━━━━━━━",
    `🛍 ${params.productName.toUpperCase()} — *${params.variantLabel}*`,
  ];
  if (params.warranty) {
    lines.push(`🛡 ${params.warranty}`);
  }
  lines.push(`💰 Total: *${formatRupiah(params.total)}*`);
  lines.push(`💳 Metode: *${params.method}*`);
  lines.push("");

  if (params.method === "QRIS") {
    lines.push("Scan gambar QRIS yang dikirim setelah pesan ini.");
    lines.push("Bayar tepat sesuai total; status lunas terdeteksi otomatis.");
    lines.push("Screenshot opsional. Jika dikirim, cukup beri caption *QRIS*.");
  }

  if (params.method === "SEABANK" && params.seabankAccount && params.seabankName) {
    lines.push(`No. rekening: ${params.seabankAccount}`);
    lines.push(`Atas nama: ${params.seabankName}`);
  }

  if (params.method === "EWALLET" && params.ewalletAccount && params.ewalletName) {
    lines.push(`Nomor: ${params.ewalletAccount}`);
    lines.push(`Atas nama: ${params.ewalletName}`);
  }

  lines.push("");
  if (params.method !== "QRIS") {
    lines.push("Transfer tepat sesuai total, lalu kirim screenshot bukti");
    lines.push(`dengan caption *${params.method}*. Tidak perlu mengetik kode pesanan.`);
  }
  lines.push(`_Referensi otomatis: ${params.orderCode}_`);

  return lines.join("\n");
}

export function proofAcknowledgementMessage(orderCode: string): string {
  return [
    `Bukti pembayaran untuk ${orderCode} sudah diterima.`,
    "Status: menunggu verifikasi.",
    "Bukti tidak otomatis berarti pembayaran sudah sah.",
  ].join("\n");
}

export function warrantyMessage(): string {
  return formatWarrantyWhatsApp();
}

// Error responses
export function notFoundMessage(): string {
  return "Produk tidak ditemukan. Ketik *list* untuk melihat produk.";
}

export function ambiguousMessage(candidates: string[]): string {
  const lines = ["Beberapa produk cocok:", ""];
  candidates.forEach(c => lines.push(`• ${c}`));
  lines.push("");
  lines.push("Ketik nama yang lebih spesifik.");
  return lines.join("\n");
}

export function sessionExpiredMessage(): string {
  return "Sesi sudah kedaluwarsa. Ketik nama produk lagi untuk memilih.";
}

export function noSelectionMessage(): string {
  return "Belum ada varian yang dipilih. Ketik nama produk dan pilih angka terlebih dahulu.";
}

export function variantUnavailableMessage(): string {
  return "Varian ini baru saja tidak tersedia. Ketik nama produk untuk melihat pilihan terbaru.";
}

export function proofFormatErrorMessage(orderCode: string): string {
  return [
    "Bukti belum dapat dikenali. Kirim ulang foto/screenshot dengan caption:",
    "",
    "*QRIS*, *SEABANK*, atau *EWALLET*.",
    `Referensi aktif: ${orderCode}`,
  ].join("\n");
}

export function proofWrongOwnerMessage(): string {
  return "Bukti ini tidak dapat diproses untuk pesanan Anda.";
}

export function proofDuplicateMessage(orderCode: string): string {
  return `Bukti untuk ${orderCode} sudah diterima sebelumnya. Menunggu verifikasi.`;
}

export function gatewayErrorMessage(): string {
  return "Terjadi kesalahan. Silakan coba lagi dalam beberapa saat.";
}

export function paymentDetectedMessage(params: {
  orderCode: string;
  productName?: string;
  variantLabel?: string;
  total?: number;
  method?: string;
}): string {
  const lines = [
    "🎊🎉 *PEMBAYARAN BERHASIL!* 🎉🎊",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    `✅ Order: *${params.orderCode}*`,
  ];
  if (params.productName) {
    lines.push(`🛍 ${params.productName}${params.variantLabel ? ` — *${params.variantLabel}*` : ""}`);
  }
  if (params.total) {
    lines.push(`💰 Total: *${formatRupiah(params.total)}*`);
  }
  if (params.method) {
    lines.push(`💳 Via: *${params.method}*`);
  }
  lines.push("");
  lines.push("🚀 Pesanan kamu sedang diproses, ditunggu ya!");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("💎 Terima kasih sudah belanja di *AXVARA*!");
  lines.push(`🌐 ${SITE.webUrl}`);
  lines.push(`✈️ ${adminTelegramLink()}`);
  return lines.join("\n");
}

// ---- Admin .d command: order completed ----

export function orderCompletedMessage(params: {
  orderCode: string;
  productName?: string;
  variantLabel?: string;
  total?: number;
}): string {
  const lines = [
    "✅🎉 *PESANAN SELESAI!* 🎉✅",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 Order *${params.orderCode}* telah berhasil diproses admin!`,
  ];
  if (params.productName) {
    lines.push(`🛍 ${params.productName}${params.variantLabel ? ` — *${params.variantLabel}*` : ""}`);
  }
  if (params.total) {
    lines.push(`💰 ${formatRupiah(params.total)}`);
  }
  lines.push("");
  lines.push("💎 Terima kasih sudah belanja di *AXVARA*!");
  lines.push("Jangan lupa order lagi ya! 🔥🔥🔥");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("🛒 Ketik *list* untuk lihat produk terbaru");
  lines.push(`🌐 ${SITE.webUrl}`);
  lines.push(`✈️ ${adminTelegramLink()}`);
  return lines.join("\n");
}

export function orderAlreadyProcessedMessage(orderCode: string): string {
  return `Pesanan *${orderCode}* sudah diproses sebelumnya.`;
}

export function adminDoneNoOrderMessage(): string {
  return [
    "⚠️ Tidak dapat menemukan kode pesanan.",
    "",
    "Cara pakai: reply pesan pembayaran dengan *.d*",
    "Atau ketik: *.d AXV-XXXXXXXX*",
  ].join("\n");
}

// ---- Welcome message for new group members ----

export function welcomeNewMemberMessage(name?: string): string {
  const { greeting } = formatWIBTime();
  const displayName = name?.trim() || "Kak";
  const lines = [
    "━━━━━━━━━━━━━━━━━━━━",
    "🎉 *SELAMAT DATANG DI AXVARA!* 🎉",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    `${greeting}, *${displayName}*! 👋`,
    "",
    "Selamat bergabung di grup official *AXVARA* 💎",
    "Gerbang semua tools premium favoritmu! 🚀",
    "",
    "🛒 *Cara Order:*",
    "Ketik *list* untuk lihat semua produk.",
    "",
    "🛡 *Garansi:*",
    "Ketik *garansi* untuk baca ketentuan.",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "*Belanja & update produk AXVARA:*",
    `🌐 ${SITE.webUrl}`,
    `✈️ ${adminTelegramLink()}`,
  ];
  return lines.join("\n");
}
