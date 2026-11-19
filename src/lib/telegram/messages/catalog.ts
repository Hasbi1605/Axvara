import { escapeHtml, escapeItemSummary, formatRupiah, truncate, formatSoldCountLabel, paymentLabels, fulfillmentLabels } from "./format";
import type { Locale } from "@/lib/i18n/locale";
import { formatIdr, formatUsdCents } from "@/lib/i18n/format";
import type { FxSnapshot } from "@/lib/payments/fx";

// TG2a read-surface localization: tiny optional render opts threaded through
// existing messages (default id keeps admin/group callers compiling).
// Prices: IDR primary verbatim; optional honest USD equivalent computed ONCE
// upstream and passed as exact text (no FX math in messages).
export type TgMoneyOpts = {
  locale?: Locale;
  usdEquivalentText?: string | null;
  usdUnavailable?: boolean;
};

function moneyLine(primary: string, opts?: TgMoneyOpts): string[] {
  if (!opts?.usdEquivalentText) return [primary];
  return [primary, `≈ ${opts.usdEquivalentText}`];
}

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
  return [
    en ? "<b>🛍 AXVARA Catalog</b>" : "<b>🛍 Katalog AXVARA</b>",
    total > 0
      ? en ? `${total} products available.` : `${total} produk tersedia.`
      : en ? "No products available." : "Belum ada produk tersedia.",
  ].join("\n");
}

export function categoriesMessage(opts?: { locale?: Locale }): string {
  return opts?.locale === "en" ? "<b>Product categories</b>" : "<b>Kategori produk</b>";
}

