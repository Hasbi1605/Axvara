import { MAX_UNIQUE_UNITS_PER_ORDER } from "@/lib/fulfillment/units";
import { notifyPaymentMaintenance } from "@/lib/telegram/payment-maintenance";
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
  queryFirst, execRun, getD1, isD1Mode, transitionPendingOrder, StockReservationError,
} from "@/lib/db";
import { sendMessage, sendPhoto, sendChatAction } from "@/lib/telegram/api";
import { orderStatusKeyboard, qrisInvoiceKeyboard, minimalMenuKeyboard, otherMethodsEntryKeyboard } from "@/lib/telegram/keyboards";
import {
  outOfStockMessage, alreadyPendingMessage, errorMessage, invoiceMessage,
} from "@/lib/telegram/messages";
import { invoiceItemName } from "@/lib/telegram/messages/format";
import { getActiveVariant, formatDuration, formatVariantLabel, buyerWarrantyLabel, effectiveVariantStock, type VariantSummary } from "@/lib/catalog";
import { isCriticalSendResult } from "@/lib/telegram/webhook-errors";
import { generateOrderCode } from "@/lib/security";
import { createActiveQrisInvoice, isActiveQrisConfigured, qrisPaymentAccountLabel } from "@/lib/payments/dana-qris";
import { createFulfillmentJob } from "@/lib/fulfillment/deliver";
// Tanpa notif "Order Baru" ke admin (keputusan owner 2026-10-10, paritas Web
// 2026-09-25): grup Axvara_Notif hanya menerima "Lunas — Telegram" saat order
// lunas (notifyTelegramPaidAdmin via jalur paid). Order yang tidak jadi bayar
// tidak membunyikan grup.
import { markInvoicePending, markInvoiceSent, isAmbiguousSendResult, settleAmbiguousInvoiceSend, claimProviderInvoiceSend, releaseInvoiceSendClaim } from "@/lib/telegram/invoice-retry";
import { createChannelOrderAtomic } from "@/lib/commerce";
import { trackFunnelEvent } from "@/lib/analytics/funnel";
import { activeQrisProvider } from "@/lib/payments/dana-qris";
import { clampQty, clearPendingAction } from "./shared";
import { handleShowQty } from "./catalog";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import { readCheckoutEmail } from "@/lib/telegram/checkout-email";
import { paymentMethodNoticeMessage } from "@/lib/telegram/messages/purchase";

