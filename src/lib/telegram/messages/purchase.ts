// src/lib/telegram/messages/purchase.ts — Copy alur pembelian & invoice.
//
// MENGAPA dipisah: ini JALUR UANG (konfirmasi varian → jumlah → keranjang →
// invoice QRIS + pengingat). Perubahan di sini punya dampak transaksional,
// jadi mengisolasinya dari copy katalog/status membuat perubahan mudah ditinjau
// dan diuji terpisah. Pemindahan murni — teks, breadcrumb, dan angka identik.

import { escapeHtml, formatRupiah, truncate, breadcrumbLine } from "./format";

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
