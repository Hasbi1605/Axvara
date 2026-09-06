// src/lib/telegram/messages.ts — Premium UX copy, Bahasa Indonesia + HTML escaping
// Patterns adopted from top Telegram shop bots:
// - Visual hierarchy with separators (━━━)
// - Consistent emoji language (not spam)
// - Monospace <code> for copyable data (order codes, secrets)
// - Progress indicators for multi-step flows
// - Short, scannable lines — mobile-first (95% users)

import { formatWarrantyTermsTelegram, formatWarrantyClaimsTelegram } from "@/lib/warranty-policy";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatRupiah(amount: number): string {
  return `Rp${amount.toLocaleString("id-ID")}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WIB TIME (ported from WhatsApp for interactive copy)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

  const hourNum = wibDate.getHours();
  let greeting = "Selamat Malam 🌙";
  if (hourNum >= 4 && hourNum < 11) greeting = "Selamat Pagi ☀️";
  else if (hourNum >= 11 && hourNum < 15) greeting = "Selamat Siang 🌤️";
  else if (hourNum >= 15 && hourNum < 18) greeting = "Selamat Sore ⛅";

  return {
    greeting,
    tanggal: `${day} ${month} ${year}`,
    jam: `${hours}:${minutes} WIB`,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WELCOME & NAVIGATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function welcomeMessage(firstName: string): string {
  const name = escapeHtml(truncate(firstName, 50));
  const { greeting, tanggal, jam } = formatWIBTime();
  return [
    `🎯 <b>Halo, ${name}!</b>`,
    `${greeting} 👋`,
    "",
    "Selamat datang di <b>AXVARA</b> 💎",
    "Gerbang semua tools premium favoritmu! 🚀",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📅 ${tanggal} • 🕐 ${jam}`,
    "",
    "🛍 Tools AI &amp; aplikasi premium",
    "💰 Harga jauh lebih hemat dari official",
    "✅ Bergaransi &amp; support admin",
    "⚡ Order 1 menit, bayar QRIS otomatis",
    "",
    "Pilih menu di bawah 👇",
  ].join("\n");
}

export function catalogFlatMessage(total: number): string {
  const { greeting, tanggal, jam } = formatWIBTime();
  return [
    "🛍 <b>Katalog AXVARA</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `${greeting}! 👋`,
    `📅 ${tanggal} • 🕐 ${jam}`,
    "",
    total > 0
      ? `${total} produk tersedia — langsung tap nama produk 👇`
      : "Katalog sedang kosong. Coba lagi nanti 🙏",
  ].join("\n");
}

export function categoriesMessage(): string {
  return [
    "📦 <b>Katalog AXVARA</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "Pilih kategori untuk melihat produk:",
  ].join("\n");
}

