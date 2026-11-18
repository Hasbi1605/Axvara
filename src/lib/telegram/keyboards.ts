import { MARKET_INVOICE } from "@/lib/refund/calculate";
import { MAX_UNIQUE_UNITS_PER_ORDER } from "@/lib/fulfillment/units";
// src/lib/telegram/keyboards.ts — Premium UX inline keyboards
// Patterns: ≤3 buttons per row, verbs on buttons, consistent back/home placement,
// 2-column grid for categories, single-column for products (longer labels).
// All callback_data ≤ 64 bytes.

import type { InlineKeyboardMarkup, InlineKeyboardButton, ReplyKeyboardMarkup } from "./types";
import { supportTelegramLink, SITE } from "@/lib/site";
import type { DisplayCurrency, Locale } from "@/lib/i18n/locale";
import type { FxSnapshot } from "@/lib/payments/fx";
import { tgDisplayPrice } from "./render-prefs";
import { formatIdr } from "@/lib/i18n/format";
import { getCryptoAsset } from "@/lib/payments/crypto-assets";

export type OfferMethodView = {
  id: string;
  kind?: string;
  label?: string;
  gateway?: { estimated_fee: number; estimated_total: number } | null;
  amount_text?: string;
  pay_currency?: string;
};

export type TgPriceCtx = { locale?: Locale; displayCurrency?: DisplayCurrency | null; fx?: FxSnapshot | null };
export type TgLocaleCtx = { locale?: Locale };

/** ONE primary display price for buttons. Buttons never show two
 * currencies. USD only with fresh FX; otherwise honest IDR. */
function priceButtonText(price: number, ctx?: TgPriceCtx): string {
  const amount = Math.max(0, Math.round(Number(price) || 0));
  if (ctx?.displayCurrency === "USD" && ctx?.fx) {
    return tgDisplayPrice(amount, { locale: ctx.locale ?? "id", displayCurrency: "USD", fx: ctx.fx });
  }
  if (ctx?.displayCurrency === "USD") return buttonPrice(amount);
  if (amount >= 1000 && amount % 1000 === 0) return `Rp${amount / 1000}rb`;
  return `Rp${amount.toLocaleString(ctx?.locale === "en" ? "en-US" : "id-ID")}`;
}

const PER_PAGE = 6;

// Reply-menu labels — single source of truth shared by webhook routing + tests.
export const MENU_LABEL_CATALOG = "🛍 Katalog";
export const MENU_LABEL_SEARCH = "🔎 Cari";
export const MENU_LABEL_ORDERS = "📦 Pesanan";
export const MENU_LABEL_HELP = "❓ Bantuan";
export const MENU_LABEL_CART = "🛒 Keranjang";

/**
 * Harga untuk label tombol. "Rp89rb" hanya bila tepat ribuan; selain itu
 * nominal utuh. Dulu `(harga/1000).toFixed(0)` membulatkan: Rp7.500 tampil
 * "Rp8rb" dan Rp1.500 "Rp2rb", jadi keputusan klik diambil dari angka salah.
 */
export function buttonPrice(price: number): string {
  const amount = Math.max(0, Math.round(Number(price) || 0));
  if (amount >= 1000 && amount % 1000 === 0) return `Rp${amount / 1000}rb`;
  return `Rp${amount.toLocaleString("id-ID")}`;
}

/**
 * Halaman dari tombol pesan lama bisa melewati jumlah halaman sekarang
 * (produk habis → katalog menyusut): tampilkan halaman terakhir yang ada,
 * bukan daftar kosong berlabel "6/3".
 */
function clampPage(page: number, total: number, perPage: number): number {
  const lastPage = Math.max(0, Math.ceil(total / perPage) - 1);
  return Math.min(Math.max(0, Math.floor(Number(page) || 0)), lastPage);
}

