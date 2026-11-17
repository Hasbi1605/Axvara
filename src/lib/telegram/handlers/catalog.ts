import { MAX_UNIQUE_UNITS_PER_ORDER } from "@/lib/fulfillment/units";
// src/lib/telegram/handlers/catalog.ts — Handler penjelajahan katalog & varian.
//
// MENGAPA dipisah: handler tampilan (katalog datar, kategori, daftar produk,
// detail produk, pemilih varian, dan stepper jumlah) hanya MEMBACA katalog dan
// merender pesan — tidak menyentuh uang/order. Mengisolasinya dari jalur invoice
// membuat perubahan tampilan aman ditinjau. Pemindahan murni dari route.ts.

import { queryFirst, queryAll, isD1Mode } from "@/lib/db";
import { sendMessage, sendPhoto, safeEditOrSend, withLoadingIndicator } from "@/lib/telegram/api";
import {
  catalogFlatMessage, categoriesMessage, categoryProductsMessage,
  productDetailMessage, outOfStockMessage, errorMessage,
  chooseQtyMessage, escapeHtml,
  myOrdersPrompt, myOrdersMessage, searchPromptMessage, searchResultsMessage,
} from "@/lib/telegram/messages";
import type { Locale } from "@/lib/i18n/locale";
import { tgCtxFor, tgUsdAlternate, type TgCtx } from "@/lib/telegram/render-prefs";
import {
  catalogFlatKeyboard, categoriesKeyboard, productsKeyboard,
  variantsKeyboard, cb, homeKeyboard,
  qtyKeyboard, TELEGRAM_MAX_QTY,
} from "@/lib/telegram/keyboards";
import { getProductDetail, getActiveVariant, formatVariantLabel, buyerWarrantyLabel, buyerDeliveryKind, effectiveVariantStock } from "@/lib/catalog";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import { resolveVariantCopy, adminCopyOf } from "@/lib/product-copy/resolve";
import { sanitizeSupplierCopy } from "@/lib/product-copy/sanitize";
import { mergeProductCopy, parseProductDescription, copySectionTitles } from "@/lib/product-copy/format";
import { loadActiveSupplierLinkMap } from "@/lib/supplier-links";
import { localizedProductDescription } from "@/lib/i18n/catalog-copy";
import { productDisplayName } from "@/lib/i18n/product-name";
import { needsEmailForVariant } from "@/lib/warung-rebahan/delivery-class";
import { winnerForLoserProduct } from "@/lib/supplier-pairs";
import { clampQty, setPendingActionUnlessCreating } from "./shared";

type CatalogProduct = { id: number; name: string; price: number };

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
    .map(row => ({ id: row.id, name: productDisplayName({ name: row.name, nameEn: row.name_en }, locale), price: row.price! }));
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

export async function handleShowCatalogEdit(chatId: number, messageId: number, page: number, from?: { id: number }) {
  const ctx = await tgCtx(from?.id ?? chatId);
  const products = await listTelegramProducts(undefined, ctx.locale);
  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: catalogFlatMessage(products.length, { locale: ctx.locale }),
    parse_mode: "HTML",
    reply_markup: catalogFlatKeyboard(products, page, 8, { locale: ctx.locale, displayCurrency: ctx.displayCurrency, fx: ctx.fx }),
  });
}

export async function handleShowCategoriesEdit(chatId: number, messageId: number, page: number, from?: { id: number }) {
  const ctx = await tgCtx(from?.id ?? chatId);
  const categories = await queryAll(
    `SELECT id, name FROM categories ORDER BY sort_order ASC`,
  );
  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: categoriesMessage({ locale: ctx.locale }),
    parse_mode: "HTML",
    reply_markup: categoriesKeyboard(categories as { id: number; name: string }[], page, { locale: ctx.locale }),
  });
}

export async function handleShowProducts(chatId: number, messageId: number, categoryId: number, page: number, from?: { id: number }) {
  const ctx = await tgCtx(from?.id ?? chatId);
  const category = await queryFirst(`SELECT name FROM categories WHERE id=?`, categoryId);
  if (!category) return;

  const products = await listTelegramProducts(categoryId, ctx.locale);

  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: categoryProductsMessage(String(category.name), products.length, { locale: ctx.locale }),
    parse_mode: "HTML",
    reply_markup: productsKeyboard(products, categoryId, page, { locale: ctx.locale, displayCurrency: ctx.displayCurrency, fx: ctx.fx }),
  });
}

