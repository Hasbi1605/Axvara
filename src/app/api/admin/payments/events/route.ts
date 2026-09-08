import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { execRun, isD1Mode, queryAll, queryFirst, transitionPendingPaymentToPaid } from "@/lib/db";
import { isFutureIso } from "@/lib/expiry";
import { isCausallyPlausiblePayment } from "@/lib/payments/dana-qris";
import { ensureFulfillmentForPaidOrder } from "@/lib/fulfillment/deliver";
import { sendTextMessage } from "@/lib/whatsapp/gateway";
import { paymentDetectedMessage } from "@/lib/whatsapp/messages";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const page = clamp(Number(params.get("page") || 1), 1, 100_000);
  const limit = clamp(Number(params.get("limit") || 12), 1, 50);
  const status = params.get("status") || "all";
  const health = paymentHealth();
  if (!isD1Mode()) return NextResponse.json({ events: [], counts: {}, pagination: { page: 1, pages: 1, total: 0 }, last_event_at: null, health });

  const conditions: string[] = [];
  if (status === "attention") conditions.push("status IN ('received','ignored','failed')");
  else if (["received", "matched", "ignored", "failed"].includes(status)) conditions.push("status=?");
  const bindings: unknown[] = status !== "attention" && ["received", "matched", "ignored", "failed"].includes(status) ? [status] : [];
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const offset = (page - 1) * limit;
  const [events, totalRow, countRows, lastRow] = await Promise.all([
    queryAll(`SELECT id,amount,sender_name,status,order_code,last_error,created_at,processed_at
      FROM dana_webhook_events${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...bindings, limit, offset),
    queryFirst(`SELECT COUNT(*) AS count FROM dana_webhook_events${where}`, ...bindings),
    queryAll("SELECT status AS value,COUNT(*) AS count FROM dana_webhook_events GROUP BY status"),
    queryFirst("SELECT created_at FROM dana_webhook_events ORDER BY created_at DESC LIMIT 1"),
  ]);
  const total = Number(totalRow?.count || 0);
  return NextResponse.json({
    events,
    counts: Object.fromEntries(countRows.map((row) => [String(row.value), Number(row.count || 0)])),
    pagination: { page, pages: Math.max(1, Math.ceil(total / limit)), total },
    last_event_at: lastRow?.created_at || null,
    health,
  });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isD1Mode()) return NextResponse.json({ error: "d1_required" }, { status: 503 });
  const body = await request.json().catch(() => null) as { event_id?: number; action?: string; order_code?: string; review_note?: string; verified?: boolean } | null;
  const eventId = Number(body?.event_id || 0);
  const manual = body?.action === "confirm_match";
  if (!eventId || !["retry_match", "confirm_match"].includes(String(body?.action))) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  if (manual && (body?.verified !== true || typeof body.order_code !== "string" || !body.order_code.trim()
    || typeof body.review_note !== "string" || body.review_note.trim().length < 10 || body.review_note.length > 500)) {
    return NextResponse.json({ error: "manual_verification_required" }, { status: 400 });
  }
  const event = await queryFirst("SELECT id,amount,status,order_code,created_at FROM dana_webhook_events WHERE id=?", eventId);
  if (!event) return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  if (String(event.status) === "matched") return NextResponse.json({ ok: true, status: "already_matched", order_code: event.order_code });

  // Same canonical JS expiry check as the webhook: an admin retry must
  // never resurrect an already-expired invoice. Same causal guard: an event
  // observed before the candidate invoice was issued cannot be its payment
  // (issue #2) — it stays in reconciliation instead of settling the order.
  const candidates = await queryAll(
    `SELECT pt.order_code,pt.expires_at,pt.created_at AS invoice_created_at,o.sales_channel,o.channel_conversation_id,
       (SELECT COUNT(*) FROM payment_transactions history
        WHERE history.provider=pt.provider AND history.payable_amount=pt.payable_amount
          AND history.order_code<>pt.order_code) AS amount_history
     FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code
     WHERE pt.provider='dana' AND pt.payable_amount=? AND pt.status='pending'
       AND o.status='pending' LIMIT 3`,
    Number(event.amount),
  );
  const live = candidates.filter((row) => isFutureIso(row.expires_at));
  const matches = live.filter((row) =>
    isCausallyPlausiblePayment(event.created_at, row.invoice_created_at)
      && (!manual || row.order_code === body?.order_code?.trim()),
  );
  if (matches.length !== 1) {
    const reason = live.length >= 1 && matches.length === 0
      ? "event_predates_invoice"
      : matches.length > 1 ? "multiple_active_exact_amount" : "no_active_exact_amount";
    await execRun("UPDATE dana_webhook_events SET status='ignored',last_error=?,processed_at=datetime('now') WHERE id=? AND status IN ('received','ignored','failed')", reason, eventId);
    return NextResponse.json({ error: reason }, { status: 409 });
  }

  const orderCode = String(matches[0].order_code);
  if (!manual && Number(matches[0].amount_history) > 0) {
    await execRun("UPDATE dana_webhook_events SET status='ignored',last_error='amount_reused_requires_review',processed_at=datetime('now') WHERE id=? AND status IN ('received','ignored','failed')", eventId);
    return NextResponse.json({ error: "amount_reused_requires_review" }, { status: 409 });
  }
  // Same atomic paid+job batch as the webhook (issue #3): the retry path
  // must not reintroduce the crash window either.
  const fulfillmentRouting = await queryFirst(
    `SELECT o.variant_id, o.sales_channel,
            (SELECT fi.id FROM fulfillment_inventory fi
              WHERE fi.order_code=o.code AND fi.status='reserved') AS inventory_id
     FROM orders o WHERE o.code=?`,
    orderCode,
  );
  const transitioned = await transitionPendingPaymentToPaid(
    orderCode,
    new Date().toISOString(),
    fulfillmentRouting
      ? {
          variantId: fulfillmentRouting.variant_id != null ? Number(fulfillmentRouting.variant_id) : null,
          inventoryId: fulfillmentRouting.inventory_id != null ? Number(fulfillmentRouting.inventory_id) : null,
          salesChannel: String(fulfillmentRouting.sales_channel || "telegram"),
        }
      : null,
    { id: eventId, ...(manual ? { reviewedBy: admin.email, reviewNote: body!.review_note!.trim() } : {}) },
  );
  if (!transitioned) {
    const consumed = await queryFirst("SELECT order_code FROM dana_webhook_events WHERE id=? AND status='matched'", eventId);
    if (consumed) return NextResponse.json({ ok: true, status: "already_matched", order_code: consumed.order_code });
    await execRun("UPDATE dana_webhook_events SET status='failed',order_code=?,last_error='payment_transition_failed',processed_at=datetime('now') WHERE id=? AND status IN ('received','ignored','failed')", orderCode, eventId);
    return NextResponse.json({ error: "payment_transition_failed" }, { status: 409 });
  }
  try { await ensureFulfillmentForPaidOrder(orderCode); } catch { /* Cron akan retry idempoten. */ }
  if (String(matches[0].sales_channel) === "whatsapp" && matches[0].channel_conversation_id) {
    try {
      const orderDetail = await queryFirst(`SELECT subtotal, payment_method, variant_snapshot FROM orders WHERE code=?`, orderCode);
      const snap = orderDetail?.variant_snapshot ? JSON.parse(String(orderDetail.variant_snapshot)) : {};
      await sendTextMessage({
        target: String(matches[0].channel_conversation_id),
        message: paymentDetectedMessage({
          orderCode,
          productName: snap.product_name,
          variantLabel: snap.label,
          total: Number(orderDetail?.subtotal || 0),
          method: String(orderDetail?.payment_method || "QRIS").toUpperCase(),
        }),
      });
    } catch { /* best effort */ }
    try {
      const { notifyWhatsAppPaidAdmin } = await import("@/lib/telegram/order-notifications");
      await notifyWhatsAppPaidAdmin(orderCode).catch(() => false);
    } catch { /* cron retry via marker */ }
  }
  return NextResponse.json({ ok: true, status: "matched", order_code: orderCode });
}

function paymentHealth() {
  const siteUrl = (process.env.SITE_URL || "https://axvara.tech").replace(/\/$/, "");
  return {
    enabled: process.env.DANA_QRIS_ENABLED === "true",
    payload_configured: Boolean(process.env.DANA_STATIC_QRIS),
    webhook_configured: Boolean(process.env.DANA_WEBHOOK_SECRET),
    webhook_url: `${siteUrl}/api/webhook/dana`,
    secret_header: "X-Webhook-Secret",
    mode: "dynamic-qris",
  };
}

function clamp(value: number, min: number, max: number) {
  return Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : min;
}
