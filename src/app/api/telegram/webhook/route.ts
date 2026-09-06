// POST /api/telegram/webhook — Telegram Bot webhook handler
// Validates secret header, deduplicates updates, routes commands/callbacks.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryFirst, queryAll, execRun, isD1Mode, getD1, D1Statement, transitionPendingOrder } from "@/lib/db";
import { sendMessage, sendPhoto, safeEditOrSend, answerCallbackQuery, sendChatAction, showLoadingBar } from "@/lib/telegram/api";
import {
  homeKeyboard, catalogFlatKeyboard, categoriesKeyboard, productsKeyboard,
  productDetailKeyboard, warrantyKeyboard,
  orderStatusKeyboard, variantsKeyboard, confirmVariantPurchaseKeyboard,
  qtyKeyboard, paymentMethodKeyboard, askWaAfterInvoiceKeyboard, parseCallback,
} from "@/lib/telegram/keyboards";
import {
  welcomeMessage, catalogFlatMessage, categoriesMessage, categoryProductsMessage,
  productDetailMessage, helpMessage, warrantyFullMessage,
  outOfStockMessage, alreadyPendingMessage, errorMessage,
  myOrdersPrompt, orderStatusMessage, invoiceMessage,
  orderCancelledMessage, askWhatsAppMessage, invalidWhatsAppMessage, waSavedAfterInvoiceMessage,
  chooseVariantMessage, chooseQtyMessage, paymentMethodMessage, manualTransferMessage,
  confirmVariantBuyMessage,
} from "@/lib/telegram/messages";
import { getProductDetail, getActiveVariant, formatDuration, formatWarranty, type VariantSummary } from "@/lib/catalog";
import { generateOrderCode } from "@/lib/security";
import { createDanaQrisInvoice, isDanaQrisConfigured } from "@/lib/payments/dana-qris";
import { getActivePaymentMethods } from "@/lib/commerce";
import { reserveInventory, releaseInventoryForOrder, countInventory } from "@/lib/fulfillment/inventory";
import { createFulfillmentJob } from "@/lib/fulfillment/deliver";

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
      await handleCommand(text, chatId, update.message.chat.type, from);
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

async function clearPendingAction(from?: { id: number }) {
  if (from && isD1Mode()) {
    await execRun(
      `UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action IS NOT NULL`,
      String(from.id),
    ).catch(() => {});
  }
}

