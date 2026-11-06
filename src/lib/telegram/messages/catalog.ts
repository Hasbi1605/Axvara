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
};

export function welcomeMessage(firstName: string, bestsellers: TelegramBestseller[] = []): string {
  const name = escapeHtml(truncate(firstName, 50));
  const lines = [
    `<b>Halo, ${name}.</b>`,
    "Selamat datang di AXVARA.",
    "",
  ];
  const top = bestsellers.filter((b) => b.productId > 0).slice(0, 3);
  if (top.length > 0) {
    lines.push("<b>Paling laris</b>");
    top.forEach((item, i) => {
      lines.push(`${i + 1}. ${escapeHtml(truncate(item.name, 50))}: ${formatRupiah(item.price)}, ${formatSoldCountLabel(item.soldCount)}`);
    });
    lines.push("");
  }
  lines.push("Lihat produk di /katalog atau cari lewat /cari.");
  return lines.join("\n");
}

export function catalogFlatMessage(total: number, opts?: { locale?: Locale }): string {
  const en = opts?.locale === "en";
  return [
    en ? "<b>🛍 AXVARA Catalog</b>" : "<b>🛍 Katalog AXVARA</b>",
    "",
    total > 0
      ? en ? `${total} products available.` : `${total} produk tersedia.`
      : en ? "No products available." : "Belum ada produk tersedia.",
  ].join("\n");
}

export function categoriesMessage(opts?: { locale?: Locale }): string {
  const en = opts?.locale === "en";
  return en
    ? ["<b>Product categories</b>", "", "Choose a category:"].join("\n")
    : [
        "<b>Kategori produk</b>",
        "",
        "Pilih kategori untuk melihat produk:",
      ].join("\n");
}

