// POST /api/webhook/sekalipay — Webhook receiver Sekalipay
// (order.paid/completed/canceled + order.item.sent + webhook.test).
// Edge runtime. Verifikasi SHA256(ref_id:invoice:status:secret) via
// header X-Signature (docs /webhook/security). Monotonik: completed tidak
// bisa diregresi canceled replay. Status HTTP jujur: 5xx hanya bila link
// tidak ditemukan (cron reconcile + retry admin butuh baris link).

import { NextRequest, NextResponse } from "next/server";
import { readTextBody } from "@/lib/http-body";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  isSkEnabled,
  skStatusForSignature,
  skWebhookSecretConfigured,
  verifySkWebhookSignature,
  type SkWebhookEvent,
} from "@/lib/sekalipay/client";
import {
  handleSkOrderCompleted,
  handleSkOrderFailed,
  handleSkOrderPaid,
  bindSkInvoiceByRef,
} from "@/lib/sekalipay/order";
import { applySkTransactionDetail, fetchSkGamesStatus } from "@/lib/games/sk-dispatch";
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
  const bounded = await readTextBody(request, MAX_BODY_SIZE);
  if (!bounded.ok) return bounded.response;
  const rawBody = bounded.data;
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
  // AXVARA Games (SK H2H): ref yang dikenal milik Games diproses lebih dulu,
  // tanpa menyentuh binding premium. Unknown ref tetap jalur premium di bawah.
  const gamesResponse = await handleSkGamesWebhook(payload, rawBody);
  if (gamesResponse) return gamesResponse;
  try {
    // Only after signature verification: bind the stable purchase reference
    // even when the dispatch Worker has not persisted its POST response yet.
    if (["order.paid", "order.completed", "order.canceled", "order.item.sent"].includes(payload.event)) {
      if (!(await bindSkInvoiceByRef(String(payload.data.ref_id || ""), invoice))) {
        throw new Error("sk_link_not_found");
      }
    }
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
 * Cabang webhook AXVARA Games. Hanya untuk ref yang sudah tercatat sebagai
 * attempt SK Games; GET detail menjadi sumber kebenaran (parser sama dengan
 * polling). Event durable via `dana_webhook_events` provider `sekalipay_games`.
 * Return null = bukan ref Games → jalur premium lama.
 */
async function handleSkGamesWebhook(payload: SkWebhookEvent, rawBody: string): Promise<NextResponse | null> {
  const ref = String(payload?.data?.ref_id || "").trim();
  if (!/^[A-Za-z0-9]{1,50}$/.test(ref)) return null;
  const db = createDatabaseAccess();
  const attempt = await db.queryFirst(
    `SELECT a.ref_id, a.order_code, a.sk_invoice, i.supplier
       FROM games_dispatch_attempts a JOIN games_order_items i ON i.order_code=a.order_code
      WHERE a.ref_id=?`,
    ref,
  ).catch(() => null);
  if (!attempt || String(attempt.supplier ?? "") !== "sekalipay") return null;

  const statusForSig = skStatusForSignature(String(payload.event || ""), payload.data?.status);
  const eventKey = `skgame:${ref}:${String(payload.event || "")}:${statusForSig}`.slice(0, 120);
  try {
    await db.execRun(
      `INSERT OR IGNORE INTO dana_webhook_events(event_key,payload_hash,amount,raw_text,provider,status)
       VALUES(?,?,?,?,'sekalipay_games','received')`,
      eventKey, await sha256Hex(rawBody), Math.max(0, Math.trunc(Number(payload.data?.price ?? 0) || 0)), rawBody,
    );
    const event = await db.queryFirst("SELECT status FROM dana_webhook_events WHERE event_key=?", eventKey);
    if (!event) return NextResponse.json({ error: "event_conflict" }, { status: 409 });
    if (event.status === "matched" || event.status === "ignored") return NextResponse.json({ ok: true, duplicate: true });

    const invoiceHint = String(payload.data?.invoice || "").trim() || null;
    // GET authoritative memakai REF milik kita, bukan invoice dari payload.
    const detail = await fetchSkGamesStatus(ref);
    const fetchedInvoice = String(detail?.invoice || "").trim() || null;
    // Hint salah tidak boleh mem-poison invoice tersimpan atau memindahkan order.
    if (invoiceHint && fetchedInvoice && invoiceHint !== fetchedInvoice) {
      await db.execRun(
        "UPDATE dana_webhook_events SET status='failed',last_error='invoice_hint_mismatch' WHERE event_key=? AND status='received'",
        eventKey,
      );
      return NextResponse.json({ error: "retryable" }, { status: 503 });
    }
    // Invoice tersimpan tetap otoritas: apply membandingkannya dengan GET dan
    // fail-closed (needs_check) bila berbeda; hint tidak pernah di-persist.
    const outcome = await applySkTransactionDetail(db, detail, { refId: ref, invoiceHint: null });
    if (outcome === "unknown_ref" || outcome === "ignored") {
      await db.execRun(
        "UPDATE dana_webhook_events SET status='ignored',last_error=?,processed_at=datetime('now') WHERE event_key=? AND status!='matched'",
        outcome, eventKey,
      );
      return NextResponse.json({ ok: true, ignored: true });
    }
    await db.execRun(
      `UPDATE dana_webhook_events SET status='matched',last_error=NULL,processed_at=datetime('now'),order_code=?
        WHERE event_key=? AND status!='matched'`,
      String(attempt.order_code), eventKey,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    try {
      await db.execRun(
        "UPDATE dana_webhook_events SET status='failed',last_error='sk_games_apply_retry' WHERE event_key=? AND status NOT IN ('matched','ignored')",
        eventKey,
      );
    } catch { /* best-effort */ }
    console.error("SK Games webhook processing failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "retryable" }, { status: 503 });
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
