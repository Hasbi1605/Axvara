// src/lib/telegram/messages.ts — Bahasa Indonesia copy + HTML escaping
// All user/product data MUST be escaped before embedding in parse_mode=HTML.

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

export function welcomeMessage(firstName: string): string {
  const name = escapeHtml(truncate(firstName, 50));
  return [
    `👋 <b>Halo, ${name}!</b>`,
    "",
    "Selamat datang di <b>AXVARA</b> — Gerbang Semua Tools Premium.",
    "",
    "Temukan berbagai tools AI dan aplikasi premium dengan harga jauh lebih hemat dari official. Bergaransi.",
    "",
    "Pilih menu di bawah untuk mulai:",
  ].join("\n");
}

export function categoriesMessage(): string {
  return "📦 <b>Katalog AXVARA</b>\n\nPilih kategori produk:";
}

export function categoryProductsMessage(categoryName: string, total: number): string {
  const name = escapeHtml(truncate(categoryName, 50));
  return `📂 <b>${name}</b>\n\n${total} produk tersedia. Pilih produk:`;
}

export function productDetailMessage(product: {
  name: string;
  description?: string | null;
  price: number;
  compare_price?: number | null;
  stock?: number | null;
  badge?: string | null;
}): string {
  const name = escapeHtml(truncate(product.name, 100));
  const desc = product.description ? escapeHtml(truncate(product.description, 300)) : "—";
  const price = formatRupiah(product.price);
  const lines = [`<b>${name}</b>`];

  if (product.badge) lines.push(`🏷️ ${escapeHtml(product.badge)}`);
  lines.push("");
  lines.push(desc);
  lines.push("");
  lines.push(`💰 <b>${price}</b>`);
  if (product.compare_price && product.compare_price > product.price) {
    const discount = Math.round((1 - product.price / product.compare_price) * 100);
    lines.push(`<s>${formatRupiah(product.compare_price)}</s> — hemat ${discount}%`);
  }

  const stock = product.stock ?? -1;
  if (stock === -1) {
    lines.push("📦 Stok: Tersedia");
  } else if (stock > 0) {
    lines.push(`📦 Stok: ${stock}`);
  } else {
    lines.push("📦 ⚠️ Stok habis");
  }

  return lines.join("\n");
}

export function confirmBuyMessage(productName: string, price: number): string {
  const name = escapeHtml(truncate(productName, 100));
  return [
    `🛒 <b>Konfirmasi Pembelian</b>`,
    "",
    `Produk: <b>${name}</b>`,
    `Harga: <b>${formatRupiah(price)}</b>`,
    `Qty: 1`,
    "",
    "⚠️ Total final bisa memiliki kode unik yang berbeda sedikit dari harga produk.",
    "",
    "Lanjutkan pembelian?",
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
    `✅ <b>Invoice Dibuat</b>`,
    "",
    `📦 ${name}`,
    `🔢 Kode: <code>${escapeHtml(orderCode)}</code>`,
    "",
    `💰 <b>Total Bayar: ${formatRupiah(payableAmount)}</b>`,
    "",
    "Scan QRIS di atas untuk membayar.",
    "",
    `⏰ Batas waktu: ${expiryText}`,
    "",
    "Setelah bayar, status akan otomatis terupdate.",
    "Tekan tombol 🔄 Cek Status untuk refresh.",
  ].join("\n");
}

export function orderPaidMessage(orderCode: string, productName: string): string {
  const name = escapeHtml(truncate(productName, 100));
  return [
    `🎉 <b>Pembayaran Diterima!</b>`,
    "",
    `Kode: <code>${escapeHtml(orderCode)}</code>`,
    `Produk: ${name}`,
    "",
    "Produk kamu sedang diproses...",
  ].join("\n");
}

export function deliveryMessage(secret: string): string {
  // Secret itself is NOT escaped — it's sent as preformatted code block
  return [
    `🎁 <b>Produk Kamu Sudah Siap!</b>`,
    "",
    "Berikut detail akses/lisensi kamu:",
    "",
    `<code>${escapeHtml(secret)}</code>`,
    "",
    "⚠️ Simpan baik-baik. Jangan bagikan ke orang lain.",
    "Kalau ada kendala, ketik /bantuan.",
  ].join("\n");
}

export function manualFulfillmentBuyerMessage(orderCode: string): string {
  return [
    `✅ <b>Pembayaran Diterima!</b>`,
    "",
    `Kode: <code>${escapeHtml(orderCode)}</code>`,
    "",
    "Admin sedang menyiapkan akses produk kamu.",
    "Kamu akan mendapat notifikasi saat produk siap.",
    "",
    "Estimasi: 1×24 jam (biasanya lebih cepat).",
  ].join("\n");
}