export function categoryProductsMessage(categoryName: string, total: number): string {
  const name = escapeHtml(truncate(categoryName, 50));
  return [
    `📂 <b>${name}</b>`,
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `${total} produk tersedia`,
    "Tap produk untuk lihat detail 👇",
  ].join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PRODUCT DETAIL (no description — warranty synced with web/WA via variants)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type TelegramVariantLine = {
  label: string;
  price: number;
  warranty?: string | null;
  duration?: string | null;
  stock?: number | null;
};

export function productDetailMessage(product: {
  name: string;
  /** @deprecated — kept for backward compat, never rendered (Telegram shows no description, like WA) */
  description?: string | null;
  price: number;
  compare_price?: number | null;
  stock?: number | null;
  badge?: string | null;
  variants?: TelegramVariantLine[] | null;
}): string {
  const name = escapeHtml(truncate(product.name, 100));
  const price = formatRupiah(product.price);

  const lines: string[] = [];

  // Header
  lines.push(`<b>${name}</b>`);
  if (product.badge) {
    const badgeEmoji: Record<string, string> = {
      "Terlaris": "🔥", "Baru": "✨", "Hemat 92%": "💎", "Hemat": "💎",
      "Bundle": "📦", "Ultimate": "👑", "Enterprise": "🏢",
    };
    lines.push(`${badgeEmoji[product.badge] ?? "🏷"} ${escapeHtml(product.badge)}`);
  }
  lines.push("━━━━━━━━━━━━━━━━━━━━━");

  // NOTE: description intentionally never rendered (WA parity, avoids truncation).

  // Price block
  lines.push("");
  if (product.compare_price && product.compare_price > product.price) {
    const discount = Math.round((1 - product.price / product.compare_price) * 100);
    lines.push(`💰 <b>${price}</b>  <s>${formatRupiah(product.compare_price)}</s>`);
    lines.push(`🎉 Hemat ${discount}%`);
  } else if (product.variants && product.variants.length > 1) {
    lines.push(`💰 Mulai <b>${price}</b>`);
  } else {
    lines.push(`💰 <b>${price}</b>`);
  }

  // Stock
  const stock = product.stock ?? -1;
  if (stock === -1) {
    lines.push("📦 Stok tersedia");
  } else if (stock > 10) {
    lines.push(`📦 Stok: ${stock}`);
  } else if (stock > 0) {
    lines.push(`📦 ⚡ Sisa ${stock} — segera order!`);
  } else {
    lines.push("📦 ❌ Stok habis");
  }

  // Variant warranty list — synced with web/WA (same product_variants source).
  // Capped so photo captions stay under Telegram's 1024-char limit.
  if (product.variants && product.variants.length > 0) {
    lines.push("");
    lines.push("🎁 <b>Pilihan Varian:</b>");
    product.variants.slice(0, 6).forEach((v, i) => {
      const num = i + 1;
      const war = v.warranty?.trim() || "Tanpa Garansi";
      const dur = v.duration?.trim() ? ` • ${escapeHtml(v.duration.trim())}` : "";
      const out = v.stock === 0 ? " ❌ <i>HABIS</i>" : "";
      lines.push(`${num}. <b>${escapeHtml(truncate(v.label, 60))}</b>${dur}${out}`);
      lines.push(`   🛡 ${escapeHtml(war)} • ${formatRupiah(v.price)}`);
    });
    if (product.variants.length > 6) {
      lines.push(`   <i>+${product.variants.length - 6} varian lain — tap Beli untuk lihat semua</i>`);
    }
  }

  // Warranty pointer — per-variant above, detail via /garansi
  lines.push("");
  lines.push("🛡 Garansi mengikuti varian yang dipilih. Ketik /garansi.");

  return lines.join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PURCHASE FLOW
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function confirmVariantBuyMessage(params: {
  productName: string;
  variantLabel: string;
  duration?: string | null;
  warranty?: string | null;
  price: number;
  qty?: number;
}): string {
  const { productName, variantLabel, duration, warranty, price, qty } = params;
  const name = escapeHtml(truncate(productName, 100));
  const quantity = Math.max(1, Math.min(20, Math.floor(qty ?? 1)));
  const total = price * quantity;
  const lines = [
    "🛒 <b>Konfirmasi Pembelian</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 <b>${name}</b>`,
    `🏷 Varian: ${escapeHtml(variantLabel)}`,
  ];
  if (duration) lines.push(`⏱ Durasi: ${escapeHtml(duration)}`);
  if (warranty) lines.push(`🛡 Garansi: ${escapeHtml(warranty)}`);
  lines.push(`💰 Harga satuan: ${formatRupiah(price)}`);
  lines.push(`📊 Qty: ${quantity}`);
  lines.push(`🧾 <b>Total: ${formatRupiah(total)}</b>`);
  lines.push("");
  lines.push("⚠️ <i>Total final bisa sedikit berbeda karena kode unik pembayaran.</i>");
  lines.push("");
  lines.push("🛡 <b>Third-party, bukan official.</b> Garansi ikut varian yang dipilih. Lanjut bayar = setuju ketentuan. /garansi untuk detail.");
  lines.push("");
  lines.push("Lanjutkan? 👇");
  return lines.join("\n");
}

export function chooseVariantMessage(productName: string): string {
  const name = escapeHtml(truncate(productName, 100));
  return [
    `📦 <b>Pilih Varian — ${name}</b>`,
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "Pilih varian yang sesuai kebutuhan kamu:",
  ].join("\n");
}

export function confirmBuyMessage(productName: string, price: number, qty = 1): string {
  const name = escapeHtml(truncate(productName, 100));
  const quantity = Math.max(1, Math.min(20, Math.floor(qty)));
  return [
    "🛒 <b>Konfirmasi Pembelian</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${name}`,
    `💰 Harga satuan: ${formatRupiah(price)}`,
    `📊 Qty: ${quantity}`,
    `🧾 <b>Total: ${formatRupiah(price * quantity)}</b>`,
    "",
    "⚠️ <i>Total final bisa sedikit berbeda karena kode unik pembayaran.</i>",
    "",
    "🛡 <b>Third-party, bukan official.</b> Garansi ikut varian yang dipilih. Lanjut bayar = setuju ketentuan. /garansi untuk detail.",
    "",
    "Lanjutkan? 👇",
  ].join("\n");
}

export function chooseQtyMessage(params: {
  productName: string;
  variantLabel: string;
  price: number;
  stock: number;
}): string {
  const { productName, variantLabel, price, stock } = params;
  const stockLine = stock === -1
    ? "📦 Stok tersedia — bisa bulk order"
    : stock > 0
      ? `📦 Stok: ${stock} — maksimal ${Math.min(stock, 20)} per order`
      : "📦 ❌ Stok habis";
  return [
    "📊 <b>Pilih Jumlah (Qty)</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 <b>${escapeHtml(truncate(productName, 80))}</b>`,
    `🏷 ${escapeHtml(truncate(variantLabel, 80))}`,
    `💰 ${formatRupiah(price)} /pcs`,
    stockLine,
    "",
    "Tap jumlah cepat di bawah, atau ketik angka 1–20 👇",
  ].join("\n");
}

export function paymentMethodMessage(params: {
  productName: string;
  variantLabel: string;
  qty: number;
  total: number;
}): string {
  const { productName, variantLabel, qty, total } = params;
  return [
    "💳 <b>Pilih Pembayaran</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 <b>${escapeHtml(truncate(productName, 80))}</b>`,
    `🏷 ${escapeHtml(truncate(variantLabel, 80))} × ${qty}`,
    `🧾 <b>Total: ${formatRupiah(total)}</b>`,
    "",
    "⚡ <b>QRIS</b> — scan sekali, lunas otomatis",
    "🏦 <b>SeaBank</b> — transfer manual + review admin",
    "👛 <b>E-Wallet</b> — DANA/Gopay/Shopeepay manual",
    "",
    "Pilih metode di bawah 👇",
  ].join("\n");
}

export function manualTransferMessage(params: {
  orderCode: string;
  productName: string;
  total: number;
  method: "seabank" | "ewallet";
  account: string;
  accountName: string;
}): string {
  const { orderCode, productName, total, method, account, accountName } = params;
  const label = method === "seabank" ? "SeaBank" : "E-Wallet (DANA/Gopay/Shopeepay)";
  return [
    `🏦 <b>Transfer ${label}</b>`,
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${escapeHtml(truncate(productName, 100))}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    `🧾 <b>Total transfer: ${formatRupiah(total)}</b>`,
    "",
    `No. tujuan: <code>${escapeHtml(account)}</code>`,
    `A.n: ${escapeHtml(accountName)}`,
    "",
    "1️⃣ Transfer <b>tepat</b> sesuai total",
    "2️⃣ Screenshot bukti transfer",
    "3️⃣ Kirim foto + caption kode pesanan di sini",
    "",
    "⏱ Order manual expired 24 jam. Admin verifikasi 5–15 menit.",
  ].join("\n");
}

export function invoiceMessage(params: {
  orderCode: string;
  productName: string;
  payableAmount: number;
  expiresAt: string;
  paymentMethod?: string;
}): string {
  const { orderCode, productName, payableAmount, expiresAt, paymentMethod } = params;
  const name = escapeHtml(truncate(productName, 100));
  const isQris = !paymentMethod || paymentMethod === "qris";
  let expiryText: string;
  try {
    const d = new Date(expiresAt);
    expiryText = d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
  } catch {
    expiryText = expiresAt;
  }

  return [
    "✅ <b>Invoice Berhasil Dibuat</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${name}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    "",
    `💳 <b>Total Bayar: ${formatRupiah(payableAmount)}</b>`,
    "",
    isQris ? "👆 Scan QRIS di atas untuk membayar" : "👆 Transfer sesuai nominal di atas",
    "",
    `⏰ Batas: ${expiryText}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━",
    "💡 Status otomatis update setelah bayar",
    "Tekan 🔄 untuk refresh manual",
  ].join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ORDER STATUS & DELIVERY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function orderPaidMessage(orderCode: string, productName: string): string {
  const name = escapeHtml(truncate(productName, 100));
  return [
    "🎉 <b>Pembayaran Diterima!</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${name}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    "",
    "⏳ Sedang diproses...",
    "💬 Perlu bantuan? Chat langsung @Axvara_bot lewat tombol di bawah.",
  ].join("\n");
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

export function manualFulfillmentBuyerMessage(orderCode: string): string {
  return [
    "✅ <b>Pembayaran Diterima!</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    "",
    "👤 Admin sedang menyiapkan produk kamu",
    "📱 Admin akan menghubungi kamu via WA",
    "💬 Kamu juga bisa chat langsung @Axvara_bot",
    "📬 Kamu juga akan dinotifikasi di sini saat siap",
    "",
    "⏱ Estimasi: 1×24 jam",
    "<i>(biasanya jauh lebih cepat)</i>",
    "",
    "🛡 Simpan kode pesanan untuk klaim. Garansi ikut deskripsi produk, hanya penggantian. /garansi",
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELP & INFO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function helpMessage(): string {
  const { greeting } = formatWIBTime();
  return [
    "❓ <b>Bantuan AXVARA</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `${greeting}! 👋 Ada yang bisa dibantu?`,
    "",
    "📌 <b>Perintah:</b>",
    "  /start — Menu utama",
    "  /katalog — Lihat produk",
    "  /pesanan &lt;kode&gt; — Cek status",
    "  /garansi — Ketentuan &amp; klaim garansi",
    "  /bantuan — Halaman ini",
    "",
    "🛒 <b>Cara beli (1 menit):</b>",
    "  1️⃣ Pilih produk langsung dari /katalog",
    "  2️⃣ Pilih varian + jumlah",
    "  3️⃣ Pilih QRIS / SeaBank / E-Wallet",
    "  4️⃣ Bayar sesuai total — QRIS lunas otomatis",
    "  5️⃣ Produk terkirim + notif di sini",
    "",
    "🛡 <b>AXVARA third-party, bukan official.</b> Garansi 1×24 jam–30 hari ikut varian tiap produk. Ketik /garansi.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━",
    "📞 <b>Admin:</b> wa.me/6289519388264",
    "✈️ <b>Telegram:</b> @Axvara_bot",
    "🌐 <b>Web:</b> axvara.tech",
  ].join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WARRANTY & CLAIMS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function warrantyTermsMessage(): string {
  return formatWarrantyTermsTelegram();
}

export function warrantyClaimMessage(): string {
  return formatWarrantyClaimsTelegram();
}

export function warrantyFullMessage(): string {
  return [warrantyTermsMessage(), "", warrantyClaimMessage()].join("\n");
}

export function myOrdersPrompt(): string {
  return [
    "📋 <b>Cek Pesanan</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "Ketik perintah berikut:",
    "<code>/pesanan AXV-XXXXXXXX-XXXXXXXX</code>",
    "",
    "👆 <i>Ganti dengan kode pesanan kamu</i>",
  ].join("\n");
}

export function outOfStockMessage(): string {
  return [
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

export function askWhatsAppMessage(productName: string): string {
  const name = escapeHtml(truncate(productName, 100));
  return [
    "📱 <b>Nomor WhatsApp Pengiriman</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `Produk: ${name}`,
    "",
    "✅ Invoice kamu <b>sudah terbit</b> — aman, tidak perlu bayar ulang.",
    "Produk ini dikirim <b>manual oleh admin</b>.",
    "Masukkan <b>nomor WA aktif</b> agar admin bisa menghubungi untuk pengiriman:",
    "",
    "Contoh: <code>08123456789</code>",
    "",
    "💡 <i>Ketik nomor WA lalu kirim — boleh juga tap Lewati</i>",
  ].join("\n");
}

export function waSavedAfterInvoiceMessage(orderCode: string): string {
  return [
    "✅ <b>Nomor WA Tersimpan</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    "",
    "Admin akan menghubungimu setelah pembayaran lunas 🙏",
    "Pantau status dengan tombol di bawah 👇",
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADMIN NOTIFICATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function adminOrderNotification(params: {
  orderCode: string;
  productName: string;
  amount: number;
  telegramUser: string;
  fulfillmentMode: string;
}): string {
  const { orderCode, productName, amount, telegramUser, fulfillmentMode } = params;
  const modeLabel: Record<string, string> = {
    manual: "👤 Manual", shared: "📝 Shared", unique: "🔑 Unique",
  };
  return [
    "🔔 <b>Order Baru — Telegram</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${escapeHtml(truncate(productName, 80))}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    `💰 ${formatRupiah(amount)}`,
    `👤 @${escapeHtml(telegramUser || "—")}`,
    `⚙️ ${modeLabel[fulfillmentMode] ?? fulfillmentMode}`,
    "",
    fulfillmentMode === "manual"
      ? "⚠️ <b>Perlu tindakan manual</b> — buka panel admin"
      : "✅ Auto-delivery aktif",
  ].join("\n");
}

export function adminDeliveryFailedNotification(orderCode: string, error: string): string {
  return [
    "🚨 <b>Delivery Gagal</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    `❌ ${escapeHtml(truncate(error, 200))}`,
    "",
    "Buka panel admin untuk retry / manual",
  ].join("\n");
}

export function adminWebOrderNotification(params: {
  orderCode: string;
  productNames: string;
  amount: number;
  customerName: string;
  customerWa: string;
  paymentMethod: string;
}): string {
  const { orderCode, productNames, amount, customerName, customerWa, paymentMethod } = params;
  return [
    "🔔 <b>Order Baru — Web</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${escapeHtml(truncate(productNames, 120))}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    `💰 ${formatRupiah(amount)}`,
    `👤 ${escapeHtml(truncate(customerName, 50))}`,
    `📱 ${escapeHtml(customerWa)}`,
    `💳 ${escapeHtml(paymentMethod.toUpperCase())}`,
    "",
    "Cek bukti transfer di panel admin",
  ].join("\n");
}
