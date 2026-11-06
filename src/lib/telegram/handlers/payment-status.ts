// src/lib/telegram/handlers/payment-status.ts — R2 provider-aware views.
// Narrow: pending/confirming/paid/manual_review/expired/failed renderers.
// Crypto shows ACTUAL provider payAmount TEXT + explicit network + copyable
// address + deadline (USD product amount separate; unknown itemization never
// zero/sender-gas extra). Gateway link/VA only via consented safe view.
// Actual rail charge currency independent of display locale (saved ORDER
// locale drives copy). Expired/review/unconsented conceal ALL payment
// details; underpaid manual-review never fulfills. No webhook leaks.
import { queryFirst } from "@/lib/db";
import type { DatabaseAccess } from "@/lib/db-access";
import { isFutureIso } from "@/lib/expiry";
import { sendMessage, safeEditOrSend as rawSafeEditOrSend } from "@/lib/telegram/api";
import { tgCtxFor } from "@/lib/telegram/render-prefs";
import { escapeHtml, truncate } from "@/lib/telegram/messages/format";
import { formatIdr } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";

function copyableAddr(address: string): string {
  return `<code>${escapeHtml(truncate(address, 220))}</code>`;
}

function expiredView(code: string, locale: Locale): string {
  return locale === "en"
    ? `<b>⌛ Invoice expired</b>\n\n<code>${escapeHtml(code)}</code>\n\nThe payment deadline has passed. Create a new order from /katalog`
    : `<b>⌛ Invoice kedaluwarsa</b>\n\n<code>${escapeHtml(code)}</code>\n\nBatas waktu pembayaran sudah habis. Buat pesanan baru dari /katalog`;
}

function failedView(code: string, locale: Locale): string {
  return locale === "en"
    ? `<b>Payment failed</b>\n\n<code>${escapeHtml(code)}</code>\n\nCreate a new order from /katalog`
    : `<b>Pembayaran gagal</b>\n\n<code>${escapeHtml(code)}</code>\n\nBuat pesanan baru dari /katalog`;
}

function reviewView(code: string, locale: Locale): string {
  // Review-sticky: NO payment details, NO consent, NO re-POST entry.
  return locale === "en"
    ? `<b>Under manual review</b>\n\n<code>${escapeHtml(code)}</code>\n\nOur team is checking this payment. Do not pay again — contact support if needed.`
    : `<b>Dalam pemeriksaan manual</b>\n\n<code>${escapeHtml(code)}</code>\n\nTim kami memeriksa pembayaran ini. Jangan bayar lagi — hubungi bantuan bila perlu.`;
}

/** R3 delivery outcome of the LAST view message. `live` = an actionable invoice
 * view (crypto details / gateway consent prompt / gateway details); every
 * other view (expired, failed, review, paid) is `terminal` and never counts as
 * an invoice delivery. `ambiguous` = Telegram gave no error_code (timeout/
 * transport): the message MAY have landed, so callers must not blindly resend. */
export type ProviderViewDelivery = { kind: "live" | "terminal" | "none"; ok: boolean; ambiguous: boolean };

type TrackedEdit = Parameters<typeof rawSafeEditOrSend>[0];

/** Provider-aware status render. Returns what the buyer-visible delivery was;
 * a live view acknowledged with ok:true marks the order's invoice delivered
 * (existing orders.telegram_invoice_sent_at marker). `savedOnly` renders from
 * the saved invoice only (no provider GET/claim) — used by the bounded retry. Reads owned order + saved TX only (fresh
 * re-read per view). Direct forged qrenew on crypto/gateway MUST NOT issue
 * QRIS or a new TX — this module never creates. */
export async function showProviderInvoiceStatus(
  chatId: number,
  messageId: number,
  orderCode: string,
  from: { id: number; first_name: string; username?: string },
  opts?: { locale?: Locale; savedOnly?: boolean; database?: DatabaseAccess },
): Promise<ProviderViewDelivery> {
  const track: { last: ProviderViewDelivery } = { last: { kind: "none", ok: false, ambiguous: false } };
  await renderProviderInvoiceStatus(chatId, messageId, orderCode, from, opts, track);
  if (track.last.kind === "live" && track.last.ok) {
    const { markInvoiceSent } = await import("@/lib/telegram/invoice-retry");
    await markInvoiceSent(orderCode.toUpperCase(), opts?.database);
  }
  return track.last;
}