async function handleCommand(
  text: string,
  chatId: number,
  chatType: string,
  from?: { id: number; first_name: string; username?: string },
) {
  const cmd = text.toLowerCase().split(/\s+/)[0].split("@")[0];

  // Check for pending WA input before processing commands
  if (from && !cmd.startsWith("/")) {
    const handled = await handlePendingWaInput(text, chatId, from);
    if (handled) return;
  }

  if (cmd === "/start") {
    // Clear any pending conversational state
    await clearPendingAction(from);
    await showLoadingBar(chatId, "🚀 Menyiapkan AXVARA");
    const siteUrl = process.env.SITE_URL ?? "https://axvara.tech";
    await sendPhoto({
      chat_id: chatId,
      photo: `${siteUrl}/r2/banners/tg-welcome.png`,
      caption: welcomeMessage(from?.first_name ?? "Pengguna"),
      parse_mode: "HTML",
      reply_markup: homeKeyboard(),
    });
    return;
  }

  if (cmd === "/katalog") {
    await clearPendingAction(from);
    await handleShowCatalog(chatId);
    return;
  }

  // Qty manual input: user typed a number while choosing qty
  if (from && /^\d{1,2}$/.test(cmd)) {
    const handled = await handlePendingQtyInput(text, chatId, from);
    if (handled) return;
  }

  if (cmd === "/bantuan" || cmd === "/help") {
    await sendMessage({ chat_id: chatId, text: helpMessage(), parse_mode: "HTML" });
    return;
  }

  if (cmd === "/chatid") {
    const isGroup = chatType === "group" || chatType === "supergroup";
    await sendMessage({
      chat_id: chatId,
      text: isGroup
        ? [
            "🔔 <b>ID Grup Notifikasi</b>",
            "",
            `<code>${chatId}</code>`,
            "",
            "ID ini dipakai AXVARA untuk mengirim notifikasi order web dan Telegram ke grup ini.",
          ].join("\n")
        : "Tambahkan @Axvara_bot ke grup tujuan, lalu kirim <code>/chatid</code> di dalam grup tersebut.",
      parse_mode: "HTML",
    });
    return;
  }

  if (cmd === "/garansi") {
    await sendMessage({
      chat_id: chatId,
      text: warrantyFullMessage(),
      parse_mode: "HTML",
      reply_markup: warrantyKeyboard(),
    });
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
      await clearPendingAction(from);
      await safeEditOrSend({
        chat_id: chatId, message_id: messageId,
        text: welcomeMessage(from.first_name),
        parse_mode: "HTML",
        reply_markup: homeKeyboard(),
      });
      break;

    case "catalog":
      await clearPendingAction(from);
      await handleShowCatalogEdit(chatId, messageId, Number(params[0] || 0));
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
      // Always use variant flow — stock synced with web/WA via product_variants
      await handleShowVariants(chatId, messageId, Number(params[0]));
      break;

    case "vars":
      await handleShowVariants(chatId, messageId, Number(params[0]));
      break;

    case "var":
      await handleVariantConfirm(chatId, messageId, Number(params[0]));
      break;

    case "qty":
      await handleShowQty(chatId, messageId, Number(params[0]), Number(params[1]));
      break;

    case "q":
      await handleShowPaymentMethods(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]));
      break;

    case "pay":
      await handleShowPaymentMethods(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]));
      break;

    case "pm":
      await handlePayWithMethod(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]), String(params[3] || "qris"), from);
      break;

    case "waskip":
      await handleWaSkip(chatId, messageId, String(params[0] || ""), from);
      break;

    case "cfv":
      // Legacy "Saya Paham, Lanjut Bayar" buttons route into the qty step now.
      await handleShowQty(chatId, messageId, Number(params[0]), Number(params[1]));
      break;

    case "confirm":
      await handleConfirmPurchase(chatId, messageId, Number(params[0]));
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

    case "warranty":
      await sendMessage({
        chat_id: chatId,
        text: warrantyFullMessage(),
        parse_mode: "HTML",
        reply_markup: warrantyKeyboard(),
      });
      break;

    case "help":
      await sendMessage({ chat_id: chatId, text: helpMessage(), parse_mode: "HTML" });
      break;

    default:
      break;
  }
}

// --- Handler implementations ---

