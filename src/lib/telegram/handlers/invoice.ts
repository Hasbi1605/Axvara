// src/lib/telegram/handlers/invoice.ts — Penerbitan invoice QRIS varian tunggal.
//
// MENGAPA dipisah: createAndSendVariantInvoice adalah fungsi transaksional
// paling kritis (JALUR UANG): reservasi stok atomik, penerbitan QRIS, job
// fulfillment, notifikasi, lalu pengiriman foto invoice dengan kompensasi
// fence (RR3-05/R4) bila gagal. Mengisolasinya dari router dan copy membuat
// invariannya (fence "hanya batalkan bila masih pending & unpaid", rethrow
// kegagalan foto untuk redelivery) mudah ditinjau. Pemindahan murni dari
// route.ts — SQL, urutan statement, dan teks IDENTIK.

import {
  queryFirst, execRun, isD1Mode, transitionPendingOrder, StockReservationError,
} from "@/lib/db";
import { sendMessage, sendPhoto, sendChatAction } from "@/lib/telegram/api";
import { orderStatusKeyboard, qrisInvoiceKeyboard } from "@/lib/telegram/keyboards";
import {
  outOfStockMessage, alreadyPendingMessage, errorMessage, invoiceMessage,
} from "@/lib/telegram/messages";
import { getActiveVariant, formatDuration, formatWarranty, type VariantSummary } from "@/lib/catalog";
import { isCriticalSendResult } from "@/lib/telegram/webhook-errors";
import { generateOrderCode } from "@/lib/security";
import { createDanaQrisInvoice, isDanaQrisConfigured } from "@/lib/payments/dana-qris";
import { releaseInventoryForOrder } from "@/lib/fulfillment/inventory";
import { createFulfillmentJob } from "@/lib/fulfillment/deliver";
import { notifyTelegramOrderCreated } from "@/lib/telegram/order-notifications";
import { markInvoicePending, markInvoiceSent } from "@/lib/telegram/invoice-retry";
import { createChannelOrderAtomic } from "@/lib/commerce";
import { clampQty, clearPendingAction } from "./shared";
import { handleShowQty } from "./catalog";

