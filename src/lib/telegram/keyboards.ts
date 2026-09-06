// src/lib/telegram/keyboards.ts — Premium UX inline keyboards
// Patterns: ≤3 buttons per row, verbs on buttons, consistent back/home placement,
// 2-column grid for categories, single-column for products (longer labels).
// All callback_data ≤ 64 bytes.

import type { InlineKeyboardMarkup, InlineKeyboardButton } from "./types";
import { adminTelegramLink, SITE } from "@/lib/site";

const PER_PAGE = 6;

// ---- Callback data builders ----
export const cb = {
  home: () => "home",
  catalog: (page = 0) => `catalog:${page}`,
  categories: (page = 0) => `cats:${page}`,
  category: (categoryId: number, page = 0) => `cat:${categoryId}:${page}`,
  product: (productId: number) => `prd:${productId}`,
  buy: (productId: number) => `buy:${productId}`,
  variants: (productId: number) => `vars:${productId}`,
  variant: (variantId: number) => `var:${variantId}`,
  confirm: (productId: number) => `confirm:${productId}`,
  confirmVariant: (productId: number, variantId: number) => `cfv:${productId}:${variantId}`,
  qty: (productId: number, variantId: number) => `qty:${productId}:${variantId}`,
  setQty: (productId: number, variantId: number, qty: number) => `q:${productId}:${variantId}:${qty}`,
  pay: (productId: number, variantId: number, qty: number) => `pay:${productId}:${variantId}:${qty}`,
  payMethod: (productId: number, variantId: number, qty: number, method: string) => `pm:${productId}:${variantId}:${qty}:${method}`,
  order: (orderCode: string) => `order:${orderCode}`,
  cancel: (orderCode: string) => `cancel:${orderCode}`,
  refresh: (orderCode: string) => `refresh:${orderCode}`,
  waSkip: (orderCode: string) => `waskip:${orderCode}`,
} as const;

// ---- Callback data parser ----
export function parseCallback(data: string): { action: string; params: string[] } {
  const parts = data.split(":");
  return { action: parts[0], params: parts.slice(1) };
}

// ---- Keyboard builders ----

export function homeKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🛍 Katalog", callback_data: cb.catalog() },
        { text: "📋 Pesanan", callback_data: "myorders" },
      ],
      [
        { text: "📜 Garansi & Ketentuan", callback_data: "warranty" },
        { text: "❓ Bantuan", callback_data: "help" },
      ],
      [
        { text: "🌐 Web", url: "https://axvara.tech" },
      ],
    ],
  };
}

export function catalogFlatKeyboard(
  products: { id: number; name: string; price: number }[],
  page = 0,
  perPage = 8,
): InlineKeyboardMarkup {
  // Flat product list (WA parity) — product names only, categories optional filter.
  const start = page * perPage;
  const pageItems = products.slice(start, start + perPage);

  const rows: InlineKeyboardButton[][] = pageItems.map((p) => {
    const priceStr = `Rp${(p.price / 1000).toFixed(0)}rb`;
    const label = truncateLabel(p.name, 28);
    return [{ text: `${label} • ${priceStr}`, callback_data: cb.product(p.id) }];
  });

  // Pagination (prev | 1/3 | next)
  const totalPages = Math.max(1, Math.ceil(products.length / perPage));
  const nav: InlineKeyboardButton[] = [];
  if (page > 0) nav.push({ text: "◀️", callback_data: cb.catalog(page - 1) });
  if (totalPages > 1) nav.push({ text: `${page + 1}/${totalPages}`, callback_data: "noop" });
  if (start + perPage < products.length) nav.push({ text: "▶️", callback_data: cb.catalog(page + 1) });
  if (nav.length) rows.push(nav);

  // Optional category filter + home (categories no longer mandatory)
  rows.push([
    { text: "📂 Kategori", callback_data: cb.categories() },
    { text: "🏠 Menu", callback_data: cb.home() },
  ]);
  return { inline_keyboard: rows };
}

