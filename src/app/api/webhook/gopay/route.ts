import { DANA_AMOUNT_REUSED_SQL } from "@/lib/payments/dana-history";
import { NextRequest, NextResponse } from "next/server";
import { execRun, queryAll, queryFirst, transitionPendingPaymentToPaid } from "@/lib/db";
import {
  constantTimeEqual,
  isCausallyPlausiblePayment,
  isGopayQrisConfigured,
  parseQrisWebhook,
  sha256Hex,
} from "@/lib/payments/dana-qris";
import { ensureFulfillmentForPaidOrder } from "@/lib/fulfillment/deliver";
import { isFutureIso } from "@/lib/expiry";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_BODY_SIZE = 32_000;

/**
 * Webhook internal rail GoPay — HANYA dari poller server milik sendiri
 * (`GOPAY_POLLER_SECRET`), bukan publik. Poller memantau mutasi GoBiz lalu
 * meneruskan {amount, order_code?, sender_name?} ke sini.
 *
 * Matching = cermin webhook DANA dengan DUA perbedaan:
 * 1. Filter `provider='gopay'` di semua query kandidat (nominal GoPay boleh
 *    sama dengan nominal DANA tanpa saling klaim).
 * 2. Bila `order_code` disertakan poller, kandidat langsung diverifikasi ke
 *    order itu (tanpa tebak nominal); fallback nominal persis bila tidak.
 */
