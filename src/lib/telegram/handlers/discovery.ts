// src/lib/telegram/handlers/discovery.ts — Handler cari, riwayat, & input teks.
//
// MENGAPA dipisah: penelusuran (my-orders, search prompt/results), konfirmasi
// beli, serta handler input percakapan (pending qty/search/WA) semuanya berbagi
// pola "baca pending_action → validasi teks → lanjut ke langkah berikut". Handler
// input WA berisi cek kepemilikan sendiri (WHERE telegram_user_id=?). Dipisah dari
// siklus-hidup order agar router tetap ramping. Pemindahan murni dari route.ts.

import { queryFirst, queryAll, execRun, isD1Mode } from "@/lib/db";
import { sendMessage, sendChatAction } from "@/lib/telegram/api";
import {
  homeKeyboard, orderStatusKeyboard, myOrdersKeyboard, searchResultsKeyboard,
  orderPaidKeyboard, TELEGRAM_MAX_QTY,
} from "@/lib/telegram/keyboards";
import {
  outOfStockMessage, alreadyPendingMessage, errorMessage,
  myOrdersPrompt, myOrdersMessage, invalidWhatsAppMessage, waSavedAfterPaymentMessage,
  whatsAppInputPromptMessage, searchPromptMessage, searchResultsMessage,
  type TelegramOrderRow,
} from "@/lib/telegram/messages";
import { getProductDetail } from "@/lib/catalog";
import { countInventory } from "@/lib/fulfillment/inventory";
import { clampQty } from "./shared";
import { handleShowCatalog, handleShowQty, handleShowVariants } from "./catalog";

// --- /orders: real order history with reorder shortcuts ---

export async function handleMyOrders(
  chatId: number,
  from?: { id: number; first_name: string; username?: string },
) {
  if (!from || !isD1Mode()) {
    await sendMessage({ chat_id: chatId, text: myOrdersPrompt(), parse_mode: "HTML" });
    return;
  }
  const rows = await queryAll(
    `SELECT o.code, o.items, pt.payable_amount, o.payment_status, o.fulfillment_status, o.created_at
     FROM orders o
     LEFT JOIN payment_transactions pt ON pt.order_code=o.code
     WHERE o.sales_channel='telegram' AND o.telegram_user_id=?
     ORDER BY o.created_at DESC
     LIMIT 10`,
    String(from.id),
  );
  const orders: TelegramOrderRow[] = (rows as {
    code: string; items: string; payable_amount: number | null;
    payment_status: string; fulfillment_status: string; created_at: string | null;
  }[]).map((row) => {
    let productName = "Produk";
    let productId: number | null = null;
    try {
      const items = JSON.parse(String(row.items ?? "[]")) as { product_id?: number; name?: string }[];
      productName = items[0]?.name ?? "Produk";
      productId = Number(items[0]?.product_id) || null;
    } catch { /* keep defaults */ }
    return {
      code: String(row.code),
      productName,
      productId,
      payableAmount: row.payable_amount ?? null,
      paymentStatus: String(row.payment_status || "unpaid"),
      fulfillmentStatus: String(row.fulfillment_status || "not_required"),
      createdAt: row.created_at,
    };
  });
  await sendMessage({
    chat_id: chatId,
    text: myOrdersMessage(orders.map(({ code, productName, payableAmount, paymentStatus, fulfillmentStatus, createdAt }) => ({
      code, productName, payableAmount, paymentStatus, fulfillmentStatus, createdAt,
    }))),
    parse_mode: "HTML",
    reply_markup: orders.length > 0
      ? myOrdersKeyboard(orders.map((order) => ({ code: order.code, productId: order.productId ?? null })))
      : homeKeyboard(),
  });
}

// --- /cari: product search by name/alias ---

export async function handleSearchPrompt(
  chatId: number,
  from?: { id: number },
) {
  if (from && isD1Mode()) {
    await execRun(
      `UPDATE telegram_users SET pending_action='search:', updated_at=datetime('now') WHERE user_id=?`,
      String(from.id),
    ).catch(() => {});
  }
  await sendMessage({ chat_id: chatId, text: searchPromptMessage(), parse_mode: "HTML" });
}

