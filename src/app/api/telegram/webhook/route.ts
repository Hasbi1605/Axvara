// POST /api/telegram/webhook — Telegram Bot webhook handler
// Validates secret header, deduplicates updates, routes commands/callbacks.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryFirst, queryAll, execRun, isD1Mode, transitionPendingOrder } from "@/lib/db";
import { sendMessage, sendPhoto, safeEditOrSend, answerCallbackQuery, sendChatAction, showLoadingBar } from "@/lib/telegram/api";
import {
  homeKeyboard, catalogFlatKeyboard, categoriesKeyboard, productsKeyboard,
  productDetailKeyboard, warrantyKeyboard,
  orderStatusKeyboard, variantsKeyboard, confirmVariantPurchaseKeyboard,
  qtyKeyboard, qrisInvoiceKeyboard, orderPaidKeyboard, parseCallback,
  TELEGRAM_MAX_QTY, myOrdersKeyboard, searchResultsKeyboard,
  cartKeyboard, mainReplyMenu,
  MENU_LABEL_CATALOG, MENU_LABEL_SEARCH, MENU_LABEL_ORDERS, MENU_LABEL_HELP,
  MENU_LABEL_CART,
} from "@/lib/telegram/keyboards";
import {
  welcomeMessage, catalogFlatMessage, categoriesMessage, categoryProductsMessage,
  productDetailMessage, helpMessage, warrantyFullMessage,
  outOfStockMessage, alreadyPendingMessage, errorMessage,
  myOrdersPrompt, myOrdersMessage, orderStatusMessage, invoiceMessage,
  orderCancelledMessage, invalidWhatsAppMessage, waSavedAfterPaymentMessage,
  whatsAppInputPromptMessage, chooseVariantMessage, chooseQtyMessage,
  confirmVariantBuyMessage, searchPromptMessage, searchResultsMessage,
  cartMessage, cartAddedMessage, cartCheckoutSummaryMessage,
  type TelegramBestseller, type TelegramOrderRow,
} from "@/lib/telegram/messages";
import { getProductDetail, getActiveVariant, formatDuration, formatWarranty, type VariantSummary } from "@/lib/catalog";
import { addToCart, setCartLineQty, removeFromCart, clearCart, getCartSummary, type CartLine } from "@/lib/telegram/cart";
import { generateOrderCode } from "@/lib/security";
import { createDanaQrisInvoice, isDanaQrisConfigured } from "@/lib/payments/dana-qris";
import { reserveInventory, releaseInventoryForOrder, countInventory } from "@/lib/fulfillment/inventory";
import { createFulfillmentJob } from "@/lib/fulfillment/deliver";
import { notifyTelegramOrderCreated } from "@/lib/telegram/order-notifications";

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

  // 5. Claim update_id with lease (idempotency, issue #6). States:
  // - done → sudah selesai penuh: jawab already_processed, janganยี ulangi.
  // - processing + lease aktif → worker lain sedang kerja: jangan rebut.
  // - failed / processing lease-kedaluwarsa → boleh reclaim atomik untuk
  //   retry nyata (attempt_count+1), tanpa membuat order/invoice ganda
  //   karena pembuatan order memakai idempotency key + guard D1.
  const leaseUntil = new Date(Date.now() + 30_000).toISOString();
  const MAX_UPDATE_ATTEMPTS = 5;
  try {
    if (isD1Mode()) {
      const existing = await queryFirst(
        `SELECT status, attempt_count, lease_until FROM telegram_updates WHERE update_id=?`, updateId,
      );
      if (existing) {
        const status = String(existing.status);
        const leaseUntilExisting = String(existing.lease_until || "");
        const leaseActive = leaseUntilExisting
          && Number.isFinite(Date.parse(leaseUntilExisting))
          && Date.parse(leaseUntilExisting) > Date.now();
        if (status === "done") {
          return NextResponse.json({ ok: true, status: "already_processed" });
        }
        if (status === "processing" && leaseActive) {
          return NextResponse.json({ ok: true, status: "already_processing" });
        }
        const attempts = Number(existing.attempt_count || 0);
        if (attempts >= MAX_UPDATE_ATTEMPTS) {
          return NextResponse.json({ ok: true, status: "already_processed" });
        }
        // Reclaim atomik: hanya menang bila baris masih failed / lease
        // kedaluwarsa — kalah berarti worker lain baru saja claim.
        const reclaimed = await execRun(
          `UPDATE telegram_updates
           SET status='processing', lease_until=?, attempt_count=attempt_count+1, updated_at=datetime('now')
           WHERE update_id=? AND status IN ('failed','processing')
             AND (status='failed' OR lease_until IS NULL OR datetime(lease_until) <= datetime('now'))`,
          leaseUntil, updateId,
        );
        if (!reclaimed.changes) {
          return NextResponse.json({ ok: true, status: "already_processing" });
        }
      } else {
        await execRun(
          `INSERT INTO telegram_updates (update_id, status, lease_until) VALUES (?, 'processing', ?)`,
          updateId, leaseUntil,
        );
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ ok: true, status: "already_processing" });
    }
  }

  // 6. Upsert telegram user + bind verified private chat (issue #5).
  // chat_id grup (negatif) TIDAK PERNAH disimpan sebagai identitas user:
  // upsert memakai chat pribadi hanya bila update datang dari chat private,
  // dan ensurePrivateRecipient mengikat ulang order lunas milik buyer ke
  // chat pribadi terverifikasi tanpa memercayai id grup.
  const from = update.message?.from ?? update.callback_query?.from;
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  // Callback updates carry no chat.type — infer privacy from the chat id
  // sign (review R7). Telegram group/supergroup/channel ids are negative;
  // a callback from a negative chat must follow the group path even though
  // there is no message.chat.type field to read.
  const chatType = update.message?.chat.type ?? (typeof chatId === "number" && chatId < 0 ? "supergroup" : "private");
  const isPrivateChat = chatType === "private";
  if (from && chatId) {
    try {
      if (isD1Mode()) {
        if (isPrivateChat) {
          await execRun(
            `INSERT INTO telegram_users (user_id, chat_id, username, first_name, last_name)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET chat_id=?, username=?, first_name=?, last_name=?, updated_at=datetime('now')`,
            String(from.id), String(chatId), from.username ?? null, from.first_name, from.last_name ?? null,
            String(chatId), from.username ?? null, from.first_name, from.last_name ?? null,
          );
          const { ensurePrivateRecipient } = await import("@/lib/fulfillment/deliver");
          await ensurePrivateRecipient(String(from.id), String(chatId)).catch(() => {});
        } else {
          await execRun(
            `INSERT INTO telegram_users (user_id, chat_id, username, first_name, last_name)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET username=?, first_name=?, last_name=?, updated_at=datetime('now')`,
            String(from.id), String(from.id), from.username ?? null, from.first_name, from.last_name ?? null,
            from.username ?? null, from.first_name, from.last_name ?? null,
          );
        }
      }
    } catch { /* best-effort user upsert */ }
  }

  // 6b. Group guard: checkout/callback dari grup tidak membawa state
  // pembelian — balas dengan deep-link ke chat pribadi, lalu berhenti.
  if (!isPrivateChat && chatId) {
    try {
      if (update.callback_query) {
        const cq = update.callback_query;
        await answerCallbackQuery(cq.id);
        if (cq.data) {
          const { SITE } = await import("@/lib/site");
          const { groupCheckoutRedirectMessage } = await import("@/lib/telegram/messages");
          await sendMessage({
            chat_id: chatId,
            text: groupCheckoutRedirectMessage(SITE.adminTelegram),
            parse_mode: "HTML",
          });
        }
        await markDone(updateId);
        return NextResponse.json({ ok: true, status: "group_redirected" });
      }
      if (update.message?.text) {
        const groupText = update.message.text.trim().toLowerCase().split(/\s+/)[0].split("@")[0];
        const purchaseIntents = ["/start", "/katalog", "/cari", "/search", "/cart", "/keranjang", "/orders", "/riwayat", "/pesanan", "/bantuan", "/help", "/garansi"];
        if (purchaseIntents.includes(groupText) || !groupText.startsWith("/")) {
          // /chatid tetap dilayani di grup (admin setup); sisanya redirect.
          if (groupText !== "/chatid") {
            const { SITE } = await import("@/lib/site");
            const { groupCheckoutRedirectMessage } = await import("@/lib/telegram/messages");
            await sendMessage({
              chat_id: chatId,
              text: groupCheckoutRedirectMessage(SITE.adminTelegram),
              parse_mode: "HTML",
            });
            await markDone(updateId);
            return NextResponse.json({ ok: true, status: "group_redirected" });
          }
        }
      }
    } catch { /* redirect best-effort; lanjutkan routing normal */ }
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
    // A processing failure must leave the update retryable: mark it failed
    // (lease expired by definition — a new delivery attempt may reclaim it)
    // and answer NON-2xx so Telegram actually redelivers (review R5).
    // Before this fix the handler returned 200 for every failure, which told
    // Telegram "delivered" — Telegram never retried, and the transient
    // outage became a silent drop. Permanent failures (invalid updates,
    // budget exhausted, group redirects) still return 200 above and never
    // reach this branch, so non-2xx here cannot loop forever.
    try {
      if (isD1Mode()) {
        await execRun(
          `UPDATE telegram_updates SET status='failed', last_error=?, updated_at=datetime('now') WHERE update_id=?`,
          (error instanceof Error ? error.message : "Unknown").slice(0, 500), updateId,
        );
      }
    } catch { /* best effort */ }

    if (chatId) {
      try { await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" }); } catch { /* ok */ }
    }
    return NextResponse.json({ ok: false, status: "error_retryable" }, { status: 500 });
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
    const bestsellers = await getBestsellers(3);
    await sendPhoto({
      chat_id: chatId,
      photo: `${siteUrl}/r2/banners/tg-welcome.png`,
      caption: welcomeMessage(from?.first_name ?? "Pengguna", bestsellers),
      parse_mode: "HTML",
      reply_markup: homeKeyboard(),
    });
    // Tombol tetap bawah (reply keyboard): Katalog · Cari · Keranjang · Pesanan · Bantuan.
    // Dikirim sebagai pesan terpisah karena sendPhoto caption memakai inline keyboard.
    // is_persistent=true → tetap nempel di semua chat private; user lama yang
    // belum pernah /start ulang tetap bisa pakai /cart atau tombol 🛒 + Keranjang.
    await sendMessage({
      chat_id: chatId,
      text: "👇 <b>Menu Cepat</b> — tombol tetap di bawah kolom ketik.",
      parse_mode: "HTML",
      reply_markup: mainReplyMenu(),
    });
    return;
  }

  // Persistent reply-menu taps arrive as plain text — route them like commands.
  if (text === MENU_LABEL_CATALOG || cmd === "/katalog") {
    await clearPendingAction(from);
    await handleShowCatalog(chatId);
    return;
  }

  if (text === MENU_LABEL_SEARCH || cmd === "/cari" || cmd === "/search") {
    await clearPendingAction(from);
    await handleSearchPrompt(chatId, from);
    return;
  }

  if (text === MENU_LABEL_ORDERS || cmd === "/orders" || cmd === "/riwayat") {
    await clearPendingAction(from);
    await handleMyOrders(chatId, from);
    return;
  }

  if (text === MENU_LABEL_CART || cmd === "/cart" || cmd === "/keranjang") {
    await clearPendingAction(from);
    await handleShowCart(chatId, 0, from);
    return;
  }

  if (text === MENU_LABEL_HELP || cmd === "/bantuan" || cmd === "/help") {
    await sendMessage({ chat_id: chatId, text: helpMessage(), parse_mode: "HTML" });
    return;
  }

  // Qty manual input: user typed a number while choosing qty (up to 100 for bulk)
  if (from && /^\d{1,3}$/.test(cmd)) {
    const handled = await handlePendingQtyInput(text, chatId, from);
    if (handled) return;
  }

  // Search text: user is answering the 🔎 Cari prompt (pending_action=search:).
  if (from && !cmd.startsWith("/")) {
    const handled = await handlePendingSearchInput(text, chatId, from);
    if (handled) return;
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
      await handleMyOrders(chatId, from);
    }
    return;
  }

  // Unknown command: show welcome
  await sendMessage({
    chat_id: chatId,
    text: welcomeMessage(from?.first_name ?? "Pengguna", await getBestsellers(3)),
    parse_mode: "HTML",
    reply_markup: homeKeyboard(),
  });
}

