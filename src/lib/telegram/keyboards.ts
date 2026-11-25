import { MARKET_INVOICE } from "@/lib/refund/calculate";
import { MAX_UNIQUE_UNITS_PER_ORDER } from "@/lib/fulfillment/units";
// src/lib/telegram/keyboards.ts — Premium UX inline keyboards
// Patterns: ≤3 buttons per row, verbs on buttons, consistent back/home placement,
// 2-column grid for categories, single-column for products (longer labels).
// All callback_data ≤ 64 bytes.

import type { InlineKeyboardMarkup, InlineKeyboardButton, ReplyKeyboardMarkup } from "./types";
import { supportTelegramLink, SITE } from "@/lib/site";
import type { DisplayCurrency, Locale } from "@/lib/i18n/locale";
import { MARKET_CATEGORY_NAMES, marketCategoryName } from "@/lib/i18n/market-categories";
import type { FxSnapshot } from "@/lib/payments/fx";
import { tgDisplayPrice } from "./render-prefs";
import { formatIdr } from "@/lib/i18n/format";
import { getCryptoAsset } from "@/lib/payments/crypto-assets";
import { invoiceItems } from "./messages/format";
import { isQrisOfferMethod, isUsdtOfferMethod, pickRepresentativeCryptoMethod } from "./messages/purchase";

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
 * currencies. USD only with fresh FX; otherwise honest IDR (dot-thousands). */
function priceButtonText(price: number, ctx?: TgPriceCtx): string {
  const amount = Math.max(0, Math.round(Number(price) || 0));
  const displayCurrency = ctx?.displayCurrency ?? (ctx?.locale === "en" ? "USD" : "IDR");
  if (displayCurrency === "USD" && ctx?.fx) {
    return tgDisplayPrice(amount, { locale: ctx?.locale ?? "en", displayCurrency: "USD", fx: ctx.fx });
  }
  return buttonPrice(amount);
}

const PER_PAGE = 6;

// Reply-menu labels — single source of truth shared by webhook routing + tests.
export const MENU_LABEL_CATALOG = "🛍 Katalog";
export const MENU_LABEL_SEARCH = "🔎 Cari";
export const MENU_LABEL_ORDERS = "📦 Pesanan";
export const MENU_LABEL_WARRANTY = "🛡 Garansi";
export const MENU_LABEL_HELP = "💬 Bantuan";
export const MENU_LABEL_HELP_LEGACY = "❓ Bantuan";
export const MENU_LABEL_SETTINGS = "🇮🇩 Bahasa";
export const MENU_LABEL_SETTINGS_GLOBE_LEGACY = "🌐 Bahasa";
export const MENU_LABEL_SETTINGS_LEGACY = "⚙️ Pengaturan";

/**
 * Harga untuk label tombol dalam format penuh pemisah titik (`Rp19.500`),
 * tidak pernah memakai singkatan "rb".
 */
export function buttonPrice(price: number): string {
  const amount = Math.max(0, Math.round(Number(price) || 0));
  return `Rp${amount.toLocaleString("id-ID")}`;
}

export function stockBadgeText(stock: number | undefined | null, locale: Locale = "id"): string {
  if (stock === undefined || stock === null) return "";
  if (stock === -1) return locale === "en" ? "Ready" : "stok ∞";
  if (stock > 0) return locale === "en" ? `stock ${stock}` : `stok ${stock}`;
  return locale === "en" ? "Sold out" : "Habis";
}

