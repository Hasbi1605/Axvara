// src/lib/telegram/messages/games.ts — Seluruh copy ID/EN untuk AXVARA Games di Bot Telegram.
// White-label ketat: tidak pernah menyebut nama supplier (Sekalipay / Digiflazz).

import type { Locale } from "@/lib/i18n/locale";
import type { GamesBuyerStatus } from "@/lib/games/status";
import { escapeHtml, formatRupiah, truncate } from "./format";
import { formatIdr } from "@/lib/i18n/format";
import type { TgPriceCtx } from "@/lib/telegram/keyboards";
import { tgDisplayPrice } from "@/lib/telegram/render-prefs";
import { gameLogoHtml } from "@/lib/telegram/games-emoji";

function priceText(amount: number, ctx?: TgPriceCtx): string {
  const locale = ctx?.locale ?? "id";
  if (ctx?.displayCurrency === "USD" && ctx?.fx) {
    return `${tgDisplayPrice(amount, { locale, displayCurrency: "USD", fx: ctx.fx })} (${formatIdr(amount, locale)})`;
  }
  return formatRupiah(amount);
}

export function gamesHomeMessage(sellableCount: number, locale: Locale = "id"): string {
  const en = locale === "en";
  if (en) {
    return [
      `<b>🎮 AXVARA Games</b> · ${sellableCount} games ready`,
      "24/7 automatic top up · Free nickname check.",
      "",
      "Pick a popular game below or type a game name (e.g. <code>ml</code>, <code>ff</code>, <code>valo</code>):",
    ].join("\n");
  }
  return [
    `<b>🎮 AXVARA Games</b> · ${sellableCount} game siap top up`,
    "Proses otomatis 24 jam · Cek nickname gratis.",
    "",
    "Pilih game populer di bawah atau ketik nama game (mis. <code>ml</code>, <code>ff</code>, <code>valo</code>):",
  ].join("\n");
}

export function gamesCatalogListMessage(params: {
  title: string;
  total: number;
  page: number;
  totalPages: number;
  locale: Locale;
}): string {
  const { title, total, page, totalPages, locale } = params;
  const en = locale === "en";
  return [
    `<b>🎮 ${escapeHtml(title)}</b> (${total})`,
    totalPages > 1 ? `${en ? "Page" : "Halaman"} ${page + 1}/${totalPages}` : "",
    en ? "Select a game below:" : "Pilih game di bawah:",
  ].filter(Boolean).join("\n");
}

export function gamesDetailMessage(params: {
  gameName: string;
  description?: string | null;
  activeTypeLabel?: string | null;
  activeCategoryLabel?: string | null;
  activeRangeLabel?: string | null;
  /** Bendera region aktif (mis. 🇮🇩), ditempel di depan label region. */
  regionFlag?: string | null;
  /** Mata uang game (mis. "💎 Diamond"), ditampilkan di baris meta. */
  currencyLabel?: string | null;
  shownCount: number;
  totalInScope: number;
  page: number;
  totalPages: number;
  orderingOpen: boolean;
  locale: Locale;
}): string {
  const en = params.locale === "en";
  const lines = [`<b>🎮 ${escapeHtml(params.gameName)}</b>`];
  const metaParts: string[] = [];
  if (params.activeTypeLabel) metaParts.push(`${params.regionFlag ? `${params.regionFlag} ` : ""}${escapeHtml(params.activeTypeLabel)}`);
  if (params.currencyLabel) metaParts.push(escapeHtml(params.currencyLabel));
  if (params.activeCategoryLabel) metaParts.push(escapeHtml(params.activeCategoryLabel));
  if (params.activeRangeLabel) metaParts.push(escapeHtml(params.activeRangeLabel));
  if (metaParts.length) lines.push(metaParts.join(" · "));
  if (params.description) lines.push(`<i>${escapeHtml(truncate(params.description, 160))}</i>`);
  lines.push("");
  if (!params.orderingOpen) {
    lines.push(en ? "ℹ️ Ordering is opening soon (catalog preview)." : "ℹ️ Pemesanan segera dibuka (pratinjau katalog).");
  } else if (params.totalInScope === 0) {
    lines.push(en ? "📭 No packages match this filter right now." : "📭 Belum ada nominal yang tersedia untuk filter ini.");
  } else {
    const pageInfo = params.totalPages > 1 ? ` · ${en ? "Page" : "Hal"} ${params.page + 1}/${params.totalPages}` : "";
    lines.push(en
      ? `Choose a package (${params.totalInScope} ready${pageInfo}):`
      : `Pilih nominal (${params.totalInScope} tersedia${pageInfo}):`);
  }
  return lines.join("\n");
}

