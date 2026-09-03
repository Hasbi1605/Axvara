// POST /api/telegram/webhook — Telegram Bot webhook handler
// Validates secret header, deduplicates updates, routes commands/callbacks.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryFirst, queryAll, execRun, isD1Mode } from "@/lib/db";
import { sendMessage, sendPhoto, editMessageText, answerCallbackQuery } from "@/lib/telegram/api";
import {
  homeKeyboard, categoriesKeyboard, productsKeyboard,
  productDetailKeyboard, confirmPurchaseKeyboard,
  orderStatusKeyboard, parseCallback,
} from "@/lib/telegram/keyboards";
import {
  welcomeMessage, categoriesMessage, categoryProductsMessage,
  productDetailMessage, confirmBuyMessage, helpMessage,
  outOfStockMessage, alreadyPendingMessage, errorMessage,
  myOrdersPrompt, orderStatusMessage, invoiceMessage,
  orderCancelledMessage,
} from "@/lib/telegram/messages";
import { generateOrderCode } from "@/lib/security";
import { getPaymentProvider, isPaymentEnabled } from "@/lib/payments/klikqris";
import { reserveInventory, releaseInventoryForOrder, countInventory } from "@/lib/fulfillment/inventory";
import { createFulfillmentJob, processJob } from "@/lib/fulfillment/deliver";

export const runtime = "edge";

const MAX_BODY_SIZE = 64_000; // 64KB max

// Zod schema for minimal Telegram update validation
const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z.object({
    message_id: z.number(),
    from: z.object({ id: z.number(), first_name: z.string(), last_name: z.string().optional(), username: z.string().optional() }).optional(),
    chat: z.object({ id: z.number(), type: z.string() }),
    text: z.string().optional(),
    date: z.number(),
  }).optional(),
  callback_query: z.object({
    id: z.string(),
    from: z.object({ id: z.number(), first_name: z.string(), last_name: z.string().optional(), username: z.string().optional() }),
    message: z.object({ message_id: z.number(), chat: z.object({ id: z.number() }) }).optional(),
    data: z.string().optional(),
  }).optional(),
}).passthrough();

