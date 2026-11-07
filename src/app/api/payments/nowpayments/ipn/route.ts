import { NextRequest, NextResponse } from "next/server";
import { readTextBody } from "@/lib/http-body";
import { execRun, queryFirst } from "@/lib/db";
import { isValidBuyerOrderCode } from "@/lib/security";
import {
  NOWPAYMENTS_IPN_PATH,
  claimNowpaymentsPollReconcile,
  readNowpaymentsBodyLimit,
  reconcileNowpaymentsPayment,
  verifyNowpaymentsSignature,
} from "@/lib/payments/nowpayments";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// IPN terverifikasi → dedupe durable → reconcile via waitUntil (cron memulihkan).
export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }
  const bounded = await readTextBody(request, readNowpaymentsBodyLimit());
  if (!bounded.ok) return bounded.response;
  const raw = bounded.data;
  const signature = request.headers.get("x-nowpayments-sig");
  if (!signature) return NextResponse.json({ error: "missing_signature" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_callback" }, { status: 400 });
  }
  if (!(await verifyNowpaymentsSignature(raw, signature))) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  const orderId = String(body.order_id ?? body.orderId ?? "");
  const paymentId = String(body.payment_id ?? body.paymentId ?? "");
  if (!isValidBuyerOrderCode(orderId) || !/^[A-Za-z0-9:_-]{1,128}$/.test(paymentId)) {
    return NextResponse.json({ error: "invalid_callback" }, { status: 400 });
  }
  const tx = await queryFirst(
    "SELECT provider_payment_id,requested_amount FROM payment_transactions WHERE order_code=? AND provider='nowpayments'",
    orderId,
  );
  if (!tx) return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });
  if (String(tx.provider_payment_id ?? "") !== paymentId) {
    return NextResponse.json({ error: "callback_mismatch" }, { status: 400 });
  }
  const providerStatus = String(body.payment_status ?? body.paymentStatus ?? "");
  const eventKey = `nowpayments:${paymentId}:${providerStatus || "unknown"}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(eventKey));
  const hash = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
  await execRun(
    `INSERT OR IGNORE INTO dana_webhook_events(event_key,payload_hash,amount,raw_text,provider,status,order_code)
     VALUES(?,?,?,?,'nowpayments','received',?)`,
    eventKey, hash, Number(tx.requested_amount), raw.slice(0, 4000), orderId,
  );
  const event = await queryFirst("SELECT status FROM dana_webhook_events WHERE event_key=?", eventKey);
  if (event && String(event.status) === "matched") {
    return NextResponse.json({ ok: true, status: "duplicate" });
  }
  const task = (async () => {
    try {
      const claimed = await claimNowpaymentsPollReconcile(orderId);
      const status = claimed ? await reconcileNowpaymentsPayment(orderId) : "deferred";
      if (claimed && status !== "paid" && status !== "already_paid") throw new Error(`ipn_reconcile_${status}`);
    } catch {
      await execRun(
        "UPDATE dana_webhook_events SET status='failed',last_error=COALESCE(last_error,'ipn_reconcile_deferred'),processed_at=datetime('now') WHERE event_key=? AND status='received'",
        eventKey,
      ).catch(() => {});
    }
  })();
  try {
    const { getRequestContext } = await import("@cloudflare/next-on-pages");
    getRequestContext().ctx.waitUntil(task);
  } catch {
    await task;
  }
  void NOWPAYMENTS_IPN_PATH;
  return NextResponse.json({ ok: true, status: "received" });
}