export function gamesSavedAccountPromptMessage(params: {
  gameName: string;
  /** Slug game untuk logo animasi di judul (fallback 🎮). */
  gameSlug?: string | null;
  packageName: string;
  price: number;
  savedDisplay: string;
  savedNickname?: string | null;
  ctx?: TgPriceCtx;
}): string {
  const locale = params.ctx?.locale ?? "id";
  const en = locale === "en";
  const nick = params.savedNickname ? ` · ${escapeHtml(params.savedNickname)}` : "";
  return [
    `<b>${gameLogoHtml(params.gameSlug)} ${escapeHtml(params.gameName)}</b>`,
    `${en ? "Package" : "Nominal"}: ${escapeHtml(params.packageName)}`,
    `${en ? "Price" : "Harga"}: <b>${priceText(params.price, params.ctx)}</b>`,
    "",
    en ? "Use your last account ID or enter a new one:" : "Pakai data akun terakhir atau masukkan ID baru:",
    `• ID: <code>${escapeHtml(params.savedDisplay)}</code>${nick}`,
  ].join("\n");
}

export function gamesAccountInputPromptMessage(params: {
  gameName: string;
  gameSlug?: string | null;
  packageName: string;
  price: number;
  requiresZone: boolean;
  noteLabel: string;
  zoneLabel?: string | null;
  idGuide?: string | null;
  stepZoneOnly?: { noteValue: string } | null;
  ctx?: TgPriceCtx;
}): string {
  const locale = params.ctx?.locale ?? "id";
  const en = locale === "en";
  const lines = [
    `<b>${gameLogoHtml(params.gameSlug)} ${escapeHtml(params.gameName)}</b> · ${escapeHtml(params.packageName)}`,
    `${en ? "Price" : "Harga"}: <b>${priceText(params.price, params.ctx)}</b>`,
    "",
  ];
  if (params.stepZoneOnly) {
    lines.push(
      en
        ? `${escapeHtml(params.noteLabel)}: <code>${escapeHtml(params.stepZoneOnly.noteValue)}</code>\nNow send your <b>${escapeHtml(params.zoneLabel || "Zone/Server ID")}</b>.`
        : `${escapeHtml(params.noteLabel)}: <code>${escapeHtml(params.stepZoneOnly.noteValue)}</code>\nSekarang kirim <b>${escapeHtml(params.zoneLabel || "Zone/Server ID")}</b> kamu.`,
    );
  } else if (params.requiresZone) {
    const zLabel = params.zoneLabel || "Zone ID";
    lines.push(
      en
        ? `Send your <b>${escapeHtml(params.noteLabel)}</b> and <b>${escapeHtml(zLabel)}</b> separated by a space or parentheses.\nExample: <code>12345678 1234</code> or <code>12345678(1234)</code>.`
        : `Kirim <b>${escapeHtml(params.noteLabel)}</b> dan <b>${escapeHtml(zLabel)}</b> dipisah spasi atau tanda kurung.\nContoh: <code>12345678 1234</code> atau <code>12345678(1234)</code>.`,
    );
  } else {
    lines.push(
      en
        ? `Send your <b>${escapeHtml(params.noteLabel)}</b> now.`
        : `Kirim <b>${escapeHtml(params.noteLabel)}</b> kamu sekarang.`,
    );
  }
  if (params.idGuide) {
    // Owner 28 Nov 2026: panduan lengkap (admin maks 600 karakter), bukan dipotong 180.
    lines.push(`💡 <b>${en ? "How to find your ID" : "Cara cek ID"}:</b> <i>${escapeHtml(truncate(params.idGuide, 600))}</i>`);
  }
  lines.push("", en ? "Type /batal to cancel." : "Ketik /batal untuk membatalkan.");
  return lines.join("\n");
}