export async function POST(request: NextRequest) {
  // 1. Only POST + JSON
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }

  // 2. Validate Telegram webhook secret
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) return NextResponse.json({ error: "bot_not_configured" }, { status: 503 });

  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
  if (secretHeader !== expectedSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 3. Check feature flag
  if (process.env.TELEGRAM_BOT_ENABLED !== "true") {
    return NextResponse.json({ ok: true, status: "bot_disabled" });
  }

  // 4. Parse + validate body
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_SIZE) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = TelegramUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: true, status: "invalid_update" }); // Return 200 to prevent Telegram retries
  }

  const update = parsed.data;
  const updateId = String(update.update_id);

  // 5. Claim update_id with lease (idempotency)
  const leaseUntil = new Date(Date.now() + 30_000).toISOString();
  try {
    if (isD1Mode()) {
      const existing = await queryFirst(
        `SELECT status FROM telegram_updates WHERE update_id=?`, updateId,
      );
      if (existing) {
        return NextResponse.json({ ok: true, status: "already_processed" });
      }
      await execRun(
        `INSERT INTO telegram_updates (update_id, status, lease_until) VALUES (?, 'processing', ?)`,
        updateId, leaseUntil,
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ ok: true, status: "already_processing" });
    }
  }

  // 6. Upsert telegram user
  const from = update.message?.from ?? update.callback_query?.from;
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  if (from && chatId) {
    try {
      if (isD1Mode()) {
        await execRun(
          `INSERT INTO telegram_users (user_id, chat_id, username, first_name, last_name)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET chat_id=?, username=?, first_name=?, last_name=?, updated_at=datetime('now')`,
          String(from.id), String(chatId), from.username ?? null, from.first_name, from.last_name ?? null,
          String(chatId), from.username ?? null, from.first_name, from.last_name ?? null,
        );
      }
    } catch { /* best-effort user upsert */ }
  }

  try {
    // 7. Route: callback query
    if (update.callback_query) {
      const cq = update.callback_query;
      const cqChatId = cq.message?.chat.id;
      const messageId = cq.message?.message_id;

      if (!cqChatId || !messageId || !cq.data) {
        await answerCallbackQuery(cq.id);
        await markDone(updateId);
        return NextResponse.json({ ok: true });
      }

      await answerCallbackQuery(cq.id);
      await handleCallback(cq.data, cqChatId, messageId, cq.from);
      await markDone(updateId);
      return NextResponse.json({ ok: true });
    }

    // 8. Route: text command
    if (update.message?.text && chatId) {
      const text = update.message.text.trim();
      await handleCommand(text, chatId, from);
      await markDone(updateId);
      return NextResponse.json({ ok: true });
    }

    await markDone(updateId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Mark failed so lease expires and Telegram can retry
    try {
      if (isD1Mode()) {
        await execRun(
          `UPDATE telegram_updates SET status='failed', last_error=?, updated_at=datetime('now') WHERE update_id=?`,
          (error instanceof Error ? error.message : "Unknown").slice(0, 500), updateId,
        );
      }
    } catch { /* best effort */ }

    // Still return 200 for non-transient errors to prevent infinite retries
    if (chatId) {
      try { await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" }); } catch { /* ok */ }
    }
    return NextResponse.json({ ok: true, status: "error_handled" });
  }
}

async function markDone(updateId: string) {
  if (isD1Mode()) {
    await execRun(
      `UPDATE telegram_updates SET status='done', updated_at=datetime('now') WHERE update_id=?`,
      updateId,
    );
  }
}

async function handleCommand(text: string, chatId: number, from?: { id: number; first_name: string; username?: string }) {
  const cmd = text.toLowerCase().split(/\s+/)[0];

  if (cmd === "/start") {
    await sendMessage({
      chat_id: chatId,
      text: welcomeMessage(from?.first_name ?? "Pengguna"),
      parse_mode: "HTML",
      reply_markup: homeKeyboard(),
    });
    return;
  }

  if (cmd === "/katalog") {
    await handleShowCategories(chatId);
    return;
  }

  if (cmd === "/bantuan" || cmd === "/help") {
    await sendMessage({ chat_id: chatId, text: helpMessage(), parse_mode: "HTML" });
    return;
  }

  if (cmd === "/pesanan") {
    const parts = text.split(/\s+/);
    if (parts.length >= 2) {
      await handleOrderStatus(chatId, parts[1]);
    } else {
      await sendMessage({ chat_id: chatId, text: myOrdersPrompt(), parse_mode: "HTML" });
    }
    return;
  }

  // Unknown command: show welcome
  await sendMessage({
    chat_id: chatId,
    text: welcomeMessage(from?.first_name ?? "Pengguna"),
    parse_mode: "HTML",
    reply_markup: homeKeyboard(),
  });
}

async function handleCallback(data: string, chatId: number, messageId: number, from: { id: number; first_name: string; username?: string }) {
  const { action, params } = parseCallback(data);

  switch (action) {
    case "home":
      await editMessageText({
        chat_id: chatId, message_id: messageId,
        text: welcomeMessage(from.first_name),
        parse_mode: "HTML",
        reply_markup: homeKeyboard(),
      });
      break;

    case "cats":
      await handleShowCategoriesEdit(chatId, messageId, Number(params[0] || 0));
      break;

    case "cat":
      await handleShowProducts(chatId, messageId, Number(params[0]), Number(params[1] || 0));
      break;

    case "prd":
      await handleShowProduct(chatId, messageId, Number(params[0]));
      break;

    case "buy":
      await handleBuyConfirm(chatId, messageId, Number(params[0]));
      break;

    case "confirm":
      await handleConfirmPurchase(chatId, messageId, Number(params[0]), from);
      break;

    case "order":
      await handleOrderStatus(chatId, params[0]);
      break;

    case "refresh":
      await handleOrderRefresh(chatId, messageId, params[0]);
      break;

    case "cancel":
      await handleOrderCancel(chatId, messageId, params[0], from);
      break;

    case "myorders":
      await sendMessage({ chat_id: chatId, text: myOrdersPrompt(), parse_mode: "HTML" });
      break;

    case "help":
      await sendMessage({ chat_id: chatId, text: helpMessage(), parse_mode: "HTML" });
      break;

    default:
      break;
  }
}

// --- Handler implementations ---

async function handleShowCategories(chatId: number) {
  const categories = await queryAll(
    `SELECT id, name FROM categories ORDER BY sort_order ASC`,
  );
  await sendMessage({
    chat_id: chatId,
    text: categoriesMessage(),
    parse_mode: "HTML",
    reply_markup: categoriesKeyboard(categories as { id: number; name: string }[]),
  });
}

async function handleShowCategoriesEdit(chatId: number, messageId: number, page: number) {
  const categories = await queryAll(
    `SELECT id, name FROM categories ORDER BY sort_order ASC`,
  );
  await editMessageText({
    chat_id: chatId, message_id: messageId,
    text: categoriesMessage(),
    parse_mode: "HTML",
    reply_markup: categoriesKeyboard(categories as { id: number; name: string }[], page),
  });
}

async function handleShowProducts(chatId: number, messageId: number, categoryId: number, page: number) {
  const category = await queryFirst(`SELECT name FROM categories WHERE id=?`, categoryId);
  if (!category) return;

  const products = await queryAll(
    `SELECT id, name, price FROM products WHERE category_id=? AND is_active=1 AND telegram_enabled=1 ORDER BY sort_order ASC`,
    categoryId,
  );

  await editMessageText({
    chat_id: chatId, message_id: messageId,
    text: categoryProductsMessage(String(category.name), products.length),
    parse_mode: "HTML",
    reply_markup: productsKeyboard(
      products as { id: number; name: string; price: number }[],
      categoryId, page,
    ),
  });
}

async function handleShowProduct(chatId: number, messageId: number, productId: number) {
  const product = await queryFirst(
    `SELECT id, name, description, price, compare_price, stock, badge, image_url FROM products WHERE id=? AND is_active=1 AND telegram_enabled=1`,
    productId,
  );
  if (!product) return;

  const text = productDetailMessage(product as {
    name: string; description?: string | null; price: number;
    compare_price?: number | null; stock?: number | null; badge?: string | null;
  });

  const imageUrl = String(product.image_url ?? "");
  if (imageUrl && imageUrl.startsWith("http")) {
    // Send as new photo message (can't edit to add photo)
    await sendPhoto({
      chat_id: chatId,
      photo: imageUrl,
      caption: text,
      parse_mode: "HTML",
      reply_markup: productDetailKeyboard(productId),
    });
  } else {
    await editMessageText({
      chat_id: chatId, message_id: messageId,
      text,
      parse_mode: "HTML",
      reply_markup: productDetailKeyboard(productId),
    });
  }
}

async function handleBuyConfirm(chatId: number, messageId: number, productId: number) {
  if (!isPaymentEnabled()) {
    await sendMessage({
      chat_id: chatId,
      text: "⚠️ Pembayaran otomatis belum aktif. Hubungi admin untuk order.",
      parse_mode: "HTML",
    });
    return;
  }

  const product = await queryFirst(
    `SELECT id, name, price, stock, fulfillment_mode FROM products WHERE id=? AND is_active=1 AND telegram_enabled=1`,
    productId,
  );
  if (!product) return;

  const stock = Number(product.stock ?? -1);
  if (stock === 0) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
    return;
  }

  // Check for unique inventory availability
  if (product.fulfillment_mode === "unique") {
    const counts = await countInventory(productId);
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

  await editMessageText({
    chat_id: chatId, message_id: messageId,
    text: confirmBuyMessage(String(product.name), Number(product.price)),
    parse_mode: "HTML",
    reply_markup: confirmPurchaseKeyboard(productId),
  });
}

async function handleConfirmPurchase(
  chatId: number,
  messageId: number,
  productId: number,
  from: { id: number; first_name: string; username?: string },
) {
  if (!isPaymentEnabled()) {
    await sendMessage({ chat_id: chatId, text: "⚠️ Pembayaran otomatis belum aktif.", parse_mode: "HTML" });
    return;
  }

  const product = await queryFirst(
    `SELECT id, name, price, stock, fulfillment_mode FROM products WHERE id=? AND is_active=1 AND telegram_enabled=1`,
    productId,
  );
  if (!product) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
    return;
  }

  const price = Number(product.price);
  const fulfillmentMode = String(product.fulfillment_mode || "manual");
  const orderCode = generateOrderCode();

  try {
    // Reserve inventory for unique products
    let inventoryId: number | null = null;
    if (fulfillmentMode === "unique") {
      inventoryId = await reserveInventory(productId, orderCode);
      if (inventoryId === null) {
        await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
        return;
      }
    }

    // Decrement general stock
    if (isD1Mode()) {
      const stockResult = await execRun(
        `UPDATE products SET stock = CASE WHEN stock=-1 THEN -1 ELSE stock-1 END
         WHERE id=? AND is_active=1 AND (stock=-1 OR stock>=1)`,
        productId,
      );
      if (!stockResult.changes) {
        // Compensate inventory reservation
        if (inventoryId) await releaseInventoryForOrder(orderCode);
        await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
        return;
      }
    }

    // Create KlikQRIS invoice
    const provider = getPaymentProvider();
    const providerOrderId = orderCode.replace(/^AXV-/, "");
    const merchantId = process.env.KLIKQRIS_MERCHANT_ID ?? "";

    let invoiceResult;
    try {
      invoiceResult = await provider.createInvoice({
        orderId: providerOrderId,
        amount: price,
        merchantId,
      });
    } catch (providerError) {
      // Provider error: try status check before compensating
      try {
        const statusCheck = await provider.checkStatus(providerOrderId, merchantId);
        if (statusCheck.success && statusCheck.status === "pending") {
          // Invoice exists on provider side, don't compensate
        } else {
          throw providerError;
        }
      } catch {
        // Compensate: restore stock + release inventory
        await execRun(
          `UPDATE products SET stock = CASE WHEN stock=-1 THEN -1 ELSE stock+1 END WHERE id=? AND stock!=-1`,
          productId,
        );
        if (inventoryId) await releaseInventoryForOrder(orderCode);
        await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
        return;
      }
      invoiceResult = null;
    }

    if (!invoiceResult || !invoiceResult.success) {
      // Compensate
      await execRun(
        `UPDATE products SET stock = CASE WHEN stock=-1 THEN -1 ELSE stock+1 END WHERE id=? AND stock!=-1`,
        productId,
      );
      if (inventoryId) await releaseInventoryForOrder(orderCode);
      await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
      return;
    }

    // Insert order
    const items = [{ product_id: productId, name: String(product.name), price, qty: 1 }];
    await execRun(
      `INSERT INTO orders (code, customer_name, customer_wa, customer_email, items, subtotal,
         payment_method, payment_account, proof_url, status, sales_channel,
         telegram_chat_id, telegram_user_id, payment_status, fulfillment_status, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      orderCode,
      from.first_name,
      "", // customer_wa empty for Telegram orders
      null,
      JSON.stringify(items),
      invoiceResult.payableAmount,
      "klikqris",
      "",
      null, // no proof for QRIS dynamic
      "pending",
      "telegram",
      String(chatId),
      String(from.id),
      "pending",
      fulfillmentMode === "unique" ? "reserved" : fulfillmentMode === "manual" ? "not_required" : "not_required",
      invoiceResult.expiresAt,
    );

    // Insert payment transaction
    await execRun(
      `INSERT INTO payment_transactions (order_code, provider, provider_mode, provider_order_id,
         merchant_id, requested_amount, payable_amount, status, provider_signature,
         qris_url, direct_url, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      orderCode,
      "klikqris",
      provider.mode,
      invoiceResult.providerOrderId,
      invoiceResult.merchantId,
      price,
      invoiceResult.payableAmount,
      "pending",
      invoiceResult.signature,
      invoiceResult.qrisUrl,
      invoiceResult.directUrl,
      invoiceResult.expiresAt,
    );

    // Create fulfillment job
    await createFulfillmentJob(orderCode, inventoryId, fulfillmentMode);

    // Send QRIS to user — prefer qris_url (HTTPS), fallback to qris_image (data URI base64)
    const photoSource = invoiceResult.qrisUrl ?? invoiceResult.qrisImage;
    if (photoSource) {
      await sendPhoto({
        chat_id: chatId,
        photo: photoSource,
        caption: invoiceMessage({
          orderCode,
          productName: String(product.name),
          payableAmount: invoiceResult.payableAmount,
          expiresAt: invoiceResult.expiresAt,
        }),
        parse_mode: "HTML",
        reply_markup: orderStatusKeyboard(orderCode),
      });
    } else {
      await sendMessage({
        chat_id: chatId,
        text: invoiceMessage({
          orderCode,
          productName: String(product.name),
          payableAmount: invoiceResult.payableAmount,
          expiresAt: invoiceResult.expiresAt,
        }),
        parse_mode: "HTML",
        reply_markup: orderStatusKeyboard(orderCode),
      });
    }

    // Notify admin
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (adminChatId) {
      try {
        const { adminOrderNotification } = await import("@/lib/telegram/messages");
        await sendMessage({
          chat_id: adminChatId,
          text: adminOrderNotification({
            orderCode,
            productName: String(product.name),
            amount: invoiceResult.payableAmount,
            telegramUser: from.username ?? String(from.id),
            fulfillmentMode,
          }),
          parse_mode: "HTML",
        });
      } catch { /* admin notification is best-effort */ }
    }

  } catch (error) {
    console.error("Order creation failed:", error instanceof Error ? error.message : "unknown");
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
  }
}

async function handleOrderStatus(chatId: number, orderCode: string) {
  const order = await queryFirst(
    `SELECT code, items, subtotal, payment_status, fulfillment_status FROM orders WHERE code=?`,
    orderCode.toUpperCase(),
  );
  if (!order) {
    await sendMessage({
      chat_id: chatId,
      text: "❌ Pesanan tidak ditemukan. Pastikan kode pesanan benar.",
      parse_mode: "HTML",
    });
    return;
  }

  let productName = "Produk";
  try {
    const items = JSON.parse(String(order.items));
    productName = items[0]?.name ?? "Produk";
  } catch { /* ok */ }

  await sendMessage({
    chat_id: chatId,
    text: orderStatusMessage({
      orderCode: String(order.code),
      productName,
      paymentStatus: String(order.payment_status || "unpaid"),
      fulfillmentStatus: String(order.fulfillment_status || "not_required"),
      payableAmount: Number(order.subtotal),
    }),
    parse_mode: "HTML",
    reply_markup: String(order.payment_status) === "pending"
      ? orderStatusKeyboard(String(order.code))
      : undefined,
  });
}

async function handleOrderRefresh(chatId: number, messageId: number, orderCode: string) {
  // Same as status but edit existing message
  const order = await queryFirst(
    `SELECT code, items, subtotal, payment_status, fulfillment_status FROM orders WHERE code=?`,
    orderCode,
  );
  if (!order) return;

  let productName = "Produk";
  try {
    const items = JSON.parse(String(order.items));
    productName = items[0]?.name ?? "Produk";
  } catch { /* ok */ }

  await editMessageText({
    chat_id: chatId, message_id: messageId,
    text: orderStatusMessage({
      orderCode: String(order.code),
      productName,
      paymentStatus: String(order.payment_status || "unpaid"),
      fulfillmentStatus: String(order.fulfillment_status || "not_required"),
      payableAmount: Number(order.subtotal),
    }),
    parse_mode: "HTML",
    reply_markup: String(order.payment_status) === "pending"
      ? orderStatusKeyboard(orderCode)
      : undefined,
  });
}

async function handleOrderCancel(chatId: number, messageId: number, orderCode: string, from: { id: number }) {
  const order = await queryFirst(
    `SELECT code, status, payment_status, telegram_user_id, items FROM orders WHERE code=? AND status='pending' AND payment_status IN ('unpaid','pending')`,
    orderCode,
  );
  if (!order) {
    await sendMessage({ chat_id: chatId, text: "❌ Pesanan tidak dapat dibatalkan.", parse_mode: "HTML" });
    return;
  }

  // Only the owner can cancel
  if (String(order.telegram_user_id) !== String(from.id)) {
    await sendMessage({ chat_id: chatId, text: "❌ Kamu tidak bisa membatalkan pesanan orang lain.", parse_mode: "HTML" });
    return;
  }

  // Restore stock
  try {
    const items = JSON.parse(String(order.items)) as { product_id: number; qty: number }[];
    for (const item of items) {
      await execRun(
        `UPDATE products SET stock = CASE WHEN stock=-1 THEN -1 ELSE stock+? END WHERE id=? AND stock!=-1`,
        item.qty, item.product_id,
      );
    }
  } catch { /* ok */ }

  // Release inventory
  await releaseInventoryForOrder(orderCode);

  // Update order
  await execRun(
    `UPDATE orders SET status='dibatalkan', payment_status='failed', fulfillment_status='not_required',
     updated_at=datetime('now') WHERE code=? AND status='pending'`,
    orderCode,
  );

  // Update payment transaction
  await execRun(
    `UPDATE payment_transactions SET status='cancelled', updated_at=datetime('now') WHERE order_code=?`,
    orderCode,
  );

  await editMessageText({
    chat_id: chatId, message_id: messageId,
    text: orderCancelledMessage(orderCode),
    parse_mode: "HTML",
  });
}