async function handleCallback(data: string, chatId: number, messageId: number, from: { id: number; first_name: string; username?: string }) {
  const { action, params } = parseCallback(data);

  // Ownership guard (issue #5): callback sensitif order (bayar, keranjang,
  // batal, refresh, status, wainput) hanya boleh dieksekusi pemilik order.
  // from.id adalah identitas penekan tombol terverifikasi Telegram — chat_id
  // grup tidak boleh dipakai untuk mengambil alih order orang lain.
  const ownerBound = new Set(["pay", "pm", "cadd", "cinc", "cdec", "crm", "ccheckout", "cancel", "refresh", "order", "wainput"]);
  if (ownerBound.has(action)) {
    const targetCode = action === "cancel" || action === "refresh" || action === "order" || action === "wainput"
      ? String(params[0] || "").toUpperCase()
      : null;
    if (targetCode) {
      const owned = await queryFirst(
        `SELECT code FROM orders WHERE code=? AND telegram_user_id=? AND sales_channel='telegram'`,
        targetCode, String(from.id),
      );
      if (!owned) {
        await sendMessage({ chat_id: chatId, text: "❌ Pesanan ini bukan milikmu. Buka chat pribadi bot dan buat pesanan sendiri.", parse_mode: "HTML" });
        return;
      }
    }
    // verifyPrivateChat: callback dari grup untuk aksi sensitif ditolak
    // (grup sudah di-redirect di POST; ini lapis kedua bila pesan lama
    // diteruskan). Chat pribadi selalu lolos (chatId positif = from.id).
    if (Number(chatId) < 0) {
      const { SITE } = await import("@/lib/site");
      const { groupCheckoutRedirectMessage } = await import("@/lib/telegram/messages");
      await sendMessage({ chat_id: chatId, text: groupCheckoutRedirectMessage(SITE.adminTelegram), parse_mode: "HTML" });
      return;
    }
  }

  switch (action) {
    case "home":
      await clearPendingAction(from);
      await safeEditOrSend({
        chat_id: chatId, message_id: messageId,
        text: welcomeMessage(from.first_name, await getBestsellers(3)),
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
      await handleShowQty(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]));
      break;

    case "pay":
      await handlePayWithQris(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]), from);
      break;

    case "pm":
      // Compatibility for buttons from older messages: Telegram now always uses QRIS.
      await handlePayWithQris(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]), from);
      break;

    case "wainput":
      await handleWaInput(chatId, String(params[0] || ""), from);
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
      await handleMyOrders(chatId, from);
      break;

    case "search":
      await handleSearchPrompt(chatId, from);
      break;

    case "reorder": {
      const productId = Number(params[0] || 0);
      if (productId > 0) {
        await handleBuyConfirm(chatId, messageId, productId);
      }
      break;
    }

    case "cart":
      await handleShowCart(chatId, messageId, from);
      break;

    case "cadd":
      await handleCartAdd(chatId, messageId, Number(params[0] || 0), Number(params[1] || 0), Number(params[2] || 1), from);
      break;

    case "cinc":
      await handleCartAdjust(chatId, messageId, from, Number(params[0] || 0), +1);
      break;

    case "cdec":
      await handleCartAdjust(chatId, messageId, from, Number(params[0] || 0), -1);
      break;

    case "crm":
      await handleCartAdjust(chatId, messageId, from, Number(params[0] || 0), 0);
      break;

    case "cclear":
      await clearCart(String(from.id));
      await handleShowCart(chatId, messageId, from);
      break;

    case "ccheckout":
      await handleCartCheckout(chatId, messageId, from);
      break;

    case "cconfirm": {
      const cartSummary = await getCartSummary(String(from.id));
      if (cartSummary.lines.length === 0) {
        await handleShowCart(chatId, messageId, from);
        break;
      }
      const dupOrder = await queryFirst(
        `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending')`,
        String(chatId),
      );
      if (dupOrder) {
        await sendMessage({
          chat_id: chatId,
          text: alreadyPendingMessage(String(dupOrder.code)),
          parse_mode: "HTML",
          reply_markup: orderStatusKeyboard(String(dupOrder.code)),
        });
        break;
      }
      await createAndSendCartInvoice(chatId, cartSummary.lines, from);
      break;
    }

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

