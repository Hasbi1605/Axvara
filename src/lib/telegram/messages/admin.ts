// src/lib/telegram/messages/admin.ts — Notifikasi grup admin (semua kanal).
//
// MENGAPA dipisah: notifikasi ke grup admin (Order Baru / Lunas untuk Web,
// Telegram, dan WhatsApp) adalah audiens BERBEDA dari pembeli. Formatnya harus
// stabil dan seragam antar-kanal agar admin tidak salah baca. Mengelompokkannya
// mempermudah menjaga keseragaman itu. Pemindahan murni — teks identik.

import { escapeHtml, formatRupiah, truncate } from "./format";
import { formatWibDateTime } from "@/lib/utils";

type PaidStatus = { paidAt?: unknown; orderStatus?: string; deliveryLines?: string[] };
function createdStatus(createdAt: unknown): string[] {
  const time = formatWibDateTime(createdAt, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return ["⏳ Status pembayaran: MENUNGGU PEMBAYARAN", "📦 Status pesanan: MENUNGGU PEMBAYARAN",
    `🕒 Dibuat: ${time ? escapeHtml(time) + " WIB" : "Belum tercatat"}`];
}
function paidStatus(params: PaidStatus): string[] {
  const time = formatWibDateTime(params.paidAt, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return ["✅ Status pembayaran: LUNAS", `📦 Status pesanan: ${escapeHtml(params.orderStatus || "DIPROSES")}`,
    ...(params.deliveryLines ?? []).map(escapeHtml),
    `🕒 Dibayar: ${time ? escapeHtml(time) + " WIB" : "Belum tercatat"}`];
}

export function adminTelegramOrderCreatedMessage(params: {
  createdAt?: unknown;
  orderCode: string;
  productNames: string;
  amount: number;
  customerName: string;
  telegramUser: string;
  paymentMethod: string;
  /** Email pembeli (2026-10-10, permintaan owner): wajib tampil agar admin bisa verifikasi order require-email. Kosong = "— tanpa email". */
  customerEmail?: string;
}): string {
  const { orderCode, productNames, amount, customerName, telegramUser, paymentMethod } = params;
  const normalizedUser = telegramUser.replace(/^@/, "");
  const telegramLabel = !normalizedUser
    ? "—"
    : /^\d+$/.test(normalizedUser)
      ? `ID ${normalizedUser}`
      : `@${normalizedUser}`;
  const email = (params.customerEmail ?? "").trim() || "— tanpa email";
  return [
    "🔔 <b>Order Baru — Telegram</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${escapeHtml(truncate(productNames, 120))}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    `💰 ${formatRupiah(amount)}`,
    `👤 ${escapeHtml(truncate(customerName, 50))}`,
    `✈️ ${escapeHtml(telegramLabel)}`,
    `📧 ${escapeHtml(truncate(email, 80))}`,
    `💳 ${escapeHtml(paymentMethod.toUpperCase())} dinamis`,
    "",
    ...createdStatus(params.createdAt),
  ].join("\n");
}

export function adminTelegramOrderPaidMessage(params: {
  orderCode: string;
  productNames: string;
  amount: number;
  customerName: string;
  telegramUser: string;
  customerWa: string;
  /** Kelas kirim order (2026-10-04). Selain `manual`, nomor WA tidak dibutuhkan:
   *  produk dikirim otomatis ke chat buyer, jadi baris "WA belum diisi" menyesatkan. */
  delivery?: "instant" | "queued" | "manual";
  /** Email pembeli (2026-10-10, permintaan owner): wajib tampil agar admin bisa verifikasi order require-email. Kosong = "— tanpa email". */
  customerEmail?: string;
} & PaidStatus): string {
  const { orderCode, productNames, amount, customerName, telegramUser, customerWa } = params;
  const delivery = params.delivery ?? "manual";
  const normalizedUser = telegramUser.replace(/^@/, "");
  const telegramLabel = !normalizedUser
    ? "—"
    : /^\d+$/.test(normalizedUser)
      ? `ID ${normalizedUser}`
      : `@${normalizedUser}`;
  const wa = customerWa.trim() || "— belum diisi (buyer balas nomor di chat bot)";
  const email = (params.customerEmail ?? "").trim() || "— tanpa email";
  return [
    "💳 <b>Pembayaran diterima — Telegram</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${escapeHtml(truncate(productNames, 120))}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    `💰 ${formatRupiah(amount)}`,
    `👤 ${escapeHtml(truncate(customerName, 50))}`,
    `✈️ ${escapeHtml(telegramLabel)}`,
    `📧 ${escapeHtml(truncate(email, 80))}`,
    delivery === "instant"
      ? "⚡ Kirim otomatis ke chat buyer"
      : delivery === "queued"
        ? "⏳ Made By Order — otomatis ke chat buyer saat selesai"
        : `📱 ${escapeHtml(truncate(wa, 30))}`,
    `💳 QRIS dinamis`,
    "",
    ...paidStatus(params),
  ].join("\n");
}

/**
 * Notif admin "Lunas — Web" (2026-09-25, keputusan owner: web cukup notif
 * lunas, tanpa "Order Baru"). Satu pesan per order, dikirim setelah upaya kirim
 * pertama sehingga status pengirimannya sudah diketahui.
 */
export function adminWebOrderPaidMessage(params: {
  orderCode: string;
  productNames: string;
  amount: number;
  customerName: string;
  customerEmail: string;
  customerWa: string;
  paymentMethod: string;
  needsAdmin: boolean;
  deliveryLines: string[];
} & PaidStatus): string {
  const { orderCode, productNames, amount, customerName, customerEmail, customerWa, paymentMethod, needsAdmin, deliveryLines } = params;
  return [
    needsAdmin ? "🛠 <b>Pembayaran diterima — Web · perlu dikirim admin</b>" : "💳 <b>Pembayaran diterima — Web</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${escapeHtml(truncate(productNames, 120))}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    `💰 ${formatRupiah(amount)}`,
    `👤 ${escapeHtml(truncate(customerName || "—", 50))}`,
    `📧 ${escapeHtml(truncate(customerEmail || "— tanpa email", 80))}`,
    `📱 ${escapeHtml(truncate(customerWa || "—", 30))}`,
    `💳 ${escapeHtml((paymentMethod || "qris").toUpperCase())}`,
    "",
    ...paidStatus({ ...params, deliveryLines }),
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

export function adminWhatsAppOrderCreatedMessage(params: {
  createdAt?: unknown;
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
    ...createdStatus(params.createdAt),
  ].join("\n");
}

export function adminWhatsAppOrderPaidMessage(params: {
  orderCode: string;
  productNames: string;
  amount: number;
  customerName: string;
  channelMember: string;
  paymentMethod: string;
} & PaidStatus): string {
  const { orderCode, productNames, amount, customerName, channelMember, paymentMethod } = params;
  const member = channelMember.trim().replace(/^\+/, "") || "—";
  const methodLabel = paymentMethod.trim().toUpperCase() || "QRIS";
  return [
    "💳 <b>Pembayaran diterima — WhatsApp</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 ${escapeHtml(truncate(productNames, 120))}`,
    `🔢 <code>${escapeHtml(orderCode)}</code>`,
    `💰 ${formatRupiah(amount)}`,
    `👤 ${escapeHtml(truncate(customerName, 50))}`,
    `💬 ${escapeHtml(truncate(member, 30))}`,
    `💳 ${escapeHtml(methodLabel)}`,
    "",
    ...paidStatus(params),
  ].join("\n");
}
