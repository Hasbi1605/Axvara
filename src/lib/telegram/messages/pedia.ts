// src/lib/telegram/messages/pedia.ts — Seluruh copy ID/EN untuk AXVARA Pedia di Bot Telegram.
// White-label ketat: semua teks melewati `whiteLabel()`; istilah SMM
// (`No Drop`, `Less Drop`, `High Drop`, `Refill N Days`, `No Refill`) tetap utuh.

import type { Locale } from "@/lib/i18n/locale";
import type { PediaCatalogTier } from "@/lib/pedia/public-catalog";
import type { PediaRefillState } from "@/lib/pedia/refill-policy";
import { pediaNumber, pediaServiceName } from "@/lib/pedia/copy";
import { refillLabel, whiteLabel, pediaDropLabel } from "@/lib/pedia/terms";
import { escapeHtml, formatRupiah, truncate } from "./format";
import { formatIdr } from "@/lib/i18n/format";
import type { TgPriceCtx } from "@/lib/telegram/keyboards";
import { tgDisplayPrice } from "@/lib/telegram/render-prefs";

function priceText(amount: number, ctx?: TgPriceCtx): string {
  const locale = ctx?.locale ?? "id";
  if (ctx?.displayCurrency === "USD" && ctx?.fx) {
    return `${tgDisplayPrice(amount, { locale, displayCurrency: "USD", fx: ctx.fx })} (${formatIdr(amount, locale)})`;
  }
  return formatRupiah(amount);
}

export function pediaHomeMessage(platformCount: number, productCount: number, locale: Locale = "id"): string {
  const en = locale === "en";
  if (en) {
    return [
      `<b>📈 AXVARA Pedia</b> · ${platformCount} platforms · ${productCount} services`,
      "24/7 automatic processing · No account password needed.",
      "",
      "💡 <b>Tip:</b> You can also paste an Instagram/TikTok/YouTube link directly in this chat!",
      "",
      "Pick a popular platform below:",
    ].join("\n");
  }
  return [
    `<b>📈 AXVARA Pedia</b> · ${platformCount} platform · ${productCount} layanan`,
    "Proses otomatis 24 jam · Tanpa password akun.",
    "",
    "💡 <b>Tips:</b> Kamu juga bisa langsung tempel link IG/TikTok/YouTube di chat ini!",
    "",
    "Pilih platform populer di bawah:",
  ].join("\n");
}

export function pediaAllPlatformsMessage(total: number, page: number, totalPages: number, locale: Locale = "id"): string {
  const en = locale === "en";
  return [
    `<b>📈 ${en ? "All Pedia Platforms" : "Semua Platform Pedia"}</b> (${total})`,
    totalPages > 1 ? `${en ? "Page" : "Halaman"} ${page + 1}/${totalPages}` : "",
    en ? "Choose a platform below:" : "Pilih platform di bawah:",
  ].filter(Boolean).join("\n");
}

export function pediaPlatformProductsMessage(params: {
  platformLabel: string;
  count: number;
  page: number;
  totalPages: number;
  locale: Locale;
}): string {
  const en = params.locale === "en";
  return [
    `<b>📈 ${escapeHtml(params.platformLabel)}</b> (${params.count} ${en ? "services" : "layanan"})`,
    params.totalPages > 1 ? `${en ? "Page" : "Halaman"} ${params.page + 1}/${params.totalPages}` : "",
    en ? "Select the service you need:" : "Pilih layanan yang kamu butuhkan:",
  ].filter(Boolean).join("\n");
}

export function pediaLinkDetectedMessage(params: {
  platformLabel: string;
  targetKind: string;
  targetUrl: string;
  locale: Locale;
}): string {
  const en = params.locale === "en";
  return [
    en
      ? `<b>🔗 ${escapeHtml(params.platformLabel)} (${escapeHtml(params.targetKind)}) link detected!</b>`
      : `<b>🔗 Link ${escapeHtml(params.platformLabel)} (${escapeHtml(params.targetKind)}) terdeteksi!</b>`,
    `${en ? "Target" : "Tujuan"}: <code>${escapeHtml(truncate(params.targetUrl, 120))}</code>`,
    "",
    en ? "Choose a matching service for this link:" : "Pilih layanan yang cocok untuk link ini:",
  ].join("\n");
}

