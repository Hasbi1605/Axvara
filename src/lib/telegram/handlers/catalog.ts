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
import { purchasableStockSql } from "@/lib/catalog-availability";
import { clampQty } from "./shared";
import { handleBuyConfirm } from "./discovery";

type CatalogProduct = { id: number; name: string; price: number };

/**
 * Produk yang BISA DIBELI saja (keputusan owner 2026-09-24): produk tanpa
 * satu pun varian tersedia tidak tampil di katalog Telegram. Dulu 28 dari 48
 * produk di katalog adalah jalan buntu "stok habis". Membaca tabel yang sama
 * dengan web setiap kali dibuka, jadi habis/ready di web langsung berlaku di
 * sini. Harga = varian tersedia termurah, sama dengan kartu web.
 */
export async function listTelegramProducts(categoryId?: number): Promise<CatalogProduct[]> {
  const rows = await queryAll(
    `SELECT p.id, p.name, MIN(pv.price) AS price
     FROM products p
     JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = 1 AND ${purchasableStockSql("pv")}
     WHERE p.is_active=1 AND p.telegram_enabled=1${categoryId ? " AND p.category_id=?" : ""}
     GROUP BY p.id
     ORDER BY p.sort_order ASC, p.name ASC`,
    ...(categoryId ? [categoryId] : []),
  );
  return rows.map((row) => ({ id: Number(row.id), name: String(row.name), price: Number(row.price) }));
}

// Flat catalog (WA parity): product names only, no mandatory categories.
export async function handleShowCatalog(chatId: number) {
  const products = await listTelegramProducts();
  await sendMessage({
    chat_id: chatId,
    text: catalogFlatMessage(products.length),
    parse_mode: "HTML",
    reply_markup: catalogFlatKeyboard(products, 0),
  });
}

export async function handleShowCatalogEdit(chatId: number, messageId: number, page: number) {
  const products = await listTelegramProducts();
  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: catalogFlatMessage(products.length),
    parse_mode: "HTML",
    reply_markup: catalogFlatKeyboard(products, page),
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

  const products = await listTelegramProducts(categoryId);

  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: categoryProductsMessage(String(category.name), products.length),
    parse_mode: "HTML",
    reply_markup: productsKeyboard(products, categoryId, page),
  });
}

export async function handleShowProduct(chatId: number, messageId: number, productId: number) {
  await showLoadingBar(chatId, "📦 Memuat produk");

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
    await sendMessage({ chat_id: chatId, text: "Produk ini sedang tidak tersedia. Buka /katalog untuk produk yang ready 🙏", parse_mode: "HTML" });
    return;
  }

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
    wr_delivery_class: v.wr_delivery_class ?? null,
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

  // Guard: existing pending order for this chat — resend it, never duplicate.
  // RR3-05: kirim ulang foto invoice yang sama bila belum terkirim.
  // Per-chat, sejajar dengan jalur keranjang & beli-langsung (2026-09-23):
  // mencocokkan varian saja membuat satu chat bisa memegang dua order pending
  // + dua QRIS aktif. Varian yang sama tetap diprioritaskan agar kirim-ulang
  // invoice tidak berubah perilaku.
  const existingOrder = await queryFirst(
    `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending')
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
  const uniqueMax = variant.fulfillment_mode === "unique" ? 1 : stockMax;
  // Minimum pembelian (migrasi 0034): stepper dibuka LANGSUNG di min agar
  // pembeli GSuite (min 50) tidak mulai dari 1 lalu ditolak saat bayar.
  // Bila min > stok tersedia: biarkan qty tampil min (invoice tetap menolak
  // via guard stok) — jangan clamp diam-diam ke stok lalu lolos min.
  const minQty = variant.fulfillment_mode === "unique" ? 1 : Math.max(1, Number(variant.min_qty ?? 1) || 1);
  const maxQty = Math.max(minQty, uniqueMax);
  const qty = Math.min(Math.max(clampQty(requestedQty), minQty), maxQty);

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
      minQty,
    }),
    parse_mode: "HTML",
    reply_markup: qtyKeyboard({ productId, variantId, stock: variant.stock, qty, price: variant.price, maxQty, minQty }),
  });
}
