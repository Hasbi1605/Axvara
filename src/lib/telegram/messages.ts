// src/lib/telegram/messages.ts — Premium UX copy, Bahasa Indonesia + HTML escaping
// Patterns adopted from top Telegram shop bots:
// - Visual hierarchy with separators (━━━)
// - Consistent emoji language (not spam)
// - Monospace <code> for copyable data (order codes, secrets)
// - Progress indicators for multi-step flows
// - Short, scannable lines — mobile-first (95% users)

import { formatWarrantyTermsTelegram, formatWarrantyClaimsTelegram } from "@/lib/warranty-policy";
import { SITE } from "@/lib/site";

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

export type TelegramBestseller = {
  name: string;
  price: number;
  soldCount: number;
  productId: number;
};

function formatSoldCount(sold: number): string {
  if (sold >= 1000) {
    const k = sold / 1000;
    return `Terjual ${Number(k.toFixed(1))}rb+`;
  }
  return `Terjual ${sold}+`;
}

export function formatSoldCountLabel(sold: number): string {
  return formatSoldCount(Math.max(0, Math.floor(sold)));
}

export function welcomeMessage(firstName: string, bestsellers: TelegramBestseller[] = []): string {
  const name = escapeHtml(truncate(firstName, 50));
  const { greeting, tanggal, jam } = formatWIBTime();
  const lines = [
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
  ];
  const top = bestsellers.filter((b) => b.productId > 0).slice(0, 3);
  if (top.length > 0) {
    lines.push("🔥 <b>Paling Laris:</b>");
    top.forEach((item, i) => {
      lines.push(`${i + 1}. <b>${escapeHtml(truncate(item.name, 50))}</b> — ${formatRupiah(item.price)} • ${formatSoldCountLabel(item.soldCount)}`);
    });
    lines.push("");
    lines.push("Tap 🛍 Katalog atau 🔎 Cari untuk mulai 👇");
  } else {
    lines.push("Pilih menu di bawah 👇");
  }
  return lines.join("\n");
}

export function catalogFlatMessage(total: number): string {
  return [
    "🛍 <b>Katalog AXVARA</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
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
  sold_count?: number | null;
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

  // Social proof — sold_count is free marketing from data we already track.
  const sold = Math.max(0, Math.floor(product.sold_count ?? 0));
  if (sold > 0) lines.push(`🔥 ${formatSoldCountLabel(sold)}`);

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
  step?: string | null;
}): string {
  const { productName, variantLabel, duration, warranty, price } = params;
  const name = escapeHtml(truncate(productName, 100));
  const lines = [
    "🛒 <b>Konfirmasi Pembelian</b>",
    params.step ?? breadcrumbLine(2),
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 <b>${name}</b>`,
    `🏷 Varian: ${escapeHtml(variantLabel)}`,
  ];
  if (duration) lines.push(`⏱ Durasi: ${escapeHtml(duration)}`);
  if (warranty) lines.push(`🛡 Garansi: ${escapeHtml(warranty)}`);
  lines.push(`💰 Harga satuan: ${formatRupiah(price)}`);
  lines.push("");
  lines.push("Setelah ini kamu dapat mengatur jumlah pesanan.");
  return lines.join("\n");
}

export function chooseVariantMessage(productName: string): string {
  const name = escapeHtml(truncate(productName, 100));
  return [
    `📦 <b>Pilih Varian — ${name}</b>`,
    breadcrumbLine(2),
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "Pilih varian yang sesuai kebutuhan kamu:",
  ].join("\n");
}

export function confirmBuyMessage(productName: string, price: number, qty = 1): string {
  const name = escapeHtml(truncate(productName, 100));
  const quantity = Math.max(1, Math.min(100, Math.floor(qty)));
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
  qty: number;
  maxQty?: number;
}): string {
  const { productName, variantLabel, price, stock } = params;
  // Telegram bulk cap is 100/order.
  const qty = Math.max(1, Math.min(100, Math.floor(params.qty || 1)));
  const maxQty = params.maxQty ?? (stock === -1 ? 100 : Math.max(1, Math.min(stock, 100)));
  const stockLine = maxQty === 1
    ? "📦 Produk unik — maksimal 1 per pesanan"
    : stock === -1
    ? "📦 Stok tersedia"
    : stock > 0
      ? `📦 Stok: ${stock} — maksimal ${Math.min(stock, 100)} per order`
      : "📦 ❌ Stok habis";
  return [
    "📊 <b>Tentukan Jumlah Pesanan</b>",
    breadcrumbLine(3),
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 <b>${escapeHtml(truncate(productName, 80))}</b>`,
    `🏷 ${escapeHtml(truncate(variantLabel, 80))}`,
    `💰 Harga satuan: ${formatRupiah(price)}`,
    stockLine,
    "",
    `🔢 <b>Jumlah dipilih: ${qty}</b>`,
    `🧾 <b>Total: ${formatRupiah(price * qty)}</b>`,
    "",
    "Gunakan tombol ➖ / ➕ di bawah.",
    maxQty > 1
      ? `Untuk bulk, kamu juga bisa ketik angka 1–${maxQty}.`
      : "Varian ini tidak mendukung bulk order.",
  ].join("\n");
}