async function renderProviderInvoiceStatus(
  chatId: number,
  messageId: number,
  orderCode: string,
  from: { id: number; first_name: string; username?: string },
  opts: { locale?: Locale; savedOnly?: boolean; database?: DatabaseAccess } | undefined,
  track: { last: ProviderViewDelivery },
): Promise<void> {
  const safeEditOrSend = async (params: TrackedEdit, kind: "live" | "terminal" = "terminal") => {
    const result = await rawSafeEditOrSend(params).catch(() => ({ ok: false }) as { ok: boolean; error_code?: number });
    track.last = { kind, ok: result.ok === true, ambiguous: result.ok !== true && (result as { error_code?: number }).error_code == null };
    return result;
  };
  const locale: Locale = opts?.locale ?? (await tgCtxFor(from.id).catch(() => ({ locale: "id" as Locale }))).locale;
  const order = await (opts?.database?.queryFirst ?? queryFirst)(
    `SELECT o.code, o.locale, o.status, o.payment_status, o.subtotal,
            pt.provider, pt.status AS transaction_status, pt.pay_currency, pt.pay_network,
            pt.pay_amount_text, pt.pay_address, pt.price_amount_text,
            pt.expires_at, pt.provider_status_text, pt.direct_url, pt.gateway_virtual_account,
            pt.gateway_checkout_url, pt.gateway_label, pt.gateway_estimated_fee, pt.gateway_fee,
            pt.payable_amount, pt.gateway_fee_consent_required, pt.gateway_fee_consented_at,
            pt.provider_payment_id, pt.last_error
     FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
     WHERE o.code=? AND o.sales_channel='telegram' AND o.telegram_user_id=?`,
    orderCode.toUpperCase(), String(from.id),
  ).catch(() => null);
  if (!order) {
    await sendMessage({ chat_id: chatId, text: "❌ Pesanan tidak ditemukan.", parse_mode: "HTML" });
    return;
  }
  const savedLocale: Locale = order.locale === "en" ? "en" : order.locale === "id" ? "id" : locale;
  const code = String(order.code);
  const provider = String(order.provider ?? "");
  if (order.payment_status === "paid" || order.status === "lunas") {
    const { orderPaidMessage } = await import("@/lib/telegram/messages/status");
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: orderPaidMessage(code, "", false, "manual", { locale: savedLocale }),
      parse_mode: "HTML",
    });
    return;
  }
  if (order.status === "dibatalkan") {
    await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: failedView(code, savedLocale), parse_mode: "HTML" });
    return;
  }
  const liveOrder = order.status === "pending" && ["pending", "unpaid"].includes(String(order.payment_status));
  const reviewSticky = /manual_review/i.test(String(order.last_error ?? ""));
  if (!liveOrder || reviewSticky) {
    await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: reviewSticky ? reviewView(code, savedLocale) : expiredView(code, savedLocale), parse_mode: "HTML" });
    return;
  }

  if (provider === "nowpayments") {
    // Saved flag-off / missing FX: GET recovery still renders from the SAVED
    // invoice row (never newly created here). Missing saved TX => fail-closed.
    if (!order.transaction_status) {
      await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: failedView(code, savedLocale), parse_mode: "HTML" });
      return;
    }
    // Refresh: claim CAS + reconcile, then fresh re-read (single claimer).
    const { claimNowpaymentsPollReconcile, reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
    const { buildNowpaymentsPaymentView } = await import("@/lib/payments/payment-view");
    const claimed = opts?.savedOnly ? false : await claimNowpaymentsPollReconcile(code).catch(() => false);
    if (claimed) {
      await reconcileNowpaymentsPayment(code).catch(() => null);
    }
    const view = await buildNowpaymentsPaymentView(code, opts?.database);
    if (!view) {
      await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: failedView(code, savedLocale), parse_mode: "HTML" });
      return;
    }
    if (view.state === "expired") {
      await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: expiredView(code, savedLocale), parse_mode: "HTML" });
      return;
    }
    if (view.state === "failed") {
      await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: failedView(code, savedLocale), parse_mode: "HTML" });
      return;
    }
    if (view.state === "manual_review") {
      await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: reviewView(code, savedLocale), parse_mode: "HTML" });
      return;
    }
    // Label dari katalog kurasi (simbol + jaringan); instruksi: kirim tepat nominal koin di jaringan itu SAJA.
    const symbol = escapeHtml(view.symbol || String(order.pay_currency ?? "").toUpperCase());
    const networkLabel = escapeHtml(view.network_label || String(order.pay_network ?? "").toUpperCase());
    const payAmount = escapeHtml(String(order.pay_amount_text ?? ""));
    const { bpsPercentText } = await import("@/lib/payments/crypto-pricing");
    const totalUsd = escapeHtml(String(view.amount_text ?? ""));
    const feeLine = view.surcharge_amount_text && view.surcharge_bps !== null
      ? (savedLocale === "en"
        ? `Order total: US$${totalUsd} (incl. ${bpsPercentText(view.surcharge_bps, "en")}% crypto service fee US$${escapeHtml(view.surcharge_amount_text)})`
        : `Total pesanan: US$${totalUsd} (termasuk biaya layanan crypto ${bpsPercentText(view.surcharge_bps, "id")}% US$${escapeHtml(view.surcharge_amount_text)})`)
      : (savedLocale === "en" ? `Order total: US$${totalUsd}` : `Total pesanan: US$${totalUsd}`);
    const amountLine = savedLocale === "en"
      ? `Send exactly <b>${payAmount} ${symbol}</b> on the <b>${networkLabel}</b> network only.\n${feeLine}`
      : `Kirim tepat <b>${payAmount} ${symbol}</b> lewat jaringan <b>${networkLabel}</b> saja.\n${feeLine}`;
    const address = String(order.pay_address ?? "");
    const warning = savedLocale === "en"
      ? "Sending another coin or network may lose your funds. Network gas is paid by the sender."
      : "Mengirim koin atau jaringan lain dapat membuat dana hilang. Gas jaringan ditanggung pengirim.";
    const text = savedLocale === "en"
      ? `<b>⏳ Awaiting crypto payment</b>\n\n<code>${escapeHtml(code)}</code>\n\n${amountLine}\nTo: ${address ? copyableAddr(address) : "(preparing — refresh in a moment)"}\n\n${warning} Pay before: ${escapeHtml(String(order.expires_at ?? ""))}`
      : `<b>⏳ Menunggu pembayaran crypto</b>\n\n<code>${escapeHtml(code)}</code>\n\n${amountLine}\nKe: ${address ? copyableAddr(address) : "(disiapkan — refresh sebentar lagi)"}\n\n${warning} Batas bayar: ${escapeHtml(String(order.expires_at ?? ""))}`;
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: savedLocale === "en" ? "🔄 Refresh status" : "🔄 Refresh status", callback_data: `refresh:${code}` }]] },
    }, "live");
    return;
  }

  if (provider === "sekalipay_gateway") {
    if (!order.transaction_status) {
      await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: failedView(code, savedLocale), parse_mode: "HTML" });
      return;
    }
    const { buildSekalipayGatewayPaymentView, claimSekalipayGatewayPoll } = await import("@/lib/payments/payment-view");
    const claimed = opts?.savedOnly ? false : await claimSekalipayGatewayPoll(code).catch(() => false);
    if (claimed) {
      const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
      await reconcileSekalipayGatewayPayment(code).catch(() => null);
    }
    const view = await buildSekalipayGatewayPaymentView(code, opts?.database);
    if (!view) {
      await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: failedView(code, savedLocale), parse_mode: "HTML" });
      return;
    }
    if (view.state === "expired") {
      await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: expiredView(code, savedLocale), parse_mode: "HTML" });
      return;
    }
    if (view.state === "manual_review" || view.state === "initializing") {
      await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: reviewView(code, savedLocale), parse_mode: "HTML" });
      return;
    }
    if (view.state === "fee_consent_required" || !view.payment_link && !view.virtual_account) {
      // Consent view: localized price/estimated fee/actual fee/TOTAL offer in
      // actual IDR; payment link/VA/deeplink HIDDEN until exact consent.
      const total = Number(view.total ?? 0);
      const fee = Number(view.fee ?? view.estimated_fee ?? 0);
      const { payq1ConsentTag } = await import("./payment-consent");
      const invoiceId = String(order.provider_payment_id ?? "");
      const tag = await payq1ConsentTag(code, String(from.id), invoiceId, total);
      const label = escapeHtml(truncate(String(view.label ?? "Gateway"), 80));
      const text = savedLocale === "en"
        ? `<b>Confirm gateway fee</b>\n\n<code>${escapeHtml(code)}</code>\n\n${label}\nSubtotal: ${formatIdr(Number(view.subtotal ?? 0), savedLocale)}\nEstimated fee: ${formatIdr(Number(view.estimated_fee ?? fee), savedLocale)}\nActual fee: ${formatIdr(fee, savedLocale)}\n<b>Total: ${formatIdr(total, savedLocale)}</b>\n\nPress confirm to reveal the payment details.`
        : `<b>Konfirmasi biaya gateway</b>\n\n<code>${escapeHtml(code)}</code>\n\n${label}\nSubtotal: ${formatIdr(Number(view.subtotal ?? 0), savedLocale)}\nEstimasi biaya: ${formatIdr(Number(view.estimated_fee ?? fee), savedLocale)}\nBiaya aktual: ${formatIdr(fee, savedLocale)}\n<b>Total: ${formatIdr(total, savedLocale)}</b>\n\nTekan konfirmasi untuk membuka detail pembayaran.`;
      if (!tag || !invoiceId || !Number.isSafeInteger(total) || total <= 0) {
        await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: reviewView(code, savedLocale), parse_mode: "HTML" });
        return;
      }
      await safeEditOrSend({
        chat_id: chatId, message_id: messageId,
        text,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: savedLocale === "en" ? "✅ Confirm total" : "✅ Konfirmasi total", callback_data: `gconsent:${code}:${total}:${tag}` }]] },
      }, "live");
      return;
    }
    const label = escapeHtml(truncate(String(view.label ?? "Gateway"), 80));
    const text = savedLocale === "en"
      ? `<b>⏳ Awaiting gateway payment</b>\n\n<code>${escapeHtml(code)}</code>\n\n${label}\n<b>Total: ${formatIdr(Number(view.total ?? 0), savedLocale)}</b>\n\nPay before: ${escapeHtml(String(view.expires_at ?? ""))}`
      : `<b>⏳ Menunggu pembayaran gateway</b>\n\n<code>${escapeHtml(code)}</code>\n\n${label}\n<b>Total: ${formatIdr(Number(view.total ?? 0), savedLocale)}</b>\n\nBatas bayar: ${escapeHtml(String(view.expires_at ?? ""))}`;
    const buttons: { text: string; url?: string; callback_data?: string }[] = [];
    if (view.payment_link) buttons.push({ text: savedLocale === "en" ? "Open payment page" : "Buka halaman bayar", url: String(view.payment_link) });
    if (view.virtual_account) buttons.push({ text: `VA ${escapeHtml(String(view.virtual_account)).slice(0, 24)}`, callback_data: `noop:${code}` });
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [buttons.length ? buttons : [{ text: savedLocale === "en" ? "🔄 Refresh status" : "🔄 Refresh status", callback_data: `refresh:${code}` }], [{ text: savedLocale === "en" ? "🔄 Refresh status" : "🔄 Refresh status", callback_data: `refresh:${code}` }]] },
    }, "live");
    return;
  }

  // Unknown provider => fail closed, never QRIS fallback.
  await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: reviewView(code, savedLocale), parse_mode: "HTML" });
}

export async function handleRefreshProviderStatus(
  chatId: number, orderCode: string, from: { id: number; first_name: string; username?: string },
): Promise<void> {
  const normalized = String(orderCode || "").toUpperCase();
  const owned = await queryFirst(
    `SELECT code FROM orders WHERE code=? AND sales_channel='telegram' AND telegram_user_id=?`,
    normalized, String(from.id),
  ).catch(() => null);
  if (!owned) {
    await sendMessage({ chat_id: chatId, text: "❌ Pesanan ini bukan milikmu.", parse_mode: "HTML" });
    return;
  }
  await showProviderInvoiceStatus(chatId, 0, normalized, from);
}

export function isProviderRail(order: { payment_method?: unknown } | null): boolean {
  const method = String(order?.payment_method ?? "");
  return method.startsWith("sekalipay_gateway:") || method.startsWith("nowpayments:");
}

void isFutureIso;
void 0;