// Flat catalog (WA parity): product names only, no mandatory categories.
async function handleShowCatalog(chatId: number) {
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

async function handleShowCatalogEdit(chatId: number, messageId: number, page: number) {
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

async function handleShowCategoriesEdit(chatId: number, messageId: number, page: number) {
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

async function handleShowProducts(chatId: number, messageId: number, categoryId: number, page: number) {
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

async function handleShowProduct(chatId: number, messageId: number, productId: number) {
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
  const priceRow = await queryFirst(`SELECT compare_price, badge FROM products WHERE id=?`, productId);
  const comparePrice = priceRow?.compare_price ? Number(priceRow.compare_price) : null;
  const badge = priceRow?.badge ? String(priceRow.badge) : null;

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

async function handleShowVariants(chatId: number, messageId: number, productId: number) {
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

async function handleVariantConfirm(chatId: number, messageId: number, variantId: number) {
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
  const productName = product ? String(product.name) : "Produk";
  const productId = product ? Number(product.id) : 0;

  // Guard: existing pending order for this chat+variant — resend it, never duplicate.
  const existingOrder = await queryFirst(
    `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending')
     AND variant_id=?`,
    String(chatId), variantId,
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

  await safeEditOrSend({
    chat_id: chatId,
    message_id: messageId,
    text: confirmVariantBuyMessage({
      productName,
      variantLabel: variant.label,
      duration: formatDuration(variant) || null,
      warranty: formatWarranty(variant) || null,
      price: variant.price,
      qty: 1,
    }),
    parse_mode: "HTML",
    reply_markup: confirmVariantPurchaseKeyboard(productId, variantId),
  });
}

// --- Qty + payment-method flow (bulk order support, WA parity) ---

function clampQty(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(20, Math.floor(raw)));
}

// One-shot read of a WA number left by a legacy pre-invoice step.
async function consumeWaPrefill(userId: number): Promise<string> {
  if (!isD1Mode()) return "";
  try {
    const user = await queryFirst(
      `SELECT pending_action FROM telegram_users WHERE user_id=?`,
      String(userId),
    );
    const action = user?.pending_action ? String(user.pending_action) : "";
    if (!action.startsWith("wa_prefill:")) return "";
    const wa = action.slice("wa_prefill:".length);
    await execRun(
      `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=?`,
      String(userId),
    ).catch(() => {});
    return /^(\+62|62|0)8\d{8,13}$/.test(wa) || /^62\d{8,14}$/.test(wa) ? wa : "";
  } catch {
    return "";
  }
}

async function handleShowQty(chatId: number, messageId: number, productId: number, variantId: number) {
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

  // Remember qty context so a typed number (1-20) works without buttons.
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
    }),
    parse_mode: "HTML",
    reply_markup: qtyKeyboard({ productId, variantId, stock: variant.stock }),
  });
}

async function handleShowPaymentMethods(
  chatId: number,
  messageId: number,
  productId: number,
  variantId: number,
  rawQty: number,
) {
  const variant = await getActiveVariant(variantId);
  if (!variant || variant.product_id !== productId) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
    return;
  }
  const qty = clampQty(rawQty);
  if (variant.stock !== -1 && variant.stock < qty) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
    return;
  }
  const product = await queryFirst(`SELECT id, name FROM products WHERE id=?`, productId);
  const productName = product ? String(product.name) : "Produk";

  await safeEditOrSend({
    chat_id: chatId,
    message_id: messageId,
    text: paymentMethodMessage({
      productName,
      variantLabel: variant.label,
      qty,
      total: variant.price * qty,
    }),
    parse_mode: "HTML",
    reply_markup: paymentMethodKeyboard(productId, variantId, qty),
  });
}

async function handlePendingQtyInput(
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
  const qty = clampQty(Number(text.trim()));
  await execRun(
    `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=?`,
    String(from.id),
  ).catch(() => {});
  await handleShowPaymentMethods(chatId, 0, productId, variantId, qty);
  return true;
}

type TelegramPayMethod = "qris" | "seabank" | "ewallet";

async function handlePayWithMethod(
  chatId: number,
  messageId: number,
  productId: number,
  variantId: number,
  rawQty: number,
  rawMethod: string,
  from: { id: number; first_name: string; username?: string },
) {
  const method: TelegramPayMethod = rawMethod === "seabank" ? "seabank" : rawMethod === "ewallet" ? "ewallet" : "qris";

  await sendChatAction(chatId, "typing");
  await clearPendingAction(from);

  const variant = await getActiveVariant(variantId);
  if (!variant || variant.product_id !== productId) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
    return;
  }
  const qty = clampQty(rawQty);
  if (variant.stock === 0 || (variant.stock !== -1 && variant.stock < qty)) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
    return;
  }

  const product = await queryFirst(`SELECT id, name FROM products WHERE id=?`, productId);
  if (!product) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
    return;
  }

  // Guard double-tap: reuse pending order for same chat+variant, never duplicate.
  const existingOrder = await queryFirst(
    `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending')
     AND variant_id=?`,
    String(chatId), variantId,
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

  // Best-effort: pick up a WA number the user gave in a legacy pre-invoice step.
  const prefillWa = await consumeWaPrefill(from.id);

  if (method === "qris") {
    if (!isDanaQrisConfigured()) {
      await sendMessage({ chat_id: chatId, text: "⚠️ Pembayaran QRIS belum aktif. Pilih SeaBank / E-Wallet atau hubungi admin.", parse_mode: "HTML" });
      return;
    }
    await createAndSendVariantInvoice(chatId, messageId, productId, String(product.name), variant, from, prefillWa, qty, "qris");
    return;
  }

  await createManualTransferOrder(chatId, productId, String(product.name), variant, from, qty, method, prefillWa);
}