export async function handlePayWithQris(
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
  // RR3-05: kirim ulang foto invoice yang sama bila belum terkirim.
  const existingOrder = await queryFirst(
    `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending')
     AND variant_id=?`,
    String(chatId), variantId,
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

  await createAndSendVariantInvoice(chatId, messageId, productId, String(product.name), variant, from, qty);
}

export async function createAndSendVariantInvoice(
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

    // Reservasi stok, reservasi inventory unik, dan INSERT order dijalankan
    // sebagai SATU batch atomik (createChannelOrderAtomic). Sebelumnya ketiga
    // langkah ini adalah statement terpisah dengan rollback manual di catch:
    // aman untuk error yang dilempar, tetapi bila isolate dihentikan di tengah
    // (batas CPU/eviction) stok terpotong tanpa order — dan tidak ada yang
    // memulihkannya. Jalur Web dan WhatsApp sudah atomik sejak awal.
    try {
      await createChannelOrderAtomic({
        orderCode,
        lines: [{
          productId,
          variantId: variant.id,
          qty,
          fulfillmentMode,
          stock: Number(variant.stock),
        }],
        items,
        variantSnapshot,
        subtotal,
        primaryVariantId: variant.id,
        customerName: from.first_name,
        salesChannel: "telegram",
        telegramChatId: String(chatId),
        telegramUserId: String(from.id),
        paymentMethod: "qris",
        paymentAccount: "DANA Business",
        fulfillmentStatus: uniqueFulfillment ? "reserved" : "not_required",
      });
    } catch (reservationError) {
      // Guard gagal = stok/inventory habis saat commit. Batch dibatalkan
      // seluruhnya, jadi tidak ada yang perlu di-rollback manual.
      if (reservationError instanceof StockReservationError) {
        await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
        return;
      }
      throw reservationError;
    }
    orderInserted = true;
    finiteStockReserved = Number(variant.stock) !== -1;
    if (uniqueFulfillment) {
      // Inventory direservasi di dalam batch; id-nya dibaca kembali untuk
      // createFulfillmentJob (jalur cart memang sudah memakai null + pemilihan
      // per varian di deliver.ts).
      const reservedUnit = await queryFirst(
        `SELECT id FROM fulfillment_inventory
         WHERE order_code=? AND status='reserved' ORDER BY id ASC`,
        orderCode,
      ).catch(() => null);
      inventoryId = reservedUnit ? Number(reservedUnit.id) : null;
    }

    const invoiceResult = await createDanaQrisInvoice(orderCode, subtotal);

    // Payment remains usable if the fulfillment outbox insert is temporarily
    // unavailable; ensureFulfillmentForPaidOrder recreates it after payment.
    await createFulfillmentJob(orderCode, inventoryId, fulfillmentMode, variant.id, "telegram").catch(() => null);
    await notifyTelegramOrderCreated(orderCode).catch(() => false);

    // RR3-05: sama seperti jalur cart — foto invoice transaksional, periksa
    // {ok:false}, tandai pending/sent, lempar agar retry nyata + cron retry.
    await markInvoicePending(orderCode);
    const displayName = qty > 1 ? `${productName} — ${variant.label} ×${qty}` : `${productName} — ${variant.label}`;
    const variantPhoto = await sendPhoto({
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
    if (isCriticalSendResult(variantPhoto, "transactional")) {
      throw new Error(`telegram_invoice_send_failed:${variantPhoto.description || "unknown"}`);
    }
    await markInvoiceSent(orderCode);
  } catch (error) {
    console.error("Variant order creation failed:", error instanceof Error ? error.message : "unknown");
    // RR3-05: sama seperti jalur cart — kegagalan foto invoice = transient,
    // stok/reservasi dipertahankan, RETHROW agar retry nyata via redelivery
    // Telegram (guard double-tap memakai ulang order yang sama) + cron.
    const variantInvoiceFailed = error instanceof Error
      && error.message.startsWith("telegram_invoice_send_failed");
    try {
      if (orderInserted) {
        // Fence (review R4): hanya batalkan bila order masih pending &
        // unpaid — worker pembayaran lain mungkin sudah memproses.
        const fence = await queryFirst(
          `SELECT status, payment_status FROM orders WHERE code=?`,
          orderCode,
        ).catch(() => null) as { status?: unknown; payment_status?: unknown } | null;
        const stillPending = fence
          && String(fence.status) === "pending" && String(fence.payment_status) !== "paid";
        const transaction = stillPending ? await queryFirst(
          `SELECT id FROM payment_transactions WHERE order_code=?`,
          orderCode,
        ) : { id: 1 };
        if (!transaction) {
          await transitionPendingOrder(orderCode, "dibatalkan", "invoice_setup_failed", items);
        } else if (stillPending) {
          // RR3-05: invoice aktif (ledger pending) + foto gagal = JANGAN
          // lepas stok/reservasi — order masih hidup dan cron akan mengirim
          // ulang foto yang sama. Stok hanya dilepas bila TIDAK ada ledger
          // aktif (invoice memang gagal total). Kegagalan foto invoice
          // (telegram_invoice_send_failed) TIDAK melepas stok.
          const invoiceFailed = error instanceof Error
            && error.message.startsWith("telegram_invoice_send_failed");
          const activeLedger = invoiceFailed ? { id: 1 } : await queryFirst(
            `SELECT id FROM payment_transactions WHERE order_code=? AND status='pending'`,
            orderCode,
          ).catch(() => ({ id: 1 }));
          if (!activeLedger) {
            if (finiteStockReserved) {
              await execRun(
                `UPDATE product_variants SET stock=stock+?, updated_at=datetime('now')
                 WHERE id=? AND stock!=-1`,
                qty, variant.id,
              );
            }
            if (inventoryId) await releaseInventoryForOrder(orderCode);
          }
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
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" }).catch(() => {});
    // RR3-05: lempar ulang kegagalan foto invoice (lihat jalur cart).
    if (variantInvoiceFailed) throw error;
  }
}