export type PediaTierFilter = "a" | "i" | "g" | "r";

export function pediaTierDisplayName(tier: PediaCatalogTier, productName: string, locale: Locale): string {
  const raw = whiteLabel(String(tier.public_name || tier.label_note || tier.tier || productName)).trim();
  return locale === "en" ? pediaServiceName(raw, "en") : raw;
}

export function pediaTierListMessage(params: {
  productName: string;
  tiers: PediaCatalogTier[];
  totalFiltered: number;
  filter: PediaTierFilter;
  page: number;
  totalPages: number;
  hasPreFilledTarget?: boolean;
  ctx?: TgPriceCtx;
}): string {
  const locale = params.ctx?.locale ?? "id";
  const en = locale === "en";
  const prodName = en ? pediaServiceName(whiteLabel(params.productName), "en") : whiteLabel(params.productName);
  const filterName = params.filter === "i" ? "🇮🇩 Indonesia"
    : params.filter === "g" ? "🌍 Global"
      : params.filter === "r" ? "🛡 Refill"
        : (en ? "All" : "Semua");
  const lines = [
    `<b>📈 ${escapeHtml(prodName)}</b> (${params.totalFiltered} ${en ? "options" : "pilihan"})`,
    ...(params.filter !== "a" ? [`Filter: ${filterName}`] : []),
    ...(params.totalPages > 1 ? [`${en ? "Page" : "Halaman"} ${params.page + 1}/${params.totalPages}`] : []),
    "",
  ];
  if (!params.tiers.length) {
    lines.push(en ? "No services match this filter. Try another filter below." : "Tidak ada layanan untuk filter ini. Coba filter lain di bawah.");
    return lines.join("\n");
  }
  params.tiers.forEach((tier, idx) => {
    const num = idx + 1;
    const title = pediaTierDisplayName(tier, params.productName, locale);
    const regionBadge = tier.region === "indonesia" ? "🇮🇩" : tier.region === "global" ? "🌍" : "🌐";
    const star = tier.recommended ? "⭐ " : "";
    const pricePart = tier.price_ref
      ? `${priceText(tier.price_ref.price, params.ctx)} / ${pediaNumber(tier.price_ref.qty, locale)} ${en ? "comments" : "komentar"}`
      : tier.price_per_1k
        ? `${priceText(tier.price_per_1k, params.ctx)}/1.000`
        : "";
    const rLabel = tier.refill_days > 0 ? `🛡 ${refillLabel(tier.refill_days)}` : "No Refill";
    const dropPart = tier.drop_label && tier.drop_label !== "unknown" ? ` · ${pediaDropLabel(tier.drop_label, locale)}` : "";
    const minPart = tier.min_qty ? ` · Min ${pediaNumber(tier.min_qty, locale)}` : "";
    const commentTag = tier.input_kind === "comments" ? (en ? " · Custom Comments" : " · Komentar Custom") : "";
    lines.push(`${num}. ${star}${regionBadge} <b>${escapeHtml(truncate(title, 90))}</b>`);
    lines.push(`   ${[pricePart, rLabel].filter(Boolean).join(" · ")}${dropPart}${minPart}${commentTag}`);
  });
  lines.push("", en ? "Tap a service number below:" : "Pilih nomor layanan di bawah:");
  return lines.join("\n");
}

export function pediaTargetPromptMessage(params: {
  productName: string;
  tierName: string;
  platformLabel: string;
  targetKind: string;
  example: string;
  locale: Locale;
}): string {
  const en = params.locale === "en";
  return [
    `<b>📈 ${escapeHtml(whiteLabel(params.productName))}</b>`,
    `${en ? "Quality" : "Kualitas"}: ${escapeHtml(whiteLabel(params.tierName))}`,
    "",
    en
      ? `Send the target <b>${escapeHtml(params.platformLabel)} ${escapeHtml(params.targetKind)}</b> link.`
      : `Kirim link <b>${escapeHtml(params.targetKind)} ${escapeHtml(params.platformLabel)}</b> tujuan.`,
    `${en ? "Example" : "Contoh"}: <code>${escapeHtml(params.example)}</code>`,
    en ? "⚠️ Make sure the account/content is public." : "⚠️ Pastikan akun/konten bersifat publik (tidak dikunci).",
    "",
    en ? "Type /batal to cancel." : "Ketik /batal untuk membatalkan.",
  ].join("\n");
}