// --- /cart: keranjang multi-item → checkout SATU QRIS gabungan ---

function cartLineLabel(line: CartLine): string {
  return `${line.productName} — ${line.variantLabel} ×${line.qty}`;
}

async function handleShowCart(
  chatId: number,
  messageId: number,
  from?: { id: number; first_name: string; username?: string },
) {
  if (!from) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
    return;
  }
  const summary = await getCartSummary(String(from.id));
  const keyboard = cartKeyboard({
    lines: summary.lines.map((line) => ({
      variantId: line.variantId, qty: line.qty, stock: line.stock, fulfillmentMode: line.fulfillmentMode,
    })),
  });
  const text = cartMessage(summary.lines.map((line) => ({
    productName: line.productName, variantLabel: line.variantLabel, price: line.price, qty: line.qty,
  })));
  if (messageId > 0) {
    await safeEditOrSend({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", reply_markup: keyboard });
  } else {
    await sendMessage({ chat_id: chatId, text, parse_mode: "HTML", reply_markup: keyboard });
  }
}

async function handleCartAdd(
  chatId: number,
  messageId: number,
  productId: number,
  variantId: number,
  qty: number,
  from: { id: number; first_name: string; username?: string },
) {
  await sendChatAction(chatId, "typing");
  const result = await addToCart(String(from.id), productId, variantId, qty);
  if (!result.ok) {
    await sendMessage({
      chat_id: chatId,
      text: result.reason === "out_of_stock" ? outOfStockMessage()
        : result.reason === "cart_full" ? "🛒 <b>Keranjang Penuh</b>\n\nMaksimal 20 varian. Checkout dulu sebelum tambah lagi 👇"
        : result.reason === "unique_conflict" ? "⚠️ <b>Produk Unik Satu per Order</b>\n\nProduk stok unik (1 secret = 1 order) tidak bisa digabung dengan produk unik lain. Checkout dulu, baru order produk unik berikutnya 👇"
        : errorMessage(),
      parse_mode: "HTML",
    });
    return;
  }
  const summary = await getCartSummary(String(from.id));
  const added = summary.lines.find((line) => line.variantId === variantId);
  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: cartAddedMessage(
      added?.productName ?? "Produk", added?.variantLabel ?? "", added?.qty ?? qty, summary.totalQty,
    ),
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🛒 Lihat Keranjang & Checkout", callback_data: "cart" }],
        [
          { text: "🛍 Lanjut Belanja", callback_data: "catalog:0" },
          { text: "🏠 Menu", callback_data: "home" },
        ],
      ],
    },
  });
}