// Telegram bulk cap: 100/order for bulk purchase (web checkout keeps its own cap).
export const TELEGRAM_MAX_QTY = 100;

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
  pay: (productId: number, variantId: number, qty: number, tag?: string) => `pay:${productId}:${variantId}:${qty}${tag ? `:${tag}` : ""}`,
  qtyInput: (productId: number, variantId: number) => `qinput:${productId}:${variantId}`,
  emailPay: (productId: number, variantId: number, qty: number, tag?: string, nonce?: string) => `epay:${productId}:${variantId}:${qty}${tag ? `:${tag}:${nonce ?? ""}` : ""}`,
  emailEdit: (productId: number, variantId: number, qty: number) => `eedit:${productId}:${variantId}:${qty}`,
  order: (orderCode: string) => `order:${orderCode}`,
  credentials: (orderCode: string) => `cred:${orderCode}`,
  cancel: (orderCode: string) => `cancel:${orderCode}`,
  cancelConfirm: (orderCode: string) => `cancelok:${orderCode}`,
  terms: (productId: number, variantId = 0) => `terms:${productId}:${variantId}`,
  refresh: (orderCode: string) => `refresh:${orderCode}`,
  reorder: (productId: number) => `reorder:${productId}`,
  search: () => "search",
  myOrders: () => "myorders",
  cart: () => "cart",
  cartAdd: (productId: number, variantId: number, qty: number) => `cadd:${productId}:${variantId}:${qty}`,
  cartDec: (variantId: number) => `cdec:${variantId}`,
  cartInc: (variantId: number) => `cinc:${variantId}`,
  cartRemove: (variantId: number) => `crm:${variantId}`,
  cartClear: () => "cclear",
  cartCheckout: () => "ccheckout",
  waInput: (orderCode: string) => `wainput:${orderCode}`,
  /** R1 frozen offer entry (nonce flows via frozen state, not callbacks). */
  payMethodsEntry: () => "pmentry",
  /** R1 frozen offer selection: index into FROZEN payq1 array (nonce-bound). */
  payMethod: (nonce: string, index: number) => `pm:${nonce}:${index}`,
  /** Sub-menu koin crypto (nonce-bound) dan kembali. */
  payCryptoMenu: (nonce: string) => `pmc:${nonce}`,
  payCryptoBack: (nonce: string) => `pmb:${nonce}`,
  /** Minta QRIS baru untuk order yang masih hidup tetapi QR-nya sudah mati. */
  qrisRenew: (orderCode: string) => `qrenew:${orderCode}`,
  /** Buka pemilih bahasa dari menu utama (locale dipilih lewat cb.lang). */
  langMenu: () => "langmenu",
  /** Buka pemilih mata uang tampilan (dipilih lewat cb.currency). */
  currencyMenu: () => "curmenu",
  /** TG1 onboarding: explicit language choice from chooser. */
  lang: (locale: "id" | "en") => `lang:${locale}`,
  /** TG1 independent display-currency control. */
  currency: (currency: "IDR" | "USD") => `cur:${currency}`,
} as const;

// ---- Callback data parser ----
export function parseCallback(data: string): { action: string; params: string[] } {
  const parts = data.split(":");
  return { action: parts[0], params: parts.slice(1) };
}

// ---- Keyboard builders ----

/**
 * Persistent bottom menu (ReplyKeyboardMarkup) — always visible under the
 * input field so new visitors never wonder "what now?".
 * Labels route back to the webhook as plain text (see MENU_LABEL_*).
 */
export function mainReplyMenu(locale: "id" | "en" = "id"): ReplyKeyboardMarkup {
  if (locale === "en") {
    return {
      keyboard: [
        [{ text: MENU_LABEL_EN.catalog }, { text: MENU_LABEL_EN.search }],
        [{ text: MENU_LABEL_EN.cart }, { text: MENU_LABEL_EN.orders }],
        [{ text: MENU_LABEL_EN.help }],
      ],
      resize_keyboard: true,
      is_persistent: true,
      input_field_placeholder: "Choose a menu or type /bantuan…",
    };
  }
  return {
    keyboard: [
      [{ text: MENU_LABEL_CATALOG }, { text: MENU_LABEL_SEARCH }],
      [{ text: MENU_LABEL_CART }, { text: MENU_LABEL_ORDERS }],
      [{ text: MENU_LABEL_HELP }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Pilih menu atau ketik /bantuan…",
  };
}

/**
 * TG1 onboarding keyboards (LOCAL ONLY): explicit language choice + settings
 * surface with independent locale/currency controls. Existing commerce
 * keyboards unchanged (still ID until TG2).
 */
export function languageChooserKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🇮🇩 Bahasa Indonesia", callback_data: cb.lang("id") },
        { text: "🇬🇧 English", callback_data: cb.lang("en") },
      ],
    ],
  };
}

/** Display-currency picker: shows the saved choice without inventing a
 * default. `null` means unset; render-prefs keeps showing IDR in that case. */
export function currencyKeyboard(locale: "id" | "en" = "id", currency: DisplayCurrency | null = null): InlineKeyboardMarkup {
  const selected = (value: DisplayCurrency) => (currency === value ? "✅ " : "");
  return {
    inline_keyboard: [
      [
        { text: `${selected("IDR")}Rp IDR`, callback_data: cb.currency("IDR") },
        { text: `${selected("USD")}$ USD`, callback_data: cb.currency("USD") },
      ],
      [{ text: locale === "en" ? "🏠 Main Menu" : "🏠 Menu Utama", callback_data: cb.home() }],
    ],
  };
}