function productButtonText(
  product: { name: string; price: number; stock?: number | null },
  ctx?: TgPriceCtx & TgLocaleCtx,
  maxNameLen = 28,
): string {
  const label = truncateLabel(product.name, maxNameLen);
  const priceStr = priceButtonText(product.price, ctx);
  const stockStr = stockBadgeText(product.stock, ctx?.locale ?? "id");
  return stockStr ? `${label} · ${priceStr} · ${stockStr}` : `${label} · ${priceStr}`;
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
  restockNotify: (productId: number) => `rst:${productId}`,
  refresh: (orderCode: string) => `refresh:${orderCode}`,
  reorder: (productId: number) => `reorder:${productId}`,
  search: () => "search",
  myOrders: () => "myorders",
  waInput: (orderCode: string) => `wainput:${orderCode}`,
  /** R1 frozen offer entry; single-product entry binds product/variant/qty/tag. */
  payMethodsEntry: (productId: number, variantId: number, qty: number, tag?: string) =>
    `pmentry:${productId}:${variantId}:${qty}${tag ? `:${tag}` : ""}`,
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
  /** Buka layar pengaturan gabungan Bahasa + Mata Uang. */
  settings: () => "settings",
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
        [{ text: MENU_LABEL_EN.catalog }, { text: MENU_LABEL_EN.orders }],
        [{ text: MENU_LABEL_EN.help }, { text: MENU_LABEL_EN.settings }],
      ],
      resize_keyboard: true,
      // false: Telegram shows the keyboard toggle icon in the input field so
      // buyers can collapse/expand the menu (owner request 2026-11-20).
      is_persistent: false,
      one_time_keyboard: false,
      input_field_placeholder: "Search product or pick a menu…",
    };
  }
  return {
    keyboard: [
      [{ text: MENU_LABEL_CATALOG }, { text: MENU_LABEL_ORDERS }],
      [{ text: MENU_LABEL_HELP }, { text: MENU_LABEL_SETTINGS }],
    ],
    resize_keyboard: true,
    is_persistent: false,
    one_time_keyboard: false,
    input_field_placeholder: "Cari produk atau ketik nama produk…",
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
        { text: "🇮🇩 Indonesia · Rupiah", callback_data: cb.lang("id") },
        { text: "🇬🇧 English · USD", callback_data: cb.lang("en") },
      ],
    ],
  };
}

/** Legacy helper kept exported without any currency buttons (redirects to language screen). */
export function currencyKeyboard(locale: "id" | "en" = "id", _currency: DisplayCurrency | null = null): InlineKeyboardMarkup {
  return settingsKeyboard(locale);
}

export function settingsKeyboard(locale?: Locale, _currency?: DisplayCurrency | null): InlineKeyboardMarkup {
  const selLang = (l: Locale) => (locale === l ? "✅ " : "");
  return {
    inline_keyboard: [
      [
        { text: `${selLang("id")}🇮🇩 Indonesia (Rupiah)`, callback_data: cb.lang("id") },
        { text: `${selLang("en")}🇬🇧 English (USD)`, callback_data: cb.lang("en") },
      ],
      [{ text: locale === "en" ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() }],
    ],
  };
}

/**
 * TG2a: localized labels for the SAME callback targets (catalog/orders/
 * search/help/settings). Existing ID MENU_LABEL_* retained for old keyboards/policy.
 */
export const MENU_LABEL_EN = {
  catalog: "🛍 Catalog",
  search: "🔎 Search",
  orders: "📦 Orders",
  warranty: "🛡 Warranty",
  help: "💬 Help",
  helpLegacy: "❓ Help",
  settings: "🇬🇧 Language",
  settingsGlobeLegacy: "🌐 Language",
  settingsLegacy: "⚙️ Settings",
} as const;

export type TelegramCategoryItem = { id: number; name: string; slug?: string | null };

const HOME_MAX_CATEGORIES = 6;

