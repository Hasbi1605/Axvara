import { notifyPaymentMaintenance } from "@/lib/telegram/payment-maintenance";
import { queryFirst, getD1, transitionPendingOrder, OrderTransitionError } from "@/lib/db";
import { sendMessage, safeEditOrSend, sendPhoto } from "@/lib/telegram/api";
import { orderStatusKeyboard, paidOrderStatusKeyboard, qrisInvoiceKeyboard } from "@/lib/telegram/keyboards";
import {
  errorMessage, orderStatusMessage, invoiceMessage,
  orderCancelledMessage, qrisRenewRejectedMessage,
} from "@/lib/telegram/messages";
import { isCriticalSendResult } from "@/lib/telegram/webhook-errors";
import { reissueDanaQrisInvoice } from "@/lib/payments/dana-qris";
import { markInvoicePending, markInvoiceSent } from "@/lib/telegram/invoice-retry";

function orderItemsSummary(raw: unknown): string {
  try {
    const items = JSON.parse(String(raw ?? "[]"));
    if (Array.isArray(items) && items.length) {
      return items.map(item => `${String(item?.name || "Produk")} x${Math.max(1, Number(item?.qty) || 1)}`).join("\n");
    }
  } catch { /* Historical snapshots may be incomplete. */ }
  return "Produk";
}

async function ownedOrder(chatId: number, orderCode: string, fromUserId: number) {
  if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== fromUserId) return null;
  return queryFirst(
    `SELECT o.code, o.items, o.subtotal, o.payment_status, o.fulfillment_status, o.telegram_invoice_sent_at,
            pt.requested_amount, pt.payable_amount, pt.qris_url, pt.expires_at AS invoice_expires_at,
            pt.provider AS payment_provider, pt.status AS transaction_status
     FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
     WHERE o.code=? AND o.sales_channel='telegram' AND o.telegram_user_id=?`,
    String(orderCode || "").toUpperCase(), String(fromUserId),
  );
}

export async function handleOrderStatus(chatId: number, orderCode: string, fromUserId = chatId) {
  if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== fromUserId) return;
  let order;
  try {
    order = await ownedOrder(chatId, orderCode, fromUserId);
  } catch {
    await sendMessage({ chat_id: chatId, text: "Status pesanan gagal dibaca. Coba lagi.", parse_mode: "HTML" });
    return;
  }
  if (!order) {
    await sendMessage({
      chat_id: chatId,
      text: "❌ Pesanan tidak ditemukan. Pastikan kode pesanan benar.",
      parse_mode: "HTML",
    });
    return;
  }

  await sendMessage({
    chat_id: chatId,
    text: orderStatusMessage({
      orderCode: String(order.code),
      productName: orderItemsSummary(order.items),
      paymentStatus: String(order.payment_status || "unpaid"),
      fulfillmentStatus: String(order.fulfillment_status || "not_required"),
      payableAmount: Number(order.payable_amount ?? order.subtotal),
    }),
    parse_mode: "HTML",
    reply_markup: ["unpaid", "pending"].includes(String(order.payment_status))
      ? orderStatusKeyboard(String(order.code))
      : String(order.payment_status) === "paid"
        ? paidOrderStatusKeyboard(String(order.code))
        : undefined,
  });
}