export function pediaQtyPromptMessage(params: {
  productName: string;
  tierName: string;
  targetUrl: string;
  minQty: number;
  maxQty: number;
  step: number;
  locale: Locale;
}): string {
  const en = params.locale === "en";
  const stepNote = params.step > 1
    ? (en ? ` (multiples of ${pediaNumber(params.step, params.locale)})` : ` (kelipatan ${pediaNumber(params.step, params.locale)})`)
    : "";
  return [
    `<b>📈 ${escapeHtml(whiteLabel(params.productName))}</b>`,
    `${en ? "Quality" : "Kualitas"}: ${escapeHtml(whiteLabel(params.tierName))}`,
    `${en ? "Target" : "Tujuan"}: <code>${escapeHtml(truncate(params.targetUrl, 100))}</code>`,
    "",
    en
      ? `Choose a quantity below or type a number (<b>${pediaNumber(params.minQty, params.locale)}–${pediaNumber(params.maxQty, params.locale)}</b>${stepNote}):`
      : `Pilih jumlah di bawah atau ketik angka langsung (<b>${pediaNumber(params.minQty, params.locale)}–${pediaNumber(params.maxQty, params.locale)}</b>${stepNote}):`,
  ].join("\n");
}

export function pediaCommentsPromptMessage(params: {
  productName: string;
  tierName: string;
  targetUrl: string;
  minQty: number;
  maxQty: number;
  step: number;
  locale: Locale;
}): string {
  const en = params.locale === "en";
  const stepNote = params.step > 1
    ? (en ? `, multiples of ${params.step}` : `, kelipatan ${params.step}`)
    : "";
  return [
    `<b>💬 ${escapeHtml(whiteLabel(params.productName))}</b>`,
    `${en ? "Quality" : "Kualitas"}: ${escapeHtml(whiteLabel(params.tierName))}`,
    `${en ? "Target" : "Tujuan"}: <code>${escapeHtml(truncate(params.targetUrl, 100))}</code>`,
    "",
    en
      ? `Send <b>1 message</b> containing your custom comments (<b>1 line = 1 comment</b>).`
      : `Kirim <b>1 pesan</b> berisi daftar komentar custom (<b>1 baris = 1 komentar</b>).`,
    en
      ? `Allowed: <b>${params.minQty}–${params.maxQty} lines</b>${stepNote} (max 300 chars/line).`
      : `Batas: <b>${params.minQty}–${params.maxQty} baris</b>${stepNote} (maks 300 karakter/baris).`,
    "",
    en ? "Example:\n<code>Awesome content!\nKeep it up 🔥\nAuto follow!</code>" : "Contoh:\n<code>Mantap kak 🔥\nKeren banget kontennya\nAuto follow!</code>",
    "",
    en ? "Type /batal to cancel." : "Ketik /batal untuk membatalkan.",
  ].join("\n");
}

export function pediaReviewMessage(params: {
  productName: string;
  tierName: string;
  targetUrl: string;
  qty: number;
  refillDays: number;
  refillAnchor?: "created" | "completed";
  etaStart?: string | null;
  etaFinish?: string | null;
  isComments?: boolean;
  total: number;
  ctx?: TgPriceCtx;
}): string {
  const locale = params.ctx?.locale ?? "id";
  const en = locale === "en";
  const prod = en ? pediaServiceName(whiteLabel(params.productName), "en") : whiteLabel(params.productName);
  const tier = en ? pediaServiceName(whiteLabel(params.tierName), "en") : whiteLabel(params.tierName);
  const refillText = params.refillDays > 0
    ? `🛡 ${refillLabel(params.refillDays)}${params.refillAnchor === "completed" ? (en ? " (since completed)" : " (sejak selesai)") : (en ? " (since created)" : " (sejak pesanan dibuat)")}`
    : "No Refill";
  const eta = params.etaFinish || params.etaStart || null;
  const qtyLabel = params.isComments
    ? `${pediaNumber(params.qty, locale)} ${en ? "comments" : "komentar"}`
    : pediaNumber(params.qty, locale);

  const lines = [
    en ? "<b>🧾 Confirm Pedia Order</b>" : "<b>🧾 Konfirmasi Pesanan Pedia</b>",
    "━━━━━━━━━━━━━━━━",
    `${en ? "Service" : "Layanan"}  : <b>${escapeHtml(prod)}</b>`,
    `${en ? "Quality" : "Kualitas"} : ${escapeHtml(truncate(tier, 100))}`,
    `${en ? "Target" : "Tujuan"}   : <code>${escapeHtml(truncate(params.targetUrl, 120))}</code>`,
    `${en ? "Quantity" : "Jumlah"}   : <b>${qtyLabel}</b>`,
    `${en ? "Refill" : "Garansi"}  : ${refillText}`,
    ...(eta ? [`${en ? "Estimate" : "Estimasi"} : ${escapeHtml(whiteLabel(eta))}`] : []),
    `Total    : <b>${priceText(params.total, params.ctx)}</b>`,
    "━━━━━━━━━━━━━━━━",
    en ? "⚠️ Required before paying:" : "⚠️ Syarat wajib sebelum bayar:",
    en ? "• Keep the account/post PUBLIC during processing." : "• Pastikan akun/postingan TIDAK dikunci (Publik) selama proses.",
    en ? "• Do not change username or delete the target before completion." : "• Jangan ganti username atau hapus target sebelum pesanan selesai.",
    en ? "• By paying, you agree to the Pedia Terms." : "• Dengan membayar, kamu menyetujui Ketentuan Pedia.",
  ];
  return lines.join("\n");
}

