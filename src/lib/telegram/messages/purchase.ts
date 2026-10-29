import { QRIS_PAYMENT_DEADLINE_NOTICE } from "@/lib/payment-maintenance";
import { escapeHtml, escapeItemSummary, formatRupiah, truncate } from "./format";

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
    "<b>Konfirmasi pembelian</b>",
    "",
    `<b>${name}</b>`,
    `Varian: ${escapeHtml(truncate(variantLabel, 100))}`,
  ];
  if (duration) lines.push(`Durasi: ${escapeHtml(duration)}`);
  if (warranty) lines.push(`Garansi: ${escapeHtml(warranty)}`);
  lines.push(`Harga satuan: ${formatRupiah(price)}`);
  lines.push("");
  lines.push("Setelah ini kamu dapat mengatur jumlah pesanan.");
  return lines.join("\n");
}

export function chooseVariantMessage(productName: string): string {
  const name = escapeHtml(truncate(productName, 100));
  return [
    `<b>${name}</b>`,
    "",
    "Pilih varian.",
  ].join("\n");
}

export function confirmBuyMessage(productName: string, price: number, qty = 1): string {
  const name = escapeHtml(truncate(productName, 100));
  const quantity = Math.max(1, Math.min(100, Math.floor(qty)));
  return [
    "<b>Konfirmasi pembelian</b>",
    "",
    name,
    `Harga satuan: ${formatRupiah(price)}`,
    `Jumlah: ${quantity}`,
    `<b>Subtotal: ${formatRupiah(price * quantity)}</b>`,
    "",
    "Total bayar final tercantum pada invoice, termasuk kode unik pembayaran.",
    "",
    "Third-party, bukan official. Garansi mengikuti varian yang dipilih. Dengan melanjutkan pembayaran, kamu setuju ketentuan /garansi.",
  ].join("\n");
}

export function chooseQtyMessage(params: {
  productName: string;
  variantLabel: string;
  price: number;
  stock: number;
  qty: number;
  maxQty?: number;
  minQty?: number;
  requiresEmail?: boolean;
}): string {
  const { productName, variantLabel, price, stock } = params;
  // Telegram bulk cap is 100/order.
  const minQty = Math.max(1, Math.floor(Number(params.minQty ?? 1) || 1));
  const maxQty = Math.max(1, Math.min(100, stock === -1 ? 100 : Math.max(1, stock), Math.floor(params.maxQty ?? 100)));
  const qty = Math.min(Math.max(minQty, Math.floor(params.qty || minQty)), maxQty);
  const stockLine = stock === -1 ? "Stok tersedia" : stock > 0 ? `Stok: ${stock}` : "Stok habis";
  return [
    "<b>🛒 Jumlah pesanan</b>",
    "",
    `<b>${escapeHtml(truncate(productName, 80))}</b>`,
    `Varian: ${escapeHtml(truncate(variantLabel, 80))}`,
    "",
    `Harga satuan: ${formatRupiah(price)}`,
    `<b>Jumlah: ${qty}</b>`,
    `<b>Subtotal: ${formatRupiah(price * qty)}</b>`,
    "",
    stockLine,
    ...(minQty > 1 ? [`Minimal pembelian: ${minQty}`] : []),
    `Maksimal ${maxQty} per pesanan.`,
    "",
    ...(params.requiresEmail ? ["Email aktif diperlukan sebelum membayar."] : []),
  ].join("\n");
}