export async function handleOrderRefresh(chatId: number, messageId: number, rawOrderCode: string, fromUserId = chatId) {
  if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== fromUserId) return;
  const orderCode = String(rawOrderCode || "").toUpperCase();
  let order;
  try {
    order = await ownedOrder(chatId, orderCode, fromUserId);
  } catch {
    await sendMessage({ chat_id: chatId, text: "Status pesanan gagal dibaca. Coba lagi.", parse_mode: "HTML" });
    return;
  }
  if (!order) {
    await sendMessage({ chat_id: chatId, text: "Pesanan tidak ditemukan. Pastikan kode pesanan benar.", parse_mode: "HTML" });
    return;
  }
  let checkFailed = false;
  let paymentNotice = "";
  // 2026-10-10: "Periksa Pembayaran" membangunkan poller GoPay di VPS (idle
  // 60 dtk) — pembayaran terbaca beberapa detik kemudian & bot mengabari.
  if (String(order.payment_provider ?? "") === "gopay" && String(order.transaction_status ?? "") === "pending") {
    const { scheduleGopayWake } = await import("@/lib/payments/gopay-wake");
    await scheduleGopayWake("telegram_check").catch(() => { checkFailed = true; });
  }

  if (order.payment_provider === "klikqris" && ["initializing", "pending"].includes(String(order.transaction_status))) {
    try {
      const { createKlikQrisInvoice, reconcileKlikQrisPayment } = await import("@/lib/payments/klikqris");
      if (order.transaction_status === "initializing") {
        // An existing initializing ledger recovers through GET, never a second create.
        await createKlikQrisInvoice(orderCode, Number(order.requested_amount));
      } else {
        const result = await reconcileKlikQrisPayment(orderCode);
        if (result === "manual_review") paymentNotice = "Pembayaran perlu diperiksa admin. Hubungi admin dengan kode pesanan ini.";
        if (result === "expired") paymentNotice = "QR pembayaran sudah kedaluwarsa. Cek status lagi atau hubungi admin.";
      }
    } catch { checkFailed = true; }
  }

  try {
    const refreshed = await ownedOrder(chatId, orderCode, fromUserId);
    if (!refreshed) throw new Error("order_missing");
    order = refreshed;
  } catch {
    await sendMessage({ chat_id: chatId, text: "Status terbaru gagal dibaca. Coba lagi.", parse_mode: "HTML" });
    return;
  }

  let invoiceFailed = false;
  if (order.payment_status === "pending" && order.transaction_status === "pending"
    && order.qris_url && !order.telegram_invoice_sent_at
    && Date.parse(String(order.invoice_expires_at)) > Date.now()) {
    try {
      const photo = await sendPhoto({
        chat_id: chatId,
        photo: String(order.qris_url),
        caption: invoiceMessage({
          orderCode,
          productName: orderItemsSummary(order.items),
          payableAmount: Number(order.payable_amount ?? order.subtotal),
          expiresAt: String(order.invoice_expires_at),
          paymentMethod: "qris",
        }),
        parse_mode: "HTML",
        reply_markup: qrisInvoiceKeyboard(orderCode),
      });
      if (!photo.ok) throw new Error("telegram_invoice_send_failed");
      await markInvoiceSent(orderCode);
    } catch { invoiceFailed = true; }
  }

  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: orderStatusMessage({
      orderCode: String(order.code),
      productName: orderItemsSummary(order.items),
      paymentStatus: String(order.payment_status || "unpaid"),
      fulfillmentStatus: String(order.fulfillment_status || "not_required"),
      payableAmount: Number(order.payable_amount ?? order.subtotal),
    }) + (paymentNotice && order.payment_status !== "paid" ? `\n\n${paymentNotice}` : "")
      + (checkFailed && order.payment_status !== "paid"
      ? "\n\nPemeriksaan pembayaran belum berhasil. Coba lagi atau hubungi admin."
      : "") + (invoiceFailed ? "\n\nQR pembayaran gagal dikirim. Cek status lagi atau hubungi admin." : ""),
    parse_mode: "HTML",
    reply_markup: ["unpaid", "pending"].includes(String(order.payment_status))
      ? orderStatusKeyboard(orderCode)
      : String(order.payment_status) === "paid"
        ? paidOrderStatusKeyboard(orderCode)
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
    if (await notifyPaymentMaintenance(chatId)) return;
  const orderCode = String(rawOrderCode || "").toUpperCase();
  if (!orderCode) return;

  const order = await queryFirst(
    `SELECT items, buyer_access_version,buyer_access_format FROM orders WHERE code=? AND sales_channel='telegram'`,
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
  if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== from.id) return;
  orderCode = String(orderCode || "").toUpperCase();
  let order;
  try {
    order = await queryFirst(
      `SELECT code, telegram_user_id, items FROM orders WHERE code=? AND sales_channel='telegram'
       AND status='pending' AND payment_status IN ('unpaid','pending')`,
      orderCode,
    );
  } catch {
    await sendMessage({ chat_id: chatId, text: "Pesanan gagal dibaca. Coba lagi.", parse_mode: "HTML" });
    return;
  }
  if (!order) {
    await sendMessage({ chat_id: chatId, text: "❌ Pesanan tidak dapat dibatalkan.", parse_mode: "HTML" });
    return;
  }

  // Only the owner can cancel
  if (String(order.telegram_user_id) !== String(from.id)) {
    await sendMessage({ chat_id: chatId, text: "❌ Kamu tidak bisa membatalkan pesanan orang lain.", parse_mode: "HTML" });
    return;
  }

  try {
    const items = JSON.parse(String(order.items));
    if (!Array.isArray(items) || !items.length || items.some(item =>
      !item || !Number.isSafeInteger(item.product_id) || item.product_id <= 0
      || !Number.isSafeInteger(item.qty) || item.qty <= 0
      || (item.variant_id != null && (!Number.isSafeInteger(item.variant_id) || item.variant_id <= 0)))) {
      throw new Error("invalid_order_items");
    }
    const d1 = getD1();
    if (!d1) throw new Error("cancellation_requires_d1");
    const guardId = `${orderCode}:telegram-cancel:${crypto.randomUUID()}`;
    // Extend the existing stock/inventory transition batch, not a second commit.
    await transitionPendingOrder(orderCode, "dibatalkan", "buyer_cancel", items, {
      prepare: query => d1.prepare(query),
      batch: statements => d1.batch([
        d1.prepare(`INSERT INTO operation_guards(operation_id,valid) SELECT ?,CASE WHEN EXISTS(
          SELECT 1 FROM orders WHERE code=? AND sales_channel='telegram' AND telegram_user_id=?
          AND status='pending' AND payment_status IN ('unpaid','pending'))
          AND NOT EXISTS(SELECT 1 FROM payment_transactions WHERE order_code=?
            AND status NOT IN ('initializing','pending','unpaid','expired','failed','cancelled')) THEN 1 ELSE 0 END`)
          .bind(guardId, orderCode, String(from.id), orderCode),
        ...statements,
        d1.prepare(`UPDATE payment_transactions SET status='cancelled', updated_at=datetime('now')
          WHERE order_code=? AND status IN ('initializing','pending','unpaid','expired')`).bind(orderCode),
        d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guardId),
      ]),
    });
  } catch (error) {
    await sendMessage({
      chat_id: chatId,
      text: error instanceof OrderTransitionError
        ? "Pesanan tidak dapat dibatalkan karena statusnya sudah berubah. Cek status terbaru."
        : "Pembatalan gagal dikonfirmasi. Cek status lalu coba lagi.",
      parse_mode: "HTML",
      reply_markup: orderStatusKeyboard(orderCode),
    });
    return;
  }

  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: orderCancelledMessage(orderCode),
    parse_mode: "HTML",
  });
}
