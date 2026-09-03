// src/lib/telegram/keyboards.ts — Stateless callback_data keyboards
// All callback_data values MUST be <= 64 bytes (Telegram limit).

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
      [{ text: "📦 Katalog", callback_data: cb.categories() }],
      [{ text: "📋 Pesanan Saya", callback_data: "myorders" }],
      [{ text: "❓ Bantuan", callback_data: "help" }],
    ],
  };
}

export function categoriesKeyboard(
  categories: { id: number; name: string }[],
  page = 0,
): InlineKeyboardMarkup {
  const start = page * PER_PAGE;
  const pageItems = categories.slice(start, start + PER_PAGE);
  const rows: InlineKeyboardButton[][] = pageItems.map((cat) => [
    { text: cat.name, callback_data: cb.category(cat.id) },
  ]);

  const nav: InlineKeyboardButton[] = [];
  if (page > 0) nav.push({ text: "‹ Sebelumnya", callback_data: cb.categories(page - 1) });
  if (start + PER_PAGE < categories.length) nav.push({ text: "Berikutnya ›", callback_data: cb.categories(page + 1) });
  if (nav.length) rows.push(nav);

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
  const rows: InlineKeyboardButton[][] = pageItems.map((p) => [
    { text: `${p.name} — Rp${p.price.toLocaleString("id-ID")}`, callback_data: cb.product(p.id) },
  ]);

  const nav: InlineKeyboardButton[] = [];
  if (page > 0) nav.push({ text: "‹ Sebelumnya", callback_data: cb.category(categoryId, page - 1) });
  if (start + PER_PAGE < products.length) nav.push({ text: "Berikutnya ›", callback_data: cb.category(categoryId, page + 1) });
  if (nav.length) rows.push(nav);

  rows.push([{ text: "⬅️ Kategori", callback_data: cb.categories() }]);
  return { inline_keyboard: rows };
}

export function productDetailKeyboard(productId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "🛒 Beli Sekarang", callback_data: cb.buy(productId) }],
      [{ text: "⬅️ Kembali", callback_data: cb.categories() }],
    ],
  };
}

export function confirmPurchaseKeyboard(productId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "✅ Ya, Beli", callback_data: cb.confirm(productId) }],
      [{ text: "❌ Batal", callback_data: cb.product(productId) }],
    ],
  };
}

export function orderStatusKeyboard(orderCode: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "🔄 Cek Status", callback_data: cb.refresh(orderCode) }],
      [{ text: "❌ Batalkan", callback_data: cb.cancel(orderCode) }],
      [{ text: "🏠 Menu Utama", callback_data: cb.home() }],
    ],
  };
}

export function orderPaidKeyboard(orderCode: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "📋 Detail Pesanan", callback_data: cb.order(orderCode) }],
      [{ text: "🏠 Menu Utama", callback_data: cb.home() }],
    ],
  };
}
