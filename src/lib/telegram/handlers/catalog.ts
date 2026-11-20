import { displaySoldCountSql } from "@/lib/product-groups";
import { MAX_UNIQUE_UNITS_PER_ORDER } from "@/lib/fulfillment/units";
// src/lib/telegram/handlers/catalog.ts — Handler penjelajahan katalog & varian.
//
// MENGAPA dipisah: handler tampilan (katalog datar, kategori, daftar produk,
// detail produk, pemilih varian, dan stepper jumlah) hanya MEMBACA katalog dan
// merender pesan — tidak menyentuh uang/order. Mengisolasinya dari jalur invoice
// membuat perubahan tampilan aman ditinjau. Pemindahan murni dari route.ts.

import { queryFirst, queryAll, isD1Mode, getD1 } from "@/lib/db";
import * as tgApi from "@/lib/telegram/api";
import { sendMessage } from "@/lib/telegram/api";
import {
  catalogFlatMessage, categoriesMessage, categoryProductsMessage,
  productDetailMessage, outOfStockMessage, errorMessage,
  chooseQtyMessage, reviewPurchaseMessage, type ReviewCopySection, escapeHtml,
} from "@/lib/telegram/messages";
import type { Locale } from "@/lib/i18n/locale";
import { trackFunnelEvent } from "@/lib/analytics/funnel";
import { tgCtxFor, tgDisplayPrice, tgUsdAlternate, type TgCtx } from "@/lib/telegram/render-prefs";
import {
  catalogFlatKeyboard, categoriesKeyboard, productsKeyboard,
  variantsKeyboard, variantButtonDuration, cb, minimalMenuKeyboard,
  qtyKeyboard, reviewKeyboard, orderStatusKeyboard, TELEGRAM_MAX_QTY,
} from "@/lib/telegram/keyboards";
import {
  getProductDetail, getActiveVariant, formatVariantLabel, buyerWarrantyLabel,
  buyerDeliveryKind, effectiveVariantStock, displayDescription, displayDescriptionEn,
} from "@/lib/catalog";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import { resolveVariantCopy, adminCopyOf } from "@/lib/product-copy/resolve";
import { sanitizeSupplierCopy } from "@/lib/product-copy/sanitize";
import { mergeProductCopy, parseProductDescription, copySectionTitles } from "@/lib/product-copy/format";
import { loadActiveSupplierLinkMap } from "@/lib/supplier-links";
import { localizedProductDescription, catalogWarranty } from "@/lib/i18n/catalog-copy";
import { productDisplayName } from "@/lib/i18n/product-name";
import { notifyPaymentMaintenance } from "@/lib/telegram/payment-maintenance";
import { needsEmailForVariant } from "@/lib/warung-rebahan/delivery-class";
import { winnerForLoserProduct } from "@/lib/supplier-pairs";
import { getCatalogRevision } from "@/lib/catalog-cache";
import { unwrapD1 } from "@/lib/db-access";
import {
  clampQty, clearPendingAction, replaceWithPhoto, replaceWithText, runInBackground,
  setPendingActionUnlessCreating, type ScreenSourceMeta,
} from "./shared";

type CatalogProduct = { id: number; name: string; price: number; stock: number };
type CategoryRow = { id: number; name: string };
type CategoriesMemo = { revision: string; expiresAt: number; items: CategoryRow[] };

const CATEGORIES_MEMO_TTL_MS = 10_000;
const categoriesMemoByD1 = new WeakMap<object, CategoriesMemo>();

async function readTelegramCategories(): Promise<CategoryRow[]> {
  let hasEdgeCache = false;
  try {
    hasEdgeCache = Boolean((globalThis as unknown as { caches?: { default?: unknown } }).caches?.default);
  } catch { /* ignore */ }
  let d1Key: object | null = null;
  if (hasEdgeCache) {
    try {
      const raw = typeof getD1 === "function" ? getD1() : null;
      if (raw) d1Key = unwrapD1(raw) as object | null;
    } catch { /* ignore */ }
  }
  if (hasEdgeCache && d1Key) {
    const memo = categoriesMemoByD1.get(d1Key);
    if (memo && Date.now() < memo.expiresAt) {
      const rev = await getCatalogRevision("market").catch(() => null);
      if (rev && rev === memo.revision) return memo.items;
    }
  }
  const rows = (await queryAll(`SELECT id, name FROM categories ORDER BY sort_order ASC`)) as unknown as CategoryRow[];
  if (hasEdgeCache && d1Key) {
    const rev = await getCatalogRevision("market").catch(() => null);
    if (rev) {
      categoriesMemoByD1.set(d1Key, { revision: rev, expiresAt: Date.now() + CATEGORIES_MEMO_TTL_MS, items: rows });
    }
  }
  return rows;
}