export function categoryProductsMessage(categoryName: string, total: number, opts?: { locale?: Locale }): string {
  const name = escapeHtml(truncate(categoryName, 50));
  const en = opts?.locale === "en";
  return [
    `<b>${name}</b>`,
    "",
    total > 0 ? (en ? `${total} products available.` : `${total} produk tersedia.`) : (en ? "No products available in this category." : "Belum ada produk tersedia di kategori ini."),
  ].join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PRODUCT DETAIL (ringkas; detail varian hidup di inline keyboard)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type TelegramVariantLine = {
  label: string;
  price: number;
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
  /** Only the first paragraph is shown; selected-variant terms come from the handler. */
  description?: string | null;
  price: number;
  compare_price?: number | null;
  stock?: number | null;
  badge?: string | null;
  sold_count?: number | null;
  variants?: TelegramVariantLine[] | null;
}, opts?: { locale?: Locale; usdEquivalentText?: string | null; usdUnavailable?: boolean }): string {
  const name = escapeHtml(truncate(product.name, 100));
  const price = formatIdr(product.price, opts?.locale ?? "id");
  const en = opts?.locale === "en";

  const lines: string[] = [];

  lines.push(`<b>${name}</b>`);
  const description = product.description?.trim().split(/\r?\n\s*\r?\n/)[0];
  if (description) {
    lines.push("", escapeItemSummary(truncate(description, 300), 900));
  }
  lines.push("");
  if (product.compare_price && product.compare_price > product.price) {
    const discount = Math.round((1 - product.price / product.compare_price) * 100);
    lines.push(en
      ? `Price: <b>${price}</b> (was <s>${formatIdr(product.compare_price, opts?.locale ?? "id")}</s>, save ${discount}%)`
      : `Harga: <b>${price}</b> (sebelumnya <s>${formatIdr(product.compare_price, opts?.locale ?? "id")}</s>, hemat ${discount}%)`);
    lines.push(...moneyLine("", opts).slice(1));
  } else if (product.variants && product.variants.length > 1) {
    lines.push(en ? `From <b>${price}</b>` : `Harga mulai <b>${price}</b>`);
    lines.push(...moneyLine("", opts).slice(1));
  } else {
    lines.push(en ? `Price: <b>${price}</b>` : `Harga: <b>${price}</b>`);
    lines.push(...moneyLine("", opts).slice(1));
  }
  if (opts?.usdUnavailable) {
    lines.push(en ? "USD equivalent unavailable — shown in IDR." : "Perkiraan USD tidak tersedia — ditampilkan dalam IDR.");
  }

  const sold = Math.max(0, Math.floor(product.sold_count ?? 0));
  if (sold > 0) lines.push(formatSoldCountLabel(sold));

  const stock = product.stock;
  if (stock === -1) {
    lines.push(en ? "In stock" : "Stok tersedia");
  } else if (stock != null && stock > 0) {
    lines.push(en ? `Stock: ${stock}` : `Stok: ${stock}`);
  } else if (stock === 0) {
    lines.push(en ? "Out of stock" : "Stok habis");
  }

  lines.push("");
  // Delivery labels come from catalog metadata, never the product name.
  const deliveryLines = (product.variants ?? []).filter((v) => (v.delivery_badge ?? "").trim() !== "");
  if (deliveryLines.length > 0) {
    lines.push(en ? "<b>Delivery</b>" : "<b>Pengiriman</b>");
    const deliverySummary = deliveryLines.slice(0, 10).map(v => {
      const delivery = String(v.delivery_badge).replace(/^[⚡⏳]\s*/, "");
      return `• ${truncate(v.label, 40)}: ${truncate(delivery, 80)}`;
    }).join("\n");
    lines.push(escapeItemSummary(deliverySummary, 1800));
    lines.push("");
  }
  if (product.variants && product.variants.length > 1) lines.push(en ? `${product.variants.length} variants.` : `${product.variants.length} varian.`);

  return lines.join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MY ORDERS & SEARCH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function myOrdersPrompt(opts?: { locale?: Locale }): string {
  if (opts?.locale === "en") {
    return [
      "<b>Check order</b>",
      "",
      "Type /pesanan followed by the order code:",
      "<code>/pesanan AXV-XXXXXXXX-XXXXXXXX</code>",
    ].join("\n");
  }
  return [
    "<b>Cek pesanan</b>",
    "",
    "Ketik /pesanan diikuti kode pesanan:",
    "<code>/pesanan AXV-XXXXXXXX-XXXXXXXX</code>",
  ].join("\n");
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
    return [
      en ? "<b>My orders</b>" : "<b>Pesanan saya</b>",
      "",
      en ? "No orders from this Telegram account yet." : "Belum ada pesanan dari akun Telegram ini.",
      "",
      en ? "Browse products in /katalog." : "Lihat produk di /katalog.",
    ].join("\n");
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
    return [
      "<b>Search products</b>",
      "",
      "Type the product name you are looking for.",
      "",
      "Example: <code>canva</code>, <code>chatgpt</code>, <code>netflix</code>",
      "",
      "/batal to go back.",
    ].join("\n");
  }
  return [
    "<b>Cari produk</b>",
    "",
    "Ketik nama produk yang kamu cari.",
    "",
    "Contoh: <code>canva</code>, <code>chatgpt</code>, <code>netflix</code>",
    "",
    "/batal untuk kembali.",
  ].join("\n");
}

export function searchResultsMessage(keyword: string, total: number, soldOut = 0, showing?: number, opts?: { locale?: Locale }): string {
  const kw = escapeHtml(truncate(keyword, 60));
  const en = opts?.locale === "en";
  return [
    en ? `<b>Search results: ${kw}</b>` : `<b>Hasil pencarian: ${kw}</b>`,
    "",
    total > 0
      ? (en ? `${total} matching products.${showing != null ? ` Showing ${Math.max(0, Math.min(total, Math.floor(showing)))} products.` : ""}` : `${total} produk cocok.${showing != null ? ` Menampilkan ${Math.max(0, Math.min(total, Math.floor(showing)))} produk.` : ""}`)
      : soldOut > 0
        ? (en ? "Matching products are sold out. Browse other products in /katalog." : "Produk yang cocok sedang habis. Lihat produk lain di /katalog.")
        : (en ? "No matching products. Try another keyword or browse /katalog." : "Tidak ada produk yang cocok. Coba kata lain atau lihat /katalog."),
  ].join("\n");
}