export async function handleShowProduct(chatId: number, messageId: number, requestedProductId: number, from?: { id: number }) {
  const ctx = await tgCtx(from?.id ?? chatId);
  const loadingLabel: Record<Locale, string> = { id: "📦 Memuat produk", en: "📦 Loading product" };
  return withLoadingIndicator(chatId, loadingLabel[ctx.locale], async (beforeResult) => {

  // Pecundang pasangan WR/SK (tombol lama, hasil cari lama) → tampilkan
  // pemenangnya, cermin redirect 308 PDP web: 1 barang = 1 kartu.
  const productId = (await winnerForLoserProduct(requestedProductId).catch(() => null)) ?? requestedProductId;

  // Use catalog.ts for variant-level stock (synced with web/WA)
  const detail = await getProductDetail(productId);
  // Check telegram_enabled flag
  const meta = await queryFirst(
    `SELECT telegram_enabled FROM products WHERE id=? AND is_active=1`,
    productId,
  );
  // Tombol dari pesan katalog lama bisa menunjuk produk yang sudah nonaktif:
  // jawab, jangan diam (spinner berhenti tanpa penjelasan).
  if (!detail || !meta || Number(meta.telegram_enabled) !== 1) {
    await beforeResult();
    await sendMessage({ chat_id: chatId, text: ctx.locale === "en" ? "This product is currently unavailable. Browse /katalog for ready products 🙏" : "Produk ini sedang tidak tersedia. Buka /katalog untuk produk yang ready 🙏", parse_mode: "HTML" });
    return;
  }

  // Aggregate stock from variants for display
  const activeVariants = detail.variants.filter(v => v.is_active).map(v => ({ ...v, stock: effectiveVariantStock(v) }));
  const purchasable = activeVariants.filter(v => v.stock === -1 || v.stock >= v.min_qty);
  const hasUnlimited = activeVariants.some(v => v.stock === -1);
  const totalStock = hasUnlimited ? -1 : purchasable.reduce((sum, v) => sum + v.stock, 0);
  const minPrice = purchasable.length > 0 ? Math.min(...purchasable.map(v => v.price)) : 0;
  const maxPrice = purchasable.length > 0 ? Math.max(...purchasable.map(v => v.price)) : 0;

  // Find compare_price from DB for discount display
  const priceRow = await queryFirst(`SELECT compare_price, badge, sold_count FROM products WHERE id=?`, productId);
  const comparePrice = priceRow?.compare_price ? Number(priceRow.compare_price) : null;
  const badge = priceRow?.badge ? String(priceRow.badge) : null;
  const soldCount = priceRow?.sold_count ? Number(priceRow.sold_count) : 0;

  const variantLines = activeVariants.map((v) => {
    const kind = buyerDeliveryKind(v);
    return {
      label: formatVariantLabel(v, ctx.locale),
      price: v.price,
      warranty: buyerWarrantyLabel(v) || null,
      stock: v.stock,
      wr_delivery_class: v.wr_delivery_class ?? null,
      // Badge pengiriman siap tampil (satu sumber dengan PDP web via
      // buyerDeliveryKind): instan = "⚡ Kirim otomatis", antrean =
      // "⏳ Made By Order". Lihat productDetailMessage.
      delivery_badge: kind === "instant" ? "⚡ Kirim otomatis" : "⏳ Made By Order",
    };
  });

  const text = productDetailMessage({
    name: productDisplayName(detail, ctx.locale),
    description: localizedProductDescription(detail, ctx.locale),
    price: minPrice,
    compare_price: comparePrice && comparePrice > maxPrice ? comparePrice : null,
    stock: totalStock,
    badge,
    sold_count: soldCount,
    variants: variantLines,
  }, { locale: ctx.locale, ...tgUsdAlternate(minPrice, ctx) });
  const keyboard = variantsKeyboard(productId, activeVariants.map(v => ({ ...v, label: formatVariantLabel(v, ctx.locale) })), { locale: ctx.locale, displayCurrency: ctx.displayCurrency, fx: ctx.fx });

  // Product photo = same image as web (free: sendPhoto with product image_url)
  const imageUrl = detail.image?.startsWith("/") ? `https://axvara.tech${detail.image}` : detail.image ?? "";
  await beforeResult();
  if (imageUrl.startsWith("https://") && text.length <= 1024) {
    const sent = await sendPhoto({
      chat_id: chatId,
      photo: imageUrl,
      caption: text,
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
    if (!sent.ok) await safeEditOrSend({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", reply_markup: keyboard });
  } else {
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text,
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }
  });
}

// --- Variant flow handlers (TELEGRAM_VARIANT_FLOW) ---

export async function handleShowVariants(chatId: number, messageId: number, productId: number, from?: { id: number }) {
  await handleShowProduct(chatId, messageId, productId, from);
}

export async function handleVariantConfirm(chatId: number, messageId: number, variantId: number, from?: { id: number }) {
  const ctx = await tgCtx(from?.id ?? chatId);
  const variant = await getActiveVariant(variantId);
  if (!variant) {
    await sendMessage({ chat_id: chatId, text: errorMessage({ locale: ctx.locale }), parse_mode: "HTML" });
    return;
  }

  if (effectiveVariantStock(variant) !== -1 && effectiveVariantStock(variant) < variant.min_qty) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage({ locale: ctx.locale }), parse_mode: "HTML" });
    return;
  }

  // Get product for name
  const product = await queryFirst(`SELECT id, name FROM products WHERE id=?`, variant.product_id);
  const productId = product ? Number(product.id) : 0;

  // Guard: existing pending order for this chat — resend it, never duplicate.
  // RR3-05: kirim ulang foto invoice yang sama bila belum terkirim.
  // Per-chat, sejajar dengan jalur keranjang & beli-langsung (2026-09-23):
  // mencocokkan varian saja membuat satu chat bisa memegang dua order pending
  // + dua QRIS aktif. Varian yang sama tetap diprioritaskan agar kirim-ulang
  // invoice tidak berubah perilaku.
  const existingOrder = await queryFirst(
    `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending') AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))
     ORDER BY CASE WHEN variant_id=? THEN 0 ELSE 1 END, id DESC LIMIT 1`,
    String(chatId), variantId,
  );
  if (existingOrder) {
    try {
      const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
      await retryTelegramInvoiceDelivery(String(existingOrder.code)).catch(() => false);
    } catch { /* sapuan cron berikutnya */ }
    const { alreadyPendingMessage } = await import("@/lib/telegram/messages");
    const { orderStatusKeyboard } = await import("@/lib/telegram/keyboards");
    await sendMessage({
      chat_id: chatId,
      text: alreadyPendingMessage(String(existingOrder.code), { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: orderStatusKeyboard(String(existingOrder.code)),
    });
    return;
  }

  await handleShowQty(chatId, messageId, productId, variantId, 1, from);
}

export async function handleShowQty(
  chatId: number,
  messageId: number,
  productId: number,
  variantId: number,
  requestedQty = 1,
  from?: { id: number },
) {
  const ctx = await tgCtx(from?.id ?? chatId);
  const variant = await getActiveVariant(variantId);
  if (!variant || variant.product_id !== productId) {
    await sendMessage({ chat_id: chatId, text: errorMessage({ locale: ctx.locale }), parse_mode: "HTML" });
    return;
  }
  variant.stock = effectiveVariantStock(variant);
  if (variant.stock !== -1 && variant.stock < variant.min_qty) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage({ locale: ctx.locale }), parse_mode: "HTML" });
    return;
  }
  const product = await queryFirst(`SELECT id, name, name_en FROM products WHERE id=?`, productId);
  const productName = product ? productDisplayName({ name: String(product.name), nameEn: product.name_en == null ? null : String(product.name_en) }, ctx.locale) : "Produk";
  const productEmail = await queryFirst(`SELECT require_email FROM products WHERE id=?`, productId);
  const requiresEmail = needsEmailForVariant({
    wrType: variant.wr_type ?? null,
    requireEmail: Number(productEmail?.require_email ?? variant.require_email ?? 0),
  });
  const stockMax = variant.stock === -1 ? TELEGRAM_MAX_QTY : Math.max(1, Math.min(variant.stock, TELEGRAM_MAX_QTY));
  const uniqueMax = variant.fulfillment_mode === "unique" ? Math.min(MAX_UNIQUE_UNITS_PER_ORDER, stockMax) : stockMax;
  // Minimum pembelian (migrasi 0034): stepper dibuka LANGSUNG di min agar
  // pembeli GSuite (min 50) tidak mulai dari 1 lalu ditolak saat bayar.
  const minQty = Math.max(1, Number(variant.min_qty ?? 1) || 1);
  const maxQty = Math.min(variant.max_qty ?? TELEGRAM_MAX_QTY,uniqueMax);
  if (minQty > maxQty) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage({ locale: ctx.locale }), parse_mode: "HTML" });
    return;
  }
  const qty = Math.min(Math.max(clampQty(requestedQty), minQty), maxQty);

  // Remember qty context so a typed number (1-100) works without buttons.
  if (isD1Mode() && !(await setPendingActionUnlessCreating(String(chatId), chatId, `qty_for:${productId}:${variantId}`))) return;

  // TG2b: harga efektif server (agregat qty varian yang sama = qty ini)
  // untuk tampilan + approval; guard atomik memverifikasi ulang.
  let effectiveQtyPrice = Number(variant.price);
  let effectiveQtyTier: number | null = null;
  try {
    const { resolveBulkPrice: resolveQtyBulk } = await import("@/lib/bulk-pricing");
    const resolvedQty = resolveQtyBulk(Number(variant.price), qty, variant.bulk_pricing_enabled ? 1 : 0, JSON.stringify(variant.bulk_pricing_tiers ?? []));
    effectiveQtyPrice = resolvedQty.price;
    effectiveQtyTier = resolvedQty.tier ?? null;
  } catch {
    await sendMessage({ chat_id: chatId, text: errorMessage({ locale: ctx.locale }), parse_mode: "HTML" });
    return;
  }

  await safeEditOrSend({
    chat_id: chatId,
    message_id: messageId,
    text: chooseQtyMessage({
      productName,
      variantLabel: formatVariantLabel(variant, ctx.locale),
      price: effectiveQtyPrice,
      basePrice: Number(variant.price),
      appliedTierMinQty: effectiveQtyTier,
      bulkTiers: variant.bulk_pricing_tiers,
      bulkEnabled: variant.bulk_pricing_enabled ? true : variant.bulk_pricing_invalid ? false : undefined,
      stock: variant.stock,
      qty,
      maxQty,
      minQty,
      requiresEmail,
    }, { locale: ctx.locale, ...tgUsdAlternate(effectiveQtyPrice * qty, ctx) }) + `\n\n${ctx.locale === "en" ? "Delivery" : "Pengiriman"}: ${buyerDeliveryKind(variant) === "instant" ? (ctx.locale === "en" ? "automatic after payment" : "otomatis setelah pembayaran") : (ctx.locale === "en" ? "processed after payment" : "diproses setelah pembayaran")}.` + (buyerWarrantyLabel(variant) ? `\n${ctx.locale === "en" ? "Warranty" : "Garansi"}: ${escapeHtml(buyerWarrantyLabel(variant))}.` : "") + (ctx.locale === "en" ? "\nRead the product terms before paying." : "\nBaca ketentuan produk sebelum membayar."),
    parse_mode: "HTML",
    reply_markup: qtyKeyboard({ productId, variantId, stock: variant.stock, qty, price: effectiveQtyPrice, maxQty, minQty, requiresEmail, approvalTag: await checkoutApprovalTag([{ productId, variantId, qty, price: effectiveQtyPrice }]) }, { locale: ctx.locale, displayCurrency: ctx.displayCurrency, fx: ctx.fx }),
  });
}