async function createAndSendVariantInvoice(
  chatId: number,
  _messageId: number,
  productId: number,
  productName: string,
  variant: VariantSummary,
  from: { id: number; first_name: string; username?: string },
  customerWa: string,
  rawQty = 1,
  method: TelegramPayMethod = "qris",
) {
  const qty = clampQty(rawQty);
  const price = Number(variant.price);
  const subtotal = price * qty;
  const fulfillmentMode = String(variant.fulfillment_mode || "manual");
  const uniqueFulfillment = fulfillmentMode === "unique" && qty === 1;
  const orderCode = generateOrderCode();
  const items = [{
    product_id: productId,
    variant_id: variant.id,
    name: `${productName} — ${variant.label}`,
    price,
    qty,
  }];
  const variantSnapshot = JSON.stringify({
    product_name: productName,
    variant_id: variant.id,
    sku: variant.sku,
    label: variant.label,
    duration_value: variant.duration_value,
    duration_unit: variant.duration_unit,
    duration_label: formatDuration(variant),
    warranty_type: variant.warranty_type,
    warranty_value: variant.warranty_value,
    warranty_unit: variant.warranty_unit,
    warranty_label: formatWarranty(variant),
    price,
    qty,
    fulfillment_mode: fulfillmentMode,
  });
  let inventoryId: number | null = null;
  let finiteStockReserved = false;
  let orderInserted = false;

  try {
    if (fulfillmentMode === "shared" && isD1Mode()) {
      const configured = await queryFirst(
        `SELECT id FROM product_variants
         WHERE id=? AND product_id=?
           AND shared_secret_ciphertext IS NOT NULL AND shared_secret_iv IS NOT NULL`,
        variant.id,
        productId,
      );
      if (!configured) {
        await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
        return;
      }
    }

    // Unique fulfillment is 1 secret per order — bulk qty routes to manual flow instead.
    if (uniqueFulfillment) {
      inventoryId = await reserveInventory(productId, orderCode, variant.id);
      if (inventoryId === null) {
        await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
        return;
      }
    }

    // Decrement variant stock by qty (bulk-aware)
    if (isD1Mode() && variant.stock !== -1) {
      const stockResult = await execRun(
        `UPDATE product_variants SET stock = stock - ?, updated_at = datetime('now')
         WHERE id=? AND is_active=1 AND stock >= ?`,
        qty, variant.id, qty,
      );
      if (!stockResult.changes) {
        if (inventoryId) await releaseInventoryForOrder(orderCode);
        inventoryId = null;
        await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
        return;
      }
      finiteStockReserved = true;
    }

    // QRIS invoice expires 15 min; created via DANA ledger right after insert.
    await execRun(
      `INSERT INTO orders (code, customer_name, customer_wa, customer_email, items, subtotal,
         payment_method, payment_account, proof_url, status, sales_channel,
         telegram_chat_id, telegram_user_id, payment_status, fulfillment_status,
         variant_id, variant_snapshot, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      orderCode, from.first_name, customerWa, null, JSON.stringify(items),
      subtotal, method === "qris" ? "qris" : method, method === "qris" ? "DANA Business" : "",
      null, "pending", "telegram",
      String(chatId), String(from.id), "pending",
      uniqueFulfillment ? "reserved" : "not_required",
      variant.id, variantSnapshot, new Date(Date.now() + 15 * 60_000).toISOString(),
    );
    orderInserted = true;

    const invoiceResult = await createDanaQrisInvoice(orderCode, subtotal);

    await createFulfillmentJob(orderCode, inventoryId, fulfillmentMode, variant.id, "telegram");

    const displayName = qty > 1 ? `${productName} — ${variant.label} ×${qty}` : `${productName} — ${variant.label}`;
    await sendPhoto({
      chat_id: chatId,
      photo: invoiceResult.qrisUrl,
      caption: invoiceMessage({
        orderCode,
        productName: displayName,
        payableAmount: invoiceResult.payableAmount,
        expiresAt: invoiceResult.expiresAt,
        paymentMethod: "qris",
      }),
      parse_mode: "HTML",
      reply_markup: orderStatusKeyboard(orderCode),
    });

    // WA number AFTER invoice/payment (manual fulfillment only) — never a gate.
    if (fulfillmentMode === "manual") {
      await askWaAfterInvoice(chatId, orderCode, displayName, from);
    }
  } catch (error) {
    console.error("Variant order creation failed:", error instanceof Error ? error.message : "unknown");
    try {
      if (orderInserted) {
        const transaction = await queryFirst(
          `SELECT id FROM payment_transactions WHERE order_code=?`,
          orderCode,
        );
        if (!transaction) {
          await transitionPendingOrder(orderCode, "dibatalkan", "invoice_setup_failed", items);
        }
      } else {
        if (finiteStockReserved) {
          await execRun(
            `UPDATE product_variants SET stock=stock+?, updated_at=datetime('now')
             WHERE id=? AND stock!=-1`,
            qty, variant.id,
          );
        }
        if (inventoryId) await releaseInventoryForOrder(orderCode);
      }
    } catch { /* Cron/admin reconciliation can handle any remaining reservation. */ }
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
  }
}

// Manual rails (SeaBank / E-Wallet): create pending order with atomic stock
// reservation, send transfer details immediately, ask WA after invoice.
async function createManualTransferOrder(
  chatId: number,
  productId: number,
  productName: string,
  variant: VariantSummary,
  from: { id: number; first_name: string; username?: string },
  rawQty: number,
  method: "seabank" | "ewallet",
  prefillWa = "",
) {
  const qty = clampQty(rawQty);
  const price = Number(variant.price);
  const subtotal = price * qty;
  const fulfillmentMode = String(variant.fulfillment_mode || "manual");

  // Bulk qty on unique fulfillment is not deliverable — steer to manual/admin.
  if (fulfillmentMode === "unique" && qty > 1) {
    await sendMessage({
      chat_id: chatId,
      text: [
        "⚠️ <b>Stok Unik Maksimal 1</b>",
        "━━━━━━━━━━━━━━━━━━━━━",
        "",
        "Varian ini memakai stok unik (1 secret = 1 order).",
        "Kurangi qty ke 1, atau chat admin untuk bulk order.",
      ].join("\n"),
      parse_mode: "HTML",
    });
    return;
  }

  const methods = await getActivePaymentMethods();
  const rail = method === "seabank" ? methods.seabank : methods.ewallet;
  if (!rail?.account) {
    await sendMessage({
      chat_id: chatId,
      text: "⚠️ Metode pembayaran ini belum lengkap. Pilih metode lain atau hubungi admin.",
      parse_mode: "HTML",
    });
    return;
  }

  const paymentMethod = method === "seabank" ? "bank:seabank" : "ewallet";
  const orderCode = generateOrderCode();
  const items = [{
    product_id: productId,
    variant_id: variant.id,
    name: `${productName} — ${variant.label}`,
    variant_label: variant.label,
    price,
    qty,
  }];
  const variantSnapshot = JSON.stringify({
    product_name: productName,
    variant_id: variant.id,
    sku: variant.sku,
    label: variant.label,
    duration_value: variant.duration_value,
    duration_unit: variant.duration_unit,
    duration_label: formatDuration(variant),
    warranty_type: variant.warranty_type,
    warranty_value: variant.warranty_value,
    warranty_unit: variant.warranty_unit,
    warranty_label: formatWarranty(variant),
    price,
    qty,
    fulfillment_mode: fulfillmentMode,
  });

  const d1 = getD1();
  if (!d1) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
    return;
  }

  const guardId = `tg:manual:${orderCode}:${variant.id}`;
  const needsUniqueInventory = fulfillmentMode === "unique";
  try {
    const statements: D1Statement[] = [
      d1.prepare(
        `INSERT INTO operation_guards (operation_id, valid)
         SELECT ?, CASE WHEN EXISTS(
           SELECT 1 FROM product_variants
           WHERE id=? AND is_active=1 AND (stock=-1 OR stock>=?)
         ) AND (
           ? != 'unique' OR EXISTS(
             SELECT 1 FROM fulfillment_inventory
             WHERE product_id=? AND status='available' AND (variant_id=? OR variant_id IS NULL)
           )
         ) THEN 1 ELSE 0 END`,
      ).bind(guardId, variant.id, qty, fulfillmentMode, productId, variant.id),
      d1.prepare(
        `UPDATE product_variants
         SET stock = CASE WHEN stock=-1 THEN -1 ELSE stock-? END,
             updated_at = datetime('now')
         WHERE id=?`,
      ).bind(qty, variant.id),
    ];
    if (needsUniqueInventory) {
      statements.push(
        d1.prepare(
          `UPDATE fulfillment_inventory
           SET status='reserved', order_code=?, reserved_at=datetime('now')
           WHERE id=(
             SELECT id FROM fulfillment_inventory
             WHERE product_id=? AND status='available' AND (variant_id=? OR variant_id IS NULL)
             ORDER BY CASE WHEN variant_id=? THEN 0 ELSE 1 END, id ASC
             LIMIT 1
           ) AND status='available'`,
        ).bind(orderCode, productId, variant.id, variant.id),
      );
    }
    const orderInsertIndex = statements.length;
    statements.push(
      d1.prepare(
        `INSERT INTO orders (
           code, customer_name, customer_wa, customer_email, items, subtotal,
           payment_method, payment_account, proof_url, status, sales_channel,
           channel_conversation_id, channel_member_id, telegram_chat_id, telegram_user_id,
           payment_status, fulfillment_status, variant_id, variant_snapshot,
           quote_id, expires_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','+24 hours'))`,
      ).bind(
        orderCode, from.first_name, "", null, JSON.stringify(items), subtotal,
        paymentMethod, rail.account, null, "pending", "telegram",
        String(chatId), String(from.id), String(chatId), String(from.id),
        "pending", needsUniqueInventory ? "reserved" : "not_required",
        variant.id, variantSnapshot, `tg:manual:${orderCode}`,
      ),
      d1.prepare(`DELETE FROM operation_guards WHERE operation_id=?`).bind(guardId),
    );
    const results = await d1.batch(statements);
    const inserted = results[orderInsertIndex]?.meta?.last_row_id ?? 0;
    if (!inserted) throw new Error("manual_order_insert_failed");

    // Attach a prefilled WA number if the user gave one in a legacy step.
    if (prefillWa) {
      await execRun(
        `UPDATE orders SET customer_wa=? WHERE code=?`,
        prefillWa, orderCode,
      ).catch(() => {});
    }

    const reserved = needsUniqueInventory
      ? await queryFirst(`SELECT id FROM fulfillment_inventory WHERE order_code=? AND status='reserved'`, orderCode)
      : null;
    await createFulfillmentJob(
      orderCode,
      reserved ? Number(reserved.id) : null,
      fulfillmentMode,
      variant.id,
      "telegram",
    );

    const displayName = qty > 1 ? `${productName} — ${variant.label} ×${qty}` : `${productName} — ${variant.label}`;
    await sendMessage({
      chat_id: chatId,
      text: manualTransferMessage({
        orderCode,
        productName: displayName,
        total: subtotal,
        method,
        account: rail.account,
        accountName: rail.name,
      }),
      parse_mode: "HTML",
      reply_markup: orderStatusKeyboard(orderCode),
    });

    // WA number after invoice — manual fulfillment ships via admin.
    // Skip the ask when the number is already known (prefill).
    if (fulfillmentMode === "manual" && !prefillWa) {
      await askWaAfterInvoice(chatId, orderCode, displayName, from);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/operation_guards|CHECK constraint/i.test(msg)) {
      await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
      return;
    }
    if (/UNIQUE/i.test(msg)) {
      const winner = await queryFirst(`SELECT code FROM orders WHERE quote_id=?`, `tg:manual:${orderCode}`);
      if (winner) {
        await handleOrderStatus(chatId, String(winner.code));
        return;
      }
    }
    console.error("Manual transfer order failed:", msg);
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
  }
}