export function gamesReviewMessage(params: {
  gameName: string;
  gameSlug?: string | null;
  packageName: string;
  typeLabel?: string | null;
  accountDisplay: string;
  nickname?: string | null;
  nicknameUnavailable?: boolean;
  regionWarning?: { accountRegion: string; variantRegion: string } | null;
  total: number;
  ctx?: TgPriceCtx;
}): string {
  const locale = params.ctx?.locale ?? "id";
  const en = locale === "en";
  const pkg = params.typeLabel ? `${params.packageName} (${params.typeLabel})` : params.packageName;
  const lines = [
    en ? "<b>🧾 Confirm Game Top Up</b>" : "<b>🧾 Konfirmasi Top Up Game</b>",
    "━━━━━━━━━━━━━━━━",
    `Game     : ${gameLogoHtml(params.gameSlug)} <b>${escapeHtml(params.gameName)}</b>`,
    `${en ? "Package " : "Nominal "} : ${escapeHtml(pkg)}`,
    `${en ? "Account " : "ID Akun "} : <code>${escapeHtml(params.accountDisplay)}</code>`,
  ];
  if (params.nickname) {
    lines.push(`Nickname : <b>${escapeHtml(params.nickname)}</b> ✓`);
  } else if (params.nicknameUnavailable) {
    lines.push(en
      ? "Nickname : <i>Could not be checked right now — please double-check your ID.</i>"
      : "Nickname : <i>Belum bisa dicek saat ini — pastikan ID sudah benar.</i>");
  }
  lines.push(
    `Total    : <b>${priceText(params.total, params.ctx)}</b>`,
    "━━━━━━━━━━━━━━━━",
  );
  if (params.regionWarning) {
    lines.push(
      en
        ? `⚠️ Account detected in region <b>${escapeHtml(params.regionWarning.accountRegion)}</b>, while this package is for <b>${escapeHtml(params.regionWarning.variantRegion)}</b>.`
        : `⚠️ Akun terdeteksi region <b>${escapeHtml(params.regionWarning.accountRegion)}</b>, sedangkan nominal ini untuk <b>${escapeHtml(params.regionWarning.variantRegion)}</b>.`,
      "",
    );
  }
  lines.push(
    en
      ? "⚡ Processed automatically right after payment. Double-check your ID — processed top ups cannot be cancelled."
      : "⚡ Pengiriman instan otomatis setelah lunas. Pastikan ID & nominal benar — top up yang sudah diproses tidak dapat dibatalkan.",
  );
  return lines.join("\n");
}

export function gamesPaidNoticeMessage(params: {
  orderCode: string;
  gameName: string;
  packageName: string;
  customerNo: string;
  nickname?: string | null;
  locale: Locale;
}): string {
  const en = params.locale === "en";
  const lines = [
    en ? "<b>✅ Payment confirmed — Top up processing</b>" : "<b>✅ Pembayaran lunas — Top up diproses</b>",
    `<code>${escapeHtml(params.orderCode)}</code>`,
    "",
    `🎮 <b>${escapeHtml(params.gameName)}</b> · ${escapeHtml(params.packageName)}`,
    `${en ? "Account ID" : "ID Akun"}: <code>${escapeHtml(params.customerNo)}</code>${params.nickname ? ` (${escapeHtml(params.nickname)})` : ""}`,
    "",
    en
      ? "Your top up is being processed automatically. We will notify you here as soon as it succeeds."
      : "Top up sedang diproses otomatis. Kamu akan langsung dikabari di chat ini begitu selesai.",
  ];
  return lines.join("\n");
}

