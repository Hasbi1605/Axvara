// POST /api/webhook/warung — Webhook receiver Warung Rebahan (order.* + jaspay.*).
// Edge runtime. Verifikasi HMAC-SHA256: primer X-Digitals-Signature
// (Jaspay WAJIB primer bila hadir — primer invalid tidak fallback ke
// legacy), alias X-Rebahan/X-Warung/X-Premify tetap diterima.
// Monotonik (P1-7): completed tidak bisa diregresi failed replay.
// Status HTTP jujur: 5xx hanya bila recovery durable tidak tersedia.

import { NextRequest, NextResponse } from "next/server";
import { readTextBody } from "@/lib/http-body";
import {
  isWrEnabled,
  verifyWebhookSignature,
  wrWebhookSecretConfigured,
  type JaspayWebhookEvent,
  type WrWebhookEvent,
} from "@/lib/warung-rebahan/client";
import {
  handleWrOrderCompleted,
  handleWrOrderFailed,
  handleWrOrderProcessing,
} from "@/lib/warung-rebahan/order";
import { jaspayAmount } from "@/lib/warung-rebahan/jaspay";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_BODY_SIZE = 32_000;

function isJaspayEventName(event: unknown): boolean {
  return typeof event === "string" && event.startsWith("jaspay.");
}

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
  const bounded = await readTextBody(request, MAX_BODY_SIZE);
  if (!bounded.ok) return bounded.response;
  const rawBody = bounded.data;
  let probe: { event?: unknown; data?: Record<string, unknown> } | null = null;
  try {
    probe = JSON.parse(rawBody) as { event?: unknown; data?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const jaspay = isJaspayEventName(probe?.event);
  // Primer X-Digitals-Signature; alias legacy X-Rebahan/X-Warung/X-Premify.
  // Jaspay: primer hadir tapi invalid => 401 TANPA fallback ke legacy valid.
  const primary = request.headers.get("x-digitals-signature") || "";
  const legacy =
    request.headers.get("x-rebahan-signature") ||
    request.headers.get("x-warung-signature") ||
    request.headers.get("x-premify-signature") ||
    "";
  if (jaspay && primary) {
    const primaryValid = await verifyWebhookSignature(rawBody, primary);
    if (!primaryValid) {
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
  } else {
    const signature = primary || legacy;
    const valid = await verifyWebhookSignature(rawBody, signature);
    if (!valid) {
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
  }
  let payload: WrWebhookEvent | JaspayWebhookEvent;
  try {
    payload = JSON.parse(rawBody) as WrWebhookEvent | JaspayWebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
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
  // ── Cabang Jaspay: event jaspay.* + data.invoice (BUKAN data.order_id).
  // Invoice JSP milik link `jaspay:` saja — handler menolak famili salah.
  if (isJaspayEventName(payload?.event)) {
    const invoice = String((payload.data as Record<string, unknown>)?.invoice || "").slice(0, 120);
    if (!payload?.event || !invoice) {
      return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }
    try {
      const { handleJaspayTerminal } = await import("@/lib/warung-rebahan/deliver");
      const { createDatabaseAccess } = await import("@/lib/db-access");
      const db = createDatabaseAccess();
      let handled = true;
      switch ((payload as JaspayWebhookEvent).event) {
        case "jaspay.completed":
        case "jaspay.partial":
        case "jaspay.failed":
        case "jaspay.refunded": {
          const data = (payload as JaspayWebhookEvent).data;
          const name = String((payload as JaspayWebhookEvent).event).slice("jaspay.".length);
          // Refund saldo dapat terjadi tanpa kegagalan produk. Kirim nominal
          // kumulatif dan status eksplisit, bukan menebak hasil dari nama event.
          handled = await handleJaspayTerminal(invoice, {
            invoice,
            status: name === "completed" || name === "partial" || name === "failed" ? name
              : data.status === "failed" ? "failed" : "processing",
            refunded_event: name === "refunded",
            product: String(data.product ?? ""),
            package: typeof data.package === "string" ? data.package : undefined,
            total: jaspayAmount(data.total),
            refunded: jaspayAmount(data.refunded),
            quantity: Number(data.quantity ?? 0) || 0,
            success_count: Number(data.success_count ?? 0) || 0,
            accounts: Array.isArray(data.accounts) ? data.accounts : [],
            raw: data,
          }, db);
          break;
        }
        default: {
          // Event terminal tak dikenal: persist observable + 503 (WR
          // mengulang), TANPA ack sukses sebelum persist.
          try {
            await db.execRun(
              `INSERT INTO wr_webhook_events (wr_order_id, event, event_id, applied, result)
               VALUES (?,?,?,?,?)`,
              invoice,
              String((payload as { event?: unknown }).event),
              eventId ?? null,
              0,
              "unknown_jaspay_event",
            );
          } catch {
            return NextResponse.json({ error: "retryable" }, { status: 503, headers: { "Retry-After": "60" } });
          }
          console.warn(`Unknown Jaspay webhook event: ${String((payload as { event?: unknown }).event)}`);
          return NextResponse.json({ error: "retryable" }, { status: 503, headers: { "Retry-After": "60" } });
        }
      }
      if (!handled) return NextResponse.json({ error: "retryable" }, { status: 503, headers: { "Retry-After": "60" } });
    } catch (error) {
      console.error("Jaspay webhook processing failed:", error instanceof Error ? error.message : "unknown");
      return NextResponse.json({ error: "retryable" }, { status: 500 });
    }
    return NextResponse.json({ status: "ok" });
  }
  const orderId = String((payload as WrWebhookEvent)?.data?.order_id || "").slice(0, 120);
  if (!payload?.event || !orderId) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  try {
    let handled = true;
    switch ((payload as WrWebhookEvent).event) {
      case "order.processing":
        await handleWrOrderProcessing(orderId, undefined, eventId);
        break;
      case "order.completed":
        handled = await handleWrOrderCompleted(orderId, (payload as WrWebhookEvent).data);
        break;
      // Akun diganti WR (garansi/replace): simpan akun terbaru + kirim ulang.
      case "order.account_updated":
        handled = await handleWrOrderCompleted(orderId, (payload as WrWebhookEvent).data, undefined, { accountUpdated: true });
        break;
      // `order.refunded` = event resmi api-docs WR; `order.failed` = nama lama.
      case "order.refunded":
      case "order.failed": {
        const note = String(((payload as WrWebhookEvent).data as Record<string, unknown>)?.note ?? "").slice(0, 160);
        const reason = (payload as WrWebhookEvent).event === "order.refunded"
          ? `refunded${note ? `: ${note}` : ""}`
          : String((payload as WrWebhookEvent).data?.status || "failed");
        handled = await handleWrOrderFailed(orderId, reason, undefined, eventId);
        break;
      }
      default:
        console.warn(`Unknown WR webhook event: ${String((payload as { event?: unknown }).event)}`);
    }
    if (!handled) return NextResponse.json({ error: "retryable" }, { status: 503, headers: { "Retry-After": "60" } });
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