export async function handlePayWithQris(
  chatId: number,
  messageId: number,
  productId: number,
  variantId: number,
  rawQty: number,
  from: { id: number; first_name: string; username?: string },
  emailConfirmed = false,
  approvalTag?: string,
  confirmedEmail?: string,
) {
  if (await notifyPaymentMaintenance(chatId)) return;
  const { requestBuyerInput } = await import("./buyer-input");
  if (await requestBuyerInput(chatId,from,productId,variantId,rawQty)) return;
  await sendChatAction(chatId, "typing");
  // Legacy QRIS rail NEVER borrows new-method payq1 state: pending winner
  // preserves the existing rail. A quoted payq1 row stays untouched here —
  // the QRIS path owns the email_confirm namespace only.
  const prePayq1 = isD1Mode()
    ? await queryFirst(`SELECT pending_action FROM telegram_users WHERE user_id=?`, String(from.id)).catch(() => null)
    : null;
  const hasNewMethodDraft = prePayq1?.pending_action != null && String(prePayq1.pending_action).startsWith("payq1:");
  if (!emailConfirmed && !hasNewMethodDraft) await clearPendingAction(from);

  const existingOrder = await queryFirst(
    `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending') AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))
     ORDER BY CASE WHEN variant_id=? THEN 0 ELSE 1 END, id DESC LIMIT 1`,
    String(chatId), variantId,
  );
  if (existingOrder) {
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    await retryTelegramInvoiceDelivery(String(existingOrder.code)).catch(() => false);
    await sendMessage({
      chat_id: chatId,
      text: alreadyPendingMessage(String(existingOrder.code)),
      parse_mode: "HTML",
      reply_markup: orderStatusKeyboard(String(existingOrder.code)),
    });
    return;
  }

  // Gate rail aktif: DANA atau GoPay, mana pun yang terkonfigurasi.
  if (!isActiveQrisConfigured()) {
    await sendMessage({
      chat_id: chatId,
      text: "Pembayaran QRIS belum tersedia. Coba lagi atau hubungi admin.",
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard(),
    });
    return;
  }

  const variant = await getActiveVariant(variantId);
  if (!variant || variant.product_id !== productId) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
    return;
  }
  variant.stock = effectiveVariantStock(variant);
  const qty = clampQty(rawQty);
  if (variant.fulfillment_mode === "unique" && qty > MAX_UNIQUE_UNITS_PER_ORDER) {
    await handleShowQty(chatId, messageId, productId, variantId, MAX_UNIQUE_UNITS_PER_ORDER);
    return;
  }
  // Minimum pembelian per varian (migrasi 0034, generik — GSuite min 50):
  // tolak SEBELUM invoice dengan pesan jelas, bukan diam-diam menaikkan.
  const minQty = Math.max(1, Number(variant.min_qty ?? 1) || 1);
  if (minQty > 1 && qty < minQty) {
    await sendMessage({
      chat_id: chatId,
      text: `Minimal pembelian ${minQty}. Ubah jumlah ke minimal ${minQty} sebelum membayar.`,
      parse_mode: "HTML",
    });
    await handleShowQty(chatId, messageId, productId, variantId, minQty);
    return;
  }
  // TG2b: harga efektif server dari bulk config aktif (bukan klaim tombol).
  // Harga effective dipin di sini lalu dijaga approvalTag; guard atomik
  // createChannelOrderAtomic memverifikasi ulang sebelum INSERT.
  let effectivePrice = Number(variant.price);
  let appliedTier: number | null = null;
  try {
    const { resolveBulkPrice } = await import("@/lib/bulk-pricing");
    const resolved = resolveBulkPrice(Number(variant.price), qty, variant.bulk_pricing_enabled ? 1 : 0, JSON.stringify(variant.bulk_pricing_tiers ?? []));
    effectivePrice = resolved.price;
    appliedTier = resolved.tier ?? null;
  } catch {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
    return;
  }
  const currentTag = await checkoutApprovalTag([{ productId, variantId, qty, price: effectivePrice }]);
  if (!approvalTag || approvalTag !== currentTag) {
    if (approvalTag) console.warn("[telegram-checkout] rejected", { method: "qris", variantId, reason: "price_or_approval_changed" });
    await handleShowQty(chatId, messageId, productId, variantId, qty);
    return;
  }
  let buyerEmail: string | null;
  try {
    const checkoutEmail = await readCheckoutEmail(String(from.id), [{ productId, variantId }], emailConfirmed ? confirmedEmail : undefined);
    buyerEmail = checkoutEmail.email;
    if (checkoutEmail.required || emailConfirmed) {
      if (!buyerEmail) {
        if (isD1Mode()) {
          await execRun(
            `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=?`,
            `email_for:${productId}:${variantId}:${qty}`,
            String(from.id),
          );
        }
        await sendMessage({
          chat_id: chatId,
          text: [
            "Email dibutuhkan untuk mengirim produk ini.",
            "Balas dengan email aktif, contoh: <code>nama@email.com</code>.",
            "Ketik /batal untuk membatalkan.",
          ].join("\n"),
          parse_mode: "HTML",
          reply_markup: { force_reply: true, selective: true, input_field_placeholder: "nama@email.com" },
        });
        return;
      }
      if (!emailConfirmed || !confirmedEmail) {
        const { showEmailConfirmation } = await import("./discovery");
        await showEmailConfirmation(chatId, productId, variantId, qty, buyerEmail, null, messageId);
        return;
      }
    }
  } catch {
    await sendMessage({ chat_id: chatId, text: "Email belum bisa diperiksa. Coba lagi sebelum membayar.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
    return;
  }
  if (variant.stock === 0 || (variant.stock !== -1 && variant.stock < qty)) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage(), parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
    return;
  }

  const product = await queryFirst(`SELECT id, name FROM products WHERE id=?`, productId);
  if (!product) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
    return;
  }

  await createAndSendVariantInvoice(chatId, messageId, productId, String(product.name), variant, from, qty, buyerEmail);
}