export function settingsKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🇮🇩 Bahasa Indonesia", callback_data: cb.lang("id") },
        { text: "🇬🇧 English", callback_data: cb.lang("en") },
      ],
      [
        { text: "Rp IDR", callback_data: cb.currency("IDR") },
        { text: "$ USD", callback_data: cb.currency("USD") },
      ],
      [{ text: "🏠", callback_data: cb.home() }],
    ],
  };
}

/**
 * TG2a: localized labels for the SAME callback targets (catalog/cart/orders/
 * search/help). Existing ID MENU_LABEL_* retained for old keyboards/policy.
 */
export const MENU_LABEL_EN = {
  catalog: "🛍 Catalog",
  search: "🔎 Search",
  orders: "📦 Orders",
  help: "❓ Help",
  cart: "🛒 Cart",
} as const;

export function homeKeyboard(locale: "id" | "en" = "id"): InlineKeyboardMarkup {
  const en = locale === "en";
  return {
    inline_keyboard: [
      [
        { text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: cb.catalog() },
        { text: en ? "🛒 Cart" : "🛒 Keranjang", callback_data: cb.cart() },
      ],
      [
        { text: en ? "📦 My Orders" : "📦 Pesanan Saya", callback_data: "myorders" },
        { text: en ? "🔎 Search Products" : "🔎 Cari Produk", callback_data: cb.search() },
      ],
      [
        { text: en ? "🛡 Warranty & Terms" : "🛡 Garansi & Ketentuan", callback_data: "warranty" },
        { text: en ? "❓ Help" : "❓ Bantuan", callback_data: "help" },
      ],
      [
        { text: en ? "🌐 Language" : "🌐 Bahasa", callback_data: cb.langMenu() },
        { text: en ? "💱 Currency" : "💱 Mata Uang", callback_data: cb.currencyMenu() },
      ],
      [{ text: "🌐 Web", url: "https://axvara.tech" }],
    ],
  };
}

export function catalogFlatKeyboard(
  products: { id: number; name: string; price: number }[],
  requestedPage = 0,
  perPage = 8,
  ctx?: TgPriceCtx & TgLocaleCtx,
): InlineKeyboardMarkup {
  // Flat product list (WA parity) — product names only, categories optional filter.
  const page = clampPage(requestedPage, products.length, perPage);
  const start = page * perPage;
  const pageItems = products.slice(start, start + perPage);
  const en = ctx?.locale === "en";

  const rows: InlineKeyboardButton[][] = pageItems.map((p) => {
    const priceStr = priceButtonText(p.price, ctx);
    const label = truncateLabel(p.name, 28);
    return [{ text: `${label} · ${en ? "From" : "Mulai"} ${priceStr}`, callback_data: cb.product(p.id) }];
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
    { text: en ? "🔎 Search Products" : "🔎 Cari Produk", callback_data: cb.search() },
    { text: en ? "🛒 Cart" : "🛒 Keranjang", callback_data: cb.cart() },
  ]);
  rows.push([{ text: en ? "📦 My Orders" : "📦 Pesanan Saya", callback_data: cb.myOrders() }, { text: en ? "📂 Categories" : "📂 Kategori", callback_data: cb.categories() }]);
  return { inline_keyboard: rows };
}

export function categoriesKeyboard(
  categories: { id: number; name: string }[],
  page = 0,
  ctx?: TgLocaleCtx,
): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  const start = page * PER_PAGE;
  const pageItems = categories.slice(start, start + PER_PAGE);

  // Category icon mapping — taksonomi 6 kategori (migrasi 0046).
  // Nama lama dipertahankan sebagai alias agar data pra-migrasi tetap berikon.
  const catIcon: Record<string, string> = {
    "AI & Chatbot": "⚡",
    "Streaming & Hiburan": "🎬",
    "Produktivitas & Office": "💼",
    "Desain & Video": "🎨",
    "Developer & Tools": "🛠️",
    "Bundle Hemat": "📦",
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
  if (page > 0) nav.push({ text: en ? "◀️ Previous" : "◀️ Sebelumnya", callback_data: cb.categories(page - 1) });
  if (start + PER_PAGE < categories.length) nav.push({ text: en ? "Next ▶️" : "Berikutnya ▶️", callback_data: cb.categories(page + 1) });
  if (nav.length) rows.push(nav);

  // Home
  rows.push([{ text: en ? "🏠 Main Menu" : "🏠 Menu Utama", callback_data: cb.home() }]);
  return { inline_keyboard: rows };
}