export async function handlePendingSearchInput(
  text: string,
  chatId: number,
  from: { id: number },
): Promise<boolean> {
  if (!isD1Mode()) return false;
  const user = await queryFirst(
    `SELECT pending_action FROM telegram_users WHERE user_id=?`,
    String(from.id),
  );
  const action = user?.pending_action ? String(user.pending_action) : "";
  if (action !== "search:") return false;

  const keyword = text.trim().replace(/^\/batal$/i, "");
  if (/^\/batal$/i.test(text.trim())) {
    await execRun(
      `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=?`,
      String(from.id),
    ).catch(() => {});
    await handleShowCatalog(chatId);
    return true;
  }
  if (keyword.length < 2) {
    await sendMessage({
      chat_id: chatId,
      text: "❌ Minimal 2 huruf. Contoh: <code>canva</code>",
      parse_mode: "HTML",
    });
    return true;
  }
  await execRun(
    `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=?`,
    String(from.id),
  ).catch(() => {});
  await handleSearchResults(chatId, keyword);
  return true;
}

export async function handleSearchResults(chatId: number, keyword: string) {
  const like = `%${keyword.trim().toLowerCase()}%`;
  const rows = await queryAll(
    `SELECT p.id, p.name, COALESCE(MIN(pv.price), p.price) as price
     FROM products p
     LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = 1
     WHERE p.is_active=1 AND p.telegram_enabled=1
       AND (LOWER(p.name) LIKE ? OR LOWER(COALESCE(p.whatsapp_alias,'')) LIKE ? OR LOWER(COALESCE(p.aliases,'[]')) LIKE ?)
     GROUP BY p.id
     ORDER BY p.sold_count DESC, p.sort_order ASC
     LIMIT 10`,
    like, like, like,
  );
  const products = (rows as { id: number; name: string; price: number }[]).map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    price: Number(row.price),
  }));
  await sendMessage({
    chat_id: chatId,
    text: searchResultsMessage(keyword, products.length),
    parse_mode: "HTML",
    reply_markup: products.length > 0 ? searchResultsKeyboard(products) : homeKeyboard(),
  });
}

export async function handlePendingQtyInput(
  text: string,
  chatId: number,
  from: { id: number; first_name: string; username?: string },
): Promise<boolean> {
  if (!isD1Mode()) return false;
  const user = await queryFirst(
    `SELECT pending_action FROM telegram_users WHERE user_id=?`,
    String(from.id),
  );
  const action = user?.pending_action ? String(user.pending_action) : "";
  if (!action.startsWith("qty_for:")) return false;
  const [, productIdRaw, variantIdRaw] = action.split(":");
  const productId = Number(productIdRaw);
  const variantId = Number(variantIdRaw);
  if (!productId || !variantId) return false;
  const typedQty = Number(text.trim());
  if (!Number.isInteger(typedQty) || typedQty < 1 || typedQty > TELEGRAM_MAX_QTY) {
    await sendMessage({
      chat_id: chatId,
      text: `❌ Jumlah tidak valid. Ketik angka 1–${TELEGRAM_MAX_QTY}, misalnya <code>5</code>.`,
      parse_mode: "HTML",
    });
    return true;
  }
  const qty = clampQty(typedQty);
  await execRun(
    `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=?`,
    String(from.id),
  ).catch(() => {});
  await handleShowQty(chatId, 0, productId, variantId, qty);
  return true;
}

export async function handleBuyConfirm(chatId: number, messageId: number, productId: number) {
  // Use catalog.ts for variant-level stock (synced with web/WA)
  const detail = await getProductDetail(productId);
  if (!detail || detail.variants.length === 0) return;

  // Aggregate stock from active variants
  const activeVariants = detail.variants.filter(v => v.is_active);
  const allOutOfStock = activeVariants.every(v => v.stock === 0);

  if (allOutOfStock) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
    return;
  }

  // For unique fulfillment, check inventory on first active variant
  const firstVariant = activeVariants.find(v => v.stock !== 0);
  if (firstVariant && firstVariant.fulfillment_mode === "unique") {
    const counts = await countInventory(productId, firstVariant.id);
    if (counts.available < 1) {
      await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
      return;
    }
  }

  // Check for existing pending order from this user for same product
  const existingOrder = await queryFirst(
    `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending')
     AND items LIKE ?`,
    String(chatId), `%"product_id":${productId}%`,
  );
  if (existingOrder) {
    await sendMessage({
      chat_id: chatId,
      text: alreadyPendingMessage(String(existingOrder.code)),
      parse_mode: "HTML",
      reply_markup: orderStatusKeyboard(String(existingOrder.code)),
    });
    return;
  }

  // Single variant — straight to qty step (bulk-aware)
  if (activeVariants.length === 1 && firstVariant) {
    await handleShowQty(chatId, messageId, productId, firstVariant.id);
    return;
  }

  // Multiple variants — show variant selector
  await handleShowVariants(chatId, messageId, productId);
}

