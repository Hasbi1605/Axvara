// POST /api/webhook/warung — Webhook receiver Warung Rebahan (order.processing/completed/failed).
// Edge runtime. Verifikasi HMAC-SHA256 via X-Rebahan-Signature; selalu 200 ke WR
// setelah verifikasi agar WR tidak retry membabi-buta.

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
  if (!checkRateLimit(request, "orders:lookup")) {
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
  try {
    switch (payload.event) {
      case "order.processing":
        await handleWrOrderProcessing(orderId);
        break;
      case "order.completed":
        await handleWrOrderCompleted(orderId, payload.data);
        break;
      case "order.failed":
        await handleWrOrderFailed(orderId, String(payload.data?.status || "failed"));
        break;
      default:
        console.warn(`Unknown WR webhook event: ${String((payload as { event?: unknown }).event)}`);
    }
  } catch (error) {
    console.error("WR webhook processing failed:", error instanceof Error ? error.message : "unknown");
    // Tetap 200: state webhook WR tidak menentukan retry kita (cron reconcile
    // yang menentukan). 5xx hanya membuat WR mengirim ulang event yang sama.
  }
  return NextResponse.json({ status: "ok" });
}