export function categoriesKeyboard(
  categories: { id: number; name: string }[],
  page = 0,
): InlineKeyboardMarkup {
  const start = page * PER_PAGE;
  const pageItems = categories.slice(start, start + PER_PAGE);

  // Category icon mapping
  const catIcon: Record<string, string> = {
    "AI Gateway": "⚡",
    "Akun Premium": "👑",
    "Tools Pro": "🛡",
    "Bundle Kucing": "📦",
  };

  // 2-column grid for categories (short labels, fits mobile)
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < pageItems.length; i += 2) {
    const row: InlineKeyboardButton[] = [];
    row.push({
      text: `${catIcon[pageItems[i].name] ?? "📂"} ${pageItems[i].name}`,
      callback_data: cb.category(pageItems[i].id),
    });
    if (pageItems[i + 1]) {
      row.push({
        text: `${catIcon[pageItems[i + 1].name] ?? "📂"} ${pageItems[i + 1].name}`,
        callback_data: cb.category(pageItems[i + 1].id),
      });
    }
    rows.push(row);
  }

  // Pagination
  const nav: InlineKeyboardButton[] = [];
  if (page > 0) nav.push({ text: "◀️ Sebelumnya", callback_data: cb.categories(page - 1) });
  if (start + PER_PAGE < categories.length) nav.push({ text: "Berikutnya ▶️", callback_data: cb.categories(page + 1) });
  if (nav.length) rows.push(nav);

  // Home
  rows.push([{ text: "🏠 Menu Utama", callback_data: cb.home() }]);
  return { inline_keyboard: rows };
}

export function productsKeyboard(
  products: { id: number; name: string; price: number }[],
  categoryId: number,
  page = 0,
): InlineKeyboardMarkup {
  const start = page * PER_PAGE;
  const pageItems = products.slice(start, start + PER_PAGE);

  // Single-column for products (longer labels with price)
  const rows: InlineKeyboardButton[][] = pageItems.map((p) => {
    const priceStr = `Rp${(p.price / 1000).toFixed(0)}rb`;
    const label = truncateLabel(p.name, 25);
    return [{ text: `${label} • ${priceStr}`, callback_data: cb.product(p.id) }];
  });

  // Pagination
  const nav: InlineKeyboardButton[] = [];
  if (page > 0) nav.push({ text: "◀️", callback_data: cb.category(categoryId, page - 1) });
  // Page indicator
  const totalPages = Math.ceil(products.length / PER_PAGE);
  if (totalPages > 1) nav.push({ text: `${page + 1}/${totalPages}`, callback_data: "noop" });
  if (start + PER_PAGE < products.length) nav.push({ text: "▶️", callback_data: cb.category(categoryId, page + 1) });
  if (nav.length) rows.push(nav);

  // Back
  rows.push([
    { text: "◀️ Kategori", callback_data: cb.categories() },
    { text: "🏠 Menu", callback_data: cb.home() },
  ]);
  return { inline_keyboard: rows };
}

export function productDetailKeyboard(productId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "🛒 Beli Sekarang", callback_data: cb.buy(productId) }],
      [
        { text: "◀️ Katalog", callback_data: cb.catalog() },
        { text: "🏠 Menu", callback_data: cb.home() },
      ],
    ],
  };
}

export function variantsKeyboard(
  productId: number,
  variants: { id: number; label: string; price: number; stock: number; duration_label?: string | null }[],
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = variants.map((v) => {
    const priceStr = `Rp${(v.price / 1000).toFixed(0)}rb`;
    const dur = v.duration_label ? ` • ${v.duration_label}` : "";
    const isOutOfStock = v.stock === 0;
    const text = isOutOfStock
      ? `❌ ${v.label} (Habis)`
      : `${v.label}${dur} • ${priceStr}`;
    return [{
      text,
      callback_data: isOutOfStock ? "noop" : cb.variant(v.id),
    }];
  });

  rows.push([
    { text: "◀️ Kembali", callback_data: cb.product(productId) },
    { text: "🏠 Menu", callback_data: cb.home() },
  ]);

  return { inline_keyboard: rows };
}

export function confirmVariantPurchaseKeyboard(productId: number, variantId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        // Lanjut = pilih qty (bulk order), bukan langsung bayar.
        { text: "➡️ Lanjut Pilih Jumlah", callback_data: cb.qty(productId, variantId) },
      ],
      [
        { text: "📜 Syarat Garansi", callback_data: "warranty" },
        { text: "❌ Ganti Varian", callback_data: cb.variants(productId) },
      ],
    ],
  };
}

