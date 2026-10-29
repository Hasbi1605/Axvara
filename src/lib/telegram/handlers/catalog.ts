import { MAX_UNIQUE_UNITS_PER_ORDER } from "@/lib/fulfillment/units";
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
  variantsKeyboard, cb,
  qtyKeyboard, TELEGRAM_MAX_QTY,
} from "@/lib/telegram/keyboards";
import {
  catalogFlatMessage, categoriesMessage, categoryProductsMessage,
  productDetailMessage, outOfStockMessage, errorMessage,
  chooseQtyMessage, escapeHtml,
} from "@/lib/telegram/messages";
import { getProductDetail, getActiveVariant, formatVariantLabel, buyerWarrantyLabel, buyerDeliveryKind, effectiveVariantStock } from "@/lib/catalog";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import { resolveVariantCopy, adminCopyOf } from "@/lib/product-copy/resolve";
import { mergeProductCopy, parseProductDescription, COPY_SECTION_TITLES } from "@/lib/product-copy/format";
import { needsEmailForVariant } from "@/lib/warung-rebahan/delivery-class";
import { winnerForLoserProduct } from "@/lib/supplier-pairs";
import { clampQty } from "./shared";

type CatalogProduct = { id: number; name: string; price: number };

/**
 * Produk yang BISA DIBELI saja (keputusan owner 2026-09-24): produk tanpa
 * satu pun varian tersedia tidak tampil di katalog Telegram. Dulu 28 dari 48
 * produk di katalog adalah jalan buntu "stok habis". Membaca tabel yang sama
 * dengan web setiap kali dibuka, jadi habis/ready di web langsung berlaku di
 * sini. Harga = varian tersedia termurah, sama dengan kartu web.
 */
export async function listTelegramProducts(categoryId?: number): Promise<CatalogProduct[]> {
  const { readTelegramCatalog } = await import("@/lib/telegram/catalog-snapshot");
  return (await readTelegramCatalog())
    .filter(row => row.price !== null && (!categoryId || row.category_id === categoryId))
    .map(row => ({ id: row.id, name: row.name, price: row.price! }));
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

export async function handleShowProduct(chatId: number, messageId: number, requestedProductId: number) {
  await showLoadingBar(chatId, "📦 Memuat produk").catch(() => {});

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
    await sendMessage({ chat_id: chatId, text: "Produk ini sedang tidak tersedia. Buka /katalog untuk produk yang ready 🙏", parse_mode: "HTML" });
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
      label: formatVariantLabel(v),
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
    name: detail.name,
    description: detail.description,
    price: minPrice,
    compare_price: comparePrice && comparePrice > maxPrice ? comparePrice : null,
    stock: totalStock,
    badge,
    sold_count: soldCount,
    variants: variantLines,
  });
  const keyboard = variantsKeyboard(productId, activeVariants.map(v => ({ ...v, label: formatVariantLabel(v) })));

  // Product photo = same image as web (free: sendPhoto with product image_url)
  const imageUrl = detail.image?.startsWith("/") ? `https://axvara.tech${detail.image}` : detail.image ?? "";
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
}

// --- Variant flow handlers (TELEGRAM_VARIANT_FLOW) ---

export async function handleShowVariants(chatId: number, messageId: number, productId: number) {
  await handleShowProduct(chatId, messageId, productId);
}

export async function handleVariantConfirm(chatId: number, messageId: number, variantId: number) {
  const variant = await getActiveVariant(variantId);
  if (!variant) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
    return;
  }

  if (effectiveVariantStock(variant) !== -1 && effectiveVariantStock(variant) < variant.min_qty) {
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
  variant.stock = effectiveVariantStock(variant);
  if (variant.stock !== -1 && variant.stock < variant.min_qty) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
    return;
  }
  const product = await queryFirst(`SELECT id, name FROM products WHERE id=?`, productId);
  const productName = product ? String(product.name) : "Produk";
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
  const maxQty = uniqueMax;
  if (minQty > maxQty) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
    return;
  }
  const qty = Math.min(Math.max(clampQty(requestedQty), minQty), maxQty);

  // Remember qty context so a typed number (1-100) works without buttons.
  if (isD1Mode()) {
    await execRun(
      `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=?`,
      `qty_for:${productId}:${variantId}`,
      String(chatId),
    ).catch(() => {});
  }

  await safeEditOrSend({
    chat_id: chatId,
    message_id: messageId,
    text: chooseQtyMessage({
      productName,
      variantLabel: formatVariantLabel(variant),
      price: variant.price,
      stock: variant.stock,
      qty,
      maxQty,
      minQty,
      requiresEmail,
    }) + `\n\nPengiriman: ${buyerDeliveryKind(variant) === "instant" ? "otomatis setelah pembayaran" : "diproses setelah pembayaran"}.` + (buyerWarrantyLabel(variant) ? `\nGaransi: ${escapeHtml(buyerWarrantyLabel(variant))}.` : "") + "\nBaca ketentuan produk sebelum membayar.",
    parse_mode: "HTML",
    reply_markup: qtyKeyboard({ productId, variantId, stock: variant.stock, qty, price: variant.price, maxQty, minQty, requiresEmail, approvalTag: await checkoutApprovalTag([{ productId, variantId, qty, price: variant.price }]) }),
  });
}

