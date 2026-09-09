// src/lib/telegram/messages/catalog.ts — Copy penjelajahan produk.
//
// MENGAPA dipisah: welcome, katalog, kategori, detail produk, pencarian, dan
// daftar pesanan adalah alur "discovery" yang berdiri sendiri dari alur uang
// (pembayaran) dan status. Mengelompokkannya memudahkan mengubah tampilan
// katalog tanpa risiko menyentuh teks invoice. Pemindahan murni — teks identik.

import { escapeHtml, formatRupiah, truncate, formatWIBTime, formatSoldCountLabel } from "./format";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WELCOME & NAVIGATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type TelegramBestseller = {
  name: string;
  price: number;
  soldCount: number;
  productId: number;
};

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
// MY ORDERS & SEARCH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