async function askWaAfterInvoice(
  chatId: number,
  orderCode: string,
  displayName: string,
  from: { id: number; first_name: string; username?: string },
) {
  // WA number AFTER invoice/payment (manual fulfillment only) — never a gate.
  // Guard: don't re-ask if already requested for this order/user.
  if (isD1Mode()) {
    const existing = await queryFirst(
      `SELECT pending_action FROM telegram_users WHERE user_id=?`,
      String(from.id),
    ).catch(() => null);
    if (existing?.pending_action === `wa_after:${orderCode}`) return;
    await execRun(
      `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=?`,
      `wa_after:${orderCode}`, String(from.id),
    ).catch(() => {});
  }
  await sendMessage({
    chat_id: chatId,
    text: askWhatsAppMessage(displayName),
    parse_mode: "HTML",
    reply_markup: askWaAfterInvoiceKeyboard(orderCode),
  });
}

async function handleWaSkip(chatId: number, messageId: number, orderCode: string, from: { id: number }) {
  if (isD1Mode() && orderCode) {
    await execRun(
      `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now')
       WHERE user_id=? AND pending_action=?`,
      String(from.id), `wa_after:${orderCode}`,
    ).catch(() => {});
  }
  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: [
      "👍 <b>Siap!</b>",
      "━━━━━━━━━━━━━━━━━━━━━",
      "",
      "Lanjut ke pembayaran dulu — nomor WA bisa dilengkapi nanti saat admin menghubungimu.",
      "Pantau status pesananmu di bawah 👇",
    ].join("\n"),
    parse_mode: "HTML",
    reply_markup: orderCode ? orderStatusKeyboard(orderCode) : undefined,
  });
}