export async function handleQtyInputPrompt(chatId: number, productId: number, variantId: number, from: { id: number }) {
  const variant = await getActiveVariant(variantId);
  if (!variant || variant.product_id !== productId) return;
  variant.stock = effectiveVariantStock(variant);
  const minQty = Math.max(1, Number(variant.min_qty ?? 1) || 1);
  const maxQty = variant.fulfillment_mode === "unique" ? Math.min(MAX_UNIQUE_UNITS_PER_ORDER, variant.stock === -1 ? MAX_UNIQUE_UNITS_PER_ORDER : variant.stock) : variant.stock === -1 ? TELEGRAM_MAX_QTY : Math.min(variant.stock, TELEGRAM_MAX_QTY);
  if (minQty > maxQty) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
    return;
  }
  if (isD1Mode()) {
    await execRun(`UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=?`, `qty_for:${productId}:${variantId}`, String(from.id)).catch(() => {});
  }
  await sendMessage({
    chat_id: chatId,
    text: `<b>Masukkan jumlah</b>\n\nKirim angka ${minQty}–${maxQty}. Ketik /batal untuk kembali.`,
    parse_mode: "HTML",
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: `Ketik ${minQty}–${maxQty}` },
  });
}

export async function handleProductTerms(chatId: number, productId: number, variantId = 0, requestedPage = 0) {
  const detail = await getProductDetail(productId);
  const enabled = await queryFirst("SELECT telegram_enabled FROM products WHERE id=? AND is_active=1", productId);
  if (!detail || Number(enabled?.telegram_enabled) !== 1) return;
  if (!variantId) {
    await sendMessage({ chat_id: chatId, text: "Pilih varian untuk membaca ketentuannya.", reply_markup: { inline_keyboard: detail.variants.filter(v => v.is_active).map(v => [{ text: formatVariantLabel(v).slice(0, 60), callback_data: cb.terms(productId, v.id) }]) } });
    return;
  }
  const variants = detail.variants.filter(v => v.id === variantId && v.is_active);
  for (const variant of variants) {
    const copy = mergeProductCopy(resolveVariantCopy(variant.terms, variant.delivery_terms, adminCopyOf(variant)), parseProductDescription(detail.description));
    const lines = [
      ...copy.sections.flatMap(section => [COPY_SECTION_TITLES[section.kind], ...section.items.map(item => `• ${item}`), ""]),
      ...copy.activation.flatMap(group => [group.title ?? "Cara aktivasi", ...group.steps.map((step, i) => `${i + 1}. ${step}`), ""]),
      ...copy.notes,
    ];
    if (!lines.length) lines.push("Ketentuan khusus belum tersedia. Hubungi admin melalui /bantuan sebelum membeli.");
    const header = `<b>${escapeHtml(formatVariantLabel(variant).slice(0, 120))}</b>\n\n`;
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
    if (page > 0) navigation.push({ text: "Sebelumnya", callback_data: `${cb.terms(productId, variant.id)}:${page - 1}` });
    if (page < parts.length - 1) navigation.push({ text: "Ketentuan Berikutnya", callback_data: `${cb.terms(productId, variant.id)}:${page + 1}` });
    const sent = await sendMessage({ chat_id: chatId, text: parts[page], parse_mode: "HTML", disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [...(navigation.length ? [navigation] : []), [{ text: "Pilih Varian", callback_data: cb.variants(productId) }], [{ text: "Lanjut ke Jumlah", callback_data: cb.variant(variant.id) }]] } });
    if (!sent.ok) throw new Error("telegram_terms_send_failed");
  }
}
