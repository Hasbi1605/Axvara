// src/lib/telegram/messages.ts — Premium UX copy, Bahasa Indonesia + HTML escaping
// Patterns adopted from top Telegram shop bots:
// - Visual hierarchy with separators (━━━)
// - Consistent emoji language (not spam)
// - Monospace <code> for copyable data (order codes, secrets)
// - Progress indicators for multi-step flows
// - Short, scannable lines — mobile-first (95% users)

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
// WELCOME & NAVIGATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function welcomeMessage(firstName: string): string {
  const name = escapeHtml(truncate(firstName, 50));
  return [
    `🎯 <b>Halo, ${name}!</b>`,
    "",
    "Selamat datang di <b>AXVARA</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "🛍 Tools AI &amp; aplikasi premium",
    "💰 Harga jauh lebih hemat dari official",
    "✅ Bergaransi &amp; support admin",
    "",
    "Pilih menu di bawah 👇",
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
// PRODUCT DETAIL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function productDetailMessage(product: {
  name: string;
  description?: string | null;
  price: number;
  compare_price?: number | null;
  stock?: number | null;
  badge?: string | null;
}): string {
  const name = escapeHtml(truncate(product.name, 100));
  const desc = product.description ? escapeHtml(truncate(product.description, 300)) : "";
  const price = formatRupiah(product.price);

  const lines: string[] = [];

  // Header
  lines.push(`<b>${name}</b>`);
  if (product.badge) {
    const badgeEmoji: Record<string, string> = {
      "Terlaris": "🔥", "Baru": "✨", "Hemat 92%": "💎",
      "Bundle": "📦", "Ultimate": "👑", "Enterprise": "🏢",
    };
    lines.push(`${badgeEmoji[product.badge] ?? "🏷"} ${escapeHtml(product.badge)}`);
  }
  lines.push("━━━━━━━━━━━━━━━━━━━━━");

  // Description
  if (desc) {
    lines.push("");
    lines.push(desc);
  }

  // Price block
  lines.push("");
  if (product.compare_price && product.compare_price > product.price) {
    const discount = Math.round((1 - product.price / product.compare_price) * 100);
    lines.push(`💰 <b>${price}</b>  <s>${formatRupiah(product.compare_price)}</s>`);
    lines.push(`🎉 Hemat ${discount}%`);
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

  return lines.join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PURCHASE FLOW
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function confirmBuyMessage(productName: string, price: number): string {
  const name = escapeHtml(truncate(productName, 100));
  return [
    "🛒 <b>Konfirmasi Pembelian</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${name}`,
    `💰 <b>${formatRupiah(price)}</b>`,
    `📊 Qty: 1`,
    "",
    "⚠️ <i>Total final bisa sedikit berbeda karena kode unik pembayaran.</i>",
    "",
    "Lanjutkan? 👇",
  ].join("\n");
}

export function invoiceMessage(params: {
  orderCode: string;
  productName: string;
  payableAmount: number;
  expiresAt: string;
}): string {
  const { orderCode, productName, payableAmount, expiresAt } = params;
  const name = escapeHtml(truncate(productName, 100));
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
    "👆 Scan QRIS di atas untuk membayar",
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
    "📬 Kamu akan dinotifikasi saat siap",
    "",
    "⏱ Estimasi: 1×24 jam",
    "<i>(biasanya jauh lebih cepat)</i>",
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
  return [
    "❓ <b>Bantuan AXVARA</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "📌 <b>Perintah:</b>",
    "  /start — Menu utama",
    "  /katalog — Lihat produk",
    "  /pesanan &lt;kode&gt; — Cek status",
    "  /bantuan — Halaman ini",
    "",
    "🛒 <b>Cara beli:</b>",
    "  1️⃣ Pilih kategori",
    "  2️⃣ Pilih produk",
    "  3️⃣ Konfirmasi pembelian",
    "  4️⃣ Bayar QRIS sesuai total",
    "  5️⃣ Produk otomatis terkirim",
    "",
    "━━━━━━━━━━━━━━━━━━━━━",
    "📞 <b>Admin:</b> wa.me/6289519388264",
    "🌐 <b>Web:</b> axvara.tech",
  ].join("\n");
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