export function productsKeyboard(
  products: { id: number; name: string; price: number }[],
  categoryId: number,
  requestedPage = 0,
  ctx?: TgPriceCtx & TgLocaleCtx,
): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  const page = clampPage(requestedPage, products.length, PER_PAGE);
  const start = page * PER_PAGE;
  const pageItems = products.slice(start, start + PER_PAGE);

  // Single-column for products (longer labels with price)
  const rows: InlineKeyboardButton[][] = pageItems.map((p) => {
    const priceStr = priceButtonText(p.price, ctx);
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
    { text: en ? "◀️ Categories" : "◀️ Kategori", callback_data: cb.categories() },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
  ]);
  return { inline_keyboard: rows };
}

export function myOrdersKeyboard(
  orders: { code: string; productId: number | null }[],
  ctx?: TgLocaleCtx,
): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  const rows: InlineKeyboardButton[][] = orders.slice(0, 10).map((order, i) => {
    const row: InlineKeyboardButton[] = [
      { text: `${i + 1}. 📋 ${truncateLabel(order.code, 22)}`, callback_data: cb.order(order.code) },
    ];
    if (order.productId) {
      row.push({ text: en ? "🔁 Buy Again" : "🔁 Beli Lagi", callback_data: cb.reorder(order.productId) });
    }
    return row;
  });
  rows.push([
    { text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: cb.catalog() },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
  ]);
  return { inline_keyboard: rows };
}

export function searchResultsKeyboard(
  products: { id: number; name: string; price: number }[],
  ctx?: TgPriceCtx & TgLocaleCtx,
): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  const rows: InlineKeyboardButton[][] = products.slice(0, 10).map((p) => {
    const priceStr = priceButtonText(p.price, ctx);
    const label = truncateLabel(p.name, 28);
    return [{ text: `${label} • ${priceStr}`, callback_data: cb.product(p.id) }];
  });
  rows.push([
    { text: en ? "🔎 Search Again" : "🔎 Cari Lagi", callback_data: cb.search() },
    { text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: cb.catalog() },
  ]);
  rows.push([{ text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() }]);
  return { inline_keyboard: rows };
}

export function productDetailKeyboard(productId: number, ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  return {
    inline_keyboard: [
      [{ text: en ? "Choose Variant" : "Pilih Varian", callback_data: cb.buy(productId) }],
      [
        { text: en ? "◀️ Catalog" : "◀️ Katalog", callback_data: cb.catalog() },
        { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
      ],
    ],
  };
}

export function variantsKeyboard(
  productId: number,
  variants: { id: number; label: string; price: number; stock: number; min_qty?: number; duration_label?: string | null; warranty_label?: string | null }[],
  ctx?: TgPriceCtx & TgLocaleCtx,
): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  const canBuy = (v: typeof variants[number]) => v.stock === -1 || v.stock >= Math.max(1, v.min_qty ?? 1);
  const available = variants.filter(canBuy);
  const unavailable = variants.filter((v) => !canBuy(v));
  const rows: InlineKeyboardButton[][] = [...available, ...unavailable].map((v) => {
    const priceStr = priceButtonText(v.price, ctx);
    const isOutOfStock = !canBuy(v);
    const text = isOutOfStock
      ? `❌ ${v.label}`
      : `${v.label} · ${priceStr}`;
    return [{
      text,
      callback_data: isOutOfStock ? "soldout" : cb.variant(v.id),
    }];
  });

  rows.push([{ text: en ? "📋 Details & Terms" : "📋 Detail & Ketentuan", callback_data: cb.terms(productId) }]);
  rows.push([{ text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: cb.catalog() }, { text: en ? "🛒 Cart" : "🛒 Keranjang", callback_data: cb.cart() }]);

  return { inline_keyboard: rows };
}

export function confirmVariantPurchaseKeyboard(productId: number, variantId: number, ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  return {
    inline_keyboard: [
      [
        { text: en ? "🛒 Choose Quantity" : "🛒 Pilih Jumlah", callback_data: cb.qty(productId, variantId) },
      ],
      [
        { text: en ? "📜 Warranty Terms" : "📜 Syarat Garansi", callback_data: "warranty" },
        { text: en ? "❌ Change Variant" : "❌ Ganti Varian", callback_data: cb.variants(productId) },
      ],
    ],
  };
}

