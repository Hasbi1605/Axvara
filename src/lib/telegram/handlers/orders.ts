import { notifyPaymentMaintenance } from "@/lib/telegram/payment-maintenance";
import { queryFirst, getD1, transitionPendingOrder, OrderTransitionError } from "@/lib/db";
import { sendMessage, safeEditOrSend, sendPhoto } from "@/lib/telegram/api";
import { orderStatusKeyboard, paidOrderStatusKeyboard, qrisInvoiceKeyboard, orderTerminalKeyboard, minimalMenuKeyboard } from "@/lib/telegram/keyboards";
import {
  errorMessage, orderStatusMessage, invoiceMessage,
  orderCancelledMessage, qrisRenewRejectedMessage,
} from "@/lib/telegram/messages";
import type { Locale } from "@/lib/i18n/locale";
import type { InlineKeyboardMarkup, InlineKeyboardButton } from "@/lib/telegram/types";
import { isCriticalSendResult } from "@/lib/telegram/webhook-errors";
import { reissueDanaQrisInvoice } from "@/lib/payments/dana-qris";
import { markInvoicePending, markInvoiceSent, isAmbiguousSendResult, settleAmbiguousInvoiceSend, claimProviderInvoiceSend, releaseInvoiceSendClaim } from "@/lib/telegram/invoice-retry";
import { SITE } from "@/lib/site";
import { marketWarrantyClaim, marketWarrantyClaimEn, warrantyClaimRules } from "@/lib/warranty-policy";
import { escapeHtml, invoiceItemSummary } from "@/lib/telegram/messages/format";

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
    `SELECT o.code, o.items, o.subtotal, o.locale, o.payment_status, o.fulfillment_status, o.telegram_invoice_sent_at,
            o.created_at, o.paid_at, o.status, o.order_kind, o.payment_method,
            pt.requested_amount, pt.payable_amount, pt.qris_url, pt.expires_at AS invoice_expires_at,
            pt.provider AS payment_provider, pt.status AS transaction_status
     FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
     WHERE o.code=? AND o.sales_channel='telegram' AND o.telegram_user_id=?`,
    String(orderCode || "").toUpperCase(), String(fromUserId),
  );
}

/** TG2c1: bahasa transaksi mengikuti locale order yang tersimpan (ID legacy
 * bila kosong), bukan preferensi saat ini. */
export function orderLocaleOf(row?: { locale?: unknown } | null): Locale {
  return String(row?.locale ?? "") === "en" ? "en" : "id";
}

const WIB_MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Tanggal/jam WIB ringkas dari timestamp D1 (`YYYY-MM-DD HH:MM:SS`, UTC). */
export function wibDateTimeText(value: unknown, locale: Locale): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const ms = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text)
    ? Date.parse(text.replace(" ", "T") + "Z")
    : Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  const wib = new Date(ms + 7 * 3600_000);
  const day = wib.getUTCDate();
  const month = WIB_MONTHS[wib.getUTCMonth()];
  const year = wib.getUTCFullYear();
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  void locale;
  return `${day} ${month} ${year} • ${hh}:${mm} WIB`;
}

export type WarrantySummary = { line: string | null; claimEligible: boolean };

/**
 * Sisa garansi dari snapshot `market_refund_items` (sumber kanonik web/admin).
 * Baris tanpa snapshot / tanpa garansi dihilangkan, bukan ditebak.
 */
export async function orderWarrantySummary(order: {
  code: string; status?: unknown; payment_status?: unknown; subtotal?: unknown;
}, locale: Locale): Promise<WarrantySummary> {
  if (String(order.status ?? "") !== "lunas" || String(order.payment_status ?? "") !== "paid") {
    return { line: null, claimEligible: false };
  }
  let estimate;
  try {
    const { createDatabaseAccess } = await import("@/lib/db-access");
    const { readEstimate } = await import("@/lib/refund/server");
    estimate = await readEstimate(createDatabaseAccess(), {
      code: order.code, status: order.status, payment_status: order.payment_status, subtotal: order.subtotal,
    });
  } catch {
    return { line: null, claimEligible: false };
  }
  if (!estimate || estimate.state !== "ready" || !estimate.lines.length) return { line: null, claimEligible: false };
  const en = locale === "en";
  const warranted = estimate.lines.filter(line => line.status !== "no_warranty");
  if (!warranted.length) return { line: null, claimEligible: false };
  const waiting = warranted.some(line => line.status === "waiting");
  if (waiting) {
    return { line: en ? "🛡 Warranty: awaiting handover" : "🛡 Garansi: Menunggu serah terima", claimEligible: false };
  }
  const active = warranted.filter(line => line.status === "ready" && line.remaining != null && line.remaining > 0);
  if (active.length) {
    const longest = Math.max(...active.map(line => Number(line.remaining)));
    const days = Math.max(1, Math.ceil(longest / 86400));
    // One claim per order is active while at least one line's warranty is live.
    return { line: en ? `🛡 Warranty left: ${days} day(s)` : `🛡 Sisa garansi: ${days} hari`, claimEligible: true };
  }
  const ended = warranted.every(line => ["warranty_ended", "ended", "review"].includes(line.status));
  return { line: ended ? (en ? "🛡 Warranty period ended" : "🛡 Masa garansi habis") : null, claimEligible: false };
}