export function gamesCompletedNoticeMessage(params: {
  orderCode: string;
  gameName: string;
  packageName: string;
  customerNo: string;
  nickname?: string | null;
  sn: string;
  locale: Locale;
}): string {
  const en = params.locale === "en";
  return [
    en ? "<b>🎉 Top Up Successful!</b>" : "<b>🎉 Top Up Berhasil!</b>",
    `<code>${escapeHtml(params.orderCode)}</code>`,
    "",
    `🎮 <b>${escapeHtml(params.gameName)}</b> · ${escapeHtml(params.packageName)}`,
    `${en ? "Account ID" : "ID Akun"}: <code>${escapeHtml(params.customerNo)}</code>${params.nickname ? ` (${escapeHtml(params.nickname)})` : ""}`,
    `SN: <code>${escapeHtml(params.sn)}</code>`,
    "",
    en ? "Thank you for topping up at AXVARA Games!" : "Terima kasih sudah top up di AXVARA Games!",
  ].join("\n");
}

export function gamesStatusLabel(status: GamesBuyerStatus, locale: Locale, manualRefundRequired = false): string {
  const en = locale === "en";
  if (manualRefundRequired) {
    return en ? "Needs admin follow-up" : "Perlu tindak lanjut admin";
  }
  switch (status) {
    case "awaiting_payment": return en ? "Awaiting payment" : "Menunggu pembayaran";
    case "processing": return en ? "Processing automatically" : "Sedang diproses otomatis";
    case "success": return en ? "Top up successful" : "Top up berhasil";
    case "needs_admin": return en ? "Being checked by admin" : "Sedang diperiksa admin";
    case "expired": return en ? "Expired / Cancelled" : "Kedaluwarsa / Dibatalkan";
  }
}

export function gamesOrderDetailMessage(params: {
  orderCode: string;
  gameName: string;
  packageName: string;
  customerNo: string;
  nickname?: string | null;
  payableAmount: number;
  paymentStatus: string;
  buyerStatus: GamesBuyerStatus;
  manualRefundRequired?: boolean;
  sn?: string | null;
  createdAtText?: string | null;
  paidAtText?: string | null;
  locale: Locale;
}): string {
  const en = params.locale === "en";
  const payText = params.paymentStatus === "paid"
    ? (en ? "Paid" : "Lunas")
    : ["expired", "failed", "cancelled"].includes(params.paymentStatus)
      ? (en ? "Cancelled / Expired" : "Batal / Kedaluwarsa")
      : (en ? "Awaiting payment" : "Menunggu pembayaran");
  const lines = [
    en ? "<b>🎮 Game Order Status</b>" : "<b>🎮 Status Pesanan Games</b>",
    `<code>${escapeHtml(params.orderCode)}</code>`,
    "",
    `Game     : <b>${escapeHtml(params.gameName)}</b>`,
    `${en ? "Package " : "Nominal "} : ${escapeHtml(params.packageName)}`,
    `${en ? "Account " : "ID Akun "} : <code>${escapeHtml(params.customerNo)}</code>${params.nickname ? ` (${escapeHtml(params.nickname)})` : ""}`,
    `Total    : ${formatRupiah(params.payableAmount)}`,
    "",
    `${en ? "Payment" : "Pembayaran"}: ${payText}`,
    `${en ? "Top Up " : "Top Up "}   : ${gamesStatusLabel(params.buyerStatus, params.locale, params.manualRefundRequired)}`,
  ];
  if (params.buyerStatus === "success" && params.sn) {
    lines.push(`SN: <code>${escapeHtml(params.sn)}</code>`);
  }
  if (params.createdAtText) lines.push(`${en ? "🗓 Ordered" : "🗓 Dibuat"}: ${params.createdAtText}`);
  if (params.paidAtText) lines.push(`${en ? "✅ Paid" : "✅ Lunas"}: ${params.paidAtText}`);
  return lines.join("\n");
}