export function orderExpiredMessage(orderCode: string): string {
  return [
    `⏰ <b>Invoice Kedaluwarsa</b>`,
    "",
    `Kode: <code>${escapeHtml(orderCode)}</code>`,
    "",
    "Invoice ini sudah melewati batas waktu pembayaran.",
    "Silakan buat pesanan baru dari /katalog.",
  ].join("\n");
}

export function orderCancelledMessage(orderCode: string): string {
  return [
    `❌ <b>Pesanan Dibatalkan</b>`,
    "",
    `Kode: <code>${escapeHtml(orderCode)}</code>`,
    "",
    "Pesanan berhasil dibatalkan.",
    "Silakan buat pesanan baru dari /katalog.",
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

  const statusEmoji: Record<string, string> = {
    unpaid: "⏳",
    pending: "⏳",
    paid: "✅",
    expired: "⏰",
    failed: "❌",
  };

  const fulfillEmoji: Record<string, string> = {
    not_required: "—",
    reserved: "🔒",
    queued: "📤",
    sending: "📤",
    delivered: "✅",
    manual_required: "👤",
    retry: "🔄",
    failed: "❌",
  };

  const lines = [
    `📋 <b>Status Pesanan</b>`,
    "",
    `Kode: <code>${escapeHtml(orderCode)}</code>`,
    `Produk: ${name}`,
  ];

  if (payableAmount) lines.push(`Total: ${formatRupiah(payableAmount)}`);
  lines.push(`Pembayaran: ${statusEmoji[paymentStatus] ?? "?"} ${paymentStatus}`);
  if (fulfillmentStatus !== "not_required") {
    lines.push(`Pengiriman: ${fulfillEmoji[fulfillmentStatus] ?? "?"} ${fulfillmentStatus}`);
  }

  return lines.join("\n");
}

export function helpMessage(): string {
  return [
    "❓ <b>Bantuan AXVARA Bot</b>",
    "",
    "/start — Menu utama",
    "/katalog — Lihat katalog produk",
    "/pesanan &lt;kode&gt; — Cek status pesanan",
    "/bantuan — Tampilkan bantuan",
    "",
    "🔹 Cara beli:",
    "1. Pilih kategori dari /katalog",
    "2. Pilih produk yang diinginkan",
    "3. Konfirmasi pembelian",
    "4. Bayar QRIS sesuai total yang ditampilkan",
    "5. Produk otomatis terkirim setelah pembayaran dikonfirmasi",
    "",
    "📞 Butuh bantuan? Hubungi admin:",
    "WhatsApp: 089519388264",
  ].join("\n");
}

export function adminOrderNotification(params: {
  orderCode: string;
  productName: string;
  amount: number;
  telegramUser: string;
  fulfillmentMode: string;
}): string {
  const { orderCode, productName, amount, telegramUser, fulfillmentMode } = params;
  return [
    `🔔 <b>Order Baru dari Telegram</b>`,
    "",
    `Kode: <code>${escapeHtml(orderCode)}</code>`,
    `Produk: ${escapeHtml(truncate(productName, 80))}`,
    `Jumlah: ${formatRupiah(amount)}`,
    `User: @${escapeHtml(telegramUser || "—")}`,
    `Fulfillment: ${fulfillmentMode}`,
    "",
    fulfillmentMode === "manual"
      ? "⚠️ Perlu tindakan manual — buka panel admin."
      : "✅ Auto-delivery aktif.",
  ].join("\n");
}

export function adminDeliveryFailedNotification(orderCode: string, error: string): string {
  return [
    `⚠️ <b>Delivery Gagal</b>`,
    "",
    `Kode: <code>${escapeHtml(orderCode)}</code>`,
    `Error: ${escapeHtml(truncate(error, 200))}`,
    "",
    "Cek panel admin untuk retry atau manual delivery.",
  ].join("\n");
}

export function myOrdersPrompt(): string {
  return [
    "📋 <b>Cek Pesanan</b>",
    "",
    "Ketik /pesanan diikuti kode pesanan kamu.",
    "Contoh: <code>/pesanan AXV-20260903-AB12CD34</code>",
  ].join("\n");
}

export function outOfStockMessage(): string {
  return "⚠️ Maaf, stok produk ini sedang habis. Silakan pilih produk lain.";
}

export function alreadyPendingMessage(orderCode: string): string {
  return [
    "⚠️ Kamu masih punya pesanan aktif untuk produk ini.",
    "",
    `Kode: <code>${escapeHtml(orderCode)}</code>`,
    "",
    "Bayar atau batalkan pesanan sebelum membuat yang baru.",
  ].join("\n");
}

export function errorMessage(): string {
  return "⚠️ Terjadi kesalahan. Silakan coba lagi atau hubungi admin.";
}