export function pediaStatusLabel(status: string, locale: Locale): string {
  const en = locale === "en";
  switch (status) {
    case "awaiting_payment": return en ? "Awaiting payment" : "Menunggu pembayaran";
    case "queued":
    case "submitting": return en ? "Queued (automatic)" : "Masuk antrean otomatis";
    case "submitted":
    case "in_progress": return en ? "Processing automatically" : "Sedang diproses otomatis";
    case "completed": return en ? "Completed" : "Selesai";
    case "partial": return en ? "Partially completed — admin following up" : "Selesai sebagian — ditindaklanjuti admin";
    case "canceled": return en ? "Canceled — admin following up" : "Dibatalkan — ditindaklanjuti admin";
    case "needs_check": return en ? "Being checked by admin" : "Sedang diperiksa admin";
    case "expired": return en ? "Expired / Cancelled" : "Kedaluwarsa / Dibatalkan";
    default: return en ? "Processing" : "Sedang diproses";
  }
}

export function pediaPaidNoticeMessage(params: {
  orderCode: string;
  productName: string;
  serviceName: string;
  quantity: number;
  target: string;
  etaStart?: string | null;
  locale: Locale;
}): string {
  const en = params.locale === "en";
  return [
    en ? "<b>✅ Payment confirmed — Order queued</b>" : "<b>✅ Pembayaran lunas — Pesanan masuk antrean</b>",
    `<code>${escapeHtml(params.orderCode)}</code>`,
    "",
    `📈 <b>${escapeHtml(whiteLabel(params.productName))}</b> · ${pediaNumber(params.quantity, params.locale)}`,
    `${en ? "Quality" : "Kualitas"}: ${escapeHtml(truncate(whiteLabel(params.serviceName), 100))}`,
    ...(params.target ? [`${en ? "Target" : "Tujuan"}: <code>${escapeHtml(truncate(params.target, 120))}</code>`] : []),
    ...(params.etaStart ? [`${en ? "Est. start" : "Est. mulai"}: ${escapeHtml(whiteLabel(params.etaStart))}`] : []),
    "",
    en
      ? "Your order is processed automatically. We will notify you here once it completes."
      : "Pesananmu diproses otomatis. Kami kabari lagi di chat ini begitu selesai.",
  ].join("\n");
}

