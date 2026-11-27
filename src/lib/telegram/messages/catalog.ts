import { escapeHtml, escapeItemSummary, formatRupiah, truncate, formatSoldCountLabel, paymentLabels, fulfillmentLabels } from "./format";
import type { Locale } from "@/lib/i18n/locale";
import { appLogoEmojiId } from "../app-logo-emoji";

// TG2a read-surface localization: tiny optional render opts threaded through
// existing messages (default id keeps admin/group callers compiling).
// Prices: IDR primary verbatim; optional honest USD equivalent computed ONCE
// upstream and passed as exact text (no FX math in messages).
export type TgMoneyOpts = {
  locale?: Locale;
  usdEquivalentText?: string | null;
  usdUnavailable?: boolean;
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WELCOME & NAVIGATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type TelegramBestseller = {
  name: string;
  price: number;
  soldCount: number;
  productId: number;
  stock?: number;
};

export function welcomeMessage(firstName: string, bestsellers: TelegramBestseller[] = []): string {
  const name = escapeHtml(truncate(firstName, 50));
  const lines = [`<b>AXVARA</b> · Halo, ${name}.`];
  const top = bestsellers.filter((b) => b.productId > 0).slice(0, 3);
  if (top.length > 0) {
    lines.push("", "<b>Paling laris</b>");
    top.forEach((item, i) => {
      lines.push(`${i + 1}. ${escapeHtml(truncate(item.name, 50))}: ${formatRupiah(item.price)}, ${formatSoldCountLabel(item.soldCount)}`);
    });
  }
  lines.push("", "Lihat /katalog atau ketik nama produk.");
  return lines.join("\n");
}

export function catalogFlatMessage(total: number, opts?: { locale?: Locale }): string {
  const en = opts?.locale === "en";
  if (total > 0) {
    return en
      ? `🛍 <b>AXVARA Catalog</b> · ${total} ${total === 1 ? "product" : "products"}`
      : `🛍 <b>Katalog AXVARA</b> · ${total} produk`;
  }
  return [
    en ? "🛍 <b>AXVARA Catalog</b>" : "🛍 <b>Katalog AXVARA</b>",
    en ? "No products available." : "Belum ada produk tersedia.",
  ].join("\n");
}

export function categoriesMessage(opts?: { locale?: Locale }): string {
  return opts?.locale === "en" ? "<b>Product categories</b>" : "<b>Kategori produk</b>";
}

export function categoryProductsMessage(categoryName: string, total: number, opts?: { locale?: Locale }): string {
  const name = escapeHtml(truncate(categoryName, 50));
  const en = opts?.locale === "en";
  if (total > 0) {
    return [
      en
        ? `🛍 <b>AXVARA Catalog</b> · ${total} ${total === 1 ? "product" : "products"}`
        : `🛍 <b>Katalog AXVARA</b> · ${total} produk`,
      `<b>${name}</b>`,
    ].join("\n");
  }
  return [
    en ? "🛍 <b>AXVARA Catalog</b>" : "🛍 <b>Katalog AXVARA</b>",
    `<b>${name}</b>`,
    en ? "No products in this category." : "Kategori ini belum ada produk.",
  ].join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PRODUCT DETAIL (ringkas; detail varian hidup di inline keyboard)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type TelegramVariantLine = {
  label: string;
  price: number;
  price_text?: string | null;
  warranty?: string | null;
  duration?: string | null;
  stock?: number | null;
  /** Kelas pengiriman WR (migrasi 0032): restock = otomatis, selainnya = via admin. */
  wr_delivery_class?: string | null;
  /** Badge pengiriman siap tampil per varian ("⚡ Kirim otomatis" / "⏳ Made By Order"). Kosong = jangan render. */
  delivery_badge?: string | null;
};

const CARD_INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;
const CARD_BULLET_LINE = /^\s*(?:[-–—•·*▪✓✔]|\d{1,2}[.)]\s)/u;
const CARD_URL_LINE = /^\s*(?:https?:\/\/\S+|(?:links?|tautan)\s*:.*)$/i;
const CARD_HEADING_LINE = /^.{1,48}:$/u;

function truncateAtWordBoundary(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  if (maxChars <= 1) return "…";
  const sliced = chars.slice(0, maxChars - 1).join("");
  const lastSpace = sliced.lastIndexOf(" ");
  const cut = lastSpace >= Math.floor((maxChars - 1) * 0.5)
    ? sliced.slice(0, lastSpace)
    : sliced;
  return cut.replace(/[\s,;:.!?-]+$/u, "").trimEnd() + "…";
}

function extractShortProductDescription(raw: string | null | undefined, maxChars = 180): string {
  const cleanedRaw = String(raw ?? "")
    .replace(/Detail benefit,\s*syarat,\s*dan cara aktivasi mengikuti varian yang dipilih\.?/gi, "")
    .replace(/Benefit details,\s*terms,\s*and activation steps follow the chosen variant\.?/gi, "")
    .normalize("NFKC")
    .replace(CARD_INVISIBLE_CHARS, "")
    .trim();
  if (!cleanedRaw) return "";

  const paraLines: string[] = [];
  for (const rawLine of cleanedRaw.split(/\r?\n/)) {
    const trimmed = rawLine
      .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (!trimmed) {
      if (paraLines.length > 0) break;
      continue;
    }
    if (CARD_BULLET_LINE.test(trimmed) || CARD_URL_LINE.test(trimmed) || CARD_HEADING_LINE.test(trimmed)) {
      if (paraLines.length > 0) break;
      break;
    }
    paraLines.push(trimmed);
  }
  const para = paraLines.join(" ").replace(/\s+/g, " ").trim();
  if (!para) return "";

  const sentences = para.split(/(?<=[.!?])\s+/).filter(Boolean);
  const firstTwo = sentences.slice(0, 2).join(" ").trim();
  return truncateAtWordBoundary(firstTwo, maxChars);
}

export function productDetailMessage(product: {
  name: string;
  description?: string | null;
  price?: number;
  compare_price?: number | null;
  stock?: number | null;
  badge?: string | null;
  sold_count?: number | null;
  variants?: TelegramVariantLine[] | null;
  warrantySummary?: string | null;
  outOfStockCount?: number | null;
}, opts?: {
  locale?: Locale;
  usdEquivalentText?: string | null;
  usdUnavailable?: boolean;
  hasImage?: boolean;
  maxLength?: number;
  formatPrice?: (idr: number) => string;
}): string {
  const locale = opts?.locale ?? "id";
  const en = locale === "en";
  const name = escapeHtml(truncate(product.name, 100));
  const sold = Math.max(0, Math.floor(product.sold_count ?? 0));
  // Logo aplikasi animasi (custom emoji) di depan nama bila produk dikenal.
  const logoId = appLogoEmojiId(product.name);
  const logo = logoId ? `<tg-emoji emoji-id="${logoId}">📱</tg-emoji> ` : "";
  const titleLine = sold > 0 ? `${logo}<b>${name}</b> · ${formatSoldCountLabel(sold, locale)}` : `${logo}<b>${name}</b>`;
  const ctaLine = en ? "Choose a variant 👇" : "Pilih varian 👇";
  const shortDesc = extractShortProductDescription(product.description, 180);
  if (!shortDesc) return `${titleLine}\n${ctaLine}`;

  const maxTotal = opts?.maxLength ?? 1024;
  const full = `${titleLine}\n<blockquote>${escapeHtml(shortDesc)}</blockquote>\n${ctaLine}`;
  if (full.length <= maxTotal) return full;

  // Enforce photo-caption budget while keeping identical photo/text fallback content.
  const overhead = titleLine.length + ctaLine.length + "<blockquote></blockquote>".length + 2;
  const budget = Math.max(0, maxTotal - overhead);
  if (budget < 8) return `${titleLine}\n${ctaLine}`;

  const suffix = "…";
  let plain = "";
  let escapedLen = 0;
  for (const ch of Array.from(shortDesc)) {
    const esc = escapeHtml(ch);
    if (escapedLen + esc.length > budget - suffix.length) break;
    plain += ch;
    escapedLen += esc.length;
  }
  const trimmed = plain.trimEnd();
  return trimmed
    ? `${titleLine}\n<blockquote>${escapeHtml(trimmed)}${suffix}</blockquote>\n${ctaLine}`
    : `${titleLine}\n${ctaLine}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MY ORDERS & SEARCH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function myOrdersPrompt(opts?: { locale?: Locale }): string {
  if (opts?.locale === "en") {
    return "<b>Check order</b>\nType <code>/pesanan AXV-XXXXXXXX-XXXXXXXX</code>";
  }
  return "<b>Cek pesanan</b>\nKetik <code>/pesanan AXV-XXXXXXXX-XXXXXXXX</code>";
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

export function myOrdersMessage(orders: TelegramOrderRow[], opts?: { locale?: Locale }): string {
  const en = opts?.locale === "en";
  if (orders.length === 0) {
    return en
      ? "<b>My orders</b>\nNo orders yet. Browse /katalog."
      : "<b>Pesanan saya</b>\nBelum ada pesanan. Lihat /katalog.";
  }
  const lines = [
    en ? "<b>My orders</b>" : "<b>Pesanan saya</b>",
    "",
  ];
  const recent = orders.slice(0, 10);
  const details = recent.map(order => [
    `<code>${escapeItemSummary(order.code, 120)}</code>`,
    ...(order.payableAmount != null ? [`${en ? "Total" : "Total"}: ${formatRupiah(order.payableAmount)}`] : []),
    `${en ? "Payment" : "Pembayaran"}: ${paymentLabels[order.paymentStatus] ?? (en ? "Unknown" : "Belum diketahui")}`,
    ...(order.paymentStatus === "paid" ? [`${en ? "Delivery" : "Pengiriman"}: ${fulfillmentLabels[order.fulfillmentStatus] ?? (en ? "Unknown" : "Belum diketahui")}`] : []),
    "",
  ].join("\n"));
  lines.slice(0, 10);
  const summaryLimit = Math.floor((4096 - lines.join("\n").length - details.join("\n").length - recent.length * 10) / recent.length);
  recent.forEach((order, i) => {
    lines.push(`${i + 1}. ${escapeItemSummary(order.productName, summaryLimit)}`);
    lines.push(details[i]);
  });
  return lines.join("\n");
}

export function searchPromptMessage(opts?: { locale?: Locale }): string {
  if (opts?.locale === "en") {
    return "<b>🔎 Search products</b>\nType a product name (e.g. <code>canva</code>, <code>netflix</code>). /batal to cancel.";
  }
  return "<b>🔎 Cari produk</b>\nKetik nama produk (mis. <code>canva</code>, <code>netflix</code>). /batal untuk batal.";
}

export function searchResultsMessage(keyword: string, total: number, soldOut = 0, _showing?: number, opts?: { locale?: Locale }): string {
  const kw = escapeHtml(truncate(keyword, 60));
  const en = opts?.locale === "en";
  if (total > 0) {
    return en ? `🔎 <b>Results for “${kw}”</b>` : `🔎 <b>Hasil untuk “${kw}”</b>`;
  }
  if (soldOut > 0) {
    return en
      ? `🔎 <b>Results for “${kw}”</b>\n\nSold out. Browse /katalog.`
      : `🔎 <b>Hasil untuk “${kw}”</b>\n\nSedang habis. Cek /katalog.`;
  }
  return en
    ? `🔎 <b>Results for “${kw}”</b>\n\nNo matches. Try another keyword.`
    : `🔎 <b>Hasil untuk “${kw}”</b>\n\nTidak ketemu. Coba kata lain.`;
}
