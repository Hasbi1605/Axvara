import { NextRequest, NextResponse } from "next/server";
import { execRun, queryAll, queryFirst, transitionPendingPaymentToPaid } from "@/lib/db";
import {
  constantTimeEqual,
  isCausallyPlausiblePayment,
  isDanaQrisConfigured,
  parseDanaWebhook,
  sha256Hex,
} from "@/lib/payments/dana-qris";
import { ensureFulfillmentForPaidOrder } from "@/lib/fulfillment/deliver";
import { isFutureIso } from "@/lib/expiry";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_BODY_SIZE = 32_000;

export async function POST(request: NextRequest) {
  if (!isDanaQrisConfigured()) return NextResponse.json({ error: "qris_not_configured" }, { status: 503 });
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }

  const expectedSecret = process.env.DANA_WEBHOOK_SECRET!;
  const suppliedSecret = request.headers.get("x-webhook-secret") || "";
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
  const payment = parseDanaWebhook(body);
  if (!payment) return NextResponse.json({ error: "payment_not_recognized" }, { status: 400 });

  const payloadHash = await sha256Hex(rawBody);
  const eventKey = payment.sourceEventId ? `hook:${payment.sourceEventId}` : `sha256:${payloadHash}`;
  await execRun(
    `INSERT OR IGNORE INTO dana_webhook_events
       (event_key,payload_hash,amount,sender_name,raw_text,status)
     VALUES (?,?,?,?,?,'received')`,
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

  // Expiry is evaluated in JS from the canonical ISO string (shared helper
  // with both crons): a raw `datetime(expires_at)>datetime('now')` SQL
  // comparison would still match some formats, while a raw string comparison
  // never matches ISO rows. Over-fetching one extra row and filtering here
  // keeps webhook matching exactly as strict as cron expiry.
  const candidates = await queryAll(
    `SELECT pt.order_code, pt.status, pt.expires_at, pt.created_at AS invoice_created_at,
            o.status AS order_status,
            (SELECT COUNT(*) FROM payment_transactions history
             WHERE history.provider=pt.provider AND history.payable_amount=pt.payable_amount
               AND history.order_code<>pt.order_code) AS amount_history,
            o.sales_channel, o.channel_conversation_id
     FROM payment_transactions pt
     JOIN orders o ON o.code=pt.order_code
     WHERE pt.provider='dana' AND pt.payable_amount=?
       AND pt.status='pending' AND o.status='pending'
     LIMIT 2`,
    payment.amount,
  );
  const live = candidates.filter((row) => isFutureIso(row.expires_at));
  // Causal guard (issue #2): an event observed BEFORE the candidate invoice
  // was issued cannot be its payment — money cannot pay an invoice that did
  // not exist yet. Such a stale/relayed notification must not settle a new
  // order; it goes to reconciliation instead of being force-matched.
  const plausible = live.filter((row) =>
    isCausallyPlausiblePayment(event.created_at, row.invoice_created_at),
  );
  const transaction = plausible.length === 1 ? plausible[0] : undefined;
  if (!transaction || Number(transaction.amount_history) > 0) {
    const staleEventForLiveInvoice = live.length >= 1 && plausible.length === 0;
    await execRun(
      `UPDATE dana_webhook_events
       SET status='ignored', last_error=?, processed_at=datetime('now')
       WHERE id=? AND status='received'`,
      transaction ? "amount_reused_requires_review" : staleEventForLiveInvoice ? "event_predates_invoice" : "no_active_exact_amount",
      event.id,
    );
    return NextResponse.json({ ok: true, status: "unmatched" });
  }

  const orderCode = String(transaction.order_code);
  // Resolve fulfillment routing BEFORE the atomic paid batch so the outbox
  // row lands in the same commit (issue #3): no crash window between
  // "payment stored" and "job created". Idempotent INSERT OR IGNORE keeps
  // concurrent webhook deliveries to exactly one job row.
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

  if (String(transaction.sales_channel) === "whatsapp" && transaction.channel_conversation_id) {
    try {
      const orderDetail = await queryFirst(
        `SELECT subtotal, payment_method, variant_snapshot FROM orders WHERE code=?`,
        orderCode,
      );
      const snap = orderDetail?.variant_snapshot ? JSON.parse(String(orderDetail.variant_snapshot)) : {};
      // Notifikasi penting → antrean idempoten (issue #13), bukan best-effort
      // sekali-kirim: gagal dikirim kini diretry cron via whatsapp_outbox.
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
    // Grup Telegram admin juga wajib tahu WA lunas (best-effort; cron retry
    // via telegram_paid_admin_notified_at bila gagal).
    try {
      const { notifyWhatsAppPaidAdmin } = await import("@/lib/telegram/order-notifications");
      await notifyWhatsAppPaidAdmin(orderCode).catch(() => false);
    } catch { /* Cron retries. */ }
  }

  return NextResponse.json({ ok: true, status: transitioned ? "paid" : "already_paid" });
}
