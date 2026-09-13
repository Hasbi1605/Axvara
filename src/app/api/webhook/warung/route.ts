// POST /api/webhook/warung — Webhook receiver Warung Rebahan (order.processing/completed/failed).
// Edge runtime. Verifikasi HMAC-SHA256 via X-Rebahan-Signature.
// Monotonik (P1-7): completed tidak bisa diregresi failed replay.
// Status HTTP jujur: 5xx hanya bila recovery durable tidak tersedia.

import { NextRequest, NextResponse } from "next/server";
import {
  isWrEnabled,
  verifyWebhookSignature,
  wrWebhookSecretConfigured,
  type WrWebhookEvent,
} from "@/lib/warung-rebahan/client";
import {
  handleWrOrderCompleted,
  handleWrOrderFailed,
  handleWrOrderProcessing,
} from "@/lib/warung-rebahan/order";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_BODY_SIZE = 32_000;

export async function POST(request: NextRequest) {
  if (!isWrEnabled()) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }
  // Scope rate-limit khusus webhook (P2): bukan orders:lookup.
  if (!checkRateLimit(request, "webhook:warung")) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!wrWebhookSecretConfigured()) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }
  const rawBody = await request.text().catch(() => "");
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_SIZE) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const signature =
    request.headers.get("x-rebahan-signature") ||
    request.headers.get("x-warung-signature") ||
    "";
  const valid = await verifyWebhookSignature(rawBody, signature);
  if (!valid) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  let payload: WrWebhookEvent;
  try {
    payload = JSON.parse(rawBody) as WrWebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const orderId = String(payload?.data?.order_id || "").slice(0, 120);
  if (!payload?.event || !orderId) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  // Event ID provider untuk dedupe (bila WR mengirimnya di data/header).
  const eventId =
    String(
      (payload.data as Record<string, unknown>)?.event_id ||
        request.headers.get("x-rebahan-event-id") ||
        "",
    ).slice(0, 120) || undefined;
  try {
    switch (payload.event) {
      case "order.processing":
        await handleWrOrderProcessing(orderId, undefined, eventId);
        break;
      case "order.completed":
        await handleWrOrderCompleted(orderId, payload.data);
        break;
      case "order.failed":
        await handleWrOrderFailed(orderId, String(payload.data?.status || "failed"), undefined, eventId);
        break;
      default:
        console.warn(`Unknown WR webhook event: ${String((payload as { event?: unknown }).event)}`);
    }
  } catch (error) {
    console.error("WR webhook processing failed:", error instanceof Error ? error.message : "unknown");
    // 500 HANYA bila link tidak ditemukan (tidak ada recovery yang bisa
    // berjalan — cron reconcile dan retry admin butuh baris link). Bila link
    // ada, state sudah durable (monotonik + delivery queue) sehingga 200
    // aman: retry WR hanya mengulang dedupe yang idempoten.
    const message = error instanceof Error ? error.message : "";
    if (/wr_link_not_found|warung_rebahan_disabled/i.test(message)) {
      return NextResponse.json({ error: "retryable" }, { status: 500 });
    }
  }
  return NextResponse.json({ status: "ok" });
}