async function handleCartAdjust(
  chatId: number,
  messageId: number,
  from: { id: number; first_name: string; username?: string },
  variantId: number,
  delta: number,
) {
  const userId = String(from.id);
  if (delta === 0) {
    await removeFromCart(userId, variantId);
  } else {
    const summary = await getCartSummary(userId);
    const line = summary.lines.find((l) => l.variantId === variantId);
    if (!line) {
      await handleShowCart(chatId, messageId, from);
      return;
    }
    const ok = await setCartLineQty(userId, variantId, line.qty + delta);
    if (!ok) {
      await handleShowCart(chatId, messageId, from);
      return;
    }
  }
  await handleShowCart(chatId, messageId, from);
}

async function handleCartCheckout(
  chatId: number,
  messageId: number,
  from: { id: number; first_name: string; username?: string },
) {
  await sendChatAction(chatId, "typing");
  await clearPendingAction(from);

  if (!isDanaQrisConfigured()) {
    await sendMessage({
      chat_id: chatId,
      text: "⚠️ QRIS dinamis sedang tidak tersedia. Coba lagi sebentar atau hubungi admin.",
      parse_mode: "HTML",
    });
    return;
  }

  const summary = await getCartSummary(String(from.id));
  if (summary.lines.length === 0) {
    await handleShowCart(chatId, messageId, from);
    return;
  }

  // Guard double-tap: satu pending order Telegram per chat — checkout gabungan
  // tidak boleh menumpuk invoice aktif yang belum dibayar/dibatalkan.
  const existingOrder = await queryFirst(
    `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending')`,
    String(chatId),
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

  // Ringkasan konfirmasi dulu (Langkah 4/4) — invoice QRIS terbit setelah tap Lanjut.
  await sendMessage({
    chat_id: chatId,
    text: cartCheckoutSummaryMessage(summary.lines.map((line) => ({
      productName: line.productName, variantLabel: line.variantLabel, price: line.price, qty: line.qty,
    })), summary.subtotal),
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: `✅ Lanjut — Bayar QRIS`, callback_data: "cconfirm" }],
        [
          { text: "🛒 Ubah Keranjang", callback_data: "cart" },
          { text: "🏠 Menu", callback_data: "home" },
        ],
      ],
    },
  });
}