// Category icon mapping — taksonomi 6 kategori (migrasi 0046).
// Kunci slug & nama lama dipertahankan agar fixture/data pra-migrasi tetap berikon.
const CATEGORY_ICON_BY_KEY: Record<string, string> = {
  "ai-chatbot": "⚡",
  "streaming-hiburan": "🎬",
  "produktivitas-office": "💼",
  "desain-video": "🎨",
  "developer-tools": "🛠️",
  "bundle-hemat": "📦",
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

const CATEGORY_EN_BY_ID_NAME = new Map<string, string>(
  Object.values(MARKET_CATEGORY_NAMES).map((entry) => [entry.id.toLowerCase(), entry.en]),
);

export function categoryDisplayName(
  category: { name: string; slug?: string | null },
  locale: Locale = "id",
): string {
  const slug = category.slug?.trim();
  if (slug) return marketCategoryName(slug, locale, category.name);
  if (locale === "en") {
    const mapped = CATEGORY_EN_BY_ID_NAME.get(category.name.trim().toLowerCase());
    if (mapped) return mapped;
  }
  return category.name;
}

export function categoryButtonText(category: TelegramCategoryItem, locale: Locale = "id"): string {
  const slugKey = category.slug?.trim().toLowerCase();
  const icon = (slugKey && CATEGORY_ICON_BY_KEY[slugKey]) || CATEGORY_ICON_BY_KEY[category.name] || "📂";
  return `${icon} ${categoryDisplayName(category, locale)}`;
}

function buildCategoryGridRows(
  categories: TelegramCategoryItem[],
  locale: Locale = "id",
): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < categories.length; i += 2) {
    const row: InlineKeyboardButton[] = [
      {
        text: categoryButtonText(categories[i], locale),
        callback_data: cb.category(categories[i].id),
      },
    ];
    if (categories[i + 1]) {
      row.push({
        text: categoryButtonText(categories[i + 1], locale),
        callback_data: cb.category(categories[i + 1].id),
      });
    }
    rows.push(row);
  }
  return rows;
}

export function homeKeyboard(
  locale: "id" | "en" = "id",
  categories: TelegramCategoryItem[] = [],
  _ctx?: TgPriceCtx,
): InlineKeyboardMarkup {
  const en = locale === "en";
  const categoryRows = buildCategoryGridRows(categories.slice(0, HOME_MAX_CATEGORIES), locale);
  return {
    inline_keyboard: [
      ...categoryRows,
      [{ text: en ? "🛍 View All Catalog" : "🛍 Lihat Semua Katalog", callback_data: cb.catalog(), style: "success" }],
      [
        { text: en ? "📦 My Orders" : "📦 Pesanan Saya", callback_data: cb.myOrders(), style: "primary" },
        { text: en ? "💬 Help" : "💬 Bantuan", url: `${SITE.webUrl}/wa`, style: "primary" },
      ],
      [
        { text: en ? "🇬🇧 Language" : "🇮🇩 Bahasa", callback_data: cb.settings() },
        { text: "🌐 Web", url: SITE.webUrl },
      ],
    ],
  };
}

export function catalogFlatKeyboard(
  products: { id: number; name: string; price: number; stock?: number }[],
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
    return [{ text: productButtonText(p, ctx, 28), callback_data: cb.product(p.id) }];
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
    { text: en ? "📂 Categories" : "📂 Kategori", callback_data: cb.categories() },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
  ]);
  return { inline_keyboard: rows };
}

export function categoriesKeyboard(
  categories: TelegramCategoryItem[],
  page = 0,
  ctx?: TgLocaleCtx,
): InlineKeyboardMarkup {
  const locale: Locale = ctx?.locale ?? "id";
  const en = locale === "en";
  const start = page * PER_PAGE;
  const pageItems = categories.slice(start, start + PER_PAGE);

  // 2-column grid for categories (short labels, fits mobile)
  const rows = buildCategoryGridRows(pageItems, locale);

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
  products: { id: number; name: string; price: number; stock?: number }[],
  categoryId: number,
  requestedPage = 0,
  ctx?: TgPriceCtx & TgLocaleCtx,
): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  const page = clampPage(requestedPage, products.length, PER_PAGE);
  const start = page * PER_PAGE;
  const pageItems = products.slice(start, start + PER_PAGE);

  // Single-column for products (longer labels with price + stock)
  const rows: InlineKeyboardButton[][] = pageItems.map((p) => {
    return [{ text: productButtonText(p, ctx, 25), callback_data: cb.product(p.id) }];
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
  products: { id: number; name: string; price: number; stock?: number }[],
  ctx?: TgPriceCtx & TgLocaleCtx,
): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  const rows: InlineKeyboardButton[][] = products.slice(0, 10).map((p) => {
    return [{ text: productButtonText(p, ctx, 28), callback_data: cb.product(p.id) }];
  });
  rows.push([
    { text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: cb.catalog() },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
  ]);
  return { inline_keyboard: rows };
}

