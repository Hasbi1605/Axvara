// src/lib/whatsapp/messages.ts — WhatsApp message templates (plain text + *bold*)
// Uses WhatsApp formatting: *bold*, _italic_, ~strikethrough~, ```monospace```

import { formatRupiah } from "@/lib/catalog";
import { SITE, adminTelegramLink } from "@/lib/site";
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

export function warrantyMessage(): string {
  return formatWarrantyWhatsApp();
}

// ---- Admin .d command: order completed ----

export function orderCompletedMessage(params: {
  orderCode: string;
  productName?: string;
  variantLabel?: string;
  total?: number;
}): string {
  const lines = [
    "✅🎉 *PESANAN SELESAI!* 🎉✅",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    `📦 Order *${params.orderCode}* telah berhasil diproses admin!`,
  ];
  if (params.productName) {
    lines.push(`🛍 ${params.productName}${params.variantLabel ? ` — *${params.variantLabel}*` : ""}`);
  }
  if (params.total) {
    lines.push(`💰 ${formatRupiah(params.total)}`);
  }
  lines.push("");
  lines.push("💎 Terima kasih sudah belanja di *AXVARA*!");
  lines.push("Jangan lupa order lagi ya! 🔥🔥🔥");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("🛒 Pesan hanya lewat website atau bot Telegram");
  lines.push(`🌐 ${SITE.webUrl}`);
  lines.push(`✈️ ${adminTelegramLink()}?start=beli`);
  return lines.join("\n");
}

export function orderAlreadyProcessedMessage(orderCode: string): string {
  return `Pesanan *${orderCode}* sudah diproses sebelumnya.`;
}

export function adminDoneNoOrderMessage(): string {
  return [
    "⚠️ Tidak dapat menemukan kode pesanan.",
    "",
    "Cara pakai: reply pesan pembayaran dengan *.d*",
    "Atau ketik: *.d AXV-XXXXXXXX*",
  ].join("\n");
}

// ---- Welcome message for new group members ----

export function welcomeNewMemberMessage(name?: string): string {
  const { greeting } = formatWIBTime();
  const displayName = name?.replace(/[\r\n*`_~\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) || "Kak";
  const lines = [
    "━━━━━━━━━━━━━━━━━━━━",
    "🎉 *SELAMAT DATANG DI AXVARA!* 🎉",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    `${greeting}, *${displayName}*! 👋`,
    "",
    "Selamat bergabung di grup official *AXVARA* 💎",
    "Tools & Apps premium, Optimasi Media Sosial, Topup Games! 🚀",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "🌐 *Order via website*",
    SITE.webUrl,
    "",
    "🤖 *Order via Telegram*",
    `${adminTelegramLink()}?start=beli`,
    "",
    "💬 *Bantuan Admin*",
    `${SITE.webUrl}/wa`,
    "━━━━━━━━━━━━━━━━━━━━",
  ];
  return lines.join("\n");
}

/**
 * Alur belanja WhatsApp dipensiunkan 13 November 2026 (keputusan owner).
 * Pesan yang dulu memicu pencarian/pemesanan/bukti manual dijawab dengan satu
 * arahan ini agar pembeli tidak menunggu balasan yang tidak akan datang.
 */
export function buyerFlowsRetiredMessage(): string {
  return [
    "━━━━━━━━━━━━━━━━━━━━",
    "*PEMESANAN WHATSAPP DIALIHKAN*",
    "━━━━━━━━━━━━━━━━━━━━",
    "Pencarian produk, pemesanan, dan bukti pembayaran di grup WhatsApp sudah tidak dilayani.",
    "",
    "Silakan pesan lewat:",
    `🌐 Website: ${SITE.webUrl}`,
    `✈️ Telegram: ${adminTelegramLink()}`,
    "",
    "Pesanan lama tetap diproses dan bisa dilacak lewat tautan pesanan Anda.",
  ].join("\n");
}