export { handlePayWithQris as handleVariantPay };

export async function createAndSendVariantInvoice(
  chatId: number,
  _messageId: number,
  productId: number,
  productName: string,
  variant: VariantSummary,
  from: { id: number; first_name: string; username?: string },
  rawQty = 1,
  emailSnapshot?: string | null,
  effectivePrice?: number,
  appliedTierMinQty?: number | null,
) {
  const qty = clampQty(rawQty);
  // TG2b: harga efektif server dari bulk config aktif (bukan klaim tombol).
  // Pemanggil display (handleShowQty) boleh meneruskan harga yang sudah
  // dihitung dari snapshot varian yang sama; handler invoice menghitung
  // ulang ke harga efektif final SEBELUM tag/callback agar tombol basi
  // dengan qty berbeda tidak dipakai.
  let price: number;
  let appliedSingleTier: number | null;
  if (effectivePrice !== undefined) {
    if (!Number.isSafeInteger(effectivePrice) || effectivePrice < 0) {
      await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
      return;
    }
    price = effectivePrice;
    appliedSingleTier = appliedTierMinQty ?? null;
  } else {
    try {
      const { resolveBulkPrice: resolveInvoiceBulk } = await import("@/lib/bulk-pricing");
      const resolvedInvoice = resolveInvoiceBulk(Number(variant.price), qty, variant.bulk_pricing_enabled ? 1 : 0, JSON.stringify(variant.bulk_pricing_tiers ?? []));
      price = resolvedInvoice.price;
      appliedSingleTier = resolvedInvoice.tier ?? null;
    } catch {
      await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
      return;
    }
  }
  const subtotal = price * qty;
  const fulfillmentMode = String(variant.fulfillment_mode || "manual");
  const uniqueFulfillment = fulfillmentMode === "unique";
  const orderCode = generateOrderCode();
  const itemVariantLabel = formatVariantLabel(variant);
  const items = [{
    product_id: productId,
    variant_id: variant.id,
    name: `${productName} — ${itemVariantLabel}`,
    price,
    base_price: Number(variant.price),
    buyer_field_key: variant.buyer_field_key ?? null,
    max_qty: variant.max_qty ?? null,
    ...(appliedSingleTier != null ? { applied_tier_min_qty: appliedSingleTier } : {}),
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
    warranty_label: buyerWarrantyLabel(variant),
    price,
    base_price: Number(variant.price),
    ...(appliedSingleTier != null ? { applied_tier_min_qty: appliedSingleTier } : {}),
    qty,
    fulfillment_mode: fulfillmentMode,
  });
  let inventoryId: number | null = null;
  let orderInserted = false;
  let invoiceCreated = false;
  // TG2c1: locale order untuk caption/keyboard di try DAN catch.
  let invoiceLocale: "id" | "en" = "id";

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
        await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
        return;
      }
    }

    // Reservasi stok, reservasi inventory unik, dan INSERT order dijalankan
    // sebagai SATU batch atomik (createChannelOrderAtomic). Sebelumnya ketiga
    // langkah ini adalah statement terpisah dengan rollback manual di catch:
    // aman untuk error yang dilempar, tetapi bila isolate dihentikan di tengah
    // (batas CPU/eviction) stok terpotong tanpa order — dan tidak ada yang
    // memulihkannya. Jalur Web dan WhatsApp sudah atomik sejak awal.
    // TG2b: locale immutable dari prefs pemilik yang disimpan.
    // TG2c1: dipakai ulang untuk caption/keyboard invoice error di catch.
    const { readTgPreferences } = await import("@/lib/telegram/preferences");
    invoiceLocale = (await readTgPreferences(String(from.id)).catch(() => ({ locale: null }))).locale === "en" ? "en" as const : "id" as const;
    const tgLocale = invoiceLocale;
    try {
      const { required, email: buyerEmail } = await readCheckoutEmail(String(from.id), [{ productId, variantId: variant.id }], emailSnapshot);
      if (required && !buyerEmail) {
        await sendMessage({ chat_id: chatId, text: "Email aktif dibutuhkan sebelum membuat tagihan.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
        return;
      }
      const created = await createChannelOrderAtomic({
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
        locale: tgLocale,
        primaryVariantId: variant.id,
        customerName: from.first_name,
        customerEmail: buyerEmail,
        salesChannel: "telegram",
        telegramChatId: String(chatId),
        telegramUserId: String(from.id),
        paymentMethod: "qris",
        paymentAccount: qrisPaymentAccountLabel(),
        fulfillmentStatus: uniqueFulfillment ? "reserved" : "not_required",
      });
      if (created.isExisting) {
        // The concurrent winner owns invoice creation and all compensation.
        // A loser only links to that order, never uses its newly generated code.
        await sendMessage({ chat_id: chatId, text: `Masih ada pesanan menunggu pembayaran: ${created.code}. Gunakan tagihan yang sama.`, parse_mode: "HTML", reply_markup: qrisInvoiceKeyboard(created.code) });
        return;
      }
    } catch (reservationError) {
      // The batch rolls back on any guard failure, not just depleted stock.
      if (reservationError instanceof StockReservationError) {
        const reason = reservationError.reason;
        console.warn("[telegram-checkout] rejected", { method: "qris", variantId: variant.id, reason });
        const outOfStock = reason === "stock";
        await sendMessage({ chat_id: chatId,
          text: outOfStock ? outOfStockMessage({ locale: tgLocale }) : paymentMethodNoticeMessage("catalog_changed", { locale: tgLocale }),
          parse_mode: "HTML",
          reply_markup: outOfStock ? minimalMenuKeyboard({ locale: tgLocale }) : otherMethodsEntryKeyboard({
            locale: tgLocale, source: { kind: "single", productId, variantId: variant.id, qty },
            tag: await checkoutApprovalTag([{ productId, variantId: variant.id, qty, price }]),
          }),
        });
        return;
      }
      throw reservationError;
    }
    orderInserted = true;
    trackFunnelEvent({ stage: "order", channel: "telegram", productId, variantId: variant.id,
      subtotal, quantity: qty, locale: tgLocale, method: `qris:${activeQrisProvider()}` });
    if (uniqueFulfillment) {
      // Inventory direservasi di dalam batch; id-nya dibaca kembali untuk
      // createFulfillmentJob (jalur cart memang sudah memakai null + pemilihan
      // per varian di deliver.ts).
      const reservedUnit = await queryFirst(
        `SELECT id FROM fulfillment_inventory
         WHERE order_code=? AND status='reserved' ORDER BY COALESCE(sort_order,id), id ASC`,
        orderCode,
      ).catch(() => null);
      inventoryId = reservedUnit ? Number(reservedUnit.id) : null;
    }

    const invoiceResult = await createActiveQrisInvoice(orderCode, subtotal);
    invoiceCreated = true;

    // Payment remains usable if the fulfillment outbox insert is temporarily
    // unavailable; ensureFulfillmentForPaidOrder recreates it after payment.
    // (Tanpa notifyTelegramOrderCreated — hanya notif Lunas, lihat impor.)
    await createFulfillmentJob(orderCode, inventoryId, fulfillmentMode, variant.id, "telegram").catch(() => null);

    // RR3-05: sama seperti jalur cart — foto invoice transaksional, periksa
    // {ok:false}, tandai pending/sent, lempar agar retry nyata + cron retry.
    // TG2c1: caption + keyboard mengikuti locale order yang baru dibuat.
    // AU-E2-2: klaim atomik sebelum kirim (CAS attempts yang sama dengan teks
    // provider) agar cron retry/Refresh tidak mengirim bubble kedua.
    await markInvoicePending(orderCode);
    if (await claimProviderInvoiceSend(orderCode, { allowFresh: true }) !== "claimed") {
      throw new Error("telegram_invoice_send_failed:not_claimed");
    }
    const tgVariantLabel = formatVariantLabel(variant, tgLocale);
    const displayName = invoiceItemName(productName, tgVariantLabel, qty);
    const variantPhoto = await sendPhoto({
      chat_id: chatId,
      photo: invoiceResult.qrisUrl,
      caption: invoiceMessage({
        orderCode,
        productName: displayName,
        payableAmount: invoiceResult.payableAmount,
        expiresAt: invoiceResult.expiresAt,
        paymentMethod: "qris",
      }, { locale: tgLocale, chargeNote: true }),
      parse_mode: "HTML",
      reply_markup: qrisInvoiceKeyboard(orderCode, { locale: tgLocale }),
    });
    if (isAmbiguousSendResult(variantPhoto)) {
      // Timeout/jaringan: foto mungkin tetap mendarat — jangan lempar
      // (redelivery/cron akan menggandakan QRIS). Tutup dengan teks cadangan.
      await settleAmbiguousInvoiceSend(chatId, orderCode, invoiceResult.qrisUrl);
      return;
    }
    if (isCriticalSendResult(variantPhoto, "transactional")) {
      // Definitif (ada error_code): lepas stempel klaim agar redelivery/Refresh
      // boleh langsung mengirim ulang foto yang sama.
      await releaseInvoiceSendClaim(orderCode);
      throw new Error(`telegram_invoice_send_failed:${variantPhoto.description || "unknown"}`);
    }
    await markInvoiceSent(orderCode);
  } catch (error) {
    console.error("Variant order creation failed:", error instanceof Error ? error.message : "unknown");
    if (error instanceof Error && error.message.startsWith("klikqris_")) {
      const initializing = await queryFirst("SELECT id FROM payment_transactions WHERE order_code=? AND provider='klikqris' AND status IN ('initializing','pending')", orderCode).catch(() => ({ id: 1 }));
      if (initializing) {
        await sendMessage({ chat_id: chatId, text: `Tagihan belum tersedia. Kode pesanan: ${orderCode}. Gunakan Cek status untuk memeriksa tagihan yang sama, jangan buat pesanan baru.`, parse_mode: "HTML", reply_markup: qrisInvoiceKeyboard(orderCode) }).catch(() => {});
        return;
      }
    }
    // RR3-05: sama seperti jalur cart — kegagalan foto invoice = transient,
    // stok/reservasi dipertahankan, RETHROW agar retry nyata via redelivery
    // Telegram (guard double-tap memakai ulang order yang sama) + cron.
    const variantInvoiceFailed = error instanceof Error
      && error.message.startsWith("telegram_invoice_send_failed");
    let preserveReservation = invoiceCreated || (error instanceof Error && /ambiguous|network|timeout/i.test(error.message));
    try {
      if (orderInserted) {
        const transaction = await queryFirst("SELECT id FROM payment_transactions WHERE order_code=?", orderCode)
          .catch(() => ({ id: 1 }));
        preserveReservation ||= Boolean(transaction);
        if (!preserveReservation) {
          const d1 = getD1();
          if (!d1) throw new Error("variant_rollback_requires_d1");
          const guardId = `${orderCode}:variant-rollback:${crypto.randomUUID()}`;
          // Invoice absence must still hold in the same batch as stock release.
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
        ? (invoiceLocale === "en"
          ? `Invoice cannot be confirmed yet. Order code: ${orderCode}. Use Check Status for the same invoice; do not create a new order.`
          : `Tagihan belum bisa dikonfirmasi. Kode pesanan: ${orderCode}. Gunakan Cek status untuk memeriksa tagihan yang sama, jangan buat pesanan baru.`)
        : errorMessage({ locale: invoiceLocale }),
      parse_mode: "HTML",
      ...(orderInserted && preserveReservation
        ? { reply_markup: qrisInvoiceKeyboard(orderCode, { locale: invoiceLocale }) }
        : { reply_markup: minimalMenuKeyboard({ locale: invoiceLocale }) }),
    }).catch(() => {});
    // RR3-05: lempar ulang kegagalan foto invoice (lihat jalur cart).
    if (variantInvoiceFailed || invoiceCreated) throw error;
  }
}