export function emailConfirmationMessage(params: {
  productName: string;
  variantLabel: string;
  qty: number;
  total: number;
  maskedEmail: string;
}): string {
  return [
    "<b>📧 Konfirmasi email</b>",
    "",
    `<b>${escapeHtml(truncate(params.productName, 80))}</b>`,
    `Varian: ${escapeHtml(truncate(params.variantLabel, 80))}`,
    "",
    `Jumlah: ${params.qty}`,
    `<b>Subtotal: ${formatRupiah(params.total)}</b>`,
    "",
    "<b>Email</b>",
    escapeHtml(params.maskedEmail),
    "Periksa email sebelum membayar.",
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
      "<b>Keranjang kosong</b>",
      "",
      "Pilih produk di /katalog.",
    ].join("\n");
  }
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  const out = [
    "<b>🛒 Keranjang</b>",
    "",
  ];
  lines.slice(0, 20).forEach((line, i) => out.push(
    `${i + 1}. ${escapeItemSummary(line.productName, 65)} / ${escapeItemSummary(line.variantLabel, 65)} x${line.qty}: ${formatRupiah(line.price * line.qty)}`
  ));
  out.push("");
  out.push(`<b>Subtotal: ${formatRupiah(subtotal)}</b>`);
  out.push("");
  out.push("Satu pembayaran QRIS untuk semua item.");
  return out.join("\n");
}

export function cartAddedMessage(productName: string, variantLabel: string, qty: number, cartCount: number): string {
  return [
    "<b>Ditambahkan ke keranjang</b>",
    "",
    `<b>${escapeHtml(truncate(productName, 60))}</b>`,
    `${escapeHtml(truncate(variantLabel, 60))} x${qty}`,
    "",
    `Keranjang: ${cartCount} item`,
  ].join("\n");
}

export function cartCheckoutSummaryMessage(lines: TelegramCartLine[], subtotal: number): string {
  const names = lines.slice(0, 20).map(line =>
    `• ${escapeItemSummary(line.productName, 75)} / ${escapeItemSummary(line.variantLabel, 75)} x${line.qty}`).join("\n");
  return [
    "<b>🛒 Konfirmasi keranjang</b>",
    "",
    names,
    "",
    `<b>Subtotal: ${formatRupiah(subtotal)}</b>`,
    "",
    "Satu pembayaran QRIS untuk semua item. Total bayar final tercantum pada invoice.",
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
    attempt > 1 ? "<b>Pengingat pembayaran terakhir</b>" : "<b>Menunggu pembayaran</b>",
    "",
    escapeItemSummary(productName, 2800),
    `<code>${escapeHtml(truncate(orderCode, 120))}</code>`,
    `<b>Total bayar: ${formatRupiah(payableAmount)}</b>`,
    "",
    "Bayar QRIS yang masih aktif sesuai nominal sebelum batas waktunya.",
    "",
    "Abaikan pesan ini jika sudah bayar. Bot mengabari setelah pembayaran terkonfirmasi.",
  ].join("\n");
}

export function invoiceMessage(params: {
  orderCode: string;
  productName: string;
  payableAmount: number;
  expiresAt: string;
  paymentMethod?: string;
  /** Legacy field, never rendered: buyer PINs are email-only. */
  buyerAccessCode?: string;
}): string {
  const { orderCode, productName, payableAmount, expiresAt, paymentMethod } = params;
  const isQris = !paymentMethod || paymentMethod === "qris";
  let expiryText: string;
  try {
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime())) throw new Error("invalid_expiry");
    expiryText = d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
  } catch {
    expiryText = expiresAt;
  }

  const header = [
    "<b>⏳ Menunggu pembayaran</b>",
    `<code>${escapeItemSummary(orderCode, 120)}</code>`,
  ].join("\n");
  const footer = [
    `<b>Total bayar: ${formatRupiah(payableAmount)}</b>`,
    isQris ? "Bayar QRIS sesuai nominal ini." : "Transfer sesuai nominal ini.",
    "",
    `Batas bayar: ${escapeItemSummary(expiryText, 80)}`,
    ...(isQris ? [QRIS_PAYMENT_DEADLINE_NOTICE] : []),
    "",
    "Periksa Pembayaran untuk cek status. Bot otomatis mengabari setelah pembayaran terkonfirmasi.",
  ].join("\n");
  // Invoices are also photo captions, whose HTML budget is 1024 characters.
  return [header, escapeItemSummary(productName, 1023 - header.length - footer.length - 4), footer].join("\n\n");
}
