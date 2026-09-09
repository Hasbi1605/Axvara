// src/lib/telegram/messages/admin.ts — Notifikasi grup admin (semua kanal).
//
// MENGAPA dipisah: notifikasi ke grup admin (Order Baru / Lunas untuk Web,
// Telegram, dan WhatsApp) adalah audiens BERBEDA dari pembeli. Formatnya harus
// stabil dan seragam antar-kanal agar admin tidak salah baca. Mengelompokkannya
// mempermudah menjaga keseragaman itu. Pemindahan murni — teks identik.

import { escapeHtml, formatRupiah, truncate } from "./format";

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
