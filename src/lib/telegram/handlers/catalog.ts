// src/lib/telegram/handlers/catalog.ts — Handler penjelajahan katalog & varian.
//
// MENGAPA dipisah: handler tampilan (katalog datar, kategori, daftar produk,
// detail produk, pemilih varian, dan stepper jumlah) hanya MEMBACA katalog dan
// merender pesan — tidak menyentuh uang/order. Mengisolasinya dari jalur invoice
// membuat perubahan tampilan aman ditinjau. Pemindahan murni dari route.ts.

import { queryFirst, queryAll, execRun, isD1Mode } from "@/lib/db";
import { sendMessage, sendPhoto, safeEditOrSend, showLoadingBar } from "@/lib/telegram/api";
import {
  catalogFlatKeyboard, categoriesKeyboard, productsKeyboard,
  productDetailKeyboard, variantsKeyboard,
  qtyKeyboard, TELEGRAM_MAX_QTY,
} from "@/lib/telegram/keyboards";
import {
  catalogFlatMessage, categoriesMessage, categoryProductsMessage,
  productDetailMessage, outOfStockMessage, errorMessage,
  chooseVariantMessage, chooseQtyMessage,
} from "@/lib/telegram/messages";
import { getProductDetail, getActiveVariant, formatDuration, formatWarranty } from "@/lib/catalog";
import { clampQty } from "./shared";
import { handleBuyConfirm } from "./discovery";

// Flat catalog (WA parity): product names only, no mandatory categories.
export async function handleShowCatalog(chatId: number) {
  const products = await queryAll(
    `SELECT p.id, p.name, COALESCE(MIN(pv.price), p.price) as price
     FROM products p
     LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = 1
     WHERE p.is_active=1 AND p.telegram_enabled=1
     GROUP BY p.id
     ORDER BY p.sort_order ASC, p.name ASC`,
  );
  await sendMessage({
    chat_id: chatId,
    text: catalogFlatMessage(products.length),
    parse_mode: "HTML",
    reply_markup: catalogFlatKeyboard(products as { id: number; name: string; price: number }[], 0),
  });
}

export async function handleShowCatalogEdit(chatId: number, messageId: number, page: number) {
  const products = await queryAll(
    `SELECT p.id, p.name, COALESCE(MIN(pv.price), p.price) as price
     FROM products p
     LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = 1
     WHERE p.is_active=1 AND p.telegram_enabled=1
     GROUP BY p.id
     ORDER BY p.sort_order ASC, p.name ASC`,
  );
  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: catalogFlatMessage(products.length),
    parse_mode: "HTML",
    reply_markup: catalogFlatKeyboard(products as { id: number; name: string; price: number }[], page),
  });
}

export async function handleShowCategoriesEdit(chatId: number, messageId: number, page: number) {
  const categories = await queryAll(
    `SELECT id, name FROM categories ORDER BY sort_order ASC`,
  );
  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: categoriesMessage(),
    parse_mode: "HTML",
    reply_markup: categoriesKeyboard(categories as { id: number; name: string }[], page),
  });
}

export async function handleShowProducts(chatId: number, messageId: number, categoryId: number, page: number) {
  const category = await queryFirst(`SELECT name FROM categories WHERE id=?`, categoryId);
  if (!category) return;

  // Use variant-level min price for accurate display (synced with web/WA)
  const products = await queryAll(
    `SELECT p.id, p.name, COALESCE(MIN(pv.price), p.price) as price
     FROM products p
     LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = 1
     WHERE p.category_id=? AND p.is_active=1 AND p.telegram_enabled=1
     GROUP BY p.id
     ORDER BY p.sort_order ASC`,
    categoryId,
  );

  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: categoryProductsMessage(String(category.name), products.length),
    parse_mode: "HTML",
    reply_markup: productsKeyboard(
      products as { id: number; name: string; price: number }[],
      categoryId, page,
    ),
  });
}