export function qtyKeyboard(params: {
  productId: number;
  variantId: number;
  stock: number;
  qty: number;
  price: number;
  maxQty?: number;
  /** Minimum pembelian per varian (migrasi 0034, default 1). */
  minQty?: number;
  requiresEmail?: boolean;
  approvalTag?: string;
}, ctx?: TgPriceCtx & TgLocaleCtx): InlineKeyboardMarkup {
  const { productId, variantId, stock, price } = params;
  const en = ctx?.locale === "en";
  // Telegram bulk cap is 100/order (matches TELEGRAM_MAX_QTY in the webhook).
  const stockMax = stock === -1 ? 100 : Math.max(1, Math.min(stock, 100));
  const cap = Math.max(1, Math.min(params.maxQty ?? stockMax, stockMax));
  // Minimum pembelian (GSuite min 50): stepper tidak boleh turun di bawah
  // min. Bila min > cap (stok menipis), biarkan tombol bayar tampil dan
  // serahkan penolakan ke guard stok invoice — jangan clamp diam-diam.
  const minQty = Math.max(1, Math.floor(Number(params.minQty ?? 1) || 1));
  const max = Math.max(minQty, cap);
  const qty = Math.min(Math.max(minQty, Math.floor(params.qty || minQty)), max);
  const minusQty = Math.max(minQty, qty - 1);
  const plusQty = Math.min(max, qty + 1);
  const total = tgDisplayPrice(price * qty, { locale: ctx?.locale ?? "id", displayCurrency: ctx?.displayCurrency ?? null, fx: ctx?.fx ?? null });
  const minusCb = qty > minQty ? cb.setQty(productId, variantId, minusQty) : "noop";
  const minusLabel = qty > minQty ? (en ? "➖ Decrease" : "➖ Kurangi") : "➖";
  return {
    inline_keyboard: [
      [
        { text: minusLabel, callback_data: minusCb },
        { text: en ? `Quantity: ${qty}` : `Jumlah: ${qty}`, callback_data: "noop" },
        { text: qty < max ? (en ? "Add ➕" : "Tambah ➕") : "➕", callback_data: qty < max ? cb.setQty(productId, variantId, plusQty) : "noop" },
      ],
      ...(max > 1 ? [[{ text: en ? "✍️ Enter Quantity" : "✍️ Masukkan Jumlah", callback_data: cb.qtyInput(productId, variantId) }]] : []),
      [{ text: params.requiresEmail ? (en ? `📧 Continue to Email · ${total}` : `📧 Lanjut ke Email · ${total}`) : (en ? `💳 Pay QRIS · ${total}` : `💳 Bayar QRIS · ${total}`), callback_data: cb.pay(productId, variantId, qty, params.approvalTag) }],
      ...(!params.requiresEmail ? [[{ text: en ? "💳 Other payment methods" : "💳 Metode pembayaran lain", callback_data: cb.payMethodsEntry() }]] : []),
      [{ text: en ? "📋 Terms" : "📋 Ketentuan", callback_data: cb.terms(productId, variantId) }, { text: en ? "🛒 Add to Cart" : "🛒 Tambah ke Keranjang", callback_data: cb.cartAdd(productId, variantId, qty) }],
      [
        { text: en ? "Change Variant" : "Ganti Varian", callback_data: cb.variants(productId) },
        { text: en ? "Home" : "Menu", callback_data: cb.home() },
      ],
    ],
  };
}

