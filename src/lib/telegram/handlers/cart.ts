// src/lib/telegram/handlers/cart.ts — Keranjang multi-item (tampilan + checkout).
//
// MENGAPA dipisah: alur keranjang Telegram (tambah/ubah/hapus/ringkasan
// checkout) berdiri sendiri dari penjelajahan katalog dan dari penerbitan
// invoice-nya. Penerbitan invoice gabungan (createAndSendCartInvoice) yang
// panjang & transaksional tinggal di ./cart-invoice untuk menjaga file ini
// kecil; di-re-export di sini agar path impor pemanggil tidak berubah.
// Pemindahan murni dari route.ts — SQL, urutan statement, dan teks IDENTIK.

import { queryFirst, execRun } from "@/lib/db";
import { sendMessage, sendChatAction, safeEditOrSend } from "@/lib/telegram/api";
import { orderStatusKeyboard, cartKeyboard, minimalMenuKeyboard } from "@/lib/telegram/keyboards";
import {
  outOfStockMessage, alreadyPendingMessage, errorMessage,
  cartMessage, cartAddedMessage, cartCheckoutSummaryMessage,
} from "@/lib/telegram/messages";
import { tgCtxFor, tgUsdAlternate } from "@/lib/telegram/render-prefs";
import { isCriticalSendResult } from "@/lib/telegram/webhook-errors";
import { isActiveQrisConfigured } from "@/lib/payments/qris";
import { addToCart, setCartLineQty, removeFromCart, getCartSummary } from "@/lib/telegram/cart";
import { clearPendingAction, replaceWithText, type ScreenSourceMeta } from "./shared";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import { escapeHtml } from "@/lib/telegram/messages";

// Penerbitan invoice checkout gabungan hidup di modul terpisah agar file ini
// ringkas; re-export menjaga import lama (callback.ts) tetap `from "./cart"`.
export { createAndSendCartInvoice } from "./cart-invoice";

