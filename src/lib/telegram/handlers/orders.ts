// src/lib/telegram/handlers/orders.ts — Handler status & siklus hidup pesanan.
//
// MENGAPA dipisah: status/refresh/pembatalan/perpanjang QRIS adalah aksi atas
// order yang SUDAH ada. handleOrderCancel berisi cek kepemilikan sendiri (lapis
// kedua setelah guard ownerBound di router) — nilai keamanan yang harus jelas.
// Pemindahan murni dari route.ts — SQL, urutan statement, dan teks identik.

import { queryFirst, execRun } from "@/lib/db";
import { sendMessage, safeEditOrSend, sendPhoto } from "@/lib/telegram/api";
import { orderStatusKeyboard, qrisInvoiceKeyboard } from "@/lib/telegram/keyboards";
import {
  errorMessage, orderStatusMessage, invoiceMessage,
  orderCancelledMessage, qrisRenewRejectedMessage,
} from "@/lib/telegram/messages";
import { isCriticalSendResult } from "@/lib/telegram/webhook-errors";
import { reissueDanaQrisInvoice } from "@/lib/payments/dana-qris";
import { releaseInventoryForOrder } from "@/lib/fulfillment/inventory";
import { markInvoicePending, markInvoiceSent } from "@/lib/telegram/invoice-retry";

export async function handleOrderStatus(chatId: number, orderCode: string) {
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

export async function handleOrderRefresh(chatId: number, messageId: number, orderCode: string) {
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

/**
 * Kirim QRIS BARU untuk order yang masih hidup tetapi QR-nya sudah mati.
 *
 * Kepemilikan sudah diverifikasi di handleCallback (action "qrenew" masuk
 * ownerBound), jadi di sini cukup urusan penerbitan + pengiriman foto.
 * Reissue bersifat idempoten dari sisi pembeli: bila QR lama masih berlaku,
 * `reissueDanaQrisInvoice` menolak dengan `invoice_still_active` dan pembeli
 * diberi tahu untuk memakai QR yang sedang tampil.
 */
export async function handleQrisRenew(chatId: number, rawOrderCode: string) {
  const orderCode = String(rawOrderCode || "").toUpperCase();
  if (!orderCode) return;

  const order = await queryFirst(
    `SELECT items FROM orders WHERE code=? AND sales_channel='telegram'`,
    orderCode,
  ).catch(() => null);
  if (!order) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
    return;
  }

  let result: Awaited<ReturnType<typeof reissueDanaQrisInvoice>>;
  try {
    result = await reissueDanaQrisInvoice(orderCode);
  } catch (error) {
    console.error("Telegram QRIS renew failed:", error instanceof Error ? error.message : "unknown");
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" });
    return;
  }

  if (!result.ok) {
    await sendMessage({
      chat_id: chatId,
      text: qrisRenewRejectedMessage(result.reason),
      parse_mode: "HTML",
    });
    return;
  }

  // Nama produk dibaca ulang dari snapshot order, bukan dari memori request
  // lama, agar caption selalu cocok dengan apa yang benar-benar dipesan.
  let productLabel = "Pesanan";
  try {
    const items = JSON.parse(String(order.items ?? "[]")) as { name?: string; qty?: number }[];
    if (Array.isArray(items) && items.length === 1) {
      productLabel = String(items[0]?.name ?? "Pesanan");
    } else if (Array.isArray(items) && items.length > 1) {
      productLabel = `Keranjang (${items.length} item): ${items
        .map((item) => `${String(item.name ?? "Item")} ×${Number(item.qty ?? 1)}`)
        .join(", ")}`;
    }
  } catch { /* label fallback sudah aman */ }

  const photo = await sendPhoto({
    chat_id: chatId,
    photo: result.invoice.qrisUrl,
    caption: invoiceMessage({
      orderCode,
      productName: productLabel,
      payableAmount: result.invoice.payableAmount,
      expiresAt: result.invoice.expiresAt,
      paymentMethod: "qris",
    }),
    parse_mode: "HTML",
    reply_markup: qrisInvoiceKeyboard(orderCode),
  });
  if (isCriticalSendResult(photo, "transactional")) {
    // Ledger sudah diperbarui; foto gagal = lempar agar Telegram redelivery
    // dan cron menyapu invoice pending lewat jalur retry yang sudah ada.
    await markInvoicePending(orderCode);
    throw new Error(`telegram_invoice_send_failed:${photo.description || "unknown"}`);
  }
  await markInvoiceSent(orderCode);
}

export async function handleOrderCancel(chatId: number, messageId: number, orderCode: string, from: { id: number }) {
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