function appendLines(text: string, lines: (string | null)[], separator = "\n"): string {
  const extra = lines.filter((line): line is string => Boolean(line && line.trim()));
  return extra.length ? `${text}${separator}${extra.join(separator)}` : text;
}

export async function handleOrderStatus(chatId: number, orderCode: string, fromUserId = chatId) {
  if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== fromUserId) return;
  let order;
  try {
    order = await ownedOrder(chatId, orderCode, fromUserId);
  } catch {
    await sendMessage({ chat_id: chatId, text: "Status pesanan gagal dibaca. Coba lagi.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
    return;
  }

  if (!order) {
    await sendMessage({
      chat_id: chatId,
      text: "❌ Pesanan tidak ditemukan. Pastikan kode pesanan benar.",
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard(),
    });
    return;
  }
  // R2 provider-aware routing: new-rail created orders render via their own
  // provider view (saved-locale); QRIS keeps legacy status. Status commands
  // have no message context (plain send), refresh passes its messageId.
  const rail = String(order.payment_method ?? "");
  if (String(order.payment_provider ?? "") === "sekalipay_gateway" || rail.startsWith("sekalipay_gateway:")) {
    const from = { id: fromUserId, first_name: "" };
    const { showProviderInvoiceStatus } = await import("./payment-status");
    await showProviderInvoiceStatus(chatId, 0, String(order.code), from, { locale: orderLocaleOf(order) });
    return;
  }
  if (String(order.payment_provider ?? "") === "nowpayments" || rail.startsWith("nowpayments:")) {
    const from = { id: fromUserId, first_name: "" };
    const { showProviderInvoiceStatus } = await import("./payment-status");
    await showProviderInvoiceStatus(chatId, 0, String(order.code), from, { locale: orderLocaleOf(order) });
    return;
  }

  const locale = orderLocaleOf(order);

  // Item 11: date + paid date + warranty remaining, rendered above the
  // existing total/status footer.
  const createdText = wibDateTimeText(order.created_at, locale);
  const paidText = wibDateTimeText(order.paid_at, locale);
  const warranty = await orderWarrantySummary({
    code: String(order.code), status: order.status, payment_status: order.payment_status, subtotal: order.subtotal,
  }, locale);
  const dateLines = locale === "en"
    ? [
        createdText ? `🗓 Ordered: ${createdText}` : null,
        paidText ? `✅ Paid: ${paidText}` : null,
        warranty.line,
      ]
    : [
        createdText ? `🗓 Dibuat: ${createdText}` : null,
        paidText ? `✅ Lunas: ${paidText}` : null,
        warranty.line,
      ];
  const baseText = orderStatusMessage({
    orderCode: String(order.code),
    productName: orderItemsSummary(order.items),
    paymentStatus: String(order.payment_status || "unpaid"),
    fulfillmentStatus: String(order.fulfillment_status || "not_required"),
    payableAmount: Number(order.payable_amount ?? order.subtotal),
  }, { locale });

  const paid = String(order.payment_status) === "paid";
  const claimEligible = paid && warranty.claimEligible;
  await sendMessage({
    chat_id: chatId,
    text: appendLines(baseText, dateLines),
    parse_mode: "HTML",
    reply_markup: paid
      ? ordersDetailKeyboard(String(order.code), { locale, claimEligible })
      : ["unpaid", "pending"].includes(String(order.payment_status))
        ? orderStatusKeyboard(String(order.code), { locale })
        : orderTerminalKeyboard({ locale }),
  });
}

/** Order-detail keyboard (local builder; keyboards.ts belongs to W-A). Keeps
 * the existing "Ambil Ulang Produk" CTA and adds a warranty-claim row only
 * while the paid order's warranty is still active. */
export function ordersDetailKeyboard(orderCode: string, opts: { locale?: Locale; claimEligible?: boolean }): InlineKeyboardMarkup {
  const en = opts.locale === "en";
  const base = paidOrderStatusKeyboard(orderCode, { locale: opts.locale }).inline_keyboard;
  if (!opts.claimEligible) return { inline_keyboard: base };
  const claimRow: InlineKeyboardButton[] = [
    { text: en ? "🛡 Warranty Claim" : "🛡 Klaim Garansi", callback_data: `claim:${orderCode}` },
  ];
  // Insert the claim CTA right after the "Ambil Ulang Produk" row (index 0).
  return { inline_keyboard: [base[0], claimRow, ...base.slice(1)] };
}

export async function handleOrderRefresh(chatId: number, messageId: number, rawOrderCode: string, fromUserId = chatId) {
  if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== fromUserId) return;
  const orderCode = String(rawOrderCode || "").toUpperCase();
  let order;
  try {
    order = await ownedOrder(chatId, orderCode, fromUserId);
  } catch {
    await sendMessage({ chat_id: chatId, text: "Status pesanan gagal dibaca. Coba lagi.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
    return;
  }
  if (!order) {
    await sendMessage({ chat_id: chatId, text: "Pesanan tidak ditemukan. Pastikan kode pesanan benar.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
    return;
  }
  // R2 status/cancel for new rails uses the SAME native guards as QRIS:
  // paid/canceled/expired orders keep their terminal render; cancel below
  // reuses handleOrderCancel (no rail-specific cancel rewrite).
  // Immediate provider branches (R2 safety): new-rail created orders
  // refresh via their own reconcile+view — no generic QRIS fallback/photos
  // for new rails (forged qrenew on crypto/gateway MUST NOT issue QRIS).
  // Payment-method fallback covers paid-consented TX rows whose provider
  // column predates the new-rail columns (order.method is durable).
  const refreshRail = String((order as { payment_method?: unknown }).payment_method ?? "");
  if (String(order.payment_provider ?? "") === "sekalipay_gateway" || refreshRail.startsWith("sekalipay_gateway:")) {
    const from = { id: fromUserId, first_name: "" };
    const { showProviderInvoiceStatus } = await import("./payment-status");
    await showProviderInvoiceStatus(chatId, messageId, orderCode, from, { locale: orderLocaleOf(order) });
    return;
  }
  if (String(order.payment_provider ?? "") === "nowpayments" || refreshRail.startsWith("nowpayments:")) {
    const from = { id: fromUserId, first_name: "" };
    const { showProviderInvoiceStatus } = await import("./payment-status");
    await showProviderInvoiceStatus(chatId, messageId, orderCode, from, { locale: orderLocaleOf(order) });
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
    await sendMessage({ chat_id: chatId, text: "Status terbaru gagal dibaca. Coba lagi.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
    return;
  }

  let invoiceFailed = false;
  const locale = orderLocaleOf(order);
  if (order.payment_status === "pending" && order.transaction_status === "pending"
    && order.qris_url && !order.telegram_invoice_sent_at
    && Date.parse(String(order.invoice_expires_at)) > Date.now()) {
    try {
      // AU-E2-2: Refresh tidak boleh bersaing dengan cron retry untuk foto yang
      // sama — klaim atomik dulu; "busy" berarti pengirim lain memegangnya.
      const claim = await claimProviderInvoiceSend(orderCode, { allowFresh: true });
      if (claim === "claimed") {
        const photo = await sendPhoto({
          chat_id: chatId,
          photo: String(order.qris_url),
          caption: invoiceMessage({
            orderCode,
            productName: invoiceItemSummary(order.items, locale === "en"),
            payableAmount: Number(order.payable_amount ?? order.subtotal),
            expiresAt: String(order.invoice_expires_at),
            paymentMethod: "qris",
          }, { locale, chargeNote: true }),
          parse_mode: "HTML",
          reply_markup: qrisInvoiceKeyboard(orderCode, { locale }),
        });
        // Timeout/jaringan = foto mungkin tetap mendarat; tandai terkirim
        // agar Cek Pembayaran/cron tidak menggandakan QRIS.
        if (!photo.ok && !isAmbiguousSendResult(photo)) {
          // Definitif: lepas stempel klaim agar tap berikutnya boleh langsung.
          await releaseInvoiceSendClaim(orderCode);
          throw new Error("telegram_invoice_send_failed");
        }
        await markInvoiceSent(orderCode);
      }
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
    }, { locale }) + (paymentNotice && order.payment_status !== "paid" ? `\n\n${paymentNotice}` : "")
      + (checkFailed && order.payment_status !== "paid"
      ? (locale === "en" ? "\n\nPayment check did not succeed. Try again or contact admin." : "\n\nPemeriksaan pembayaran belum berhasil. Coba lagi atau hubungi admin.")
      : "") + (invoiceFailed ? (locale === "en" ? "\n\nQR payment failed to send. Check status again or contact admin." : "\n\nQR pembayaran gagal dikirim. Cek status lagi atau hubungi admin.") : ""),
    parse_mode: "HTML",
    reply_markup: ["unpaid", "pending"].includes(String(order.payment_status))
      ? orderStatusKeyboard(orderCode, { locale })
      : String(order.payment_status) === "paid"
        ? paidOrderStatusKeyboard(orderCode, { locale })
        : orderTerminalKeyboard({ locale }),
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
    `SELECT items, buyer_access_version,buyer_access_format, locale, payment_method FROM orders WHERE code=? AND sales_channel='telegram'`,
    orderCode,
  ).catch(() => null);
  if (!order) {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
    return;
  }
  // DIRECT forged qrenew on a crypto/gateway order MUST NOT issue QRIS or a
  // new TX: reject honestly (no renewal for non-QRIS rails).
  const rail = String(order.payment_method ?? "");
  if (rail.startsWith("sekalipay_gateway:") || rail.startsWith("nowpayments:")) {
    const railLocale = orderLocaleOf(order);
    await sendMessage({
      chat_id: chatId, text: railLocale === "en"
        ? "This order does not use QRIS — check its status for the correct payment details."
        : "Pesanan ini tidak memakai QRIS — cek statusnya untuk detail pembayaran yang benar.",
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: railLocale }),
    });
    return;
  }
  const locale = orderLocaleOf(order);

  let result: Awaited<ReturnType<typeof reissueDanaQrisInvoice>>;
  try {
    result = await reissueDanaQrisInvoice(orderCode);
  } catch (error) {
    console.error("Telegram QRIS renew failed:", error instanceof Error ? error.message : "unknown");
    await sendMessage({ chat_id: chatId, text: errorMessage({ locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale }) });
    return;
  }

  if (!result.ok) {
    await sendMessage({
      chat_id: chatId,
      text: qrisRenewRejectedMessage(result.reason, { locale }),
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale }),
    });
    return;
  }

  // Nama produk dibaca ulang dari snapshot order, bukan dari memori request
  // lama, agar caption selalu cocok dengan apa yang benar-benar dipesan.
  const photo = await sendPhoto({
    chat_id: chatId,
    photo: result.invoice.qrisUrl,
    caption: invoiceMessage({
      orderCode,
      productName: invoiceItemSummary(order.items, locale === "en"),
      payableAmount: result.invoice.payableAmount,
      expiresAt: result.invoice.expiresAt,
      paymentMethod: "qris",
    }, { locale, chargeNote: true }),
    parse_mode: "HTML",
    reply_markup: qrisInvoiceKeyboard(orderCode, { locale }),
  });
  if (isAmbiguousSendResult(photo)) {
    await settleAmbiguousInvoiceSend(chatId, orderCode, result.invoice.qrisUrl);
    return;
  }
  if (isCriticalSendResult(photo, "transactional")) {
    // Ledger sudah diperbarui; foto gagal = lempar agar Telegram redelivery
    // dan cron menyapu invoice pending lewat jalur retry yang sudah ada.
    await markInvoicePending(orderCode);
    // AU-E2-2: penolakan pasti → retry berikutnya boleh langsung (bukan 60 dtk).
    await releaseInvoiceSendClaim(orderCode);
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
      `SELECT code, telegram_user_id, items, locale FROM orders WHERE code=? AND sales_channel='telegram'
       AND status='pending' AND payment_status IN ('unpaid','pending')`,
      orderCode,
    );
  } catch {
    await sendMessage({ chat_id: chatId, text: "Pesanan gagal dibaca. Coba lagi.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
    return;
  }
  if (!order) {
    await sendMessage({ chat_id: chatId, text: "❌ Pesanan tidak dapat dibatalkan.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
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
    const locale = orderLocaleOf(order);
    await sendMessage({
      chat_id: chatId,
      text: error instanceof OrderTransitionError
        ? (locale === "en" ? "This order can no longer be cancelled because its status changed. Check the latest status." : "Pesanan tidak dapat dibatalkan karena statusnya sudah berubah. Cek status terbaru.")
        : (locale === "en" ? "Cancellation could not be confirmed. Check status then try again." : "Pembatalan gagal dikonfirmasi. Cek status lalu coba lagi."),
      parse_mode: "HTML",
      reply_markup: orderStatusKeyboard(orderCode, { locale }),
    });
    return;
  }

  const cancelLocale = orderLocaleOf(order);
  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: orderCancelledMessage(orderCode, { locale: cancelLocale }),
    parse_mode: "HTML",
    reply_markup: orderTerminalKeyboard({ locale: cancelLocale }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Item 11 — Pesanan Saya: tabs Aktif/Selesai/Gagal, 5/page, detail + klaim.
// Self-contained keyboards live here so keyboards.ts (W-A) stays untouched.
// ─────────────────────────────────────────────────────────────────────────────

export const ORDERS_PAGE_SIZE = 5;
const ORDER_TAB_SQL = {
  a: `(o.status='pending' OR (o.status='lunas' AND o.fulfillment_status!='delivered'))`,
  s: `(o.status='lunas' AND o.payment_status='paid' AND o.fulfillment_status='delivered')`,
  g: `(o.status IN ('kadaluarsa','dibatalkan') OR o.payment_status IN ('expired','failed','refunded'))`,
} as const;
export type OrderTab = keyof typeof ORDER_TAB_SQL;

function isOrderTab(value: unknown): value is OrderTab {
  return value === "a" || value === "s" || value === "g";
}

type OrdersListRow = { code: string; items: string; payment_status: string; fulfillment_status: string; created_at: string | null; payable_amount: number | null };

function orderRowButtonLabel(row: OrdersListRow, locale: Locale): string {
  const en = locale === "en";
  const name = orderItemsSummary(row.items).split("\n")[0] ?? (en ? "Product" : "Produk");
  const date = wibDateTimeText(row.created_at, locale)?.split(" • ")[0] ?? "";
  // Potong rapi: jangan biarkan pemisah ("—", "/", "·") menggantung di ujung.
  const short = name.length > 26
    ? `${name.slice(0, 25).replace(/[\s—–\-/·|,]+$/u, "")}…`
    : name;
  return `${short} · ${date}`.trim();
}

export function myOrdersPagedKeyboard(params: {
  tab: OrderTab;
  page: number;
  totalPages: number;
  rows: OrdersListRow[];
  counts: Record<OrderTab, number>;
  locale: Locale;
}): InlineKeyboardMarkup {
  const { tab, page, totalPages, rows, counts, locale } = params;
  const en = locale === "en";
  const tabLabel = (t: OrderTab, label: string) => (t === tab ? `• ${label} (${counts[t]})` : `${label} (${counts[t]})`);
  const rowsKeyboard: InlineKeyboardButton[][] = rows.map(row => [
    { text: `📋 ${orderRowButtonLabel(row, locale)}`, callback_data: `order:${row.code}` },
  ]);
  rowsKeyboard.push([
    { text: tabLabel("a", en ? "Active" : "Aktif"), callback_data: `mo:a:0` },
    { text: tabLabel("s", en ? "Done" : "Selesai"), callback_data: `mo:s:0` },
    { text: tabLabel("g", en ? "Failed" : "Gagal"), callback_data: `mo:g:0` },
  ]);
  const nav: InlineKeyboardButton[] = [];
  if (page > 0) nav.push({ text: "◀️", callback_data: `mo:${tab}:${page - 1}` });
  if (totalPages > 1) nav.push({ text: `${page + 1}/${totalPages}`, callback_data: "noop" });
  if (page + 1 < totalPages) nav.push({ text: "▶️", callback_data: `mo:${tab}:${page + 1}` });
  if (nav.length) rowsKeyboard.push(nav);
  rowsKeyboard.push([
    { text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: "catalog:0" },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: "home" },
  ]);
  return { inline_keyboard: rowsKeyboard };
}

function myOrdersPagedText(params: { tab: OrderTab; page: number; totalPages: number; rows: OrdersListRow[]; locale: Locale }): string {
  const { tab, page, totalPages, rows, locale } = params;
  const en = locale === "en";
  const tabName = tab === "a" ? (en ? "Active" : "Aktif") : tab === "s" ? (en ? "Completed" : "Selesai") : (en ? "Failed" : "Gagal");
  const header = en ? `<b>📦 My Orders — ${tabName}</b>` : `<b>📦 Pesanan Saya — ${tabName}</b>`;
  if (!rows.length) {
    return [header, "", en ? "No orders in this tab." : "Belum ada pesanan di tab ini."].join("\n");
  }
  return [header, "", `${en ? "Page" : "Halaman"} ${page + 1}/${totalPages}`, "", ...rows.map(row =>
    `• <code>${row.code}</code> — ${rowLabelStatus(row, en)}${row.payable_amount != null ? ` · Rp${Number(row.payable_amount).toLocaleString("id-ID")}` : ""}`,
  )].join("\n");
}

function rowLabelStatus(row: OrdersListRow, en: boolean): string {
  const fulfillment = String(row.fulfillment_status || "not_required");
  const payment = String(row.payment_status || "unpaid");
  if (payment === "paid") return fulfillment === "delivered" ? (en ? "Delivered" : "Selesai") : (en ? "Processing" : "Diproses");
  if (["expired", "failed", "refunded"].includes(payment)) return en ? "Failed" : "Gagal";
  return en ? "Awaiting payment" : "Menunggu bayar";
}

/**
 * Item 11 list: ONE GROUP BY query for tab counts + one page query (5 rows).
 * Default tab = Aktif when it has rows, otherwise Selesai. Edited in place via
 * safeEditOrSend so the screen stays single (no new bubble each tap).
 */
export async function handleMyOrdersPaged(
  chatId: number,
  messageId: number,
  tab: OrderTab | undefined,
  page: number,
  from?: { id: number; first_name: string; username?: string },
): Promise<void> {
  if (!from || !Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== from.id) return;
  const { tgCtxFor } = await import("@/lib/telegram/render-prefs");
  const ctx = await tgCtxFor(from.id);
  const locale = ctx.locale;
  const userId = String(from.id);

  let counts: Record<OrderTab, number> = { a: 0, s: 0, g: 0 };
  try {
    const countRows = await import("@/lib/db").then(({ queryAll }) => queryAll(
      `SELECT
         SUM(CASE WHEN ${ORDER_TAB_SQL.a} THEN 1 ELSE 0 END) AS a,
         SUM(CASE WHEN ${ORDER_TAB_SQL.s} THEN 1 ELSE 0 END) AS s,
         SUM(CASE WHEN ${ORDER_TAB_SQL.g} THEN 1 ELSE 0 END) AS g
       FROM orders o WHERE o.sales_channel='telegram' AND o.telegram_user_id=?`,
      userId,
    ));
    const row = (countRows[0] ?? {}) as Record<string, unknown>;
    counts = { a: Number(row.a ?? 0), s: Number(row.s ?? 0), g: Number(row.g ?? 0) };
  } catch {
    await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: "Daftar pesanan gagal dibaca. Coba lagi.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale }) });
    return;
  }

  const activeTab: OrderTab = isOrderTab(tab) ? tab : counts.a > 0 ? "a" : "s";
  const totalPages = Math.max(1, Math.ceil(counts[activeTab] / ORDERS_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, Math.floor(Number(page) || 0)), totalPages - 1);

  let rows: OrdersListRow[] = [];
  try {
    const { queryAll } = await import("@/lib/db");
    const raw = await queryAll(
      `SELECT o.code, o.items, o.payment_status, o.fulfillment_status, o.created_at,
              (SELECT pt.payable_amount FROM payment_transactions pt WHERE pt.order_code=o.code ORDER BY pt.id DESC LIMIT 1) AS payable_amount
         FROM orders o
        WHERE o.sales_channel='telegram' AND o.telegram_user_id=? AND ${ORDER_TAB_SQL[activeTab]}
        ORDER BY o.created_at DESC, o.code DESC
        LIMIT ? OFFSET ?`,
      userId, ORDERS_PAGE_SIZE, safePage * ORDERS_PAGE_SIZE,
    );
    rows = raw.map(row => ({
      code: String(row.code), items: String(row.items ?? "[]"),
      payment_status: String(row.payment_status ?? "unpaid"), fulfillment_status: String(row.fulfillment_status ?? "not_required"),
      created_at: row.created_at == null ? null : String(row.created_at), payable_amount: row.payable_amount == null ? null : Number(row.payable_amount),
    }));
  } catch {
    await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: "Daftar pesanan gagal dibaca. Coba lagi.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale }) });
    return;
  }

  await safeEditOrSend({
    chat_id: chatId,
    message_id: messageId,
    text: myOrdersPagedText({ tab: activeTab, page: safePage, totalPages, rows, locale }),
    parse_mode: "HTML",
    reply_markup: myOrdersPagedKeyboard({ tab: activeTab, page: safePage, totalPages, rows, counts, locale }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Item 11 — Klaim garansi (tanpa migrasi): eligibility + rules → claimstart →
// next text/photo forwarded to TELEGRAM_ADMIN_CHAT_ID, then cleared.
// ─────────────────────────────────────────────────────────────────────────────

const CLAIM_RATE_MAX = 3;
const CLAIM_RATE_WINDOW_MS = 24 * 3600_000;

export function warrantyClaimKeyboard(orderCode: string, opts: { locale?: Locale }): InlineKeyboardMarkup {
  const en = opts.locale === "en";
  return {
    inline_keyboard: [
      [{ text: en ? "📝 Submit Claim Here" : "📝 Ajukan Klaim di Sini", callback_data: `claimstart:${orderCode}` }],
      [{ text: "💬 WhatsApp Admin", url: `${SITE.webUrl}/wa?pesan=${encodeURIComponent(`Klaim garansi ${orderCode}`)}` }],
      [{ text: en ? "◀️ Order Details" : "◀️ Detail Pesanan", callback_data: `order:${orderCode}` }],
    ],
  };
}

/** `claim:<code>` — read-only eligibility screen; never consumes state. */
export async function handleWarrantyClaim(chatId: number, messageId: number, orderCode: string, from: { id: number; first_name: string; username?: string }): Promise<void> {
  if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== from.id) return;
  const code = String(orderCode || "").toUpperCase();
  let order;
  try {
    order = await queryFirst(
      `SELECT code, items, subtotal, locale, payment_status, fulfillment_status, status FROM orders
        WHERE code=? AND sales_channel='telegram' AND telegram_user_id=?`,
      code, String(from.id),
    );
  } catch {
    await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: "Pesanan gagal dibaca. Coba lagi.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
    return;
  }
  if (!order) {
    await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: "❌ Pesanan tidak ditemukan.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
    return;
  }
  const locale = orderLocaleOf(order);
  const en = locale === "en";
  const warranty = await orderWarrantySummary({ code, status: order.status, payment_status: order.payment_status, subtotal: order.subtotal }, locale);
  if (String(order.payment_status) !== "paid") {
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: en ? "🛡 Warranty claims are only available for paid orders." : "🛡 Klaim garansi hanya untuk pesanan yang sudah lunas.",
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale }),
    });
    return;
  }
  const policy = en ? marketWarrantyClaimEn : marketWarrantyClaim;
  const rules = warrantyClaimRules.slice(0, 4).map((rule, i) => `${i + 1}. ${rule.title} ${rule.detail}`);
  const lines = [
    en ? "<b>🛡 Warranty Claim</b>" : "<b>🛡 Klaim Garansi</b>",
    `<code>${escapeHtml(code)}</code>`,
    "",
    `${en ? "Product" : "Produk"}: ${orderItemsSummary(order.items).replace(/\n/g, ", ")}`,
    warranty.line ? `${warranty.line}` : (en ? "🛡 No active warranty" : "🛡 Tidak ada garansi aktif"),
    "",
    `<i>${escapeHtml(policy.eligibility)}</i>`,
    ...rules.map(line => escapeHtml(line)),
    "",
    warranty.claimEligible
      ? (en ? "Tap <b>Submit Claim Here</b>, then send issue & screenshot." : "Tekan <b>Ajukan Klaim di Sini</b>, lalu kirim kendala & screenshot.")
      : (en ? "Warranty inactive — contact admin via WhatsApp." : "Garansi tidak aktif — hubungi admin via WhatsApp."),
  ];
  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: lines.join("\n"),
    parse_mode: "HTML",
    reply_markup: warrantyClaimKeyboard(code, { locale }),
  });
}

/** `claimstart:<code>` — set pending_action wclaim:<code> (never overwrite a
 * payq1 "creating" anchor) and ask for the issue text/screenshot. */
export async function handleWarrantyClaimStart(chatId: number, messageId: number, orderCode: string, from: { id: number; first_name: string; username?: string }): Promise<void> {
  if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== from.id) return;
  const code = String(orderCode || "").toUpperCase();
  const owned = await queryFirst(
    `SELECT code, locale FROM orders WHERE code=? AND sales_channel='telegram' AND telegram_user_id=? AND status='lunas' AND payment_status='paid'`,
    code, String(from.id),
  ).catch(() => null);
  const locale = orderLocaleOf(owned);
  if (!owned) {
    await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: "❌ Pesanan lunas tidak ditemukan.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale }) });
    return;
  }
  const guard = await claimSubmissionGuard(String(from.id), code).catch(() => ({ allowed: true as const }));
  if (!guard.allowed) {
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: locale === "en" ? "🛡 Claim limit reached (max 3 per order per 24h). Contact admin via WhatsApp." : "🛡 Batas klaim tercapai (maks 3 per pesanan per 24 jam). Hubungi admin lewat WhatsApp.",
      parse_mode: "HTML",
      reply_markup: warrantyClaimKeyboard(code, { locale }),
    });
    return;
  }
  const { setPendingActionUnlessCreating } = await import("./shared");
  if (!(await setPendingActionUnlessCreating(String(from.id), chatId, `wclaim:${code}`))) return;
  await sendMessage({
    chat_id: chatId,
    text: [
      locale === "en" ? "<b>📝 Submit warranty claim</b>" : "<b>📝 Ajukan klaim garansi</b>",
      `<code>${escapeHtml(code)}</code>`,
      "",
      locale === "en"
        ? "Send issue description (optional: 1 screenshot). /batal to cancel."
        : "Kirim kendala (opsional: 1 screenshot). /batal untuk batal.",
    ].join("\n"),
    parse_mode: "HTML",
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: locale === "en" ? "Describe the issue…" : "Jelaskan kendalanya…" },
  });
}

