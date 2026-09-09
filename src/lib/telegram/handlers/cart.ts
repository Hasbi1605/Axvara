// src/lib/telegram/handlers/cart.ts — Keranjang multi-item (tampilan + checkout).
//
// MENGAPA dipisah: alur keranjang Telegram (tambah/ubah/hapus/ringkasan
// checkout) berdiri sendiri dari penjelajahan katalog dan dari penerbitan
// invoice-nya. Penerbitan invoice gabungan (createAndSendCartInvoice) yang
// panjang & transaksional tinggal di ./cart-invoice untuk menjaga file ini
// kecil; di-re-export di sini agar path impor pemanggil tidak berubah.
// Pemindahan murni dari route.ts — SQL, urutan statement, dan teks IDENTIK.

import { queryFirst } from "@/lib/db";
import { sendMessage, sendChatAction, safeEditOrSend } from "@/lib/telegram/api";
import { orderStatusKeyboard, cartKeyboard } from "@/lib/telegram/keyboards";
import {
  outOfStockMessage, alreadyPendingMessage, errorMessage,
  cartMessage, cartAddedMessage, cartCheckoutSummaryMessage,
} from "@/lib/telegram/messages";
import { isCriticalSendResult } from "@/lib/telegram/webhook-errors";
import { isDanaQrisConfigured } from "@/lib/payments/dana-qris";
import { addToCart, setCartLineQty, removeFromCart, getCartSummary } from "@/lib/telegram/cart";
import { clearPendingAction } from "./shared";

// Penerbitan invoice checkout gabungan hidup di modul terpisah agar file ini
// ringkas; re-export menjaga import lama (callback.ts) tetap `from "./cart"`.
export { createAndSendCartInvoice } from "./cart-invoice";

export async function handleShowCart(
  chatId: number,
  messageId: number,
  from?: { id: number; first_name: string; username?: string },
) {
  if (!from) {
    const missing = await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
    if (isCriticalSendResult(missing, "transactional")) throw new Error(`telegram_send_failed:${missing.description || "unknown"}`);
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
  // Review R5: hasil kirim transaksional {ok:false} TIDAK boleh markDone —
  // lempar agar update menjadi failed + 500 sehingga Telegram redelivery.
  // safeEditOrSend sudah fallback edit→send; yang dicek adalah hasil akhir.
  const sent = messageId > 0
    ? await safeEditOrSend({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", reply_markup: keyboard })
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

export async function handleCartAdjust(
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

export async function handleCartCheckout(
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
  // RR3-05: bila foto invoice order ini belum terkirim, kirim ulang foto
  // yang SAMA (redelivery/cron-proof, tanpa order kedua).
  const existingOrder = await queryFirst(
    `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending')`,
    String(chatId),
  );
  if (existingOrder) {
    try {
      const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
      await retryTelegramInvoiceDelivery(String(existingOrder.code)).catch(() => false);
    } catch { /* sapuan cron berikutnya */ }
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
