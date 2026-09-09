// src/lib/telegram/handlers/cart-invoice.ts — Penerbitan invoice checkout gabungan.
//
// MENGAPA dipisah dari cart.ts: createAndSendCartInvoice adalah SATU fungsi
// transaksional panjang (JALUR UANG) dengan invarian sensitif (reservasi
// atomik N baris, SATU order + SATU invoice, fence kompensasi RR3-05). Memisah
// handler tampilan keranjang (cart.ts) dari penerbitan invoice-nya menjaga tiap
// file tetap kecil dan menonjolkan bahwa fungsi ini yang memegang uang.
// Pemindahan murni — SQL, urutan statement, teks, dan fence IDENTIK.

import {
  queryFirst, execRun, isD1Mode, transitionPendingOrder, StockReservationError,
} from "@/lib/db";
import { sendMessage, sendPhoto } from "@/lib/telegram/api";
import { qrisInvoiceKeyboard } from "@/lib/telegram/keyboards";
import { outOfStockMessage, errorMessage, invoiceMessage } from "@/lib/telegram/messages";
import { isCriticalSendResult } from "@/lib/telegram/webhook-errors";
import { generateOrderCode } from "@/lib/security";
import { createDanaQrisInvoice } from "@/lib/payments/dana-qris";
import { releaseInventoryForOrder } from "@/lib/fulfillment/inventory";
import { createFulfillmentJob } from "@/lib/fulfillment/deliver";
import { notifyTelegramOrderCreated } from "@/lib/telegram/order-notifications";
import { markInvoicePending, markInvoiceSent } from "@/lib/telegram/invoice-retry";
import { createChannelOrderAtomic } from "@/lib/commerce";
import { clearCart, type CartLine } from "@/lib/telegram/cart";
import { cartLineLabel } from "./shared";

/**
 * Checkout gabungan: SATU order + SATU invoice QRIS untuk N baris keranjang.
 * Stok per varian direservasi atomik-per-baris (gagal satu baris = batal semua,
 * stok yang sudah terpotong dikembalikan). Fulfillment dibuat per item setelah
 * order terbit: satu job per varian via variant_id — pola sama seperti
 * single-item (createAndSendVariantInvoice) agar deliver.ts tidak berubah.
 */
export async function createAndSendCartInvoice(
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

    // Reservasi inventory unik + potong stok per baris + INSERT order kini
    // SATU batch atomik. Sebelumnya ini tiga tahap terpisah dengan kompensasi
    // manual per baris (loop `decremented` mengembalikan stok satu per satu):
    // benar untuk error yang dilempar, tetapi bila isolate dihentikan di
    // tengah loop, sebagian stok terpotong permanen tanpa order.
    const uniqueLineCount = lines.filter((line) => line.fulfillmentMode === "unique").length;
    try {
      await createChannelOrderAtomic({
        orderCode,
        lines: lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          qty: line.qty,
          fulfillmentMode: line.fulfillmentMode,
          stock: Number(line.stock),
        })),
        items,
        variantSnapshot,
        subtotal,
        primaryVariantId: lines[0].variantId,
        customerName: from.first_name,
        salesChannel: "telegram",
        telegramChatId: String(chatId),
        telegramUserId: String(from.id),
        paymentMethod: "qris",
        paymentAccount: "DANA Business",
        fulfillmentStatus: lines.every((line) => line.fulfillmentMode === "unique")
          ? "reserved"
          : "not_required",
      });
    } catch (reservationError) {
      if (reservationError instanceof StockReservationError) {
        await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML" });
        return;
      }
      throw reservationError;
    }
    orderInserted = true;
    if (uniqueLineCount > 0) reservedInventory.push(orderCode);
    for (const line of lines) {
      if (Number(line.stock) === -1) continue;
      decremented.push({ variantId: line.variantId, qty: line.qty });
    }

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

    // RR3-05: foto invoice adalah pengiriman transaksional — hasilnya WAJIB
    // diperiksa sesuai kontrak provider {ok:false}. Tandai pending SEBELUM
    // kirim; tandai terkirim HANYA bila {ok:true}. Gagal kirim = lempar
    // agar update menjadi failed + 500 (Telegram redelivery) dan cron
    // menyapu invoice pending via retryTelegramInvoiceDelivery — order,
    // invoice, reservasi, dan stok yang sama dipertahankan (tanpa order
    // kedua, tanpa potong stok ulang).
    await markInvoicePending(orderCode);
    const cartPhoto = await sendPhoto({
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
    if (isCriticalSendResult(cartPhoto, "transactional")) {
      throw new Error(`telegram_invoice_send_failed:${cartPhoto.description || "unknown"}`);
    }
    await markInvoiceSent(orderCode);
  } catch (error) {
    console.error("Cart order creation failed:", error instanceof Error ? error.message : "unknown");
    // RR3-05: kegagalan FOTO invoice (order + ledger + stok sudah benar,
    // hanya foto tak sampai) = error TRANSIENT yang wajib retry nyata.
    // Stok/reservasi dipertahankan (lihat fence di bawah), lalu RETHROW
    // agar update menjadi failed + 500 → Telegram redelivery memakai ulang
    // order yang sama via guard double-tap (TIDAK membuat order kedua).
    // Kegagalan lain (stok habis, invoice gagal total) tetap pola lama:
    // pesan error + done (tidak layak retry Telegram).
    const cartInvoiceFailed = error instanceof Error
      && error.message.startsWith("telegram_invoice_send_failed");
    try {
      if (orderInserted) {
        // Fence: jangan batalkan order yang mungkin sudah dibayar/diproses
        // worker lain — hanya batalkan bila masih pending & unpaid.
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
          // Order tercatat tapi invoice gagal dan belum dibayar: lepas
          // reservasi agar tidak terkunci; cron/admin rekonsiliasi bila
          // pembayaran datang belakangan (order tetap pending + payable).
          // RR3-05: pengecualian — kegagalan FOTO invoice
          // (telegram_invoice_send_failed) dengan ledger aktif = order
          // masih hidup, cron kirim ulang foto yang sama → stok/reservasi
          // DIPERTAHANKAN (satu order, potong sekali).
          const invoiceFailed = error instanceof Error
            && error.message.startsWith("telegram_invoice_send_failed");
          if (!invoiceFailed) {
            for (const done of decremented) {
              await execRun(
                `UPDATE product_variants SET stock=stock+?, updated_at=datetime('now')
                 WHERE id=? AND stock!=-1`,
                done.qty, done.variantId,
              );
            }
            for (const code of reservedInventory) await releaseInventoryForOrder(code);
          }
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
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" }).catch(() => {});
    // RR3-05: lempar ulang kegagalan foto invoice agar lapis POST menjawab
    // 500 + failed (retry Telegram nyata + sapuan cron). BUKAN dari awal:
    // guard double-tap memakai ulang order/invoice yang sama.
    if (cartInvoiceFailed) throw error;
  }
}