export function emailConfirmationKeyboard(productId: number, variantId: number, qty: number, total: number, tag?: string, nonce?: string, ctx?: TgPriceCtx & TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  return { inline_keyboard: [
    [{ text: `💳 ${en ? "Pay QRIS" : "Bayar QRIS"} · ${priceButtonText(total, ctx)}`, callback_data: cb.emailPay(productId, variantId, qty, tag, nonce) }],
    [{ text: en ? "💳 Other payment methods" : "💳 Metode pembayaran lain", callback_data: cb.payMethodsEntry() }],
    [{ text: en ? "📧 Change Email" : "📧 Ubah Email", callback_data: cb.emailEdit(productId, variantId, qty) }, { text: en ? "📋 Terms" : "📋 Ketentuan", callback_data: cb.terms(productId, variantId) }],
    [
      { text: en ? "◀️ Change Quantity" : "◀️ Ubah Jumlah", callback_data: cb.qty(productId, variantId) },
      { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
    ],
  ] };
}

export function cartKeyboard(params: {
  lines: { variantId: number; qty: number; stock: number; fulfillmentMode: string; minQty?: number; label?: string }[];
}, ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  const rows: InlineKeyboardButton[][] = params.lines.slice(0, 20).map((line) => {
    const uniqueTotal = params.lines.reduce((n, item) => n + (item.fulfillmentMode === "unique" ? item.qty : 0), 0);
    const cap = line.fulfillmentMode === "unique" ? MAX_UNIQUE_UNITS_PER_ORDER : TELEGRAM_MAX_QTY;
    const canInc = (line.fulfillmentMode !== "unique" || uniqueTotal < MAX_UNIQUE_UNITS_PER_ORDER)
      && line.qty < cap && (line.stock === -1 || line.qty < line.stock);
    const row: InlineKeyboardButton[] = [
      { text: `${truncateLabel(line.label ?? String(line.variantId), 20)} ×${line.qty}`, callback_data: "noop" },
      { text: "−", callback_data: line.qty > (line.minQty ?? 1) ? cb.cartDec(line.variantId) : "noop" },
    ];
    row.push(canInc
      ? { text: "➕", callback_data: cb.cartInc(line.variantId) }
      : { text: "➕", callback_data: "noop" });
    return row;
  });
  params.lines.slice(0, 20).forEach(line => rows.push([{ text: `${en ? "Remove" : "Hapus"} ${truncateLabel(line.label ?? String(line.variantId), 24)}`, callback_data: cb.cartRemove(line.variantId) }]));
  if (params.lines.length > 0) {
    rows.push([{ text: en ? "💳 Checkout with 1 QRIS" : "💳 Checkout 1 QRIS", callback_data: cb.cartCheckout() }]);
    rows.push([{ text: en ? "🧹 Clear" : "🧹 Kosongkan", callback_data: cb.cartClear() }]);
  }
  rows.push([
    { text: en ? "🛍 Continue Shopping" : "🛍 Lanjut Belanja", callback_data: cb.catalog() },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
  ]);
  return { inline_keyboard: rows };
}

export function qrisInvoiceKeyboard(orderCode: string, ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  return {
    inline_keyboard: [
      // 2026-10-10 (permintaan owner): pembeli bisa cek manual — callback
      // refresh:* SUDAH ada + ownerBound (hanya pemilik order) + handler
      // handleOrderRefresh idempoten. Tanpa ini pembeli menunggu buta bila
      // hook telat; copy "tidak perlu cek manual" di invoiceMessage ikut
      // direvisi agar tidak berbohong.
      [{ text: en ? "🔄 Check Payment" : "🔄 Cek Pembayaran", callback_data: cb.refresh(orderCode) }],
      [{ text: en ? "📋 Order Details" : "📋 Detail Pesanan", callback_data: cb.order(orderCode) }, { text: en ? "❓ Help" : "❓ Bantuan", url: `${SITE.webUrl}/wa?pesan=${encodeURIComponent(`Pesanan ${orderCode}`)}` }],
      [{ text: en ? "Cancel Order" : "Batalkan Pesanan", callback_data: cb.cancel(orderCode) }],
    ],
  };
}

export function confirmPurchaseKeyboard(productId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🛒 Pilih Jumlah", callback_data: cb.qty(productId, 0) },
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

export function orderStatusKeyboard(orderCode: string, ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  return {
    inline_keyboard: [
      [
        { text: en ? "🔄 Check Status" : "🔄 Cek Status", callback_data: cb.refresh(orderCode) },
        { text: en ? "❌ Cancel" : "❌ Batalkan", callback_data: cb.cancel(orderCode) },
      ],
      [
        { text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: cb.catalog() },
        { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
      ],
    ],
  };
}

export function orderPaidKeyboard(orderCode: string, ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  const rows: InlineKeyboardButton[][] = [];
  // WA input is reply-only (typed number). No "Masukkan Nomor WhatsApp" button:
  // the old wainput:* callback only re-sent the same prompt (loop/confusion).
  // 2026-10-10: tombol WA lewat hub /wa (URL absolut — keyboard Telegram butuh
  // URL penuh, bukan path relatif). User pilih nomor aktif di sana.
  rows.push([
    { text: en ? "💬 WhatsApp Admin" : "💬 WhatsApp Admin", url: `${SITE.webUrl}/wa?pesan=${encodeURIComponent(`Halo AXVARA, saya ingin menanyakan pesanan ${orderCode}`)}` },
    { text: `✈️ @${SITE.supportTelegram}`, url: supportTelegramLink() },
  ]);
  // Fallback pengiriman (2026-10-04): pembeli bisa meminta bot mengirim ulang
  // detail produk ke chat ini kapan saja setelah siap.
  rows.push([{ text: en ? "📦 Fetch Product Details" : "📦 Ambil Detail Produk", callback_data: cb.credentials(orderCode) }]);
  rows.push([{ text: en ? "📋 View Order" : "📋 Lihat Pesanan", callback_data: cb.order(orderCode) }]);
  rows.push([
    { text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: cb.catalog() },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
  ]);
  return {
    inline_keyboard: rows,
  };
}

/** Status pesanan yang sudah lunas: tombol ambil ulang detail produk. */
export function paidOrderStatusKeyboard(orderCode: string, ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  return {
    inline_keyboard: [
      [{ text: en ? "📦 Fetch Product Again" : "📦 Ambil Ulang Produk", callback_data: cb.credentials(orderCode) }],
      [{ text: en ? "🔄 Check Order" : "🔄 Cek Pesanan", callback_data: cb.refresh(orderCode) }],
      orderPaidKeyboard(orderCode, ctx).inline_keyboard[0],
      [
        { text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: cb.catalog() },
        { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
      ],
    ],
  };
}

export function cancelConfirmationKeyboard(orderCode: string, ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  return { inline_keyboard: [
    [{ text: en ? "Yes, Cancel" : "Ya, Batalkan", callback_data: cb.cancelConfirm(orderCode) }],
    [{ text: en ? "Back to Order" : "Kembali ke Pesanan", callback_data: cb.order(orderCode) }],
  ] };
}

export function telegramOrderAdminKeyboard(params: {
  username?: string;
  orderCode: string;
  siteUrl: string;
  paidMarket?: boolean;
}): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  if (params.username) {
    rows.push([{ text: `✈️ @${params.username}`, url: `https://t.me/${params.username}` }]);
  }
  rows.push([{ text: "👁 Lihat pesanan pembeli", url: `${params.siteUrl}/lacak-pesanan?code=${encodeURIComponent(params.orderCode)}&admin=1` }]);
  rows.push([{ text: "🔧 Buka Pesanan", url: `${params.siteUrl}/admin?section=orders&q=${encodeURIComponent(params.orderCode)}` }]);
  if (params.paidMarket) rows.push(...refundAdminButton(params.siteUrl, params.orderCode));
  return { inline_keyboard: rows };
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
  paidMarket?: boolean;
}): InlineKeyboardMarkup {
  const { customerWa, customerName, orderCode, siteUrl } = params;
  const waMsg = encodeURIComponent(`Halo ${customerName}, pesanan ${orderCode} kamu sudah kami terima. Admin akan segera memproses.`);
  return {
    inline_keyboard: [
      [
        { text: "💬 WA Buyer", url: `https://wa.me/${customerWa}?text=${waMsg}` },
        { text: "👁 Lihat pesanan pembeli", url: `${siteUrl}/lacak-pesanan?code=${encodeURIComponent(orderCode)}&admin=1` },
        { text: "🔧 Panel Admin", url: `${siteUrl}/admin?section=orders` },
      ],
      ...(params.paidMarket ? refundAdminButton(siteUrl, orderCode) : []),
    ],
  };
}

/**
 * Tombol notif "Lunas — Web". Tombol WA hanya bila nomor valid (62…), karena
 * satu URL tombol yang ditolak Telegram menggagalkan seluruh pesan.
 */
export function webPaidAdminKeyboard(params: { customerWa: string; orderCode: string; siteUrl: string; orderKind?: string }): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  const digits = params.customerWa.replace(/\D/g, "");
  if (/^62\d{8,13}$/.test(digits)) rows.push([{ text: "💬 WA Pembeli", url: `https://wa.me/${digits}` }]);
  rows.push([{ text: "👁 Lihat pesanan pembeli", url: params.orderKind === "games"
    ? `${SITE.gamesUrl}/pesanan/${encodeURIComponent(params.orderCode)}`
    : `${params.siteUrl}/lacak-pesanan?code=${encodeURIComponent(params.orderCode)}&admin=1` }]);
  rows.push([{ text: "🔧 Buka Pesanan", url: `${params.siteUrl}/admin?section=orders&q=${encodeURIComponent(params.orderCode)}` }]);
  if (params.orderKind === "apps") rows.push(...refundAdminButton(params.siteUrl, params.orderCode));
  return { inline_keyboard: rows };
}

function refundAdminButton(siteUrl: string, code: string): InlineKeyboardButton[][] {
  return MARKET_INVOICE.test(code) ? [[{ text: "🧮 Hitung Refund", url: `${siteUrl}/admin/refund?code=${encodeURIComponent(code)}` }]] : [];
}

/** Hanya ditampilkan bersama pesan QR pertama yang sudah kedaluwarsa. */
export function qrisExpiredKeyboard(orderCode: string, ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  return { inline_keyboard: [
    [{ text: ctx?.locale === "en" ? "🔄 New QRIS" : "🔄 QRIS Baru", callback_data: cb.qrisRenew(orderCode) }],
    ...qrisInvoiceKeyboard(orderCode, ctx).inline_keyboard,
  ] };
}

/** R1: localized "other payment methods" entry (after qty/email/cart approval).
 * The entry callback carries no price/user/method — the frozen payq1 state
 * already binds the approved current cart/single identity. */
export function otherMethodsEntryKeyboard(ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  return { inline_keyboard: [[{ text: en ? "💳 Other payment methods" : "💳 Metode pembayaran lain", callback_data: "pmentry" }]] };
}

/** R1 frozen offer keyboard: QRIS first + Paling cepat/Fastest badge, gateway
 * rows with estimated fee/total, ONE collapsed "Crypto (USD)" row (total
 * incl. the per-coin crypto service fee; opens the coin sub-keyboard). Selection callbacks
 * pm:<nonce>:<index> (<=64B). No
 * order creation from this screen. Labels escape owner/provider strings;
 * currency display honors the independence rule (USD shown only as the
 * frozen provider USD amount, never relabeled IDR). */
export function paymentMethodOfferKeyboard(
  state: { nonce: string; methods: OfferMethodView[] },
  ctx?: TgLocaleCtx,
): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  const rowFor = (method: OfferMethodView, index: number): InlineKeyboardButton[] => {
    const data = `pm:${state.nonce}:${index}`;
    if (method.kind === "qris") {
      const badge = en ? "Fastest" : "Paling cepat";
      return [{ text: `QRIS · ${badge}`, callback_data: data }];
    }
    if (method.kind === "gateway" && method.gateway) {
      const label = `${method.label} · +${formatIdr(method.gateway.estimated_fee, ctx?.locale ?? "id")} · ${formatIdr(method.gateway.estimated_total, ctx?.locale ?? "id")}`;
      return [{ text: label.slice(0, 90), callback_data: data }];
    }
    return [{ text: String(method.id).slice(0, 90), callback_data: data }];
  };
  // Crypto multi-koin: SATU entri "Crypto (USD)" (membuka sub-menu koin), bukan satu baris per koin.
  let cryptoEntryAdded = false;
  const rows: InlineKeyboardButton[][] = [];
  state.methods.slice(0, 96).forEach((method, index) => {
    if (method.kind !== "crypto") {
      rows.push(rowFor(method, index));
    } else if (!cryptoEntryAdded) {
      cryptoEntryAdded = true;
      rows.push([{ text: `Crypto (USD) · ${method.amount_text} USD`, callback_data: `pmc:${state.nonce}` }]);
    }
  });
  return { inline_keyboard: rows };
}