export type TelegramCartLine = {
  productName: string;
  variantLabel: string;
  price: number;
  qty: number;
};

export function cartMessage(lines: TelegramCartLine[]): string {
  if (lines.length === 0) {
    return [
      "🛒 <b>Keranjang Kosong</b>",
      "━━━━━━━━━━━━━━━━━━━━━",
      "",
      "Belum ada item. Yuk pilih dari /katalog 👇",
      "",
      "Checkout gabungan = cukup bayar SEKALI untuk semua item. ⚡",
    ].join("\n");
  }
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  const out = [
    "🛒 <b>Keranjang Kamu</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
  ];
  lines.slice(0, 20).forEach((line, i) => {
    out.push(`${i + 1}. <b>${escapeHtml(truncate(line.productName, 50))}</b>`);
    out.push(`   🏷 ${escapeHtml(truncate(line.variantLabel, 50))} ×${line.qty} — ${formatRupiah(line.price * line.qty)}`);
  });
  out.push("");
  out.push(`🧾 <b>Total: ${formatRupiah(subtotal)}</b>`);
  out.push("");
  out.push("Checkout = SATU QRIS untuk semua item. ⚡");
  return out.join("\n");
}

export function cartAddedMessage(productName: string, variantLabel: string, qty: number, cartCount: number): string {
  return [
    "✅ <b>Masuk Keranjang!</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 <b>${escapeHtml(truncate(productName, 60))}</b>`,
    `🏷 ${escapeHtml(truncate(variantLabel, 60))} ×${qty}`,
    "",
    `🛒 Keranjang: ${cartCount} item`,
    "",
    "Lanjut belanja atau checkout SEKALI bayar 👇",
  ].join("\n");
}

export function cartCheckoutSummaryMessage(lines: TelegramCartLine[], subtotal: number): string {
  const names = lines.slice(0, 5).map((line) =>
    `• ${escapeHtml(truncate(line.productName, 40))} ×${line.qty}`).join("\n");
  const more = lines.length > 5 ? `\n<i>+${lines.length - 5} item lain…</i>` : "";
  return [
    "🧾 <b>Checkout Keranjang</b>",
    breadcrumbLine(4),
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    names + more,
    "",
    `💳 <b>Total Bayar: ${formatRupiah(subtotal)}</b>`,
    "",
    "Satu QRIS untuk semua item di atas. Lanjut? 👇",
  ].join("\n");
}