export async function POST(request: NextRequest) {
  if (!isGopayQrisConfigured()) return NextResponse.json({ error: "qris_not_configured" }, { status: 503 });
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }

  const expectedSecret = process.env.GOPAY_POLLER_SECRET!;
  const suppliedSecret = request.headers.get("x-poller-secret") || "";
  if (!constantTimeEqual(suppliedSecret, expectedSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rawBody = await request.text().catch(() => "");
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_SIZE) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const payment = parseQrisWebhook(body);
  if (!payment) return NextResponse.json({ error: "payment_not_recognized" }, { status: 400 });

  const payloadHash = await sha256Hex(`gopay:${rawBody}`);
  const eventKey = payment.sourceEventId ? `gopay:${payment.sourceEventId}` : `gopay-sha256:${payloadHash}`;
  await execRun(
    `INSERT OR IGNORE INTO dana_webhook_events
       (event_key,payload_hash,amount,sender_name,raw_text,provider,status)
     VALUES (?,?,?,?,?,'gopay','received')`,
    eventKey,
    payloadHash,
    payment.amount,
    payment.senderName,
    payment.rawText,
  );
  const event = await queryFirst(`SELECT id,status,order_code,created_at FROM dana_webhook_events WHERE event_key=?`, eventKey);
  if (!event) return NextResponse.json({ error: "event_not_persisted" }, { status: 500 });
  if (["matched", "ignored"].includes(String(event.status))) {
    return NextResponse.json({ ok: true, status: "duplicate" });
  }

  const candidates = await queryAll(
    `SELECT pt.order_code, pt.status, pt.expires_at, COALESCE(pt.invoice_issued_at,pt.created_at) AS invoice_created_at,o.expires_at AS order_expires_at,
            o.status AS order_status,
            ${DANA_AMOUNT_REUSED_SQL} AS amount_history,
            o.sales_channel, o.channel_conversation_id
     FROM payment_transactions pt
     JOIN orders o ON o.code=pt.order_code
     WHERE pt.provider='gopay' AND pt.payable_amount=?
       AND pt.status='pending' AND o.status='pending'
     LIMIT 2`,
    payment.amount,
  );
  const live = candidates.filter((row) => isFutureIso(row.expires_at) && isFutureIso(row.order_expires_at));
  const plausible = live.filter((row) =>
    isCausallyPlausiblePayment(event.created_at, row.invoice_created_at),
  );
  // Poller tahu order mana yang ia pantau: bila order_code cocok dengan salah
  // satu kandidat plausibel, pilih itu langsung (tanpa ambiguitas nominal).
  const directed = payment.orderCode
    ? plausible.find((row) => String(row.order_code) === payment.orderCode)
    : undefined;
  const transaction = directed ?? (plausible.length === 1 ? plausible[0] : undefined);
  if (!transaction || Number(transaction.amount_history) > 0) {
    const staleEventForLiveInvoice = live.length >= 1 && plausible.length === 0;
    await execRun(
      `UPDATE dana_webhook_events
       SET status='ignored', last_error=?, processed_at=datetime('now')
       WHERE id=? AND status='received'`,
      transaction ? "amount_reused_requires_review" : staleEventForLiveInvoice ? "event_predates_invoice" : "no_active_exact_amount",
      event.id,
    );
    try {
      const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
      if (chatId) {
        const { sendMessage } = await import("@/lib/telegram/api");
        const reason = transaction
          ? "nominal sudah pernah dipakai"
          : staleEventForLiveInvoice ? "pembayaran mendahului invoice" : "tidak ada invoice GoPay aktif dengan nominal itu";
        await sendMessage({
          chat_id: chatId,
          text: `⚠️ <b>Pembayaran GoPay masuk tanpa pasangan invoice</b>\n`
            + `Nominal: <b>Rp ${Number(payment.amount ?? 0).toLocaleString("id-ID")}</b>\n`
            + `Sebab: ${reason}\n\n`
            + `Uang sudah diterima GoPay tetapi tidak ada order yang cocok. Rekonsiliasi manual di panel admin → Metode &amp; Rekonsiliasi.`,
          parse_mode: "HTML",
        });
      }
    } catch { /* ping admin best-effort */ }
    return NextResponse.json({ ok: true, status: "unmatched" });
  }

  const orderCode = String(transaction.order_code);
  const fulfillmentRouting = await queryFirst(
    `SELECT o.variant_id, o.sales_channel,
            (SELECT fi.id FROM fulfillment_inventory fi
              WHERE fi.order_code=o.code AND fi.status='reserved') AS inventory_id
     FROM orders o WHERE o.code=?`,
    orderCode,
  );
  const transitioned = await transitionPendingPaymentToPaid(orderCode,
    new Date().toISOString(),
    fulfillmentRouting
      ? {
          variantId: fulfillmentRouting.variant_id != null ? Number(fulfillmentRouting.variant_id) : null,
          inventoryId: fulfillmentRouting.inventory_id != null ? Number(fulfillmentRouting.inventory_id) : null,
          salesChannel: String(fulfillmentRouting.sales_channel || "telegram"),
        }
      : null,
    { id: Number(event.id) },
  );
  if (!transitioned) {
    const consumed = await queryFirst("SELECT order_code FROM dana_webhook_events WHERE id=? AND status='matched'", event.id);
    if (consumed) return NextResponse.json({ ok: true, status: "duplicate" });
    await execRun(
      `UPDATE dana_webhook_events
       SET status='failed', order_code=?, last_error='payment_transition_failed', processed_at=datetime('now')
       WHERE id=? AND status='received'`,
      orderCode,
      event.id,
    );
    return NextResponse.json({ error: "payment_transition_failed" }, { status: 409 });
  }

  try {
    await ensureFulfillmentForPaidOrder(orderCode);
  } catch { /* Payment is durable; fulfillment cron remains idempotent. */ }

  try {
    const { createWrOrderLinksForOrder, processWrPendingOrders } = await import("@/lib/warung-rebahan/order");
    const { isWrAutoOrderEnabled } = await import("@/lib/warung-rebahan/client");
    if (isWrAutoOrderEnabled() && (await createWrOrderLinksForOrder(orderCode)) > 0) {
      await processWrPendingOrders().catch(() => undefined);
    }
  } catch { /* Link WR menyusul via cron. */ }

  try {
    const { createSkOrderLinksForOrder, processSkPendingOrders } = await import("@/lib/sekalipay/order");
    const { isSkAutoOrderEnabled } = await import("@/lib/sekalipay/client");
    if (isSkAutoOrderEnabled() && (await createSkOrderLinksForOrder(orderCode)) > 0) {
      await processSkPendingOrders().catch(() => undefined);
    }
  } catch { /* Link SK menyusul via cron. */ }

  // Order Pedia (order_kind='pedia'): antrikan dispatch supplier + drain
  // segera satu siklus (pola WR/SK di atas). Best-effort; cron fase pedia
  // tetap menjadi penjamin.
  try {
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    await processPediaPaidOrders().catch(() => undefined);
  } catch { /* Job Pedia menyusul via cron. */ }

  if (String(transaction.sales_channel) === "whatsapp" && transaction.channel_conversation_id) {
    try {
      const orderDetail = await queryFirst(
        `SELECT subtotal, payment_method, variant_snapshot FROM orders WHERE code=?`,
        orderCode,
      );
      const snap = orderDetail?.variant_snapshot ? JSON.parse(String(orderDetail.variant_snapshot)) : {};
      const { paymentDetectedMessage } = await import("@/lib/whatsapp/messages");
      const { enqueueWhatsAppMessage, waOutboxKey } = await import("@/lib/whatsapp/outbox");
      const queued = await enqueueWhatsAppMessage(
        waOutboxKey("payment_detected", orderCode),
        String(transaction.channel_conversation_id),
        paymentDetectedMessage({
          orderCode,
          productName: snap.product_name,
          variantLabel: snap.label,
          total: Number(orderDetail?.subtotal || 0),
          method: String(orderDetail?.payment_method || "QRIS").toUpperCase(),
        }),
      );
      if (queued) {
        const { processWhatsAppOutboxRow } = await import("@/lib/whatsapp/outbox");
        const row = await queryFirst(
          `SELECT * FROM whatsapp_outbox WHERE idempotency_key=?`,
          waOutboxKey("payment_detected", orderCode),
        );
        if (row) await processWhatsAppOutboxRow(row).catch(() => {});
      }
    } catch { /* Antrean bertahan; cron operations memproses yang due. */ }
    try {
      const { notifyWhatsAppPaidAdmin } = await import("@/lib/telegram/order-notifications");
      await notifyWhatsAppPaidAdmin(orderCode).catch(() => false);
    } catch { /* Cron retries. */ }
  }

  return NextResponse.json({ ok: true, status: transitioned ? "paid" : "already_paid" });
}