export async function handleConfirmPurchase(
  chatId: number,
  messageId: number,
  productId: number,
) {
  // Legacy confirm buttons route into the qty flow (WA parity, bulk-aware).
  await sendChatAction(chatId, "typing");

  const detail = await getProductDetail(productId);
  if (!detail || detail.variants.length === 0) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
    return;
  }

  const activeVariants = detail.variants.filter(v => v.is_active && v.stock !== 0);
  if (activeVariants.length === 0) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
    return;
  }

  if (activeVariants.length === 1) {
    await handleShowQty(chatId, messageId, productId, activeVariants[0].id);
    return;
  }
  await handleShowVariants(chatId, messageId, productId);
}

export async function handlePendingWaInput(
  text: string,
  chatId: number,
  from: { id: number; first_name: string; username?: string },
): Promise<boolean> {
  if (!isD1Mode()) return false;

  const user = await queryFirst(
    `SELECT pending_action FROM telegram_users WHERE user_id=?`,
    String(from.id),
  );
  if (!user?.pending_action) return false;

  const action = String(user.pending_action);
  if (!action.startsWith("wa_after_paid:")) return false;

  // Validate WA number
  const wa = text.trim().replace(/\s|-/g, "");
  if (!/^(\+62|62|0)8\d{8,13}$/.test(wa)) {
    await sendMessage({ chat_id: chatId, text: invalidWhatsAppMessage(), parse_mode: "HTML" });
    return true; // handled, but invalid — keep pending_action
  }

  // Normalize WA to 62...
  let normalizedWa = wa;
  if (normalizedWa.startsWith("+62")) normalizedWa = normalizedWa.slice(1);
  else if (normalizedWa.startsWith("0")) normalizedWa = "62" + normalizedWa.slice(1);

  const orderCode = action.slice("wa_after_paid:".length).toUpperCase();
  const saved = await execRun(
    `UPDATE orders SET customer_wa=?, updated_at=datetime('now')
     WHERE code=? AND telegram_user_id=? AND sales_channel='telegram'
       AND status='lunas' AND payment_status='paid'`,
    normalizedWa,
    orderCode,
    String(from.id),
  );
  if (!saved.changes) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
    return true;
  }
  await execRun(
    `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now')
     WHERE user_id=? AND pending_action=?`,
    String(from.id),
    action,
  );
  await sendMessage({
    chat_id: chatId,
    text: waSavedAfterPaymentMessage(orderCode),
    parse_mode: "HTML",
    reply_markup: orderPaidKeyboard(orderCode),
  });
  return true;
}

export async function handleWaInput(
  chatId: number,
  orderCode: string,
  from: { id: number },
) {
  const normalizedCode = orderCode.toUpperCase();
  const order = await queryFirst(
    `SELECT customer_wa FROM orders
     WHERE code=? AND telegram_user_id=? AND sales_channel='telegram'
       AND status='lunas' AND payment_status='paid'`,
    normalizedCode,
    String(from.id),
  );
  if (!order) {
    await sendMessage({ chat_id: chatId, text: "❌ Pesanan lunas tidak ditemukan.", parse_mode: "HTML" });
    return;
  }
  if (String(order.customer_wa || "").trim()) {
    await sendMessage({
      chat_id: chatId,
      text: waSavedAfterPaymentMessage(normalizedCode),
      parse_mode: "HTML",
      reply_markup: orderPaidKeyboard(normalizedCode),
    });
    return;
  }
  await execRun(
    `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=?`,
    `wa_after_paid:${normalizedCode}`,
    String(from.id),
  );
  await sendMessage({
    chat_id: chatId,
    text: whatsAppInputPromptMessage(normalizedCode),
    parse_mode: "HTML",
    reply_markup: orderPaidKeyboard(normalizedCode),
  });
}