export function searchNoResultsKeyboard(ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  return {
    inline_keyboard: [
      [
        { text: en ? "📂 Categories" : "📂 Kategori", callback_data: cb.categories() },
        { text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: cb.catalog(), style: "primary" },
      ],
      [
        { text: en ? "💬 Help" : "💬 Bantuan", url: `${SITE.webUrl}/wa` },
        { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
      ],
    ],
  };
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

function formatDurationForButton(value: number | null | undefined, unit: string | null | undefined, locale: Locale): string | null {
  if (!unit) return null;
  const u = unit.trim().toLowerCase();
  if (u === "lifetime" || u === "selamanya") return locale === "en" ? "Lifetime" : "Selamanya";
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const n = Math.floor(value);
  if (locale === "en") {
    const word = u.startsWith("day") || u === "hari" ? "Day"
      : u.startsWith("week") || u === "minggu" ? "Week"
        : u.startsWith("month") || u === "bulan" ? "Month"
          : u.startsWith("year") || u === "tahun" ? "Year"
            : unit.trim();
    return `${n} ${n === 1 ? word : `${word}s`}`;
  }
  const word = u.startsWith("day") || u === "hari" ? "Hari"
    : u.startsWith("week") || u === "minggu" ? "Minggu"
      : u.startsWith("month") || u === "bulan" ? "Bulan"
        : u.startsWith("year") || u === "tahun" ? "Tahun"
          : unit.trim();
  return `${n} ${word}`;
}

export function variantButtonDuration(
  v: {
    label: string;
    duration_label?: string | null;
    duration_value?: number | null;
    duration_unit?: string | null;
    warranty_label?: string | null;
    warranty_value?: number | null;
    warranty_unit?: string | null;
    wr_variant_id?: string | number | null;
  },
  locale: Locale,
): string | null {
  // Never append duplicate or legacy 1-month mirror duration to labels like "Google Head 18Bulan".
  if (/\d+\s*(?:hari|bulan|tahun|minggu|hr|bln|thn|day|days|month|months|year|years|week|weeks)|\b(?:lifetime|selamanya|permanen)\b/i.test(v.label)) {
    return null;
  }
  const dl = v.duration_label?.trim();
  if (dl) {
    return dl === v.warranty_label?.trim() ? null : dl;
  }
  const isWr = v.wr_variant_id != null && String(v.wr_variant_id).trim() !== "";
  if (isWr) return formatDurationForButton(v.duration_value, v.duration_unit, locale);
  if (
    v.warranty_value != null &&
    v.warranty_unit != null &&
    (v.duration_value !== v.warranty_value || v.duration_unit !== v.warranty_unit)
  ) {
    return formatDurationForButton(v.duration_value, v.duration_unit, locale);
  }
  return null;
}

export function variantsKeyboard(
  productId: number,
  variants: {
    id: number;
    label: string;
    price: number;
    stock: number;
    min_qty?: number;
    duration_label?: string | null;
    duration_value?: number | null;
    duration_unit?: string | null;
    warranty_label?: string | null;
    warranty_value?: number | null;
    warranty_unit?: string | null;
    wr_variant_id?: string | number | null;
  }[],
  ctx?: TgPriceCtx & TgLocaleCtx,
): InlineKeyboardMarkup {
  const locale = ctx?.locale ?? "id";
  const en = locale === "en";
  const canBuy = (v: typeof variants[number]) => v.stock === -1 || v.stock >= Math.max(1, v.min_qty ?? 1);
  const available = variants.filter(canBuy);
  const unavailable = variants.filter((v) => !canBuy(v));
  const rows: InlineKeyboardButton[][] = available.map((v) => {
    const dur = variantButtonDuration(v, locale);
    const priceStr = priceButtonText(v.price, ctx);
    const stockStr = stockBadgeText(v.stock, locale);
    const text = `${v.label}${dur ? ` · ${dur}` : ""} · ${priceStr} · ${stockStr}`;
    return [{
      text,
      callback_data: cb.variant(v.id),
    }];
  });
  // Owner 2026-11-25: varian habis tetap tampil di bawah varian siap beli
  // sebagai tombol merah ❌ (style: "danger", callback "soldout" → popup habis),
  // tanpa tombol "Kabari saat restok" yang sudah dipensiunkan.
  for (const v of unavailable) {
    const dur = variantButtonDuration(v, locale);
    rows.push([{
      text: `❌ ${v.label}${dur ? ` · ${dur}` : ""} · ${en ? "Sold out" : "Habis"}`,
      callback_data: "soldout",
      style: "danger",
    }]);
  }

  rows.push([{ text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: cb.catalog() }, { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() }]);

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
  qty?: number;
  price?: number;
  maxQty?: number;
  /** Minimum pembelian per varian (migrasi 0034, default 1). */
  minQty?: number;
  requiresEmail?: boolean;
  approvalTag?: string;
}, ctx?: TgPriceCtx & TgLocaleCtx): InlineKeyboardMarkup {
  const { productId, variantId, stock } = params;
  const en = ctx?.locale === "en";
  // Telegram bulk cap is 100/order (matches TELEGRAM_MAX_QTY in the webhook).
  const stockMax = stock === -1 ? TELEGRAM_MAX_QTY : Math.max(1, Math.min(stock, TELEGRAM_MAX_QTY));
  const cap = Math.max(1, Math.min(params.maxQty ?? stockMax, stockMax));
  const minQty = Math.max(1, Math.floor(Number(params.minQty ?? 1) || 1));
  const effectiveUpper = stock === 0 ? 0 : cap;
  const candidatePresets = minQty > 1
    ? [minQty, minQty * 2, minQty * 5]
    : [1, 5, 10];
  const presets = [...new Set(candidatePresets)]
    .filter((n) => n >= minQty && n <= effectiveUpper)
    .map((n): InlineKeyboardButton => ({
      text: String(n),
      callback_data: cb.setQty(productId, variantId, n),
      style: "success",
    }));
  const rows: InlineKeyboardButton[][] = [];
  if (presets.length > 0) rows.push(presets);
  if (effectiveUpper > minQty) {
    rows.push([{
      text: en ? "✍️ Custom quantity" : "✍️ Jumlah lain",
      callback_data: cb.qtyInput(productId, variantId),
      style: "primary",
    }]);
  }
  rows.push([
    { text: en ? "◀️ Back" : "◀️ Kembali", callback_data: cb.product(productId), style: "primary" },
    { text: "🏠 Menu", callback_data: cb.home(), style: "primary" },
  ]);
  return { inline_keyboard: rows };
}

export function reviewKeyboard(params: {
  productId: number;
  variantId: number;
  qty: number;
  approvalTag: string;
  truncated?: boolean;
}, ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  const rows: InlineKeyboardButton[][] = [];
  if (params.truncated) {
    rows.push([{
      text: en ? "📋 Read full terms" : "📋 Baca lengkap",
      callback_data: cb.terms(params.productId, params.variantId),
      style: "primary",
    }]);
  }
  rows.push([{
    text: en ? "✅ I have read — Continue to Payment" : "✅ Sudah dibaca — Lanjut Bayar",
    callback_data: cb.payMethodsEntry(params.productId, params.variantId, params.qty, params.approvalTag),
    style: "success",
  }]);
  rows.push([
    { text: en ? "✍️ Change Quantity" : "✍️ Ubah Jumlah", callback_data: cb.qty(params.productId, params.variantId), style: "primary" },
    { text: en ? "✖️ Cancel" : "✖️ Batalkan", callback_data: cb.product(params.productId), style: "danger" },
  ]);
  return { inline_keyboard: rows };
}

export function emailConfirmationKeyboard(productId: number, variantId: number, qty: number, total: number, tag?: string, nonce?: string, ctx?: TgPriceCtx & TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  return { inline_keyboard: [
    [{ text: `💳 ${en ? "Pay QRIS" : "Bayar QRIS"} · ${priceButtonText(total, ctx)}`, callback_data: cb.emailPay(productId, variantId, qty, tag, nonce), style: "success" }],
    [{ text: en ? "💳 Other payment methods" : "💳 Metode pembayaran lain", callback_data: cb.payMethodsEntry(productId, variantId, qty, tag) }],
    [{ text: en ? "📧 Change Email" : "📧 Ubah Email", callback_data: cb.emailEdit(productId, variantId, qty) }, { text: en ? "📋 Terms" : "📋 Ketentuan", callback_data: cb.terms(productId, variantId) }],
    [
      { text: en ? "◀️ Change Quantity" : "◀️ Ubah Jumlah", callback_data: cb.qty(productId, variantId) },
      { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
    ],
  ] };
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
      // 2026-11-20 (permintaan owner): tanpa Detail Pesanan — invoice sudah
      // memuat kode/produk/total/batas; cukup Cek Pembayaran | Bantuan + Batalkan.
      [
        { text: en ? "🔄 Check Payment" : "🔄 Cek Pembayaran", callback_data: cb.refresh(orderCode), style: "primary" },
        { text: en ? "💬 Help" : "💬 Bantuan", url: `${SITE.webUrl}/wa?pesan=${encodeURIComponent(`Pesanan ${orderCode}`)}` },
      ],
      [{ text: en ? "Cancel Order" : "Batalkan Pesanan", callback_data: cb.cancel(orderCode), style: "danger" }],
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
        { text: "❌ Batal", callback_data: cb.product(productId), style: "danger" },
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

export function minimalMenuKeyboard(ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  return {
    inline_keyboard: [[{ text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() }]],
  };
}

export function helpKeyboard(ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  return {
    inline_keyboard: [
      [
        { text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: cb.catalog() },
        { text: en ? "📦 My Orders" : "📦 Pesanan Saya", callback_data: cb.myOrders() },
      ],
      [
        { text: "💬 WhatsApp Admin", url: `${SITE.webUrl}/wa` },
        { text: `✈️ @${SITE.supportTelegram}`, url: supportTelegramLink() },
      ],
      [
        { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
      ],
    ],
  };
}

export function orderTerminalKeyboard(ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  return {
    inline_keyboard: [
      [{ text: en ? "◀️ Order List" : "◀️ Daftar Pesanan", callback_data: cb.myOrders() }],
      [
        { text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: cb.catalog() },
        { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
      ],
    ],
  };
}

export function credentialResendOutcomeKeyboard(
  orderCode: string,
  kind: "transient" | "permanent",
  ctx?: TgLocaleCtx,
): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  const rows: InlineKeyboardButton[][] = [];
  if (kind === "transient") {
    rows.push([{ text: en ? "🔁 Try Again" : "🔁 Coba lagi", callback_data: cb.credentials(orderCode) }]);
  }
  rows.push([
    { text: "💬 WhatsApp Admin", url: `${SITE.webUrl}/wa?pesan=${encodeURIComponent(`Pesanan ${orderCode}`)}` },
    { text: en ? "◀️ Order Details" : "◀️ Detail Pesanan", callback_data: cb.order(orderCode) },
  ]);
  return { inline_keyboard: rows };
}

export function orderStatusKeyboard(orderCode: string, ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  return {
    inline_keyboard: [
      [
        { text: en ? "🔄 Check Status" : "🔄 Cek Status", callback_data: cb.refresh(orderCode) },
        { text: en ? "❌ Cancel" : "❌ Batalkan", callback_data: cb.cancel(orderCode), style: "danger" },
      ],
      [{ text: en ? "◀️ Order List" : "◀️ Daftar Pesanan", callback_data: cb.myOrders() }],
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
      [{ text: en ? "◀️ Order List" : "◀️ Daftar Pesanan", callback_data: cb.myOrders() }],
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
    [{ text: en ? "Yes, Cancel" : "Ya, Batalkan", callback_data: cb.cancelConfirm(orderCode), style: "danger" }],
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
export function paymentExpiredKeyboard(items: unknown, ctx?: TgLocaleCtx): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  const lines = invoiceItems(items);
  const productId = lines.length === 1 ? Number(lines[0].product_id) : 0;
  return { inline_keyboard: [
    [
      ...(Number.isSafeInteger(productId) && productId > 0
        ? [{ text: en ? "🔁 Buy Again" : "🔁 Pesan Lagi", callback_data: cb.reorder(productId) }] : []),
      { text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: cb.catalog() },
    ],
  ] };
}

export function qrisExpiredKeyboard(orderCode: string, ctx?: TgLocaleCtx, items?: unknown): InlineKeyboardMarkup {
  return { inline_keyboard: [
    [{ text: ctx?.locale === "en" ? "🔄 New QRIS" : "🔄 QRIS Baru", callback_data: cb.qrisRenew(orderCode) }],
    ...paymentExpiredKeyboard(items, ctx).inline_keyboard,
  ] };
}

export type Payq1OfferSource = { kind: "single"; productId: number; variantId: number; qty: number };

/** R1: localized "other payment methods" entry (after qty/email approval).
 * Routes single-product contexts back to single pmentry; falls back to catalog. */
export function otherMethodsEntryKeyboard(ctx?: TgLocaleCtx & { source?: Payq1OfferSource; tag?: string }): InlineKeyboardMarkup {
  const en = ctx?.locale === "en";
  if (ctx?.source?.kind === "single") {
    return { inline_keyboard: [[{ text: en ? "💳 Other payment methods" : "💳 Metode pembayaran lain", callback_data: cb.payMethodsEntry(ctx.source.productId, ctx.source.variantId, ctx.source.qty, ctx.tag) }]] };
  }
  return { inline_keyboard: [[{ text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: cb.catalog() }]] };
}

function formatCryptoButtonAmount(amount: string, locale: Locale): string {
  if (locale !== "en" && /^\d+\.\d+$/.test(amount)) {
    return amount.replace(".", ",");
  }
  return amount;
}

/** R1 frozen offer keyboard: ordered by locale (ID: QRIS then Crypto;
 * EN: Crypto then QRIS). Preserves exact frozen pm:<nonce>:<originalIndex>
 * callbacks and pmc:<nonce> coin-menu entry. */
export function paymentMethodOfferKeyboard(
  state: { nonce: string; methods: OfferMethodView[]; source?: Payq1OfferSource; idrSubtotal?: number },
  ctx?: TgLocaleCtx,
): InlineKeyboardMarkup {
  const locale: Locale = ctx?.locale ?? "id";
  const en = locale === "en";
  const rpTotal = state.idrSubtotal != null ? buttonPrice(state.idrSubtotal) : null;
  const qrisRows: InlineKeyboardButton[][] = [];
  const gatewayRows: InlineKeyboardButton[][] = [];

  state.methods.slice(0, 96).forEach((method, index) => {
    if (method.kind === "crypto") return;
    const data = `pm:${state.nonce}:${index}`;
    if (isQrisOfferMethod(method)) {
      const label = rpTotal ? `📱 QRIS · ${rpTotal}` : "📱 QRIS";
      qrisRows.push([{ text: label, callback_data: data }]);
      return;
    }
    if (method.kind === "gateway" && method.gateway) {
      const label = `${method.label} · +${formatIdr(method.gateway.estimated_fee, locale)} · ${formatIdr(method.gateway.estimated_total, locale)}`;
      gatewayRows.push([{ text: label.slice(0, 90), callback_data: data }]);
      return;
    }
    gatewayRows.push([{ text: String(method.id).slice(0, 90), callback_data: data }]);
  });

  const cryptoRows: InlineKeyboardButton[][] = [];
  const crypto = pickRepresentativeCryptoMethod(state.methods.slice(0, 96));
  if (crypto) {
    const amount = formatCryptoButtonAmount(String(crypto.amount_text ?? "").trim(), locale);
    const usdt = isUsdtOfferMethod(crypto);
    const label = usdt
      ? (amount ? `🪙 Crypto · ${amount} USDT` : "🪙 Crypto · USDT")
      : (amount ? `🪙 Crypto · $${amount}` : "🪙 Crypto");
    cryptoRows.push([{ text: label.slice(0, 90), callback_data: `pmc:${state.nonce}` }]);
  }

  const rows: InlineKeyboardButton[][] = en
    ? [...cryptoRows, ...gatewayRows, ...qrisRows]
    : [...qrisRows, ...gatewayRows, ...cryptoRows];

  if (state.source?.kind === "single") {
    rows.push([
      { text: en ? "◀️ Back" : "◀️ Kembali", callback_data: cb.setQty(state.source.productId, state.source.variantId, state.source.qty), style: "primary" },
      { text: en ? "✖️ Cancel" : "✖️ Batal", callback_data: cb.product(state.source.productId), style: "danger" },
    ]);
    rows.push([
      { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home(), style: "primary" },
    ]);
  } else {
    rows.push([
      { text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: cb.catalog(), style: "primary" },
      { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home(), style: "primary" },
    ]);
  }
  return { inline_keyboard: rows };
}

// Standard emoji only: custom coin-logo emoji require Telegram Premium support.
const CRYPTO_COIN_EMOJI = new Map([
  ["USDT", "💵"], ["USDC", "🔵"], ["BTC", "🟠"], ["ETH", "🔷"],
  ["BNB", "🟡"], ["TRX", "🔴"], ["TON", "💎"], ["LTC", "⚪"],
]);

/** Read-only menus; leaf buttons retain the original frozen array index. */
export function cryptoCoinKeyboard(
  state: { nonce: string; methods: OfferMethodView[] },
  ctx?: TgLocaleCtx,
  page?: string,
): InlineKeyboardMarkup | null {
  const coins = state.methods.slice(0, 96).flatMap((method, index) => {
    const asset = method.kind === "crypto" ? getCryptoAsset(method.pay_currency) : null;
    return asset ? [{ asset, index }] : [];
  }).sort((a, b) => a.asset.order - b.asset.order);
  if (!coins.length) return null;
  const symbols = [...new Set(coins.map(({ asset }) => asset.symbol))];
  const others = symbols.filter(symbol => !CRYPTO_COIN_EMOJI.has(symbol));
  const en = ctx?.locale === "en";
  const open = (target?: string) => cb.payCryptoMenu(state.nonce) + (target ? `:${target}` : "");
  const select = (index: number) => `pm:${state.nonce}:${index}`;
  const forSymbol = (symbol: string) => coins.filter(({ asset }) => asset.symbol === symbol);
  const rows: InlineKeyboardButton[][] = [];
  let back = cb.payCryptoBack(state.nonce);
  if (!page || page === "others") {
    if (page && !others.length) return null;
    const list = page ? others : [...CRYPTO_COIN_EMOJI.keys()].filter(symbol => symbols.includes(symbol));
    for (const symbol of list) {
      const options = forSymbol(symbol);
      const emoji = CRYPTO_COIN_EMOJI.get(symbol);
      rows.push([{ text: emoji ? `${emoji} ${symbol}` : symbol,
        callback_data: options.length === 1 ? select(options[0].index) : open(symbol) }]);
    }
    if (page) back = open();
    else if (others.length) rows.push([{ text: en ? "➕ Others" : "➕ Lainnya", callback_data: open("others") }]);
  } else {
    const options = forSymbol(page);
    if (options.length < 2) return null;
    for (const { asset, index } of options) {
      rows.push([{ text: `${asset.symbol} · ${asset.network.toUpperCase()}`, callback_data: select(index) }]);
    }
    back = open(CRYPTO_COIN_EMOJI.has(page) ? undefined : "others");
  }
  rows.push([{ text: en ? "◀️ Back" : "◀️ Kembali", callback_data: back, style: "primary" }]);
  return { inline_keyboard: rows };
}