function safeVariantDuration(
  v: {
    label: string;
    duration_label?: string | null;
    duration_value?: number | null;
    duration_unit?: string | null;
    warranty_label?: string | null;
    warranty_value?: number | null;
    warranty_unit?: string | null;
    wr_variant_id?: string | null;
  },
  locale: Locale,
): string | null {
  return variantButtonDuration(v, locale);
}

function triggerTyping(chatId: number): void {
  if (typeof tgApi.sendChatAction === "function") {
    runInBackground(tgApi.sendChatAction(chatId, "typing"));
  }
}

/**
 * Produk yang BISA DIBELI saja (keputusan owner 2026-09-24): produk tanpa
 * satu pun varian tersedia tidak tampil di katalog Telegram. Dulu 28 dari 48
 * produk di katalog adalah jalan buntu "stok habis". Membaca tabel yang sama
 * dengan web setiap kali dibuka, jadi habis/ready di web langsung berlaku di
 * sini. Harga = varian tersedia termurah, sama dengan kartu web.
 */
export async function listTelegramProducts(categoryId?: number, locale: "id" | "en" = "id"): Promise<CatalogProduct[]> {
  const { readTelegramCatalog } = await import("@/lib/telegram/catalog-snapshot");
  return (await readTelegramCatalog())
    .filter(row => row.price !== null && (!categoryId || row.category_id === categoryId))
    .map(row => ({
      id: row.id,
      name: productDisplayName({ name: row.name, nameEn: row.name_en }, locale),
      price: row.price!,
      stock: row.stock,
    }));
}

// TG2a: prefs+FX resolved ONCE per read surface, threaded as plain options
// into message+keyboard builders. Displays only — no order/payment writes.
async function tgCtx(userId: number): Promise<TgCtx> {
  return tgCtxFor(userId);
}

// Flat catalog (WA parity): product names only, no mandatory categories.
export async function handleShowCatalog(chatId: number, from?: { id: number }) {
  const ctx = await tgCtx(from?.id ?? chatId);
  const products = await listTelegramProducts(undefined, ctx.locale);
  await sendMessage({
    chat_id: chatId,
    text: catalogFlatMessage(products.length, { locale: ctx.locale }),
    parse_mode: "HTML",
    reply_markup: catalogFlatKeyboard(products, 0, 8, { locale: ctx.locale, displayCurrency: ctx.displayCurrency, fx: ctx.fx }),
  });
}

export async function handleShowCatalogEdit(chatId: number, messageId: number, page: number, from?: { id: number }, sourceMeta?: ScreenSourceMeta) {
  const ctx = await tgCtx(from?.id ?? chatId);
  const products = await listTelegramProducts(undefined, ctx.locale);
  await replaceWithText({
    chat_id: chatId, message_id: messageId,
    text: catalogFlatMessage(products.length, { locale: ctx.locale }),
    parse_mode: "HTML",
    reply_markup: catalogFlatKeyboard(products, page, 8, { locale: ctx.locale, displayCurrency: ctx.displayCurrency, fx: ctx.fx }),
  }, sourceMeta);
}

export async function handleShowCategoriesEdit(chatId: number, messageId: number, page: number, from?: { id: number }, sourceMeta?: ScreenSourceMeta) {
  const [ctx, categories] = await Promise.all([
    tgCtx(from?.id ?? chatId),
    readTelegramCategories(),
  ]);
  await replaceWithText({
    chat_id: chatId, message_id: messageId,
    text: categoriesMessage({ locale: ctx.locale }),
    parse_mode: "HTML",
    reply_markup: categoriesKeyboard(categories, page, { locale: ctx.locale }),
  }, sourceMeta);
}

export async function handleShowProducts(chatId: number, messageId: number, categoryId: number, page: number, from?: { id: number }, sourceMeta?: ScreenSourceMeta) {
  const [ctx, category] = await Promise.all([
    tgCtx(from?.id ?? chatId),
    queryFirst(`SELECT name FROM categories WHERE id=?`, categoryId),
  ]);
  if (!category) return;

  const products = await listTelegramProducts(categoryId, ctx.locale);

  await replaceWithText({
    chat_id: chatId, message_id: messageId,
    text: categoryProductsMessage(String(category.name), products.length, { locale: ctx.locale }),
    parse_mode: "HTML",
    reply_markup: productsKeyboard(products, categoryId, page, { locale: ctx.locale, displayCurrency: ctx.displayCurrency, fx: ctx.fx }),
  }, sourceMeta);
}