export function qtyKeyboard(params: {
  productId: number;
  variantId: number;
  stock: number;
}): InlineKeyboardMarkup {
  const { productId, variantId, stock } = params;
  const max = stock === -1 ? 20 : Math.max(1, Math.min(stock, 20));
  const quick = [1, 2, 3, 5, 10].filter((q) => q <= max);

  const rows: InlineKeyboardButton[][] = [];
  // Quick-pick rows (max 3 per row)
  for (let i = 0; i < quick.length; i += 3) {
    rows.push(
      quick.slice(i, i + 3).map((q) => ({
        text: q === 1 ? "1️⃣ 1" : q === 2 ? "2️⃣ 2" : q === 3 ? "3️⃣ 3" : q === 5 ? "5️⃣ 5" : `📦 ${q}`,
        callback_data: cb.setQty(productId, variantId, q),
      })),
    );
  }
  if (max >= 20 && !quick.includes(20)) {
    rows.push([{ text: "🔟 20 (max)", callback_data: cb.setQty(productId, variantId, 20) }]);
  }
  rows.push([
    { text: "◀️ Ganti Varian", callback_data: cb.variants(productId) },
    { text: "🏠 Menu", callback_data: cb.home() },
  ]);
  return { inline_keyboard: rows };
}

export function paymentMethodKeyboard(productId: number, variantId: number, qty: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "⚡ QRIS — otomatis", callback_data: cb.payMethod(productId, variantId, qty, "qris") }],
      [{ text: "🏦 SeaBank — manual", callback_data: cb.payMethod(productId, variantId, qty, "seabank") }],
      [{ text: "👛 E-Wallet — manual", callback_data: cb.payMethod(productId, variantId, qty, "ewallet") }],
      [
        { text: "◀️ Ubah Qty", callback_data: cb.qty(productId, variantId) },
        { text: "🏠 Menu", callback_data: cb.home() },
      ],
    ],
  };
}

export function askWaAfterInvoiceKeyboard(orderCode: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "🔄 Cek Status", callback_data: cb.refresh(orderCode) }],
      [{ text: "⏭️ Lewati", callback_data: cb.waSkip(orderCode) }],
      [{ text: "🏠 Menu Utama", callback_data: cb.home() }],
    ],
  };
}

export function confirmPurchaseKeyboard(productId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "➡️ Lanjut Pilih Jumlah", callback_data: cb.qty(productId, 0) },
      ],
      [
        { text: "📜 Syarat Garansi", callback_data: "warranty" },
        { text: "❌ Batal", callback_data: cb.product(productId) },
      ],
    ],
  };
}

export function warrantyKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🛍️ Lanjut Belanja", callback_data: cb.catalog() },
        { text: "🏠 Menu Utama", callback_data: cb.home() },
      ],
    ],
  };
}

export function orderStatusKeyboard(orderCode: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🔄 Cek Status", callback_data: cb.refresh(orderCode) },
        { text: "❌ Batalkan", callback_data: cb.cancel(orderCode) },
      ],
      [
        { text: "🛍 Katalog", callback_data: cb.catalog() },
        { text: "🏠 Menu", callback_data: cb.home() },
      ],
    ],
  };
}

export function orderPaidKeyboard(orderCode: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "📋 Lihat Pesanan", callback_data: cb.order(orderCode) }],
      [{ text: `💬 Chat @${SITE.adminTelegram}`, url: adminTelegramLink() }],
      [
        { text: "🛍 Katalog", callback_data: cb.catalog() },
        { text: "🏠 Menu", callback_data: cb.home() },
      ],
    ],
  };
}

// ---- Helpers ----

function truncateLabel(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

// ---- Web order admin notification keyboard ----

export function webOrderAdminKeyboard(params: {
  customerWa: string;
  customerName: string;
  orderCode: string;
  siteUrl: string;
}): InlineKeyboardMarkup {
  const { customerWa, customerName, orderCode, siteUrl } = params;
  const waMsg = encodeURIComponent(`Halo ${customerName}, pesanan ${orderCode} kamu sudah kami terima. Admin akan segera memproses.`);
  return {
    inline_keyboard: [
      [
        { text: "💬 WA Buyer", url: `https://wa.me/${customerWa}?text=${waMsg}` },
        { text: "🔧 Panel Admin", url: `${siteUrl}/admin?section=orders` },
      ],
    ],
  };
}
