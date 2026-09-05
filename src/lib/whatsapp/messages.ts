// src/lib/whatsapp/messages.ts — WhatsApp message templates (plain text + *bold*)
// Uses WhatsApp formatting: *bold*, _italic_, ~strikethrough~, ```monospace```

import { type VariantSummary, formatDuration, formatWarranty, formatRupiah } from "@/lib/catalog";
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

export function simplifyBrandName(name: string): string {
  const map: Record<string, string> = {
    "ai gateway 1 juta token": "AI GATEWAY",
    "ai gateway 5 juta token": "AI GATEWAY",
    "ai gateway 10 juta token": "AI GATEWAY",
    "adobe cc all apps 1 bulan": "ADOBE",
    "bundle ai master": "BUNDLE AI MASTER",
    "bundle creator 3-in-1": "BUNDLE CREATOR",
    "bundle productivity": "BUNDLE PRODUCTIVITY",
    "bundle streaming hemat": "BUNDLE STREAMING",
    "canva pro 1 tahun": "CANVA",
    "capcut pro 1 bulan": "CAPCUT",
    "chatgpt plus 1 bulan": "CHATGPT",
    "claude pro 1 bulan": "CLAUDE",
    "cursor pro 1 bulan": "CURSOR",
    "figma professional 1 bulan": "FIGMA",
    "gemini advanced 1 bulan": "GEMINI",
    "grammarly premium 1 tahun": "GRAMMARLY",
    "microsoft 365 family 1 tahun": "MICROSOFT 365",
    "midjourney basic 1 bulan": "MIDJOURNEY",
    "netflix premium 1 bulan": "NETFLIX",
    "notion plus 1 tahun": "NOTION",
    "perplexity pro 1 tahun": "PERPLEXITY",
    "spotify premium 1 bulan": "SPOTIFY",
    "vpn premium 1 tahun": "VPN",
    "youtube premium 1 bulan": "YOUTUBE",
  };

  const key = name.toLowerCase().trim();
  if (map[key]) return map[key];

  return name
    .replace(/\s+\d+\s+(Bulan|Tahun|Hari|Juta Token|jt token).*$/i, "")
    .replace(/\s+(Pro|Plus|Premium|Advanced|Professional|Basic|CC All Apps|Family)\s*$/i, "")
    .trim()
    .toUpperCase();
}

export function listProductsMessage(products: { name: string }[]): string {
  const { greeting, tanggal, jam } = formatWIBTime();

  // Extract unique clean brand names
  const uniqueBrands = Array.from(
    new Set(products.map((p) => simplifyBrandName(p.name)))
  ).sort((a, b) => a.localeCompare(b));

  const lines = [
    "「 *LIST MENU STORE* 」",
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

  return lines.join("\n");
}

export function productDetailMessage(productName: string, description: string | null, variants: VariantSummary[]): string {
  const lines = [
    `*${productName.toUpperCase()}*`,
  ];
  if (description) {
    lines.push(description.length > 200 ? description.slice(0, 197) + "..." : description);
  }
  lines.push("");

  variants.forEach((v, i) => {
    const num = i + 1;
    lines.push(`${num}. ${v.label}`);
    const dur = formatDuration(v);
    if (dur) lines.push(`   Durasi: ${dur}`);
    const war = formatWarranty(v);
    if (war) lines.push(`   Garansi: ${war}`);
    lines.push(`   Harga: ${formatRupiah(v.price)}`);
    if (v.stock === 0) lines.push(`   ❌ HABIS`);
    lines.push("");
  });

  const available = variants.filter(v => v.stock !== 0);
  if (available.length > 0) {
    lines.push(`Balas pesan ini dengan angka 1-${variants.length} untuk memilih.`);
  } else {
    lines.push("Semua varian sedang habis.");
  }

  return lines.join("\n");
}

export function variantSelectedMessage(productName: string, variant: VariantSummary): string {
  const dur = formatDuration(variant);
  const war = formatWarranty(variant);
  const lines = [
    "*VARIAN DIPILIH*",
    `${productName} — ${variant.label}`,
  ];
  if (dur) lines.push(`${dur}${war ? ` · Garansi ${war}` : ""}`);
  else if (war) lines.push(`Garansi ${war}`);
  lines.push(formatRupiah(variant.price));
  lines.push("");
  lines.push("Balas pesan ini dengan *pay* atau *payment*");
  lines.push("untuk membuat order dan melihat metode pembayaran.");
  return lines.join("\n");
}

export function paymentMessage(params: {
  orderCode: string;
  productName: string;
  variantLabel: string;
  duration: string;
  warranty: string;
  total: number;
  qrisUrl?: string;
  seabankAccount?: string;
  seabankName?: string;
  ewalletAccount?: string;
  ewalletName?: string;
}): string {
  const lines = [
    "*PEMBAYARAN AXVARA*",
    `Order: ${params.orderCode}`,
    `Produk: ${params.productName} — ${params.variantLabel}`,
  ];
  if (params.duration) lines.push(`Durasi: ${params.duration}`);
  if (params.warranty) lines.push(`Garansi: ${params.warranty}`);
  lines.push(`Total: ${formatRupiah(params.total)}`);
  lines.push("");

  if (params.qrisUrl) {
    lines.push("*QRIS*");
    lines.push("Scan gambar QRIS yang dikirim bot.");
    lines.push("");
  }

  if (params.seabankAccount && params.seabankName) {
    lines.push("*SEABANK*");
    lines.push(`No. rekening: ${params.seabankAccount}`);
    lines.push(`Atas nama: ${params.seabankName}`);
    lines.push("");
  }

  if (params.ewalletAccount && params.ewalletName) {
    lines.push("*E-WALLET*");
    lines.push(`Nomor: ${params.ewalletAccount}`);
    lines.push(`Atas nama: ${params.ewalletName}`);
    lines.push("");
  }

  lines.push("Transfer tepat sesuai total.");
  lines.push("");
  lines.push("*BUKTI PEMBAYARAN WAJIB*");
  lines.push("Balas/reply pesan ini dengan foto atau screenshot bukti.");
  lines.push(`Caption: BUKTI ${params.orderCode} SEABANK`);
  lines.push("Ganti metode menjadi QRIS, SEABANK, atau EWALLET.");
  lines.push("");
  lines.push("Bukti terlihat oleh anggota grup. Potong/sensor saldo,");
  lines.push("transaksi lain, alamat, dan data pribadi yang tidak diperlukan.");

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
    "Format bukti tidak sesuai. Kirim ulang dengan benar:",
    "",
    "1. Reply pesan pembayaran bot",
    "2. Kirim 1 foto/screenshot bukti",
    `3. Caption: BUKTI ${orderCode} QRIS`,
    "   (ganti QRIS menjadi SEABANK atau EWALLET)",
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

export function paymentDetectedMessage(orderCode: string): string {
  return [
    `Pembayaran QRIS untuk ${orderCode} terdeteksi.`,
    "Kirim foto bukti pembayaran sebagai balasan pada pesan pembayaran untuk melengkapi proses.",
  ].join("\n");
}