/**
 * Checkout gabungan: SATU order + SATU invoice QRIS untuk N baris keranjang.
 * Stok per varian direservasi atomik-per-baris (gagal satu baris = batal semua,
 * stok yang sudah terpotong dikembalikan). Fulfillment dibuat per item setelah
 * order terbit: satu job per varian via variant_id — pola sama seperti
 * single-item (createAndSendVariantInvoice) agar deliver.ts tidak berubah.
 */
async function createAndSendCartInvoice(
  chatId: number,
  lines: CartLine[],
  from: { id: number; first_name: string; username?: string },
) {
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  const orderCode = generateOrderCode();
  const items = lines.map((line) => ({
    product_id: line.productId,
    variant_id: line.variantId,
    name: `${line.productName} — ${line.variantLabel}`,
    price: line.price,
    qty: line.qty,
  }));
  // variant_snapshot order gabungan menyimpan ringkasan; mode fulfillment
  // per item dipertahankan di snapshot lines agar admin/grup tetap informatif.
  const variantSnapshot = JSON.stringify({
    cart: true,
    product_name: lines.length === 1 ? lines[0].productName : `${lines.length} item keranjang`,
    label: lines.map((line) => `${line.variantLabel} ×${line.qty}`).join(", "),
    price: subtotal,
    qty: lines.reduce((sum, line) => sum + line.qty, 0),
    fulfillment_mode: lines.every((line) => line.fulfillmentMode === "manual") ? "manual" : "mixed",
    lines: lines.map((line) => ({
      product_id: line.productId, variant_id: line.variantId,
      label: line.variantLabel, price: line.price, qty: line.qty,
      fulfillment_mode: line.fulfillmentMode,
    })),
  });
  const decremented: { variantId: number; qty: number }[] = [];
  const reservedInventory: string[] = [];
  let orderInserted = false;

  try {
    // Validasi shared secret per baris (fail-closed seperti single-item).
    if (isD1Mode()) {
      for (const line of lines) {
        if (line.fulfillmentMode !== "shared") continue;
        const configured = await queryFirst(
          `SELECT id FROM product_variants
           WHERE id=? AND product_id=?
             AND shared_secret_ciphertext IS NOT NULL AND shared_secret_iv IS NOT NULL`,
          line.variantId, line.productId,
        );
        if (!configured) {
          await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
          return;
        }
      }
    }

    // Reservasi inventory unik per baris (qty selalu 1 untuk unique).
    // Satu baris = satu secret: reserveInventoryForLines mengikat SATU unit
    // per baris ke order_code yang sama (issue #4), dan deliver.ts memilih
    // unit yang cocok per varian saat pengiriman tiap item.
    {
      const uniqueLines = lines.filter((line) => line.fulfillmentMode === "unique");
      if (uniqueLines.length > 0) {
        const { reserveInventoryForLines } = await import("@/lib/fulfillment/inventory");
        const reserved = await reserveInventoryForLines(
          uniqueLines.map((line) => ({ productId: line.productId, variantId: line.variantId })),
          orderCode,
        );
        if (reserved === null) {
          for (const code of reservedInventory) await releaseInventoryForOrder(code);
          await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
          return;
        }
        reservedInventory.push(orderCode);
      }
    }

    // Potong stok finite per baris; gagal satu = kembalikan semua.
    if (isD1Mode()) {
      for (const line of lines) {
        if (line.stock === -1) continue;
        const stockResult = await execRun(
          `UPDATE product_variants SET stock = stock - ?, updated_at = datetime('now')
           WHERE id=? AND is_active=1 AND stock >= ?`,
          line.qty, line.variantId, line.qty,
        );
        if (!stockResult.changes) {
          for (const done of decremented) {
            await execRun(
              `UPDATE product_variants SET stock=stock+?, updated_at=datetime('now')
               WHERE id=? AND stock!=-1`,
              done.qty, done.variantId,
            );
          }
          for (const code of reservedInventory) await releaseInventoryForOrder(code);
          await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
          return;
        }
        decremented.push({ variantId: line.variantId, qty: line.qty });
      }
    }

    await execRun(
      `INSERT INTO orders (code, customer_name, customer_wa, customer_email, items, subtotal,
         payment_method, payment_account, proof_url, status, sales_channel,
         telegram_chat_id, telegram_user_id, payment_status, fulfillment_status,
         variant_id, variant_snapshot, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      orderCode, from.first_name, "", null, JSON.stringify(items),
      subtotal, "qris", "DANA Business",
      null, "pending", "telegram",
      String(chatId), String(from.id), "pending",
      lines.every((line) => line.fulfillmentMode === "unique") ? "reserved" : "not_required",
      lines[0].variantId, variantSnapshot, new Date(Date.now() + 15 * 60_000).toISOString(),
    );
    orderInserted = true;

    const invoiceResult = await createDanaQrisInvoice(orderCode, subtotal);

    // Satu fulfillment job per order (UNIQUE order_code): mode = unique jika
    // ada baris unique (cuma 1 baris, dijaga addToCart), shared jika semua
    // shared, manual/mixed selebihnya. deliver.ts membaca snapshot + variant_id
    // utama lalu memproses sesuai mode — tidak berubah.
    const hasUnique = lines.some((line) => line.fulfillmentMode === "unique");
    const cartFulfillmentMode = hasUnique
      ? "unique"
      : lines.every((line) => line.fulfillmentMode === "shared")
        ? "shared"
        : lines.every((line) => line.fulfillmentMode === "manual")
          ? "manual"
          : "mixed";
    const primaryLine = lines.find((line) => line.fulfillmentMode === "unique") ?? lines[0];
    await createFulfillmentJob(
      orderCode,
      hasUnique ? null : null,
      cartFulfillmentMode === "mixed" ? "manual" : cartFulfillmentMode,
      primaryLine.variantId,
      "telegram",
    ).catch(() => null);
    await notifyTelegramOrderCreated(orderCode).catch(() => false);
    await clearCart(String(from.id));

    await sendPhoto({
      chat_id: chatId,
      photo: invoiceResult.qrisUrl,
      caption: invoiceMessage({
        orderCode,
        productName: lines.length === 1
          ? cartLineLabel(lines[0])
          : `Keranjang (${lines.length} item): ${lines.map((line) => `${line.variantLabel} ×${line.qty}`).join(", ")}`,
        payableAmount: invoiceResult.payableAmount,
        expiresAt: invoiceResult.expiresAt,
        paymentMethod: "qris",
      }),
      parse_mode: "HTML",
      reply_markup: qrisInvoiceKeyboard(orderCode),
    });
  } catch (error) {
    console.error("Cart order creation failed:", error instanceof Error ? error.message : "unknown");
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
        for (const done of decremented) {
          await execRun(
            `UPDATE product_variants SET stock=stock+?, updated_at=datetime('now')
             WHERE id=? AND stock!=-1`,
            done.qty, done.variantId,
          );
        }
        for (const code of reservedInventory) await releaseInventoryForOrder(code);
      }
    } catch { /* Cron/admin reconciliation can handle any remaining reservation. */ }
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
  }
}

// Bestsellers for the welcome landing (free marketing from sold_count).
async function getBestsellers(limit = 3): Promise<TelegramBestseller[]> {
  try {
    const rows = await queryAll(
      `SELECT p.id, p.name, COALESCE(MIN(pv.price), p.price) as price, p.sold_count
       FROM products p
       LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = 1
       WHERE p.is_active=1 AND p.telegram_enabled=1
       GROUP BY p.id
       ORDER BY p.sold_count DESC, p.sort_order ASC
       LIMIT ?`,
      limit,
    );
    return (rows as { id: number; name: string; price: number; sold_count: number }[])
      .filter((row) => Number(row.sold_count) > 0)
      .map((row) => ({
        productId: Number(row.id),
        name: String(row.name),
        price: Number(row.price),
        soldCount: Number(row.sold_count),
      }));
  } catch {
    return [];
  }
}

// --- /orders: real order history with reorder shortcuts ---

async function handleMyOrders(
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

async function handleSearchPrompt(
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

async function handlePendingSearchInput(
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

async function handleSearchResults(chatId: number, keyword: string) {
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
    }),
    parse_mode: "HTML",
    reply_markup: confirmVariantPurchaseKeyboard(productId, variantId),
  });
}

// --- Clear qty stepper followed directly by dynamic QRIS ---
// (Bulk cap lives in keyboards.ts as TELEGRAM_MAX_QTY.)

function clampQty(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(TELEGRAM_MAX_QTY, Math.floor(raw)));
}

async function handleShowQty(
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

async function handlePayWithQris(
  chatId: number,
  messageId: number,
  productId: number,
  variantId: number,
  rawQty: number,
  from: { id: number; first_name: string; username?: string },
) {
  await sendChatAction(chatId, "typing");
  await clearPendingAction(from);

  if (!isDanaQrisConfigured()) {
    await sendMessage({
      chat_id: chatId,
      text: "⚠️ QRIS dinamis sedang tidak tersedia. Coba lagi sebentar atau hubungi admin.",
      parse_mode: "HTML",
    });
    return;
  }

  const variant = await getActiveVariant(variantId);
  if (!variant || variant.product_id !== productId) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
    return;
  }
  const qty = clampQty(rawQty);
  if (variant.fulfillment_mode === "unique" && qty > 1) {
    await handleShowQty(chatId, messageId, productId, variantId, 1);
    return;
  }
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

  await createAndSendVariantInvoice(chatId, messageId, productId, String(product.name), variant, from, qty);
}

async function createAndSendVariantInvoice(
  chatId: number,
  _messageId: number,
  productId: number,
  productName: string,
  variant: VariantSummary,
  from: { id: number; first_name: string; username?: string },
  rawQty = 1,
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
      orderCode, from.first_name, "", null, JSON.stringify(items),
      subtotal, "qris", "DANA Business",
      null, "pending", "telegram",
      String(chatId), String(from.id), "pending",
      uniqueFulfillment ? "reserved" : "not_required",
      variant.id, variantSnapshot, new Date(Date.now() + 15 * 60_000).toISOString(),
    );
    orderInserted = true;

    const invoiceResult = await createDanaQrisInvoice(orderCode, subtotal);

    // Payment remains usable if the fulfillment outbox insert is temporarily
    // unavailable; ensureFulfillmentForPaidOrder recreates it after payment.
    await createFulfillmentJob(orderCode, inventoryId, fulfillmentMode, variant.id, "telegram").catch(() => null);
    await notifyTelegramOrderCreated(orderCode).catch(() => false);

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
      reply_markup: qrisInvoiceKeyboard(orderCode),
    });
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

async function handleWaInput(
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
