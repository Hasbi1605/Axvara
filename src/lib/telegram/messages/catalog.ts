import { escapeHtml, escapeItemSummary, formatRupiah, truncate, formatSoldCountLabel, paymentLabels, fulfillmentLabels } from "./format";

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

export function catalogFlatMessage(total: number): string {
  return [
    "<b>🛍 Katalog AXVARA</b>",
    "",
    total > 0
      ? `${total} produk tersedia.`
      : "Belum ada produk tersedia.",
  ].join("\n");
}

export function categoriesMessage(): string {
  return [
    "<b>Kategori produk</b>",
    "",
    "Pilih kategori untuk melihat produk:",
  ].join("\n");
}

export function categoryProductsMessage(categoryName: string, total: number): string {
  const name = escapeHtml(truncate(categoryName, 50));
  return [
    `<b>${name}</b>`,
    "",
    total > 0 ? `${total} produk tersedia.` : "Belum ada produk tersedia di kategori ini.",
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
}): string {
  const name = escapeHtml(truncate(product.name, 100));
  const price = formatRupiah(product.price);

  const lines: string[] = [];

  lines.push(`<b>${name}</b>`);
  const description = product.description?.trim().split(/\r?\n\s*\r?\n/)[0];
  if (description) {
    lines.push("", escapeItemSummary(truncate(description, 300), 900));
  }
  lines.push("");
  if (product.compare_price && product.compare_price > product.price) {
    const discount = Math.round((1 - product.price / product.compare_price) * 100);
    lines.push(`Harga: <b>${price}</b> (sebelumnya <s>${formatRupiah(product.compare_price)}</s>, hemat ${discount}%)`);
  } else if (product.variants && product.variants.length > 1) {
    lines.push(`Harga mulai <b>${price}</b>`);
  } else {
    lines.push(`Harga: <b>${price}</b>`);
  }

  const sold = Math.max(0, Math.floor(product.sold_count ?? 0));
  if (sold > 0) lines.push(formatSoldCountLabel(sold));

  const stock = product.stock;
  if (stock === -1) {
    lines.push("Stok tersedia");
  } else if (stock != null && stock > 0) {
    lines.push(`Stok: ${stock}`);
  } else if (stock === 0) {
    lines.push("Stok habis");
  }

  lines.push("");
  // Delivery labels come from catalog metadata, never the product name.
  const deliveryLines = (product.variants ?? []).filter((v) => (v.delivery_badge ?? "").trim() !== "");
  if (deliveryLines.length > 0) {
    lines.push("<b>Pengiriman</b>");
    const deliverySummary = deliveryLines.slice(0, 10).map(v => {
      const delivery = String(v.delivery_badge).replace(/^[⚡⏳]\s*/, "");
      return `• ${truncate(v.label, 40)}: ${truncate(delivery, 80)}`;
    }).join("\n");
    lines.push(escapeItemSummary(deliverySummary, 1800));
    lines.push("");
  }
  if (product.variants && product.variants.length > 1) lines.push(`${product.variants.length} varian.`);

  return lines.join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MY ORDERS & SEARCH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function myOrdersPrompt(): string {
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

export function myOrdersMessage(orders: TelegramOrderRow[]): string {
  if (orders.length === 0) {
    return [
      "<b>Pesanan saya</b>",
      "",
      "Belum ada pesanan dari akun Telegram ini.",
      "",
      "Lihat produk di /katalog.",
    ].join("\n");
  }
  const lines = [
    "<b>Pesanan saya</b>",
    "",
  ];
  const recent = orders.slice(0, 10);
  const details = recent.map(order => [
    `<code>${escapeItemSummary(order.code, 120)}</code>`,
    ...(order.payableAmount != null ? [`Total: ${formatRupiah(order.payableAmount)}`] : []),
    `Pembayaran: ${paymentLabels[order.paymentStatus] ?? "Belum diketahui"}`,
    ...(order.paymentStatus === "paid" ? [`Pengiriman: ${fulfillmentLabels[order.fulfillmentStatus] ?? "Belum diketahui"}`] : []),
    "",
  ].join("\n"));
  const summaryLimit = Math.floor((4096 - lines.join("\n").length - details.join("\n").length - recent.length * 10) / recent.length);
  recent.forEach((order, i) => {
    lines.push(`${i + 1}. ${escapeItemSummary(order.productName, summaryLimit)}`);
    lines.push(details[i]);
  });
  return lines.join("\n");
}

export function searchPromptMessage(): string {
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

export function searchResultsMessage(keyword: string, total: number, soldOut = 0, showing?: number): string {
  const kw = escapeHtml(truncate(keyword, 60));
  return [
    `<b>Hasil pencarian: ${kw}</b>`,
    "",
    total > 0
      ? `${total} produk cocok.${showing != null ? ` Menampilkan ${Math.max(0, Math.min(total, Math.floor(showing)))} produk.` : ""}`
      : soldOut > 0
        ? "Produk yang cocok sedang habis. Lihat produk lain di /katalog."
        : "Tidak ada produk yang cocok. Coba kata lain atau lihat /katalog.",
  ].join("\n");
}