export async function handleShowCart(
  chatId: number,
  messageId: number,
  from?: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
) {
  const ctx = await tgCtxFor(from?.id ?? chatId);
  if (!from) {
    const missing = await sendMessage({ chat_id: chatId, text: errorMessage({ locale: ctx.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
    if (isCriticalSendResult(missing, "transactional")) throw new Error(`telegram_send_failed:${missing.description || "unknown"}`);
    return;
  }
  const summary = await getCartSummary(String(from.id));
  const keyboard = cartKeyboard({
    lines: summary.lines.map((line) => ({
      variantId: line.variantId, qty: line.qty, stock: line.stock, fulfillmentMode: line.fulfillmentMode,
      minQty: line.minQty, label: line.variantLabel || line.productName,
    })),
  }, { locale: ctx.locale });
  const text = cartMessage(summary.lines.map((line) => ({
    productName: line.productName, variantLabel: line.variantLabel, price: line.price, qty: line.qty,
    basePrice: line.basePrice, appliedTierMinQty: line.appliedTierMinQty,
  })), { locale: ctx.locale, ...tgUsdAlternate(summary.subtotal, ctx) }) + (summary.issues.length ? `\n\n${summary.issues.map(escapeHtml).join("\n")}` : "");
  // Review R5: hasil kirim transaksional {ok:false} TIDAK boleh markDone —
  // lempar agar update menjadi failed + 500 sehingga Telegram redelivery.
  // safeEditOrSend sudah fallback edit→send; yang dicek adalah hasil akhir.
  const sent = messageId > 0
    ? await replaceWithText({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", reply_markup: keyboard }, sourceMeta)
    : await sendMessage({ chat_id: chatId, text, parse_mode: "HTML", reply_markup: keyboard });
  if (isCriticalSendResult(sent, "transactional")) throw new Error(`telegram_send_failed:${sent.description || "unknown"}`);
}

export async function handleCartAdd(
  chatId: number,
  messageId: number,
  productId: number,
  variantId: number,
  qty: number,
  from: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
) {
  await sendChatAction(chatId, "typing");
  const ctx = await tgCtxFor(from.id);
  const { requestBuyerInput } = await import("./buyer-input");
  if (await requestBuyerInput(chatId,from,productId,variantId,qty)) return;
  const result = await addToCart(String(from.id), productId, variantId, qty);
  if (!result.ok) {
    // GSuite dkk: butuh min_qty agar pesan jelas ("min. 50"), bukan generik.
    let belowMinText: string | null = null;
    if (result.reason === "below_minimum") {
      try {
        const { getActiveVariant } = await import("@/lib/catalog");
        const failed = await getActiveVariant(variantId);
        const need = Math.max(1, Number(failed?.min_qty ?? 1) || 1);
        belowMinText = `Minimal pembelian ${need}. Ubah jumlah ke minimal ${need} sebelum menambahkan ke keranjang.`;
      } catch { /* fallback generik di bawah */ }
    }
    await sendMessage({
      chat_id: chatId,
      text: result.reason === "out_of_stock" ? outOfStockMessage({ locale: ctx.locale })
                : result.reason === "cart_full" ? (ctx.locale === "en" ? "Cart max 20 variants." : "Keranjang maks 20 varian.")
        : result.reason === "unique_limit" ? (ctx.locale === "en" ? "Max 10 unique-stock units per order." : "Maks 10 unit stok unik per pesanan.")
        : result.reason === "cart_changed" ? (ctx.locale === "en" ? "Cart or stock changed. Recheck cart." : "Keranjang/stok berubah. Cek ulang keranjang.")
        : result.reason === "invalid_quantity" ? (ctx.locale === "en" ? "Quantity must be 1–100." : "Jumlah harus 1–100.")
        : belowMinText ?? errorMessage({ locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return;
  }
  const summary = await getCartSummary(String(from.id));
  const added = summary.lines.find((line) => line.variantId === variantId);
  await replaceWithText({
    chat_id: chatId, message_id: messageId,
    text: cartAddedMessage(
      added?.productName ?? "Produk", added?.variantLabel ?? "", added?.qty ?? qty, summary.totalQty, { locale: ctx.locale },
    ) + (summary.issues.length ? `\n\n${summary.issues.map(escapeHtml).join("\n")}` : ""),
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: ctx.locale === "en" ? "View cart" : "Lihat keranjang", callback_data: "cart" }],
        [
          { text: ctx.locale === "en" ? "Continue shopping" : "Lanjut belanja", callback_data: "catalog:0" },
          { text: ctx.locale === "en" ? "Home" : "Menu", callback_data: "home" },
        ],
      ],
    },
  }, sourceMeta);
}

export async function handleCartAdjust(
  chatId: number,
  messageId: number,
  from: { id: number; first_name: string; username?: string },
  variantId: number,
  delta: number,
  sourceMeta?: ScreenSourceMeta,
) {
  const userId = String(from.id);
  const ctx = await tgCtxFor(from.id);
  if (delta === 0) {
    await removeFromCart(userId, variantId);
  } else {
    // AU-E2-8: the relative ±1 write happens BEFORE the cart screen render.
    // A transient failure rendering that screen makes the webhook update
    // retryable; redelivery must not apply the delta twice. The journal row is
    // written first (mutation boundary), so a duplicate delivery only re-renders.
    if (sourceMeta?.updateId && !(await claimCartMutation(sourceMeta.updateId))) {
      await handleShowCart(chatId, messageId, from, sourceMeta);
      return;
    }
    const ok = await setCartLineQty(userId, variantId, delta, true);
    if (!ok) {
      await sendMessage({ chat_id: chatId, text: ctx.locale === "en" ? "Cannot update quantity. Check min/max and stock." : "Jumlah tidak bisa diubah. Cek batas & stok.", parse_mode: "HTML" });
      await handleShowCart(chatId, messageId, from, sourceMeta);
      return;
    }
  }
  await handleShowCart(chatId, messageId, from, sourceMeta);
}

/** AU-E2-8: idempotency journal for one RELATIVE cart mutation per Telegram
 * update_id. `buyer_notice_log` is the existing durable ledger (retention by
 * created_at); returns false when this update already mutated the cart. */
async function claimCartMutation(updateId: string): Promise<boolean> {
  const res = await execRun(
    `INSERT INTO buyer_notice_log (idempotency_key, order_code, channel, status, error)
     VALUES (?, '', 'telegram', 'sent', 'cart_mutation') ON CONFLICT(idempotency_key) DO NOTHING`,
    `tg-cart:${updateId}`,
  );
  return Number(res.changes ?? 0) > 0;
}

export async function handleCartCheckout(
  chatId: number,
  messageId: number,
  from: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
) {
  await sendChatAction(chatId, "typing");
  const ctx = await tgCtxFor(from.id);
  // COMMON guard (creating-preserve): cart checkout never blanket-clears a
  // durable creating anchor (quoted stays clearable as before).
  {
    const { readPayq1State } = await import("@/lib/telegram/payment-quote");
    const storedCheckout = await readPayq1State(String(from.id)).catch(() => null);
    if (!storedCheckout?.state || storedCheckout.state.st !== "creating") {
      await clearPendingAction(from);
    }
  }

  // Guard double-tap: satu pending order Telegram per chat — checkout gabungan
  // tidak boleh menumpuk invoice aktif yang belum dibayar/dibatalkan.
  // RR3-05: bila foto invoice order ini belum terkirim, kirim ulang foto
  // yang SAMA (redelivery/cron-proof, tanpa order kedua).
  const existingOrder = await queryFirst(
    `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending') AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))`,
    String(chatId),
  );
  if (existingOrder) {
    try {
      const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
      await retryTelegramInvoiceDelivery(String(existingOrder.code)).catch(() => false);
    } catch { /* sapuan cron berikutnya */ }
    await sendMessage({
      chat_id: chatId,
      text: alreadyPendingMessage(String(existingOrder.code), { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: orderStatusKeyboard(String(existingOrder.code)),
    });
    return;
  }

  if (!isActiveQrisConfigured()) {
    await sendMessage({ chat_id: chatId, text: ctx.locale === "en" ? "QRIS payment is not available yet. Try again or contact admin." : "Pembayaran QRIS belum tersedia. Coba lagi atau hubungi admin.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
    return;
  }
  const summary = await getCartSummary(String(from.id));
  if (summary.issues.length > 0) {
    await sendMessage({ chat_id: chatId, text: summary.issues.map(escapeHtml).join("\n"), parse_mode: "HTML" });
    await handleShowCart(chatId, messageId, from);
    return;
  }
  if (summary.lines.length === 0) {
    await handleShowCart(chatId, messageId, from);
    return;
  }
  const approvalTag = await checkoutApprovalTag(summary.lines);

  await replaceWithText({
    chat_id: chatId, message_id: messageId,
    text: cartCheckoutSummaryMessage(summary.lines.map((line) => ({
      productName: line.productName, variantLabel: line.variantLabel, price: line.price, qty: line.qty,
      basePrice: line.basePrice, appliedTierMinQty: line.appliedTierMinQty,
    })), summary.subtotal, { locale: ctx.locale, ...tgUsdAlternate(summary.subtotal, ctx) }),
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: ctx.locale === "en" ? "💳 Continue to payment" : "💳 Lanjut ke pembayaran", callback_data: `cconfirm:${approvalTag}`, style: "success" }],
        [{ text: ctx.locale === "en" ? "💳 Other payment methods" : "💳 Metode pembayaran lain", callback_data: "pmentry" }],
        ...summary.lines.map(line => [{ text: `📋 ${ctx.locale === "en" ? "Terms" : "Ketentuan"} ${line.variantLabel.slice(0, 24)}`, callback_data: `terms:${line.productId}:${line.variantId}` }]),
        [
          { text: ctx.locale === "en" ? "Edit cart" : "Ubah keranjang", callback_data: "cart" },
          { text: ctx.locale === "en" ? "Home" : "Menu", callback_data: "home" },
        ],
      ],
    },
  }, sourceMeta);
}
