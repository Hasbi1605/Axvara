// src/lib/telegram/keyboards.ts — Premium UX inline keyboards
// Patterns: ≤3 buttons per row, verbs on buttons, consistent back/home placement,
// 2-column grid for categories, single-column for products (longer labels).
// All callback_data ≤ 64 bytes.

import type { InlineKeyboardMarkup, InlineKeyboardButton } from "./types";

const PER_PAGE = 6;

// ---- Callback data builders ----
export const cb = {
  home: () => "home",
  categories: (page = 0) => `cats:${page}`,
  category: (categoryId: number, page = 0) => `cat:${categoryId}:${page}`,
  product: (productId: number) => `prd:${productId}`,
  buy: (productId: number) => `buy:${productId}`,
  confirm: (productId: number) => `confirm:${productId}`,
  order: (orderCode: string) => `order:${orderCode}`,
  cancel: (orderCode: string) => `cancel:${orderCode}`,
  refresh: (orderCode: string) => `refresh:${orderCode}`,
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
        { text: "🛍 Katalog", callback_data: cb.categories() },
        { text: "📋 Pesanan", callback_data: "myorders" },
      ],
      [
        { text: "❓ Bantuan", callback_data: "help" },
        { text: "🌐 Web", url: "https://axvara.tech" },
      ],
    ],
  };
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
        { text: "◀️ Kembali", callback_data: cb.categories() },
        { text: "🏠 Menu", callback_data: cb.home() },
      ],
    ],
  };
}

export function confirmPurchaseKeyboard(productId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ Ya, Beli", callback_data: cb.confirm(productId) },
        { text: "❌ Batal", callback_data: cb.product(productId) },
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
      [{ text: "🏠 Menu Utama", callback_data: cb.home() }],
    ],
  };
}

export function orderPaidKeyboard(orderCode: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "📋 Lihat Pesanan", callback_data: cb.order(orderCode) }],
      [
        { text: "🛍 Katalog", callback_data: cb.categories() },
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