export async function handleQtyInputPrompt(chatId: number, productId: number, variantId: number, from: { id: number }) {
  const ctx = await tgCtx(from?.id ?? chatId);
  const variant = await getActiveVariant(variantId);
  if (!variant || variant.product_id !== productId) return;
  variant.stock = effectiveVariantStock(variant);
  const minQty = Math.max(1, Number(variant.min_qty ?? 1) || 1);
  const maxQty = Math.min(variant.max_qty ?? TELEGRAM_MAX_QTY,variant.fulfillment_mode === "unique" ? Math.min(MAX_UNIQUE_UNITS_PER_ORDER, variant.stock === -1 ? MAX_UNIQUE_UNITS_PER_ORDER : variant.stock) : variant.stock === -1 ? TELEGRAM_MAX_QTY : Math.min(variant.stock, TELEGRAM_MAX_QTY));
  if (minQty > maxQty) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage({ locale: ctx.locale }), parse_mode: "HTML" });
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

export async function handleProductTerms(chatId: number, productId: number, variantId = 0, requestedPage = 0, from?: { id: number }) {
  const ctx = await tgCtx(from?.id ?? chatId);
  const detail = await getProductDetail(productId);
  const enabled = await queryFirst("SELECT telegram_enabled FROM products WHERE id=? AND is_active=1", productId);
  if (!detail || Number(enabled?.telegram_enabled) !== 1) return;
  if (!variantId) {
    await sendMessage({ chat_id: chatId, text: ctx.locale === "en" ? "Choose a variant to read its terms." : "Pilih varian untuk membaca ketentuannya.", reply_markup: { inline_keyboard: detail.variants.filter(v => v.is_active).map(v => [{ text: formatVariantLabel(v, ctx.locale).slice(0, 60), callback_data: cb.terms(productId, v.id) }]) } });
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
  const sent = await sendMessage({ chat_id: chatId, text: parts[page], parse_mode: "HTML", disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [...(navigation.length ? [navigation] : []), [{ text: ctx.locale === "en" ? "Choose Variant" : "Pilih Varian", callback_data: cb.variants(productId) }], [{ text: ctx.locale === "en" ? "Continue to Quantity" : "Lanjut ke Jumlah", callback_data: cb.variant(variant.id) }]] } });
    if (!sent.ok) throw new Error("telegram_terms_send_failed");
  }
}