/** Rate-limit claims per (user, order) to 3/24h. No dedicated table exists, so
 * we count forwarded claims in buyer_notice_log (idempotency_key namespace
 * `tg-wclaim:<code>` with one row per submission). */
async function claimSubmissionGuard(userId: string, orderCode: string): Promise<{ allowed: boolean }> {
  const { queryFirst } = await import("@/lib/db");
  void userId;
  // LIKE pattern stays <= 50 bytes (D1 limit): "tg-wclaim:<code>:%" is short.
  const row = await queryFirst(
    `SELECT COUNT(*) AS n FROM buyer_notice_log
      WHERE idempotency_key LIKE ? AND julianday(created_at) >= julianday('now','-1 day')`,
    `tg-wclaim:${orderCode}:%`,
  );
  return { allowed: Number(row?.n ?? 0) < CLAIM_RATE_MAX };
}

/** Consumes the next text/photo ONLY while pending_action starts wclaim:.
 * Forwards to the admin chat (text + optional photo by file_id), records the
 * rate-limit row, clears state, and confirms with a ticket reference. */
export async function handlePendingWarrantyClaimInput(
  text: string,
  chatId: number,
  from: { id: number; first_name: string; username?: string },
  photoFileId?: string,
): Promise<boolean> {
  const { isD1Mode, queryFirst, execRun } = await import("@/lib/db");
  if (!isD1Mode()) return false;
  if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== from.id) return false;
  const user = await queryFirst(`SELECT pending_action FROM telegram_users WHERE user_id=?`, String(from.id)).catch(() => null);
  const action = user?.pending_action ? String(user.pending_action) : "";
  if (!action.startsWith("wclaim:")) return false;
  const code = action.slice("wclaim:".length).toUpperCase();

  const clearState = () => execRun(`UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`, String(from.id), action).catch(() => ({}));
  if (/^\/batal$/i.test(text.trim())) {
    await clearState();
    const order = await queryFirst(`SELECT locale FROM orders WHERE code=?`, code).catch(() => null);
    const locale = orderLocaleOf(order);
    await sendMessage({ chat_id: chatId, text: locale === "en" ? "Claim cancelled. Type /start to continue." : "Klaim dibatalkan. Ketik /start untuk melanjutkan.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale }) });
    return true;
  }

  const order = await queryFirst(
    `SELECT code, items, subtotal, locale, status, payment_status FROM orders WHERE code=? AND sales_channel='telegram' AND telegram_user_id=? AND status='lunas' AND payment_status='paid'`,
    code, String(from.id),
  ).catch(() => null);
  if (!order) {
    await clearState();
    await sendMessage({ chat_id: chatId, text: "❌ Pesanan lunas tidak ditemukan.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
    return true;
  }
  const locale = orderLocaleOf(order);
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId) {
    await clearState();
    await sendMessage({ chat_id: chatId, text: locale === "en" ? "Claim channel is not available right now. Contact admin via WhatsApp." : "Kanal klaim belum tersedia sekarang. Hubungi admin lewat WhatsApp.", parse_mode: "HTML", reply_markup: warrantyClaimKeyboard(code, { locale }) });
    return true;
  }

  const warranty = await orderWarrantySummary({ code, status: order.status, payment_status: order.payment_status, subtotal: order.subtotal }, locale);
  const username = from.username ? `@${from.username}` : String(from.id);
  const body = (text ?? "").trim();
  const ref = `KLAIM-${code}`;
  const lines = [
    locale === "en" ? `<b>🛡 Warranty claim ${escapeHtml(ref)}</b>` : `<b>🛡 Klaim garansi ${escapeHtml(ref)}</b>`,
    `<code>${escapeHtml(code)}</code>`,
    `${locale === "en" ? "Product" : "Produk"}: ${escapeHtml(orderItemsSummary(order.items).replace(/\n/g, ", "))}`,
    warranty.line ? escapeHtml(warranty.line) : "",
    `${locale === "en" ? "Buyer" : "Pembeli"}: ${escapeHtml(username)} (id ${from.id})`,
    body ? `${locale === "en" ? "Issue" : "Kendala"}: ${escapeHtml(body).slice(0, 1500)}` : (locale === "en" ? "Issue: (screenshot only)" : "Kendala: (hanya screenshot)"),
  ].filter(Boolean);

  // AU-E2-1: Bot API rejections and timeouts return {ok:false} instead of
  // throwing. Only a CONFIRMED admin delivery may consume the claim: keep
  // `wclaim:` and write no ledger row (no quota burn) so the buyer can retry.
  const cannotForward = () => sendMessage({
    chat_id: chatId,
    text: locale === "en"
      ? "Claim was not delivered to admin. Try again or contact admin."
      : "Klaim belum terkirim ke admin. Coba lagi atau hubungi admin.",
    parse_mode: "HTML",
    reply_markup: warrantyClaimKeyboard(code, { locale }),
  });
  let textDelivery: { ok: boolean };
  try {
    textDelivery = await sendMessage({
      chat_id: adminChatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
    });
  } catch {
    textDelivery = { ok: false };
  }
  if (!textDelivery.ok) {
    await cannotForward().catch(() => undefined);
    return true;
  }
  // Text reached admin. A rejected screenshot is a PARTIAL claim, recorded
  // distinctly so the ledger never claims a fully delivered submission.
  let photoDelivered = true;
  if (photoFileId) {
    try {
      const { sendPhoto } = await import("@/lib/telegram/api");
      const photo = await sendPhoto({ chat_id: adminChatId, photo: photoFileId, caption: `<code>${escapeHtml(ref)}</code>`, parse_mode: "HTML" });
      photoDelivered = photo.ok === true;
    } catch {
      photoDelivered = false;
    }
  }
  // Record one row per submission (rate limit + audit trail).
  await execRun(
    `INSERT INTO buyer_notice_log (idempotency_key, order_code, channel, status, error)
     VALUES (?, ?, 'telegram', ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`,
    `tg-wclaim:${code}:${crypto.randomUUID()}`, code,
    photoDelivered ? "sent" : "failed",
    photoDelivered ? "warranty_claim" : "warranty_claim_partial",
  ).catch(() => undefined);
  await clearState();

  await sendMessage({
    chat_id: chatId,
    text: [
      locale === "en" ? "<b>✅ Claim submitted</b>" : "<b>✅ Klaim terkirim</b>",
      `<code>${escapeHtml(ref)}</code>`,
      "",
      ...(photoDelivered
        ? [locale === "en" ? "Admin processes claims in 1–3 days. Keep this reference." : "Admin memproses klaim 1–3 hari. Simpan referensi ini."]
        : [locale === "en" ? "⚠️ Screenshot was not delivered — resend it via WhatsApp admin." : "⚠️ Screenshot gagal terkirim — kirim ulang lewat WhatsApp admin."]),
    ].join("\n"),
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: locale === "en" ? "📦 My Orders" : "📦 Pesanan Saya", callback_data: "mo" },
        { text: locale === "en" ? "🏠 Menu" : "🏠 Menu", callback_data: "home" },
      ]],
    },
  });
  return true;
}
