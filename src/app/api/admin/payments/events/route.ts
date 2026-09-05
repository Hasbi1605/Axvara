import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { execRun, isD1Mode, queryAll, queryFirst, transitionPendingPaymentToPaid } from "@/lib/db";
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
  const body = await request.json().catch(() => null) as { event_id?: number; action?: string } | null;
  const eventId = Number(body?.event_id || 0);
  if (!eventId || body?.action !== "retry_match") return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const event = await queryFirst("SELECT id,amount,status,order_code FROM dana_webhook_events WHERE id=?", eventId);
  if (!event) return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  if (String(event.status) === "matched") return NextResponse.json({ ok: true, status: "already_matched", order_code: event.order_code });

  const matches = await queryAll(
    `SELECT pt.order_code,o.sales_channel,o.channel_conversation_id
     FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code
     WHERE pt.provider='dana' AND pt.payable_amount=? AND pt.status='pending'
       AND o.status='pending' AND datetime(pt.expires_at)>datetime('now') LIMIT 2`,
    Number(event.amount),
  );
  if (matches.length !== 1) {
    await execRun("UPDATE dana_webhook_events SET status='ignored',last_error=?,processed_at=datetime('now') WHERE id=?", matches.length > 1 ? "multiple_active_exact_amount" : "no_active_exact_amount", eventId);
    return NextResponse.json({ error: matches.length > 1 ? "multiple_active_exact_amount" : "no_active_exact_amount" }, { status: 409 });
  }

  const orderCode = String(matches[0].order_code);
  const transitioned = await transitionPendingPaymentToPaid(orderCode, new Date().toISOString());
  const paid = transitioned || Boolean(await queryFirst("SELECT code FROM orders WHERE code=? AND status='lunas' AND payment_status='paid'", orderCode));
  if (!paid) {
    await execRun("UPDATE dana_webhook_events SET status='failed',order_code=?,last_error='payment_transition_failed',processed_at=datetime('now') WHERE id=?", orderCode, eventId);
    return NextResponse.json({ error: "payment_transition_failed" }, { status: 409 });
  }
  await execRun("UPDATE dana_webhook_events SET status='matched',order_code=?,last_error=NULL,processed_at=datetime('now') WHERE id=?", orderCode, eventId);
  try { await ensureFulfillmentForPaidOrder(orderCode); } catch { /* Cron akan retry idempoten. */ }
  if (String(matches[0].sales_channel) === "whatsapp" && matches[0].channel_conversation_id) {
    try { await sendTextMessage({ target: String(matches[0].channel_conversation_id), message: paymentDetectedMessage(orderCode) }); } catch { /* best effort */ }
  }
  return NextResponse.json({ ok: true, status: "matched", order_code: orderCode });
}

function paymentHealth() {
  return {
    enabled: process.env.DANA_QRIS_ENABLED === "true",
    payload_configured: Boolean(process.env.DANA_STATIC_QRIS),
    webhook_configured: Boolean(process.env.DANA_WEBHOOK_SECRET),
    mode: "dynamic-qris",
  };
}

function clamp(value: number, min: number, max: number) {
  return Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : min;
}
