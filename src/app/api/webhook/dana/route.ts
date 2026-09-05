import { NextRequest, NextResponse } from "next/server";
import { execRun, queryFirst, transitionPendingPaymentToPaid } from "@/lib/db";
import {
  constantTimeEqual,
  isDanaQrisConfigured,
  parseDanaWebhook,
  sha256Hex,
} from "@/lib/payments/dana-qris";
import { ensureFulfillmentForPaidOrder } from "@/lib/fulfillment/deliver";
import { sendTextMessage } from "@/lib/whatsapp/gateway";
import { paymentDetectedMessage } from "@/lib/whatsapp/messages";

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
  const event = await queryFirst(`SELECT id,status,order_code FROM dana_webhook_events WHERE event_key=?`, eventKey);
  if (!event) return NextResponse.json({ error: "event_not_persisted" }, { status: 500 });
  if (["matched", "ignored"].includes(String(event.status))) {
    return NextResponse.json({ ok: true, status: "duplicate" });
  }

  const transaction = await queryFirst(
    `SELECT pt.order_code, pt.status, o.status AS order_status,
            o.sales_channel, o.channel_conversation_id
     FROM payment_transactions pt
     JOIN orders o ON o.code=pt.order_code
     WHERE pt.provider='dana' AND pt.payable_amount=?
       AND pt.status='pending' AND o.status='pending'
       AND datetime(pt.expires_at)>datetime('now')
     LIMIT 1`,
    payment.amount,
  );
  if (!transaction) {
    await execRun(
      `UPDATE dana_webhook_events
       SET status='ignored', last_error='no_active_exact_amount', processed_at=datetime('now')
       WHERE id=? AND status='received'`,
      event.id,
    );
    return NextResponse.json({ ok: true, status: "unmatched" });
  }

  const orderCode = String(transaction.order_code);
  const transitioned = await transitionPendingPaymentToPaid(orderCode, new Date().toISOString());
  const paidOrder = transitioned || Boolean(await queryFirst(
    `SELECT code FROM orders WHERE code=? AND status='lunas' AND payment_status='paid'`,
    orderCode,
  ));
  if (!paidOrder) {
    await execRun(
      `UPDATE dana_webhook_events
       SET status='failed', order_code=?, last_error='payment_transition_failed', processed_at=datetime('now')
       WHERE id=?`,
      orderCode,
      event.id,
    );
    return NextResponse.json({ error: "payment_transition_failed" }, { status: 409 });
  }

  await execRun(
    `UPDATE dana_webhook_events
     SET status='matched', order_code=?, last_error=NULL, processed_at=datetime('now')
     WHERE id=?`,
    orderCode,
    event.id,
  );

  try {
    await ensureFulfillmentForPaidOrder(orderCode);
  } catch { /* Payment is durable; fulfillment cron remains idempotent. */ }

  if (String(transaction.sales_channel) === "whatsapp" && transaction.channel_conversation_id) {
    try {
      await sendTextMessage({
        target: String(transaction.channel_conversation_id),
        message: paymentDetectedMessage(orderCode),
      });
    } catch { /* Buyer notification is best-effort. */ }
  }

  return NextResponse.json({ ok: true, status: transitioned ? "paid" : "already_paid" });
}