export function categoryProductsMessage(categoryName: string, total: number, opts?: { locale?: Locale }): string {
  const name = escapeHtml(truncate(categoryName, 50));
  const en = opts?.locale === "en";
  return [
    `<b>${name}</b>`,
    total > 0 ? (en ? `${total} products available.` : `${total} produk tersedia.`) : (en ? "No products in this category." : "Kategori ini belum ada produk."),
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

export function productDetailMessage(product: {
  name: string;
  description?: string | null;
  price: number;
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
  const formatPrimary = (idr: number) => (opts?.formatPrice ? opts.formatPrice(idr) : formatIdr(idr, locale));
  const priceStr = formatPrimary(product.price);

  const lines: string[] = [];
  const sold = Math.max(0, Math.floor(product.sold_count ?? 0));
  lines.push(sold > 0 ? `<b>${name}</b> · ${formatSoldCountLabel(sold, locale)}` : `<b>${name}</b>`);

  const rawVariants = product.variants ?? [];
  const purchasable = rawVariants.filter((v) => v.stock !== 0);
  const oosCount = product.outOfStockCount != null
    ? Math.max(0, Math.floor(product.outOfStockCount))
    : rawVariants.filter((v) => v.stock === 0).length;

  if (product.compare_price && product.compare_price > product.price) {
    const discount = Math.round((1 - product.price / product.compare_price) * 100);
    lines.push(en
      ? `Price: <b>${escapeHtml(priceStr)}</b> (was <s>${escapeHtml(formatPrimary(product.compare_price))}</s>, save ${discount}%)`
      : `Harga: <b>${escapeHtml(priceStr)}</b> (sebelumnya <s>${escapeHtml(formatPrimary(product.compare_price))}</s>, hemat ${discount}%)`);
  } else if (purchasable.length > 1 || rawVariants.length > 1) {
    lines.push(en ? `From <b>${escapeHtml(priceStr)}</b>` : `Harga mulai <b>${escapeHtml(priceStr)}</b>`);
  } else {
    lines.push(en ? `Price: <b>${escapeHtml(priceStr)}</b>` : `Harga: <b>${escapeHtml(priceStr)}</b>`);
  }
  lines.push(...moneyLine("", opts).slice(1));
  if (opts?.usdUnavailable) {
    lines.push(en ? "USD equivalent unavailable — shown in IDR." : "Perkiraan USD tidak tersedia — ditampilkan dalam IDR.");
  }

  const showTopStock = purchasable.length === 0 || !purchasable.some((v) => v.stock != null);
  if (showTopStock) {
    const stock = product.stock;
    if (stock === -1) lines.push(en ? "In stock" : "Stok tersedia");
    else if (stock != null && stock > 0) lines.push(en ? `Stock: ${stock}` : `Stok: ${stock}`);
    else if (stock === 0) lines.push(en ? "Out of stock" : "Stok habis");
  }

  // Highlight: one-line blockquote from supplied description (strip redundant variant-detail boilerplate).
  const rawDesc = String(product.description ?? "")
    .replace(/Detail benefit,\s*syarat,\s*dan cara aktivasi mengikuti varian yang dipilih\.?/gi, "")
    .replace(/Benefit details,\s*terms,\s*and activation steps follow the chosen variant\.?/gi, "")
    .trim();
  let highlight = "";
  let fullDescription = "";
  if (rawDesc) {
    const descLines = rawDesc.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const firstLine = descLines[0] ?? "";
    highlight = truncate(firstLine, 160);
    if (rawDesc.length > highlight.length || descLines.length > 1) {
      fullDescription = descLines.slice(1).join("\n") || rawDesc;
      if (descLines.length <= 1 && firstLine.length > 160) {
        fullDescription = rawDesc;
      }
    }
    lines.push(`<blockquote>${escapeItemSummary(highlight, 280)}</blockquote>`);
  }

  if (purchasable.length > 0) {
    lines.push("", en ? "<b>Available variants</b>" : "<b>Varian tersedia</b>");
    const visible = purchasable.slice(0, 10);
    const bulletLines = visible.map((v) => {
      const vPrice = v.price_text?.trim() || formatPrimary(v.price);
      const dur = v.duration?.trim() ? ` — ${truncate(v.duration.trim(), 24)}` : "";
      const stockTxt = v.stock == null
        ? ""
        : v.stock === -1
          ? ` · ${en ? "Ready" : "stok ∞"}`
          : ` · ${en ? `stock ${v.stock}` : `stok ${v.stock}`}`;
      return `• ${truncate(v.label, 48)}${dur} · ${vPrice}${stockTxt}`;
    });
    lines.push(escapeItemSummary(bulletLines.join("\n"), opts?.hasImage ? 450 : 1400));
    if (purchasable.length > visible.length) {
      lines.push(en ? `• +${purchasable.length - visible.length} more variants` : `• +${purchasable.length - visible.length} varian lainnya`);
    }
  }
  if (oosCount > 0) {
    lines.push(en ? `🔔 ${oosCount} other variant(s) currently out of stock` : `🔔 ${oosCount} varian lain sedang habis`);
  }

  // Warranty summary line (factual, from variant metadata only).
  const warrantyList = product.warrantySummary?.trim()
    ? [product.warrantySummary.trim()]
    : Array.from(new Set(purchasable.map((v) => String(v.warranty ?? "").trim()).filter(Boolean)));
  if (warrantyList.length > 0) {
    lines.push(`${en ? "🛡 Warranty" : "🛡 Garansi"}: ${escapeHtml(truncate(warrantyList.join(" / "), 140))}`);
  }

  // Delivery / instant status (only for purchasable variants).
  const deliveryLines = purchasable.filter((v) => (v.delivery_badge ?? "").trim() !== "");
  if (deliveryLines.length > 0) {
    const allInstant = deliveryLines.length === purchasable.length
      && purchasable.every((v) => v.wr_delivery_class === "restock" || /^⚡/.test(String(v.delivery_badge ?? "").trim()));
    if (allInstant) {
      lines.push(en ? "⚡ Instant delivery" : "⚡ Kirim otomatis");
    } else {
      lines.push("", en ? "<b>Delivery</b>" : "<b>Pengiriman</b>");
      const deliverySummary = deliveryLines.slice(0, 10).map((v) => {
        const delivery = String(v.delivery_badge).replace(/^[⚡⏳]\s*/, "");
        return `• ${truncate(v.label, 40)}: ${truncate(delivery, 80)}`;
      }).join("\n");
      lines.push(escapeItemSummary(deliverySummary, 900));
    }
  }

  const core = lines.join("\n");
  if (!fullDescription) return core;

  // Respect 1024 caption limit on photo messages by truncating ONLY full description.
  const maxTotal = opts?.maxLength ?? (opts?.hasImage ? 1024 : 3600);
  const descBudget = maxTotal - core.length - 2;
  if (descBudget < 24) return core;
  return `${core}\n\n${escapeItemSummary(fullDescription, descBudget)}`;
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