async function handleBuyConfirm(chatId: number, messageId: number, productId: number) {
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

async function handleConfirmPurchase(
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

async function handlePendingWaInput(
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
  const isAfter = action.startsWith("wa_after:");
  const isVar = action.startsWith("wa_for_var:");
  const isLegacy = action.startsWith("wa_for:");
  if (!isAfter && !isLegacy && !isVar) return false;

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

  // WA-after-invoice: patch the order row, never create a new invoice.
  if (isAfter) {
    const orderCode = action.slice("wa_after:".length).toUpperCase();
    await execRun(
      `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=?`,
      String(from.id),
    ).catch(() => {});
    if (orderCode) {
      await execRun(
        `UPDATE orders SET customer_wa=?, updated_at=datetime('now')
         WHERE code=? AND telegram_user_id=? AND status='pending'`,
        normalizedWa, orderCode, String(from.id),
      ).catch(() => {});
      await sendMessage({
        chat_id: chatId,
        text: waSavedAfterInvoiceMessage(orderCode),
        parse_mode: "HTML",
        reply_markup: orderStatusKeyboard(orderCode),
      });
    } else {
      await sendMessage({
        chat_id: chatId,
        text: `✅ WA <code>${normalizedWa}</code> tersimpan.`,
        parse_mode: "HTML",
      });
    }
    return true;
  }

  // Legacy pre-invoice WA gates (kept for in-flight users): create invoice, then
  // WA is already known so no post-invoice ask is needed.
  const targetId = Number(action.split(":")[1]);
  if (!targetId) return false;

  // Clear pending action
  await execRun(
    `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=?`,
    String(from.id),
  );

  if (isVar) {
    const variant = await getActiveVariant(targetId);
    if (!variant) {
      await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
      return true;
    }
    const product = await queryFirst(`SELECT id, name FROM products WHERE id=?`, variant.product_id);
    if (!product) {
      await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
      return true;
    }
    await sendMessage({ chat_id: chatId, text: `✅ WA <code>${normalizedWa}</code> tersimpan. Membuat invoice...`, parse_mode: "HTML" });
    await handleShowQty(chatId, 0, Number(product.id), variant.id);
    // Stash the known WA so the next invoice creation picks it up via the
    // wa_prefill marker (best-effort; order itself still created post-choice).
    await execRun(
      `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=?`,
      `wa_prefill:${normalizedWa}`, String(from.id),
    ).catch(() => {});
    return true;
  }

  const productId = targetId;

  // Use variant flow for stock sync — get product detail from catalog.ts
  const detail = await getProductDetail(productId);
  if (!detail || detail.variants.length === 0) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
    return true;
  }

  // Pick first available variant
  const availableVariant = detail.variants.find(v => v.is_active && v.stock !== 0);
  if (!availableVariant) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
    return true;
  }

  await handleShowQty(chatId, 0, productId, availableVariant.id);
  await execRun(
    `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=?`,
    `wa_prefill:${normalizedWa}`, String(from.id),
  ).catch(() => {});
  return true;
}

