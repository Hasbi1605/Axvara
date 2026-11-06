// src/lib/telegram/handlers/payment-consent.ts — R2 gateway fee consent.
// Narrow: gconsent:<CODE>:<total>:<tag16> verification + consented view.
// HMAC keyed on existing server BUYER_ORDER_ACCESS_SECRET, binding
// owner+order+immutable provider invoice ID+SHOWN total. Ordered via
// confirmGatewayFee CAS: old button (100) after live TX (120) => NO consent,
// re-present 120 still non-disclosing. Replay accepted => same current view,
// no double fee/dispatch. Paid-before-consent => review-sticky, no details.
import { queryFirst } from "@/lib/db";
import { safeEditOrSend, answerCallbackQuery } from "@/lib/telegram/api";
import { parsePayq1ConsentCallback, PAYQ1_GCONSENT_MAX_BYTES } from "@/lib/telegram/payment-quote";

function consentSecret(): string | null {
  const secret = process.env.BUYER_ORDER_ACCESS_SECRET ?? "";
  return secret.length >= 16 ? secret : null;
}

export async function payq1ConsentTag(orderCode: string, telegramUserId: string, providerInvoiceId: string, shownTotal: number): Promise<string | null> {
  const secret = consentSecret();
  if (!secret) return null;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const payload = `gconsent|${orderCode}|${telegramUserId}|${providerInvoiceId}|${shownTotal}`;
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
    return Array.from(mac.subarray(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}

async function verifyConsentTag(orderCode: string, telegramUserId: string, providerInvoiceId: string, shownTotal: number, tag: string): Promise<boolean> {
  const secret = consentSecret();
  if (!secret || !/^[0-9a-f]{16}$/.test(tag)) return false;
  try {
    const expected = await payq1ConsentTag(orderCode, telegramUserId, providerInvoiceId, shownTotal);
    if (!expected) return false;
    // Compare fixed-length truncated tags via native HMAC verification, not JS equality.
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    const signature = await crypto.subtle.sign("HMAC", key, enc.encode(expected));
    return await crypto.subtle.verify("HMAC", key, signature, enc.encode(tag));
  } catch { return false; }
}

export async function handleGatewayConsent(
  chatId: number,
  messageId: number,
  data: string,
  from: { id: number; first_name: string; username?: string },
  callbackId?: string,
): Promise<void> {
  const answer = async (text?: string, alert = false) => {
    if (callbackId) await answerCallbackQuery(callbackId, text, alert);
  };
  if (new TextEncoder().encode(data).length > PAYQ1_GCONSENT_MAX_BYTES) {
    await answer();
    return;
  }
  const parsed = parsePayq1ConsentCallback(data);
  if (!parsed) {
    await answer();
    return;
  }
  if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== from.id) {
    await answer();
    return;
  }
  await answer();
  const order = await queryFirst(
    `SELECT o.code, o.telegram_user_id, o.status, o.payment_status,
            pt.provider, pt.status AS transaction_status, pt.payable_amount, pt.gateway_fee_consent_required,
            pt.gateway_fee_consented_at, pt.provider_payment_id, pt.direct_url, pt.last_error
     FROM orders o JOIN payment_transactions pt ON pt.order_code=o.code AND pt.provider='sekalipay_gateway'
     WHERE o.code=? AND o.sales_channel='telegram' AND o.telegram_user_id=?`,
    parsed.orderCode, String(from.id),
  ).catch(() => null);
  if (!order) {
    // Forged/cross-user/unknown => deny without mutation/leak.
    return;
  }
  const shownTotal = parsed.total;
  const providerInvoiceId = String(order.provider_payment_id ?? "");
  if (!providerInvoiceId) return;
  if (!await verifyConsentTag(parsed.orderCode, String(from.id), providerInvoiceId, shownTotal, parsed.tag)) return;
  // Paid-before-consent: sticky review, no details/consent. Expired orders
  // also deny consent (confirmGatewayFee's CAS already requires live order;
  // this pre-check avoids leaking the paid path on a dead invoice).
  if (order.payment_status === "paid" || order.status === "lunas") return;
  if (/manual_review/i.test(String(order.last_error ?? ""))) return;
  const currentTotal = Number(order.payable_amount ?? 0);
  if (!Number.isSafeInteger(currentTotal) || currentTotal !== shownTotal) {
    // Stale button (100) after live TX (120): no consent, re-present current
    // total (still non-disclosing — link/VA stay hidden until fresh consent).
    const { showProviderInvoiceStatus } = await import("./payment-status");
    const { tgCtxFor } = await import("@/lib/telegram/render-prefs");
    const ctx = await tgCtxFor(from.id);
    await showProviderInvoiceStatus(chatId, messageId, parsed.orderCode, from, { locale: ctx.locale });
    return;
  }
  const { confirmGatewayFee } = await import("@/lib/payments/sekalipay-gateway");
  const confirmed = await confirmGatewayFee(parsed.orderCode, shownTotal).catch(() => null);
  if (!confirmed) {
    const { showProviderInvoiceStatus } = await import("./payment-status");
    const { tgCtxFor } = await import("@/lib/telegram/render-prefs");
    const ctx = await tgCtxFor(from.id);
    await showProviderInvoiceStatus(chatId, messageId, parsed.orderCode, from, { locale: ctx.locale });
    return;
  }
  const { showProviderInvoiceStatus } = await import("./payment-status");
  const { tgCtxFor } = await import("@/lib/telegram/render-prefs");
  const ctx = await tgCtxFor(from.id);
  await showProviderInvoiceStatus(chatId, messageId, parsed.orderCode, from, { locale: ctx.locale });
}

export { verifyConsentTag };
