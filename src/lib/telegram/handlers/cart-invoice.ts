import { notifyPaymentMaintenance } from "@/lib/telegram/payment-maintenance";
// src/lib/telegram/handlers/cart-invoice.ts — Penerbitan invoice checkout gabungan.
//
// MENGAPA dipisah dari cart.ts: createAndSendCartInvoice adalah SATU fungsi
// transaksional panjang (JALUR UANG) dengan invarian sensitif (reservasi
// atomik N baris, SATU order + SATU invoice, fence kompensasi RR3-05). Memisah
// handler tampilan keranjang (cart.ts) dari penerbitan invoice-nya menjaga tiap
// file tetap kecil dan menonjolkan bahwa fungsi ini yang memegang uang.
// Pemindahan murni — SQL, urutan statement, teks, dan fence IDENTIK.

import {
  queryFirst, getD1, isD1Mode, transitionPendingOrder, StockReservationError,
} from "@/lib/db";
import { sendMessage, sendPhoto } from "@/lib/telegram/api";
import { qrisInvoiceKeyboard, minimalMenuKeyboard } from "@/lib/telegram/keyboards";
import { outOfStockMessage, errorMessage, invoiceMessage } from "@/lib/telegram/messages";
import { isCriticalSendResult } from "@/lib/telegram/webhook-errors";
import { generateOrderCode } from "@/lib/security";
import { createActiveQrisInvoice, qrisPaymentAccountLabel } from "@/lib/payments/dana-qris";
import { createFulfillmentJob } from "@/lib/fulfillment/deliver";
// Tanpa notif "Order Baru" ke admin (keputusan owner 2026-10-10, paritas Web
// 2026-09-25): hanya "Lunas — Telegram" yang masuk grup.
import { markInvoicePending, markInvoiceSent, isAmbiguousSendResult, settleAmbiguousInvoiceSend, claimProviderInvoiceSend, releaseInvoiceSendClaim } from "@/lib/telegram/invoice-retry";
import { createChannelOrderAtomic } from "@/lib/commerce";
import { trackFunnelEvent } from "@/lib/analytics/funnel";
import { activeQrisProvider } from "@/lib/payments/dana-qris";
import { clearCart, type CartLine } from "@/lib/telegram/cart";
import { invoiceItemName } from "@/lib/telegram/messages/format";
import { readCheckoutEmail } from "@/lib/telegram/checkout-email";

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
  emailSnapshot?: string | null,
) {
  if (await notifyPaymentMaintenance(chatId)) return;
  // TG2b: subtotal konsisten dari harga EFEKTIF per baris (cart.ts sudah
  // memakai agregat per varian); items + snapshot menyimpan base + tier.
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  const orderCode = generateOrderCode();
  const items = lines.map((line) => ({
    product_id: line.productId,
    variant_id: line.variantId,
    name: `${line.productName} — ${line.variantLabel}`,
    price: line.price,
    base_price: line.basePrice,
    ...(line.appliedTierMinQty != null ? { applied_tier_min_qty: line.appliedTierMinQty } : {}),
    buyer_field_key:line.buyerFieldKey ?? null,max_qty:line.maxQty ?? null,buyer_fields:line.buyerFields,
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
      label: line.variantLabel, price: line.price,
      base_price: line.basePrice,
      ...(line.appliedTierMinQty != null ? { applied_tier_min_qty: line.appliedTierMinQty } : {}),
      qty: line.qty,
      fulfillment_mode: line.fulfillmentMode,
    })),
  });
  let orderInserted = false;
  let invoiceCreated = false;
  // TG2c1: locale order untuk caption/keyboard di try DAN catch.
  let cartLocale: "id" | "en" = "id";

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
          await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
          return;
        }
      }
    }

    // Reservasi inventory unik + potong stok per baris + INSERT order kini
    // SATU batch atomik. Sebelumnya ini tiga tahap terpisah dengan kompensasi
    // manual per baris (loop `decremented` mengembalikan stok satu per satu):
    // benar untuk error yang dilempar, tetapi bila isolate dihentikan di
    // tengah loop, sebagian stok terpotong permanen tanpa order.
    // TG2b: locale immutable dari prefs pemilik yang disimpan.
    // TG2c1: dipakai ulang untuk caption/keyboard di catch.
    const { required, email: cartBuyerEmail } = await readCheckoutEmail(String(from.id), lines, emailSnapshot);
    if (required && !cartBuyerEmail) {
      await sendMessage({ chat_id: chatId, text: "Email aktif dibutuhkan sebelum membuat tagihan.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
      return;
    }
    const { readTgPreferences: readCartLocale } = await import("@/lib/telegram/preferences");
    cartLocale = (await readCartLocale(String(from.id)).catch(() => ({ locale: null }))).locale === "en" ? "en" as const : "id" as const;
    try {
      const created = await createChannelOrderAtomic({
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
        locale: cartLocale,
        primaryVariantId: lines[0].variantId,
        customerName: from.first_name,
        customerEmail: cartBuyerEmail,
        salesChannel: "telegram",
        telegramChatId: String(chatId),
        telegramUserId: String(from.id),
        paymentMethod: "qris",
        paymentAccount: qrisPaymentAccountLabel(),
        fulfillmentStatus: lines.every((line) => line.fulfillmentMode === "unique")
          ? "reserved"
          : "not_required",
      });
      if (created.isExisting) {
        // The concurrent winner owns invoice creation and all compensation.
        // A loser only links to that order, never uses its newly generated code.
        await sendMessage({ chat_id: chatId, text: `Masih ada pesanan menunggu pembayaran: ${created.code}. Gunakan tagihan yang sama.`, parse_mode: "HTML", reply_markup: qrisInvoiceKeyboard(created.code) });
        return;
      }
    } catch (reservationError) {
      if (reservationError instanceof StockReservationError) {
        await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
        return;
      }
      throw reservationError;
    }
    orderInserted = true;
    trackFunnelEvent({ stage: "order", channel: "telegram", productId: lines[0]?.productId, variantId: lines[0]?.variantId,
      subtotal, quantity: lines.reduce((sum, line) => sum + line.qty, 0), locale: cartLocale, method: `qris:${activeQrisProvider()}` });

    const invoiceResult = await createActiveQrisInvoice(orderCode, subtotal);
    invoiceCreated = true;

    // Satu fulfillment job per order (UNIQUE order_code): mode = unique jika
    // ada baris unique, shared jika semua
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
    // (Tanpa notifyTelegramOrderCreated — hanya notif Lunas, lihat impor.)
    await clearCart(String(from.id), lines);

    // RR3-05: foto invoice adalah pengiriman transaksional — hasilnya WAJIB
    // diperiksa sesuai kontrak provider {ok:false}. Tandai pending SEBELUM
    // kirim; tandai terkirim HANYA bila {ok:true}. Gagal kirim = lempar
    // agar update menjadi failed + 500 (Telegram redelivery) dan cron
    // menyapu invoice pending via retryTelegramInvoiceDelivery — order,
    // invoice, reservasi, dan stok yang sama dipertahankan (tanpa order
    // kedua, tanpa potong stok ulang).
    await markInvoicePending(orderCode);
    // AU-E2-2: klaim atomik sebelum sendPhoto (CAS attempts yang sama dengan
    // teks provider) — retry cron/Refresh yang membaca marker yang sama menunggu.
    if (await claimProviderInvoiceSend(orderCode, { allowFresh: true }) !== "claimed") {
      throw new Error("telegram_invoice_send_failed:not_claimed");
    }
    const cartPhoto = await sendPhoto({
      chat_id: chatId,
      photo: invoiceResult.qrisUrl,
      caption: invoiceMessage({
        orderCode,
        productName: lines.map(line => invoiceItemName(line.productName, line.variantLabel, line.qty)).join("\n"),
        payableAmount: invoiceResult.payableAmount,
        expiresAt: invoiceResult.expiresAt,
        paymentMethod: "qris",
      }, { locale: cartLocale, chargeNote: true }),
      parse_mode: "HTML",
      reply_markup: qrisInvoiceKeyboard(orderCode, { locale: cartLocale }),
    });
    if (isAmbiguousSendResult(cartPhoto)) {
      // Timeout/jaringan: foto mungkin tetap mendarat — jangan lempar
      // (redelivery/cron akan menggandakan QRIS). Tutup dengan teks cadangan.
      await settleAmbiguousInvoiceSend(chatId, orderCode, invoiceResult.qrisUrl);
      return;
    }
    if (isCriticalSendResult(cartPhoto, "transactional")) {
      // Definitif: lepas stempel klaim agar redelivery/Refresh boleh langsung.
      await releaseInvoiceSendClaim(orderCode);
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
    let preserveReservation = invoiceCreated || (error instanceof Error && /ambiguous|network|timeout/i.test(error.message));
    try {
      if (orderInserted) {
        const transaction = await queryFirst(
          `SELECT id FROM payment_transactions WHERE order_code=?`,
          orderCode,
        ).catch(() => ({ id: 1 }));
        preserveReservation ||= Boolean(transaction);
        if (!preserveReservation) {
          const d1 = getD1();
          if (!d1) throw new Error("cart_rollback_requires_d1");
          const guardId = `${orderCode}:cart-rollback:${crypto.randomUUID()}`;
          // Invoice absence and pending/unpaid must hold in the stock-release batch.
          await transitionPendingOrder(orderCode, "dibatalkan", "invoice_setup_failed", items, {
            prepare: query => d1.prepare(query),
            batch: statements => d1.batch([
              d1.prepare(`INSERT INTO operation_guards(operation_id,valid)
                SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM payment_transactions WHERE order_code=?) THEN 1 ELSE 0 END`)
                .bind(guardId, orderCode),
              ...statements,
              d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guardId),
            ]),
          });
        }
      }
    } catch { preserveReservation = true; }
    await sendMessage({
      chat_id: chatId,
      text: orderInserted && preserveReservation
        ? (cartLocale === "en"
          ? `Invoice cannot be confirmed yet. Order code: ${orderCode}. Use Check Status for the same invoice; do not create a new order.`
          : `Tagihan belum bisa dikonfirmasi. Kode pesanan: ${orderCode}. Gunakan Cek status untuk memeriksa tagihan yang sama, jangan buat pesanan baru.`)
        : errorMessage({ locale: cartLocale }),
      parse_mode: "HTML",
      ...(orderInserted && preserveReservation
        ? { reply_markup: qrisInvoiceKeyboard(orderCode, { locale: cartLocale }) }
        : { reply_markup: minimalMenuKeyboard({ locale: cartLocale }) }),
    }).catch(() => {});
    // RR3-05: lempar ulang kegagalan foto invoice agar lapis POST menjawab
    // 500 + failed (retry Telegram nyata + sapuan cron). BUKAN dari awal:
    // guard double-tap memakai ulang order/invoice yang sama.
    if (cartInvoiceFailed || invoiceCreated) throw error;
  }
}