// ponytail: legacy createAndSendInvoice removed — all orders now go through
// createAndSendVariantInvoice which decrements product_variants.stock (synced with web/WA).
// If products without variants appear, getProductDetail returns a synthetic default variant.

async function handleOrderStatus(chatId: number, orderCode: string) {
  const order = await queryFirst(
    `SELECT o.code, o.items, o.subtotal, o.payment_status, o.fulfillment_status,
            pt.payable_amount
     FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
     WHERE o.code=?`,
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
      payableAmount: Number(order.payable_amount ?? order.subtotal),
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
    `SELECT o.code, o.items, o.subtotal, o.payment_status, o.fulfillment_status,
            pt.payable_amount
     FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
     WHERE o.code=?`,
    orderCode,
  );
  if (!order) return;

  let productName = "Produk";
  try {
    const items = JSON.parse(String(order.items));
    productName = items[0]?.name ?? "Produk";
  } catch { /* ok */ }

  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: orderStatusMessage({
      orderCode: String(order.code),
      productName,
      paymentStatus: String(order.payment_status || "unpaid"),
      fulfillmentStatus: String(order.fulfillment_status || "not_required"),
      payableAmount: Number(order.payable_amount ?? order.subtotal),
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

  // Restore stock — use product_variants (synced with web/WA)
  try {
    const items = JSON.parse(String(order.items)) as { product_id: number; variant_id?: number; qty: number }[];
    for (const item of items) {
      if (item.variant_id) {
        await execRun(
          `UPDATE product_variants SET stock = CASE WHEN stock=-1 THEN -1 ELSE stock+? END, updated_at=datetime('now') WHERE id=? AND stock!=-1`,
          item.qty, item.variant_id,
        );
      } else {
        // Fallback for legacy orders without variant_id — restore to both tables
        await execRun(
          `UPDATE products SET stock = CASE WHEN stock=-1 THEN -1 ELSE stock+? END WHERE id=? AND stock!=-1`,
          item.qty, item.product_id,
        );
      }
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

  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: orderCancelledMessage(orderCode),
    parse_mode: "HTML",
  });
}