export function orderReminderMessage(params: {
  orderCode: string;
  productName: string;
  payableAmount: number;
  attempt: number;
}): string {
  const { orderCode, productName, payableAmount, attempt } = params;
  return [
    attempt > 1 ? "⏰ <b>Pengingat Terakhir!</b>" : "⏰ <b>Pesanan Menunggu Pembayaran</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${escapeHtml(truncate(productName, 80))}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    `💳 <b>${formatRupiah(payableAmount)}</b>`,
    "",
    "QRIS kamu masih aktif — scan & bayar sesuai nominal agar order tidak hangus.",
    "",
    "Abaikan pesan ini jika sudah bayar — bot otomatis mengabari saat lunas. 🙏",
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
    breadcrumbLine(4),
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
    "🤖 Tidak perlu cek status manual.",
    "Bot otomatis mengabari setelah pembayaran terkonfirmasi.",
  ].join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ORDER STATUS & DELIVERY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function orderPaidMessage(orderCode: string, productName: string, needsWhatsApp = false): string {
  const name = escapeHtml(truncate(productName, 100));
  const lines = [
    "🎉 <b>Pembayaran Berhasil!</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${name}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    "",
    "✅ Dana sudah diterima dan terverifikasi otomatis.",
    "📩 Produk akan dikirim admin melalui DM Telegram pribadi ini.",
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
    `📞 WhatsApp Admin: wa.me/${SITE.adminWaIntl}`,
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
    `📞 WhatsApp Admin: wa.me/${SITE.adminWaIntl}`,
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GROUP SAFETY (issue #5)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Deep-link to continue a purchase in the bot's private chat. Group chats
 * must never carry checkout state: invoices, QR codes, and credentials are
 * private-only. `botUsername` is the bot's username without '@'.
 */
export function privateChatDeepLink(botUsername: string, payload = "beli"): string {
  const clean = botUsername.replace(/^@/, "");
  return `https://t.me/${clean}?start=${encodeURIComponent(payload)}`;
}

export function groupCheckoutRedirectMessage(botUsername: string): string {
  return [
    "🔒 <b>Lanjut di Chat Pribadi</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "Demi keamanan, pembelian dan pembayaran hanya dilayani di chat pribadi dengan bot.",
    "",
    `👉 <a href="${privateChatDeepLink(botUsername)}">Tap di sini untuk buka chat pribadi</a> lalu tekan <b>START</b>, kemudian ulangi pilihan produk dari /katalog.`,
    "",
    "Kredensial produk tidak pernah dikirim ke grup.",
  ].join("\n");
}

export function groupDeliveryNoticeMessage(): string {
  return [
    "🔒 <b>Pesanan Lunas — Cek Chat Pribadi</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "Produk sudah dikirim ke <b>chat pribadi</b> kamu dengan bot.",
    "Buka chat pribadi bot dan tekan START bila belum.",
    "",
    "Kredensial tidak pernah ditampilkan di grup.",
  ].join("\n");
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
    "  3️⃣ Konfirmasi jumlah — QRIS dinamis langsung terbit",
    "  4️⃣ Bayar sesuai total — lunas otomatis",
    "  5️⃣ Produk terkirim + notif di sini",
    "",
    "🛡 <b>AXVARA third-party, bukan official.</b> Garansi 1×24 jam–30 hari ikut varian tiap produk. Ketik /garansi.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━",
    `📞 <b>Admin:</b> wa.me/${SITE.adminWaIntl}`,
    `✈️ <b>Telegram Support:</b> @${SITE.supportTelegram}`,
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

export type TelegramOrderRow = {
  code: string;
  productName: string;
  productId?: number | null;
  payableAmount?: number | null;
  paymentStatus: string;
  fulfillmentStatus: string;
  createdAt?: string | null;
};

export function myOrdersMessage(orders: TelegramOrderRow[]): string {
  if (orders.length === 0) {
    return [
      "📦 <b>Pesanan Saya</b>",
      "━━━━━━━━━━━━━━━━━━━━━",
      "",
      "Belum ada pesanan dari akun Telegram ini.",
      "",
      "Yuk mulai dari /katalog — order 1 menit, bayar QRIS otomatis. 🚀",
    ].join("\n");
  }
  const paymentEmoji: Record<string, string> = {
    paid: "✅",
    pending: "⏳",
    unpaid: "⏳",
    expired: "⏰",
    failed: "❌",
  };
  const lines = [
    "📦 <b>Pesanan Saya</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `${orders.length} pesanan terakhir — tap tombol di bawah untuk detail / beli lagi 👇`,
    "",
  ];
  orders.slice(0, 10).forEach((order, i) => {
    const emoji = paymentEmoji[order.paymentStatus] ?? "❓";
    const amount = order.payableAmount ? ` • ${formatRupiah(order.payableAmount)}` : "";
    lines.push(`${i + 1}. ${emoji} <b>${escapeHtml(truncate(order.productName, 60))}</b>`);
    lines.push(`   🔢 <code>${escapeHtml(order.code)}</code>${amount}`);
  });
  return lines.join("\n");
}

export function searchPromptMessage(): string {
  return [
    "🔎 <b>Cari Produk</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "Ketik nama produk yang kamu cari.",
    "",
    "Contoh: <code>canva</code>, <code>chatgpt</code>, <code>netflix</code>",
    "",
    "❌ Ketik /batal untuk kembali.",
  ].join("\n");
}

export function searchResultsMessage(keyword: string, total: number): string {
  const kw = escapeHtml(truncate(keyword, 60));
  return [
    `🔎 <b>Hasil: “${kw}”</b>`,
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    total > 0
      ? `${total} produk cocok — tap untuk lihat detail 👇`
      : "Tidak ada produk yang cocok. Coba kata lain atau lihat /katalog 🙏",
  ].join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BREADCRUMB (Langkah X/4 — Produk → Varian → Jumlah → Bayar)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function breadcrumbLine(step: 1 | 2 | 3 | 4): string {
  const steps = ["Produk", "Varian", "Jumlah", "Bayar"];
  return `🧭 ${steps.map((label, i) => (i + 1 === step ? `<b>[${label}]</b>` : label)).join(" → ")} (Langkah ${step}/4)`;
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
      "QRIS pesanan ini sudah diperpanjang maksimal 3 kali.",
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADMIN NOTIFICATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function adminTelegramOrderCreatedMessage(params: {
  orderCode: string;
  productNames: string;
  amount: number;
  customerName: string;
  telegramUser: string;
  paymentMethod: string;
}): string {
  const { orderCode, productNames, amount, customerName, telegramUser, paymentMethod } = params;
  const normalizedUser = telegramUser.replace(/^@/, "");
  const telegramLabel = !normalizedUser
    ? "—"
    : /^\d+$/.test(normalizedUser)
      ? `ID ${normalizedUser}`
      : `@${normalizedUser}`;
  return [
    "🔔 <b>Order Baru — Telegram</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${escapeHtml(truncate(productNames, 120))}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    `💰 ${formatRupiah(amount)}`,
    `👤 ${escapeHtml(truncate(customerName, 50))}`,
    `✈️ ${escapeHtml(telegramLabel)}`,
    `💳 ${escapeHtml(paymentMethod.toUpperCase())} dinamis`,
    "",
    "⏳ Menunggu pembayaran otomatis",
  ].join("\n");
}

export function adminTelegramOrderPaidMessage(params: {
  orderCode: string;
  productNames: string;
  amount: number;
  customerName: string;
  telegramUser: string;
  customerWa: string;
}): string {
  const { orderCode, productNames, amount, customerName, telegramUser, customerWa } = params;
  const normalizedUser = telegramUser.replace(/^@/, "");
  const telegramLabel = !normalizedUser
    ? "—"
    : /^\d+$/.test(normalizedUser)
      ? `ID ${normalizedUser}`
      : `@${normalizedUser}`;
  const wa = customerWa.trim() || "— belum diisi (buyer balas nomor di chat bot)";
  return [
    "✅ <b>Lunas — Telegram</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${escapeHtml(truncate(productNames, 120))}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    `💰 ${formatRupiah(amount)}`,
    `👤 ${escapeHtml(truncate(customerName, 50))}`,
    `✈️ ${escapeHtml(telegramLabel)}`,
    `📱 ${escapeHtml(truncate(wa, 30))}`,
    `💳 QRIS dinamis`,
    "",
    "✅ Pembayaran otomatis terverifikasi",
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

export function adminWhatsAppOrderCreatedMessage(params: {
  orderCode: string;
  productNames: string;
  amount: number;
  customerName: string;
  channelMember: string;
  paymentMethod: string;
}): string {
  const { orderCode, productNames, amount, customerName, channelMember, paymentMethod } = params;
  const member = channelMember.trim().replace(/^\+/, "") || "—";
  const methodLabel = paymentMethod.trim().toUpperCase() || "QRIS";
  // Stabil vs jalur Telegram: nominal + identitas + status menunggu bayar.
  // Member WA mentah (tanpa @) agar admin bisa chat balik manual bila perlu.
  return [
    "🔔 <b>Order Baru — WhatsApp</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${escapeHtml(truncate(productNames, 120))}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    `💰 ${formatRupiah(amount)}`,
    `👤 ${escapeHtml(truncate(customerName, 50))}`,
    `💬 ${escapeHtml(truncate(member, 30))}`,
    `💳 ${escapeHtml(methodLabel)}`,
    "",
    "⏳ Menunggu pembayaran",
  ].join("\n");
}

export function adminWhatsAppOrderPaidMessage(params: {
  orderCode: string;
  productNames: string;
  amount: number;
  customerName: string;
  channelMember: string;
  paymentMethod: string;
}): string {
  const { orderCode, productNames, amount, customerName, channelMember, paymentMethod } = params;
  const member = channelMember.trim().replace(/^\+/, "") || "—";
  const methodLabel = paymentMethod.trim().toUpperCase() || "QRIS";
  return [
    "✅ <b>Lunas — WhatsApp</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${escapeHtml(truncate(productNames, 120))}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    `💰 ${formatRupiah(amount)}`,
    `👤 ${escapeHtml(truncate(customerName, 50))}`,
    `💬 ${escapeHtml(truncate(member, 30))}`,
    `💳 ${escapeHtml(methodLabel)}`,
    "",
    "✅ Pembayaran terverifikasi",
  ].join("\n");
}