export function pediaCompletedNoticeMessage(params: {
  orderCode: string;
  productName: string;
  serviceName: string;
  quantity: number;
  target: string;
  refillDays: number;
  refillEligible: boolean;
  locale: Locale;
}): string {
  const en = params.locale === "en";
  const lines = [
    en ? "<b>🎉 Pedia Order Completed!</b>" : "<b>🎉 Pesanan Pedia Selesai!</b>",
    `<code>${escapeHtml(params.orderCode)}</code>`,
    "",
    `📈 <b>${escapeHtml(whiteLabel(params.productName))}</b> · ${pediaNumber(params.quantity, params.locale)}`,
    `${en ? "Quality" : "Kualitas"}: ${escapeHtml(truncate(whiteLabel(params.serviceName), 100))}`,
    ...(params.target ? [`${en ? "Target" : "Tujuan"}: <code>${escapeHtml(truncate(params.target, 120))}</code>`] : []),
  ];
  if (params.refillDays > 0) {
    lines.push(
      "",
      params.refillEligible
        ? (en
          ? `🛡 Includes <b>${refillLabel(params.refillDays)}</b>. If the count drops during the refill period, tap <b>Request Refill</b> below.`
          : `🛡 Layanan ini memiliki <b>${refillLabel(params.refillDays)}</b>. Bila jumlah turun dalam masa refill, tekan <b>Ajukan Refill</b> di bawah.`)
        : `🛡 ${refillLabel(params.refillDays)}`,
    );
  }
  lines.push("", en ? "Thank you for ordering at AXVARA Pedia!" : "Terima kasih sudah memesan di AXVARA Pedia!");
  return lines.join("\n");
}

export function pediaFollowupNoticeMessage(orderCode: string, locale: Locale): string {
  const en = locale === "en";
  return [
    en ? "<b>ℹ️ Pedia Order Update</b>" : "<b>ℹ️ Info Pesanan Pedia</b>",
    `<code>${escapeHtml(orderCode)}</code>`,
    "",
    en
      ? "This order was partially completed or canceled and requires manual resolution. Please contact admin via WhatsApp with this order code — no need to reorder."
      : "Pesanan ini selesai sebagian atau dibatalkan dan memerlukan penyelesaian manual. Hubungi admin lewat WhatsApp dengan kode pesanan ini — tidak perlu pesan ulang.",
  ].join("\n");
}

export function pediaOrderDetailMessage(params: {
  orderCode: string;
  productName: string;
  serviceName: string;
  quantity: number;
  target: string;
  payableAmount: number;
  paymentStatus: string;
  itemStatus: string;
  startCount: number | null;
  remains: number | null;
  done: number | null;
  refill: PediaRefillState;
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
  const unknown = en ? "Not reported yet" : "Belum dilaporkan";
  const lines = [
    en ? "<b>📈 Pedia Order Status</b>" : "<b>📈 Status Pesanan Pedia</b>",
    `<code>${escapeHtml(params.orderCode)}</code>`,
    "",
    `${en ? "Service" : "Layanan"}  : <b>${escapeHtml(whiteLabel(params.productName))}</b>`,
    `${en ? "Quality" : "Kualitas"} : ${escapeHtml(truncate(whiteLabel(params.serviceName), 100))}`,
    ...(params.target ? [`${en ? "Target" : "Tujuan"}   : <code>${escapeHtml(truncate(params.target, 120))}</code>`] : []),
    `${en ? "Quantity" : "Jumlah"}   : ${pediaNumber(params.quantity, params.locale)}`,
    `Total    : ${formatRupiah(params.payableAmount)}`,
    "",
    `${en ? "Payment" : "Pembayaran"}: ${payText}`,
    `Status   : ${pediaStatusLabel(params.itemStatus, params.locale)}`,
  ];
  if (params.paymentStatus === "paid") {
    lines.push(
      `${en ? "Start count" : "Jumlah awal"}: ${params.startCount != null ? pediaNumber(params.startCount, params.locale) : unknown}`,
      `${en ? "Delivered" : "Masuk"}: ${params.done != null ? `${pediaNumber(params.done, params.locale)} / ${pediaNumber(params.quantity, params.locale)}` : unknown}`,
    );
    if (params.itemStatus !== "completed" && params.remains != null) {
      lines.push(`${en ? "Remaining" : "Sisa"}: ${pediaNumber(params.remains, params.locale)}`);
    }
    const refillTag = params.refill.days > 0 ? refillLabel(params.refill.days) : "No Refill";
    const lastStatus = params.refill.status_label ? ` (${params.refill.status_label})` : "";
    lines.push(`Refill: ${refillTag}${lastStatus}`);
  }
  if (params.createdAtText) lines.push(`${en ? "🗓 Ordered" : "🗓 Dibuat"}: ${params.createdAtText}`);
  if (params.paidAtText) lines.push(`${en ? "✅ Paid" : "✅ Lunas"}: ${params.paidAtText}`);
  return lines.join("\n");
}
