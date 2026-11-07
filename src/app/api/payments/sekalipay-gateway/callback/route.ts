import { NextRequest, NextResponse } from "next/server";
import { readTextBody } from "@/lib/http-body";
import { execRun, queryFirst } from "@/lib/db";
import { reconcileSekalipayGatewayPayment, verifyGatewayWebhook, gatewayHmac } from "@/lib/payments/sekalipay-gateway";
import { parseFxTimestamp } from "@/lib/payments/fx";
import { isValidBuyerOrderCode } from "@/lib/security";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  const bounded = await readTextBody(request, 16000);
  if (!bounded.ok) return bounded.response;
  const secret = process.env.SEKALIPAY_GATEWAY_SECRET_KEY?.trim();
  const signature = request.headers.get("x-signature") ?? "";
  if (!secret || !await verifyGatewayWebhook(secret, bounded.data, signature)) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(bounded.data); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || typeof body.merchant_ref_id !== "string" || !isValidBuyerOrderCode(body.merchant_ref_id)
    || typeof body.invoice !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(body.invoice)
    || (body.status !== "paid" && body.status !== "completed")
    || !Number.isSafeInteger(body.amount) || !Number.isSafeInteger(body.fee) || !Number.isSafeInteger(body.total)
    || Number(body.amount) < 100 || Number(body.fee) < 0 || Number(body.amount) + Number(body.fee) !== body.total
    || typeof body.paid_at !== "string" || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(body.paid_at)
    || !parseFxTimestamp(body.paid_at.replace(" ", "T") + "+07:00")) return NextResponse.json({ error: "invalid_callback" }, { status: 400 });
  const code = body.merchant_ref_id;
  const tx = await queryFirst("SELECT provider_payment_id,requested_amount,payable_amount,gateway_fee,gateway_estimated_fee FROM payment_transactions WHERE order_code=? AND provider='sekalipay_gateway'", code);
  if (!tx) return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });
  if (tx.requested_amount !== body.amount || (tx.provider_payment_id != null && tx.provider_payment_id !== body.invoice)
    || (tx.payable_amount != null && (tx.payable_amount !== body.total || tx.gateway_fee !== body.fee))) {
    await execRun("UPDATE payment_transactions SET last_error=CASE WHEN last_error IS NULL OR last_error IN ('sekalipay_gateway_finalize_probe','sekalipay_gateway_finalize_manual_review') THEN 'sekalipay_gateway_callback_mismatch_manual_review' ELSE last_error END,updated_at=datetime('now') WHERE order_code=? AND provider='sekalipay_gateway' AND status!='paid'", code);
    return NextResponse.json({ error: "callback_mismatch" }, { status: 409 });
  }
  if (tx.payable_amount == null && tx.gateway_estimated_fee !== body.fee) {
    await execRun("UPDATE payment_transactions SET last_error=CASE WHEN last_error IS NULL OR last_error IN ('sekalipay_gateway_finalize_probe','sekalipay_gateway_finalize_manual_review') THEN 'sekalipay_gateway_preconsent_manual_review' ELSE last_error END,updated_at=datetime('now') WHERE order_code=? AND provider='sekalipay_gateway' AND status='initializing'", code);
  }
  const eventKey = `sekalipaygw:${body.invoice}:${body.status}`;
  await execRun(`INSERT OR IGNORE INTO dana_webhook_events(event_key,payload_hash,amount,raw_text,provider,status,order_code)
    VALUES(?,?,?,?,'sekalipay_gateway','received',?)`, eventKey, await gatewayHmac("gateway-event-key", eventKey), body.total, bounded.data, code);
  const event = await queryFirst("SELECT provider,order_code,amount,status FROM dana_webhook_events WHERE event_key=?", eventKey);
  if (!event || event.provider !== "sekalipay_gateway" || event.order_code !== code || event.amount !== body.total) return NextResponse.json({ error: "event_conflict" }, { status: 409 });
  if (event.status === "matched") return NextResponse.json({ ok: true, status: "duplicate" });
  try {
    const state = await reconcileSekalipayGatewayPayment(code);
    if (state === "pending") throw new Error("status_pending");
    if (state === "manual_review") await execRun("UPDATE dana_webhook_events SET status='failed',last_error='sekalipay_gateway_manual_review' WHERE event_key=? AND status!='matched'", eventKey);
    return NextResponse.json({ ok: true, status: state });
  } catch {
    await execRun("UPDATE dana_webhook_events SET status='failed',last_error='sekalipay_gateway_reconcile_retry' WHERE event_key=? AND status!='matched'", eventKey);
    return NextResponse.json({ error: "reconcile_retry" }, { status: 503 });
  }
}
