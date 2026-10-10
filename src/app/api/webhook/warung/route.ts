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
  // api-docs WR (2026-10): header baru `X-Digitals-Signature`; header lama
  // (X-Rebahan/X-Premify) masih dikirim dengan nilai sama.
  const signature =
    request.headers.get("x-digitals-signature") ||
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
  // id pengiriman resmi = `payload.id` / header X-Digitals-Delivery (WR
  // mengulang dengan id yang sama) — dipakai dedupe monotonik.
  const eventId =
    String(
      (payload as { id?: unknown }).id ||
        request.headers.get("x-digitals-delivery") ||
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
      // Akun diganti WR (garansi/replace): simpan akun terbaru + kirim ulang.
      case "order.account_updated":
        await handleWrOrderCompleted(orderId, payload.data, undefined, { accountUpdated: true });
        break;
      // `order.refunded` = event resmi api-docs WR; `order.failed` = nama lama.
      case "order.refunded":
      case "order.failed": {
        const note = String((payload.data as Record<string, unknown>)?.note ?? "").slice(0, 160);
        const reason = payload.event === "order.refunded"
          ? `refunded${note ? `: ${note}` : ""}`
          : String(payload.data?.status || "failed");
        await handleWrOrderFailed(orderId, reason, undefined, eventId);
        break;
      }
      default:
        console.warn(`Unknown WR webhook event: ${String((payload as { event?: unknown }).event)}`);
    }
  } catch (error) {
    // Semua handler idempoten + monotonik → aman diulang WR (1m/5m/30m/2j).
    // Dulu error selain link_not_found dibalas 200 sehingga WR berhenti
    // mengulang dan completion setengah jalan tertinggal (insiden 2026-10-10).
    // Penyapu cron (requeueOrphanCredentialDeliveries) tetap jadi jaring kedua.
    console.error("WR webhook processing failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "retryable" }, { status: 500 });
  }
  return NextResponse.json({ status: "ok" });
}