export async function handleShowProduct(chatId: number, messageId: number, requestedProductId: number, from?: { id: number }, sourceMeta?: ScreenSourceMeta) {
  triggerTyping(chatId);
  const [ctx, winnerId] = await Promise.all([
    tgCtx(from?.id ?? chatId),
    winnerForLoserProduct(requestedProductId).catch(() => null),
  ]);

  // Pecundang pasangan WR/SK (tombol lama, hasil cari lama) → tampilkan
  // pemenangnya, cermin redirect 308 PDP web: 1 barang = 1 kartu.
  const productId = winnerId ?? requestedProductId;

  // Collapse telegram_enabled + compare_price + badge + sold_count into ONE query alongside getProductDetail.
  const [detail, productRow] = await Promise.all([
    getProductDetail(productId),
    queryFirst(
      `SELECT telegram_enabled, compare_price, badge, ${displaySoldCountSql("products")} AS sold_count FROM products WHERE id=? AND is_active=1`,
      productId,
    ),
  ]);
  // Tombol dari pesan katalog lama bisa menunjuk produk yang sudah nonaktif:
  // jawab, jangan diam (spinner berhenti tanpa penjelasan).
  if (!detail || !productRow || Number(productRow.telegram_enabled) !== 1) {
    await replaceWithText({
      chat_id: chatId,
      message_id: messageId,
      text: ctx.locale === "en" ? "Product unavailable. Browse /katalog." : "Produk tidak tersedia. Cek /katalog.",
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    }, sourceMeta);
    return;
  }

  // Aggregate stock from variants for display
  trackFunnelEvent({ stage: "view", channel: "telegram", productId, locale: ctx.locale });
  const activeVariants = detail.variants.filter(v => v.is_active).map(v => ({ ...v, stock: effectiveVariantStock(v) }));
  const soldCount = productRow.sold_count ? Number(productRow.sold_count) : 0;

  const imageUrl = detail.image?.startsWith("/") ? `https://axvara.tech${detail.image}` : detail.image ?? "";
  const canTryPhoto = imageUrl.startsWith("https://");
  const text = productDetailMessage({
    name: productDisplayName(detail, ctx.locale),
    description: localizedProductDescription(detail, ctx.locale),
    sold_count: soldCount,
  }, {
    locale: ctx.locale,
    hasImage: canTryPhoto,
  });
  const keyboard = variantsKeyboard(productId, activeVariants.map(v => ({
    ...v,
    label: formatVariantLabel(v, ctx.locale),
  })), { locale: ctx.locale, displayCurrency: ctx.displayCurrency, fx: ctx.fx });

  // Product photo = same image as web (file_id cached; single active screen).
  if (canTryPhoto && text.length <= 1024) {
    const sent = await replaceWithPhoto({
      chat_id: chatId,
      message_id: messageId,
      photo: imageUrl,
      caption: text,
      parse_mode: "HTML",
      reply_markup: keyboard,
    }, sourceMeta);
    if (sent.ok) return;
  }
  await replaceWithText({
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    reply_markup: keyboard,
  }, sourceMeta);
}

// --- Variant flow handlers (TELEGRAM_VARIANT_FLOW) ---

export async function handleShowVariants(chatId: number, messageId: number, productId: number, from?: { id: number }, sourceMeta?: ScreenSourceMeta) {
  await handleShowProduct(chatId, messageId, productId, from, sourceMeta);
}

