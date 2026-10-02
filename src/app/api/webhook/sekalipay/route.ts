// POST /api/webhook/sekalipay — Webhook receiver Sekalipay
// (order.paid/completed/canceled + order.item.sent + webhook.test).
// Edge runtime. Verifikasi SHA256(ref_id:invoice:status:secret) via
// header X-Signature (docs /webhook/security). Monotonik: completed tidak
// bisa diregresi canceled replay. Status HTTP jujur: 5xx hanya bila link
// tidak ditemukan (cron reconcile + retry admin butuh baris link).

import { NextRequest, NextResponse } from "next/server";
import {
  isSkEnabled,
  skWebhookSecretConfigured,
  verifySkWebhookSignature,
  type SkWebhookEvent,
} from "@/lib/sekalipay/client";
import {
  handleSkOrderCompleted,
  handleSkOrderFailed,
  handleSkOrderPaid,
} from "@/lib/sekalipay/order";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_BODY_SIZE = 32_000;

export async function POST(request: NextRequest) {
  if (!isSkEnabled()) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }
  if (!checkRateLimit(request, "webhook:sekalipay")) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!skWebhookSecretConfigured()) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }
  const rawBody = await request.text().catch(() => "");
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_SIZE) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  let payload: SkWebhookEvent;
  try {
    payload = JSON.parse(rawBody) as SkWebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const invoice = String(payload?.data?.invoice || "").slice(0, 120);
  if (!payload?.event || !invoice) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const signature = request.headers.get("x-signature") || "";
  const valid = await verifySkWebhookSignature(payload, signature);
  if (!valid) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  // Event ID provider untuk dedupe (bila SK mengirimnya di data/header).
  const eventId =
    String(
      (payload.data as Record<string, unknown>)?.event_id ||
        request.headers.get("x-sekalipay-event-id") ||
        "",
    ).slice(0, 120) || undefined;
  try {
    switch (payload.event) {
      case "order.paid":
        await handleSkOrderPaid(invoice, undefined, eventId);
        await notifySkProcessingBestEffort(invoice);
        break;
      case "order.completed":
        await handleSkOrderCompleted(invoice, payload.data);
        break;
      case "order.canceled":
        await handleSkOrderFailed(invoice, "canceled_by_provider", undefined, eventId);
        break;
      case "order.item.sent":
        // Fase 1 hanya auto (lisensi langsung di completed) — event per-item
        // produk manual dicatat sebagai paid agar observable, tanpa settle.
        await handleSkOrderPaid(invoice, undefined, eventId);
        await notifySkProcessingBestEffort(invoice);
        break;
      case "webhook.test":
        break;
      default:
        console.warn(`Unknown SK webhook event: ${String((payload as { event?: unknown }).event)}`);
    }
  } catch (error) {
    console.error("SK webhook processing failed:", error instanceof Error ? error.message : "unknown");
    const message = error instanceof Error ? error.message : "";
    if (/sk_link_not_found|sekalipay_disabled/i.test(message)) {
      return NextResponse.json({ error: "retryable" }, { status: 500 });
    }
  }
  return NextResponse.json({ status: "ok" });
}

/**
 * Kabar "Pesanan Diproses" ke pembeli saat SK mulai memproses (order.paid /
 * order.item.sent). Best-effort: webhook harus jawab 2xx cepat, email tidak
 * boleh menahannya. Join invoice → order_code via sk_order_links; tanpa link
 * = bukan order Axvara (mis. sandbox) → diam.
 */
async function notifySkProcessingBestEffort(skInvoice: string): Promise<void> {
  try {
    const { createDatabaseAccess } = await import("@/lib/db-access");
    const db = createDatabaseAccess();
    const link = await db
      .queryFirst(`SELECT order_code FROM sk_order_links WHERE sk_invoice=?`, skInvoice)
      .catch(() => null);
    const orderCode = String(link?.order_code || "").trim();
    if (!orderCode) return;
    const { notifyBuyerSkProcessing } = await import("@/lib/notify-buyer");
    await notifyBuyerSkProcessing(orderCode, skInvoice, db);
  } catch { /* kabar best-effort; webhook tetap ok */ }
}