export async function handleShowProduct(chatId: number, messageId: number, productId: number) {
  await showLoadingBar(chatId, "📦 Memuat produk");

  // Use catalog.ts for variant-level stock (synced with web/WA)
  const detail = await getProductDetail(productId);
  if (!detail) return;

  // Check telegram_enabled flag
  const meta = await queryFirst(
    `SELECT telegram_enabled FROM products WHERE id=? AND is_active=1`,
    productId,
  );
  if (!meta || Number(meta.telegram_enabled) !== 1) return;

  // Aggregate stock from variants for display
  const activeVariants = detail.variants.filter(v => v.is_active);
  const hasUnlimited = activeVariants.some(v => v.stock === -1);
  const totalStock = hasUnlimited ? -1 : activeVariants.reduce((sum, v) => sum + v.stock, 0);
  const minPrice = activeVariants.length > 0 ? Math.min(...activeVariants.map(v => v.price)) : 0;
  const maxPrice = activeVariants.length > 0 ? Math.max(...activeVariants.map(v => v.price)) : 0;

  // Find compare_price from DB for discount display
  const priceRow = await queryFirst(`SELECT compare_price, badge, sold_count FROM products WHERE id=?`, productId);
  const comparePrice = priceRow?.compare_price ? Number(priceRow.compare_price) : null;
  const badge = priceRow?.badge ? String(priceRow.badge) : null;
  const soldCount = priceRow?.sold_count ? Number(priceRow.sold_count) : 0;

  const variantLines = activeVariants.map((v) => ({
    label: v.label,
    price: v.price,
    warranty: formatWarranty(v) || null,
    duration: formatDuration(v) || null,
    stock: v.stock,
  }));

  // No description rendered on Telegram (WA parity). Warranty per variant above
  // uses the same product_variants source as web/WA.
  const text = productDetailMessage({
    name: detail.name,
    price: minPrice,
    compare_price: comparePrice && comparePrice > maxPrice ? comparePrice : null,
    stock: totalStock,
    badge,
    sold_count: soldCount,
    variants: variantLines,
  });

  // Product photo = same image as web (free: sendPhoto with product image_url)
  const imageUrl = detail.image ?? "";
  if (imageUrl && imageUrl.startsWith("http")) {
    await sendPhoto({
      chat_id: chatId,
      photo: imageUrl,
      caption: text,
      parse_mode: "HTML",
      reply_markup: productDetailKeyboard(productId),
    });
  } else {
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text,
      parse_mode: "HTML",
      reply_markup: productDetailKeyboard(productId),
    });
  }
}

// --- Variant flow handlers (TELEGRAM_VARIANT_FLOW) ---

export async function handleShowVariants(chatId: number, messageId: number, productId: number) {
  const detail = await getProductDetail(productId);
  if (!detail || detail.variants.length === 0) {
    // Fallback to legacy flow if no variants
    await handleBuyConfirm(chatId, messageId, productId);
    return;
  }

  // If only 1 variant, skip to confirmation
  const activeVariants = detail.variants.filter((v) => v.is_active);
  if (activeVariants.length === 1) {
    await handleVariantConfirm(chatId, messageId, activeVariants[0].id);
    return;
  }

  const variantItems = activeVariants.map((v) => ({
    id: v.id,
    label: v.label,
    price: v.price,
    stock: v.stock,
    duration_label: formatDuration(v) || null,
  }));

  await safeEditOrSend({
    chat_id: chatId,
    message_id: messageId,
    text: chooseVariantMessage(detail.name),
    parse_mode: "HTML",
    reply_markup: variantsKeyboard(productId, variantItems),
  });
}

export async function handleVariantConfirm(chatId: number, messageId: number, variantId: number) {
  const variant = await getActiveVariant(variantId);
  if (!variant) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
    return;
  }

  if (variant.stock === 0) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
    return;
  }

  // Get product for name
  const product = await queryFirst(`SELECT id, name FROM products WHERE id=?`, variant.product_id);
  const productId = product ? Number(product.id) : 0;

  // Guard: existing pending order for this chat+variant — resend it, never duplicate.
  // RR3-05: kirim ulang foto invoice yang sama bila belum terkirim.
  const existingOrder = await queryFirst(
    `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending')
     AND variant_id=?`,
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
      text: alreadyPendingMessage(String(existingOrder.code)),
      parse_mode: "HTML",
      reply_markup: orderStatusKeyboard(String(existingOrder.code)),
    });
    return;
  }

  await handleShowQty(chatId, messageId, productId, variantId);
}

export async function handleShowQty(
  chatId: number,
  messageId: number,
  productId: number,
  variantId: number,
  requestedQty = 1,
) {
  const variant = await getActiveVariant(variantId);
  if (!variant || variant.product_id !== productId) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
    return;
  }
  if (variant.stock === 0) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
    return;
  }
  const product = await queryFirst(`SELECT id, name FROM products WHERE id=?`, productId);
  const productName = product ? String(product.name) : "Produk";
  const stockMax = variant.stock === -1 ? TELEGRAM_MAX_QTY : Math.max(1, Math.min(variant.stock, TELEGRAM_MAX_QTY));
  const maxQty = variant.fulfillment_mode === "unique" ? 1 : stockMax;
  const qty = Math.min(clampQty(requestedQty), maxQty);

  // Remember qty context so a typed number (1-100) works without buttons.
  if (isD1Mode()) {
    await execRun(
      `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=(SELECT user_id FROM telegram_users WHERE chat_id=? LIMIT 1)`,
      `qty_for:${productId}:${variantId}`,
      String(chatId),
    ).catch(() => {});
  }

  await safeEditOrSend({
    chat_id: chatId,
    message_id: messageId,
    text: chooseQtyMessage({
      productName,
      variantLabel: variant.label,
      price: variant.price,
      stock: variant.stock,
      qty,
      maxQty,
    }),
    parse_mode: "HTML",
    reply_markup: qtyKeyboard({ productId, variantId, stock: variant.stock, qty, price: variant.price, maxQty }),
  });
}