export async function handleVariantConfirm(chatId: number, messageId: number, variantId: number, from?: { id: number }, sourceMeta?: ScreenSourceMeta) {
  if (await notifyPaymentMaintenance(chatId)) return;
  const [ctx, variant] = await Promise.all([
    tgCtx(from?.id ?? chatId),
    getActiveVariant(variantId),
  ]);
  if (!variant) {
    await sendMessage({ chat_id: chatId, text: errorMessage({ locale: ctx.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
    return;
  }

  if (effectiveVariantStock(variant) !== -1 && effectiveVariantStock(variant) < variant.min_qty) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage({ locale: ctx.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
    return;
  }

  // Parallel: fetch product metadata (reused in handleShowQty!) and existing pending order.
  const [product, existingOrder] = await Promise.all([
    queryFirst(`SELECT id, name, name_en, require_email, telegram_enabled, is_active FROM products WHERE id=?`, variant.product_id),
    queryFirst(
      `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending') AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))
       ORDER BY CASE WHEN variant_id=? THEN 0 ELSE 1 END, id DESC LIMIT 1`,
      String(chatId), variantId,
    ),
  ]);
  const productId = product ? Number(product.id) : 0;

  if (existingOrder) {
    try {
      const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
      await retryTelegramInvoiceDelivery(String(existingOrder.code)).catch(() => false);
    } catch { /* sapuan cron berikutnya */ }
    const { alreadyPendingMessage } = await import("@/lib/telegram/messages");
    await sendMessage({
      chat_id: chatId,
      text: alreadyPendingMessage(String(existingOrder.code), { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: orderStatusKeyboard(String(existingOrder.code), { locale: ctx.locale }),
    });
    return;
  }

  await handleShowQty(chatId, messageId, productId, variantId, 1, from, sourceMeta, {
    ctx,
    variant,
    product: product ? {
      id: Number(product.id),
      name: String(product.name),
      name_en: product.name_en == null ? null : String(product.name_en),
      require_email: Number(product.require_email ?? 0),
      telegram_enabled: Number(product.telegram_enabled ?? 1),
      is_active: Number(product.is_active ?? 1),
    } : null,
  });
}

export async function handleShowQty(
  chatId: number,
  messageId: number,
  productId: number,
  variantId: number,
  _requestedQty = 1,
  from?: { id: number },
  sourceMeta?: ScreenSourceMeta,
  preloaded?: {
    ctx: TgCtx;
    variant: NonNullable<Awaited<ReturnType<typeof getActiveVariant>>>;
    product: { id: number; name: string; name_en: string | null; require_email: number; telegram_enabled?: number; is_active?: number } | null;
  },
) {
  if (await notifyPaymentMaintenance(chatId)) return;
  const [ctx, variant, product, existingOrder] = preloaded
    ? [preloaded.ctx, preloaded.variant, preloaded.product, null]
    : await Promise.all([
        tgCtx(from?.id ?? chatId),
        getActiveVariant(variantId),
        queryFirst(`SELECT id, name, name_en, require_email, telegram_enabled, is_active FROM products WHERE id=?`, productId).then((row) =>
          row ? {
            id: Number(row.id),
            name: String(row.name),
            name_en: row.name_en == null ? null : String(row.name_en),
            require_email: Number(row.require_email ?? 0),
            telegram_enabled: Number(row.telegram_enabled ?? 1),
            is_active: Number(row.is_active ?? 1),
          } : null
        ),
        queryFirst(
          `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending') AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))
           ORDER BY CASE WHEN variant_id=? THEN 0 ELSE 1 END, id DESC LIMIT 1`,
          String(chatId), variantId,
        ),
      ]);
  if (
    !variant ||
    variant.product_id !== productId ||
    !product ||
    Number(product.is_active ?? 1) !== 1 ||
    Number(product.telegram_enabled ?? 1) !== 1
  ) {
    await sendMessage({ chat_id: chatId, text: errorMessage({ locale: ctx.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
    return;
  }
  if (existingOrder) {
    try {
      const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
      await retryTelegramInvoiceDelivery(String(existingOrder.code)).catch(() => false);
    } catch { /* sapuan cron berikutnya */ }
    const { alreadyPendingMessage } = await import("@/lib/telegram/messages");
    await sendMessage({
      chat_id: chatId,
      text: alreadyPendingMessage(String(existingOrder.code), { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: orderStatusKeyboard(String(existingOrder.code), { locale: ctx.locale }),
    });
    return;
  }
  variant.stock = effectiveVariantStock(variant);
  const stockMax = variant.stock === -1 ? TELEGRAM_MAX_QTY : Math.max(1, Math.min(variant.stock, TELEGRAM_MAX_QTY));
  const uniqueMax = variant.fulfillment_mode === "unique" ? Math.min(MAX_UNIQUE_UNITS_PER_ORDER, stockMax) : stockMax;
  const minQty = Math.max(1, Number(variant.min_qty ?? 1) || 1);
  const maxQty = Math.min(variant.max_qty ?? TELEGRAM_MAX_QTY, uniqueMax);
  if (variant.stock === 0 || (variant.stock !== -1 && variant.stock < minQty) || minQty > maxQty) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage({ locale: ctx.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
    return;
  }
  const productName = productDisplayName({ name: product.name, nameEn: product.name_en }, ctx.locale);

  // Remember qty context so a typed number (min..max) works without extra clicks.
  if (isD1Mode() && !(await setPendingActionUnlessCreating(String(from?.id ?? chatId), chatId, `qty_for:${productId}:${variantId}`))) return;

  const unitPrice = Number(variant.price);
  const vLabel = formatVariantLabel(variant, ctx.locale);
  const vDuration = safeVariantDuration({ ...variant, label: vLabel }, ctx.locale);

  await replaceWithText({
    chat_id: chatId,
    message_id: messageId,
    text: chooseQtyMessage({
      productName,
      variantLabel: vLabel,
      duration: vDuration,
      price: unitPrice,
      basePrice: unitPrice,
      bulkTiers: variant.bulk_pricing_tiers,
      bulkEnabled: variant.bulk_pricing_enabled ? true : variant.bulk_pricing_invalid ? false : undefined,
      stock: variant.stock,
      maxQty,
      minQty,
    }, {
      locale: ctx.locale,
      formatPrice: (idr) => tgDisplayPrice(idr, ctx),
      usdUnavailable: tgUsdAlternate(unitPrice, ctx).usdUnavailable,
    }),
    parse_mode: "HTML",
    reply_markup: qtyKeyboard({
      productId,
      variantId,
      stock: variant.stock,
      maxQty,
      minQty,
    }, { locale: ctx.locale, displayCurrency: ctx.displayCurrency, fx: ctx.fx }),
  }, sourceMeta);
}

const BOILERPLATE_DESC_ID = /Detail benefit,\s*syarat,\s*dan cara aktivasi mengikuti varian yang dipilih\.?/gi;
const BOILERPLATE_DESC_EN = /Benefit details,\s*terms,\s*and activation steps follow the chosen variant\.?/gi;

function copyLineDedupeKey(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")
    .replace(/^(?:[-–—•·*▪✓✔]+\s*|\d{1,2}[.)]\s+)/u, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function buildReviewCopySections(params: {
  locale: Locale;
  variant: NonNullable<Awaited<ReturnType<typeof getActiveVariant>>>;
  merged: ReturnType<typeof mergeProductCopy>;
  parsedDesc: ReturnType<typeof parseProductDescription>;
}): ReviewCopySection[] {
  const { locale, variant, merged, parsedDesc } = params;
  const seen = new Set<string>();
  const addUnique = (target: string[], raw: string, bullet = false) => {
    const cleaned = raw.trim();
    const key = copyLineDedupeKey(cleaned);
    if (!key || seen.has(key)) return;
    seen.add(key);
    target.push(bullet ? `• ${cleaned}` : cleaned);
  };

  const pkgLines: string[] = [];
  for (const sec of merged.sections) {
    if (sec.kind === "paket" || sec.kind === "proses") {
      for (const item of sec.items) addUnique(pkgLines, item, true);
    }
  }
  // Fall back to product description bullets ONLY when the variant has no
  // package/process detail of its own; never show both.
  if (pkgLines.length === 0) {
    const bulletItems: string[] = [];
    for (const block of parsedDesc.blocks) {
      if (block.type === "list") {
        for (const item of block.items) {
          const stripped = item.replace(BOILERPLATE_DESC_ID, "").replace(BOILERPLATE_DESC_EN, "").trim();
          if (stripped) bulletItems.push(stripped);
        }
      }
    }
    if (bulletItems.length > 0) {
      for (const item of bulletItems) addUnique(pkgLines, item, true);
    } else {
      for (const block of parsedDesc.blocks) {
        if (block.type === "p") {
          const stripped = block.text.replace(BOILERPLATE_DESC_ID, "").replace(BOILERPLATE_DESC_EN, "").trim();
          if (stripped) addUnique(pkgLines, stripped, false);
        }
      }
    }
    for (const sec of parsedDesc.sections) {
      const tempLines: string[] = [];
      for (const item of sec.items) addUnique(tempLines, item, true);
      if (tempLines.length > 0) {
        if (sec.title.trim()) {
          const titleKey = copyLineDedupeKey(sec.title);
          if (titleKey && !seen.has(titleKey)) {
            seen.add(titleKey);
            pkgLines.push(`${sec.title.trim()}:`);
          }
        }
        pkgLines.push(...tempLines);
      }
    }
  }

  const activationLines: string[] = [];
  for (const group of merged.activation) {
    const groupSteps: string[] = [];
    for (const step of group.steps) {
      const cleaned = step.trim();
      const key = copyLineDedupeKey(cleaned);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      groupSteps.push(`${groupSteps.length + 1}. ${cleaned}`);
    }
    if (groupSteps.length > 0) {
      if (group.title?.trim()) {
        const titleKey = copyLineDedupeKey(group.title);
        if (titleKey && !seen.has(titleKey)) {
          seen.add(titleKey);
          activationLines.push(group.title.trim());
        }
      }
      activationLines.push(...groupSteps);
    }
  }

  const warrantyLines: string[] = [];
  if (variant.warranty_type && variant.warranty_type !== "none") {
    const wLabel = locale === "en" ? catalogWarranty(variant, "en") : buyerWarrantyLabel(variant);
    if (wLabel) addUnique(warrantyLines, wLabel, true);
  }
  for (const sec of merged.sections) {
    if (sec.kind === "garansi" || sec.kind === "aturan") {
      for (const item of sec.items) addUnique(warrantyLines, item, true);
    }
  }
  for (const note of merged.notes) {
    addUnique(warrantyLines, note, true);
  }

  const out: ReviewCopySection[] = [];
  if (pkgLines.length > 0) out.push({ kind: "package", lines: pkgLines });
  if (activationLines.length > 0) out.push({ kind: "activation", lines: activationLines });
  if (warrantyLines.length > 0) out.push({ kind: "warranty_terms", lines: warrantyLines });
  return out;
}

export async function handleShowReview(
  chatId: number,
  messageId: number,
  productId: number,
  variantId: number,
  requestedQty: number,
  from?: { id: number },
  sourceMeta?: ScreenSourceMeta,
) {
  if (await notifyPaymentMaintenance(chatId)) return;
  const userId = from?.id ?? chatId;
  if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(variantId) || variantId <= 0) {
    const ctx = await tgCtx(userId);
    await sendMessage({ chat_id: chatId, text: errorMessage({ locale: ctx.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
    return;
  }

  const [ctx, variant, productRow, existingOrder] = await Promise.all([
    tgCtx(userId),
    getActiveVariant(variantId),
    queryFirst(
      `SELECT id, name, name_en, description, admin_description_override, description_en, require_email, telegram_enabled, is_active FROM products WHERE id=?`,
      productId,
    ),
    queryFirst(
      `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending') AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))
       ORDER BY CASE WHEN variant_id=? THEN 0 ELSE 1 END, id DESC LIMIT 1`,
      String(chatId),
      variantId,
    ),
  ]);

  if (
    !variant ||
    variant.product_id !== productId ||
    !productRow ||
    Number(productRow.is_active) !== 1 ||
    Number(productRow.telegram_enabled) !== 1
  ) {
    await sendMessage({ chat_id: chatId, text: errorMessage({ locale: ctx.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
    return;
  }

  if (existingOrder) {
    try {
      const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
      await retryTelegramInvoiceDelivery(String(existingOrder.code)).catch(() => false);
    } catch { /* sapuan cron berikutnya */ }
    const { alreadyPendingMessage } = await import("@/lib/telegram/messages");
    await sendMessage({
      chat_id: chatId,
      text: alreadyPendingMessage(String(existingOrder.code), { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: orderStatusKeyboard(String(existingOrder.code), { locale: ctx.locale }),
    });
    return;
  }

  const en = ctx.locale === "en";
  variant.stock = effectiveVariantStock(variant);
  const stockMax = variant.stock === -1 ? TELEGRAM_MAX_QTY : Math.max(1, Math.min(variant.stock, TELEGRAM_MAX_QTY));
  const uniqueMax = variant.fulfillment_mode === "unique" ? Math.min(MAX_UNIQUE_UNITS_PER_ORDER, stockMax) : stockMax;
  const minQty = Math.max(1, Number(variant.min_qty ?? 1) || 1);
  const maxQty = Math.min(variant.max_qty ?? TELEGRAM_MAX_QTY, uniqueMax);
  if (variant.stock === 0 || (variant.stock !== -1 && variant.stock < minQty) || minQty > maxQty) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage({ locale: ctx.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
    return;
  }

  if (!Number.isSafeInteger(requestedQty) || requestedQty < minQty) {
    await sendMessage({
      chat_id: chatId,
      text: en
        ? `Minimum purchase is ${minQty}. Adjust quantity to at least ${minQty} before paying.`
        : `Minimal pembelian ${minQty}. Ubah jumlah ke minimal ${minQty} sebelum membayar.`,
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    await handleShowQty(chatId, messageId, productId, variantId, minQty, from, sourceMeta, {
      ctx,
      variant,
      product: {
        id: Number(productRow.id),
        name: String(productRow.name),
        name_en: productRow.name_en == null ? null : String(productRow.name_en),
        require_email: Number(productRow.require_email ?? 0),
        telegram_enabled: Number(productRow.telegram_enabled ?? 1),
        is_active: Number(productRow.is_active ?? 1),
      },
    });
    return;
  }

  if ((variant.stock !== -1 && requestedQty > variant.stock) || requestedQty > maxQty || requestedQty > TELEGRAM_MAX_QTY) {
    await sendMessage({
      chat_id: chatId,
      text: variant.stock !== -1 && requestedQty > variant.stock
        ? (en ? `Only ${variant.stock} left in stock. Choose a valid quantity.` : `Stok hanya tersisa ${variant.stock}. Pilih jumlah yang tersedia.`)
        : (en ? `Maximum purchase is ${maxQty}. Choose a valid quantity.` : `Maksimal pembelian ${maxQty}. Pilih jumlah yang sesuai.`),
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    await handleShowQty(chatId, messageId, productId, variantId, maxQty, from, sourceMeta, {
      ctx,
      variant,
      product: {
        id: Number(productRow.id),
        name: String(productRow.name),
        name_en: productRow.name_en == null ? null : String(productRow.name_en),
        require_email: Number(productRow.require_email ?? 0),
        telegram_enabled: Number(productRow.telegram_enabled ?? 1),
        is_active: Number(productRow.is_active ?? 1),
      },
    });
    return;
  }

  const qty = clampQty(requestedQty);

  let effectivePrice = Number(variant.price);
  let appliedTierMinQty: number | null = null;
  try {
    const { resolveBulkPrice: resolveReviewBulk } = await import("@/lib/bulk-pricing");
    const resolved = resolveReviewBulk(Number(variant.price), qty, variant.bulk_pricing_enabled ? 1 : 0, JSON.stringify(variant.bulk_pricing_tiers ?? []));
    effectivePrice = resolved.price;
    appliedTierMinQty = resolved.tier ?? null;
  } catch {
    await sendMessage({ chat_id: chatId, text: errorMessage({ locale: ctx.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
    return;
  }

  // Clear qty_for / non-creating state so free-text won't re-trigger qty input while preserving any creating anchor.
  if (from) await clearPendingAction(from);

  const variantCopy = resolveVariantCopy(variant.terms, variant.delivery_terms, adminCopyOf(variant), ctx.locale);
  const links = variantCopy?.source === "pemasok"
    ? await loadActiveSupplierLinkMap().catch(() => null)
    : null;
  const sanitized = links ? sanitizeSupplierCopy(variantCopy, links) : variantCopy;
  const productDesc = localizedProductDescription({
    description: displayDescription(productRow),
    descriptionEn: displayDescriptionEn(productRow),
  }, ctx.locale);
  const parsedDesc = parseProductDescription(productDesc);
  const merged = mergeProductCopy(sanitized, parsedDesc);
  const sections = buildReviewCopySections({ locale: ctx.locale, variant, merged, parsedDesc });

  const productName = productDisplayName({
    name: String(productRow.name),
    nameEn: productRow.name_en == null ? null : String(productRow.name_en),
  }, ctx.locale);
  const vLabel = formatVariantLabel(variant, ctx.locale);
  const vDuration = safeVariantDuration({ ...variant, label: vLabel }, ctx.locale);
  const approvalTag = await checkoutApprovalTag([{ productId, variantId, qty, price: effectivePrice }]);

  const rendered = reviewPurchaseMessage({
    productName,
    variantLabel: vLabel,
    duration: vDuration,
    qty,
    unitPrice: effectivePrice,
    basePrice: Number(variant.price),
    appliedTierMinQty,
    deliveryKind: buyerDeliveryKind(variant),
    sections,
  }, {
    locale: ctx.locale,
    formatPrice: (idr) => tgDisplayPrice(idr, ctx),
    usdUnavailable: tgUsdAlternate(effectivePrice * qty, ctx).usdUnavailable,
  });

  await replaceWithText({
    chat_id: chatId,
    message_id: messageId,
    text: rendered.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: reviewKeyboard({
      productId,
      variantId,
      qty,
      approvalTag,
      truncated: rendered.truncated,
    }, { locale: ctx.locale }),
  }, sourceMeta);
}

export async function handleQtyInputPrompt(chatId: number, productId: number, variantId: number, from: { id: number }) {
  if (await notifyPaymentMaintenance(chatId)) return;
  const ctx = await tgCtx(from?.id ?? chatId);
  const variant = await getActiveVariant(variantId);
  if (!variant || variant.product_id !== productId) return;
  variant.stock = effectiveVariantStock(variant);
  const minQty = Math.max(1, Number(variant.min_qty ?? 1) || 1);
  const maxQty = Math.min(variant.max_qty ?? TELEGRAM_MAX_QTY,variant.fulfillment_mode === "unique" ? Math.min(MAX_UNIQUE_UNITS_PER_ORDER, variant.stock === -1 ? MAX_UNIQUE_UNITS_PER_ORDER : variant.stock) : variant.stock === -1 ? TELEGRAM_MAX_QTY : Math.min(variant.stock, TELEGRAM_MAX_QTY));
  if (minQty > maxQty) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage({ locale: ctx.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
    return;
  }
  if (isD1Mode() && !(await setPendingActionUnlessCreating(String(from.id), chatId, `qty_for:${productId}:${variantId}`))) return;
  await sendMessage({
    chat_id: chatId,
    text: ctx.locale === "en"
      ? `<b>Enter quantity</b>\n\nSend a number ${minQty}–${maxQty}. Type /batal to go back.`
      : `<b>Masukkan jumlah</b>\n\nKirim angka ${minQty}–${maxQty}. Ketik /batal untuk kembali.`,
    parse_mode: "HTML",
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: ctx.locale === "en" ? `Type ${minQty}–${maxQty}` : `Ketik ${minQty}–${maxQty}` },
  });
}

export async function handleProductTerms(
  chatId: number,
  productId: number,
  variantId = 0,
  requestedPage = 0,
  from?: { id: number },
  messageId = 0,
  sourceMeta?: ScreenSourceMeta,
) {
  const [ctx, detail, enabled] = await Promise.all([
    tgCtx(from?.id ?? chatId),
    getProductDetail(productId),
    queryFirst("SELECT telegram_enabled FROM products WHERE id=? AND is_active=1", productId),
  ]);
  if (!detail || Number(enabled?.telegram_enabled) !== 1) return;
  if (!variantId) {
    await replaceWithText({
      chat_id: chatId,
      message_id: messageId,
      text: ctx.locale === "en" ? "Choose a variant to read its terms." : "Pilih varian untuk membaca ketentuannya.",
      reply_markup: { inline_keyboard: detail.variants.filter(v => v.is_active).map(v => [{ text: formatVariantLabel(v, ctx.locale).slice(0, 60), callback_data: cb.terms(productId, v.id) }]) },
    }, sourceMeta);
    return;
  }
  const variants = detail.variants.filter(v => v.id === variantId && v.is_active);
  const resolvedVariants = variants.map((variant) => ({
    variant,
    variantCopy: resolveVariantCopy(variant.terms, variant.delivery_terms, adminCopyOf(variant), ctx.locale),
  }));
  const links = resolvedVariants.some((item) => item.variantCopy?.source === "pemasok")
    ? await loadActiveSupplierLinkMap()
    : null;
  for (const { variant, variantCopy } of resolvedVariants) {
    const sanitized = links ? sanitizeSupplierCopy(variantCopy, links) : variantCopy;
    const copy = mergeProductCopy(sanitized, parseProductDescription(localizedProductDescription(detail, ctx.locale)));
    const lines = [
      ...copy.sections.flatMap(section => [copySectionTitles(ctx.locale)[section.kind], ...section.items.map(item => `• ${item}`), ""]),
      ...copy.activation.flatMap(group => [group.title ?? (ctx.locale === "en" ? "How to activate" : "Cara aktivasi"), ...group.steps.map((step, i) => `${i + 1}. ${step}`), ""]),
      ...copy.notes,
    ];
    if (!lines.length) lines.push(ctx.locale === "en" ? "No specific terms yet. Contact admin via /bantuan before buying." : "Ketentuan khusus belum tersedia. Hubungi admin melalui /bantuan sebelum membeli.");
    const header = `<b>${escapeHtml(formatVariantLabel(variant, ctx.locale).slice(0, 120))}</b>\n\n`;
    let body = "";
    const parts: string[] = [];
    for (const char of lines.join("\n")) {
      const escaped = escapeHtml(char);
      if (header.length + body.length + escaped.length > 3900) { parts.push(header + body); body = ""; }
      body += escaped;
    }
    if (body) parts.push(header + body);
    const page = Math.max(0, Math.min(parts.length - 1, Math.floor(requestedPage) || 0));
    const navigation = [];
    if (page > 0) navigation.push({ text: ctx.locale === "en" ? "Previous" : "Sebelumnya", callback_data: `${cb.terms(productId, variant.id)}:${page - 1}` });
    if (page < parts.length - 1) navigation.push({ text: ctx.locale === "en" ? "Next terms" : "Ketentuan Berikutnya", callback_data: `${cb.terms(productId, variant.id)}:${page + 1}` });
    const sent = await replaceWithText({
      chat_id: chatId,
      message_id: messageId,
      text: parts[page],
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [...(navigation.length ? [navigation] : []), [{ text: ctx.locale === "en" ? "Choose Variant" : "Pilih Varian", callback_data: cb.variants(productId) }], [{ text: ctx.locale === "en" ? "Continue to Quantity" : "Lanjut ke Jumlah", callback_data: cb.variant(variant.id) }]] },
    }, sourceMeta);
    if (!sent.ok) throw new Error("telegram_terms_send_failed");
  }
}