/**
 * Sub-menu koin crypto Telegram: Populer dulu, lalu Stablecoin, 2 tombol per baris, label `BTC` / `USDT · BSC`,
 * plus Kembali. Hanya koin TERSEDIA (frozen payq1 tidak pernah memuat yang nonaktif). Tap = `pm:<nonce>:<index>`
 * persis seperti memilih metode biasa (index ke array beku), jadi freeze/consent/claim tidak berubah.
 */
export function cryptoCoinKeyboard(
  state: { nonce: string; methods: OfferMethodView[] },
  ctx?: TgLocaleCtx,
): InlineKeyboardMarkup {
  const coins = state.methods.slice(0, 96).flatMap((method, index) => {
    const asset = method.kind === "crypto" ? getCryptoAsset(method.pay_currency) : null;
    return asset ? [{ asset, index }] : [];
  });
  const button = ({ asset, index }: (typeof coins)[number]): InlineKeyboardButton => ({
    text: (asset.group === "stable" ? `${asset.symbol} · ${asset.network.toUpperCase()}` : asset.symbol).slice(0, 40),
    callback_data: `pm:${state.nonce}:${index}`,
  });
  const rows: InlineKeyboardButton[][] = [];
  for (const group of ["popular", "stable"] as const) {
    const buttons = coins.filter((coin) => coin.asset.group === group).sort((a, b) => a.asset.order - b.asset.order).map(button);
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  }
  rows.push([{ text: ctx?.locale === "en" ? "⬅ Back" : "⬅ Kembali", callback_data: `pmb:${state.nonce}` }]);
  return { inline_keyboard: rows };
}
