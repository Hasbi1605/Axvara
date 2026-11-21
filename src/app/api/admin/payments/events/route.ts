import { DANA_AMOUNT_REUSED_SQL } from "@/lib/payments/dana-history";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { readJsonBody } from "@/lib/http-body";
import { execRun, isD1Mode, queryAll, queryFirst, transitionPendingPaymentToPaid } from "@/lib/db";
import { isFutureIso } from "@/lib/expiry";
import { activeQrisProvider, isCausallyPlausiblePayment } from "@/lib/payments/qris";
import { schedulePaidFulfillment } from "@/lib/payments/paid-fulfillment";
import { PAYMENT_ATTENTION_SQL, PAYMENT_ATTENTION_WHERE } from "@/lib/admin-overview-queries";

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
  if (!isD1Mode()) return NextResponse.json({ events: [], counts: {}, attention: 0, pagination: { page: 1, pages: 1, total: 0 }, last_event_at: null, health });

  const conditions: string[] = [];
  if (status === "attention") conditions.push(PAYMENT_ATTENTION_WHERE);
  else if (["received", "matched", "ignored", "failed"].includes(status)) conditions.push("status=?");
  const bindings: unknown[] = status !== "attention" && ["received", "matched", "ignored", "failed"].includes(status) ? [status] : [];
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const offset = (page - 1) * limit;
  const [events, totalRow, countRows, lastRows, attentionRow] = await Promise.all([
    queryAll(`SELECT id,amount,sender_name,status,order_code,last_error,created_at,processed_at,reviewed_by,review_note,COALESCE(provider,'dana') AS provider
      FROM dana_webhook_events${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...bindings, limit, offset),
    queryFirst(`SELECT COUNT(*) AS count FROM dana_webhook_events${where}`, ...bindings),
    // Event yang sudah ditandai "sudah dicek" tidak lagi dihitung sebagai
    // status yang butuh tindakan, sehingga jumlah "Perlu dicek" di UI sama
    // dengan definisi bersama (PAYMENT_ATTENTION_WHERE).
    queryAll("SELECT status AS value,COUNT(*) AS count FROM dana_webhook_events WHERE reviewed_by IS NULL OR status='matched' GROUP BY status"),
    queryAll("SELECT COALESCE(provider,'dana') AS provider,MAX(created_at) AS created_at FROM dana_webhook_events GROUP BY COALESCE(provider,'dana')"),
    queryFirst(PAYMENT_ATTENTION_SQL),
  ]);
  for (const row of lastRows) {
    if (row.provider === "gopay" || row.provider === "klikqris") health.providers[row.provider].last_event_at = String(row.created_at);
  }
  health.last_event_at = health.provider ? health.providers[health.provider].last_event_at : null;
  const total = Number(totalRow?.count || 0);
  return NextResponse.json({
    events,
    counts: Object.fromEntries(countRows.map((row) => [String(row.value), Number(row.count || 0)])),
    attention: Number(attentionRow?.count || 0),
    pagination: { page, pages: Math.max(1, Math.ceil(total / limit)), total },
    last_event_at: lastRows.map(row => String(row.created_at)).sort().at(-1) || null,
    health,
  });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isD1Mode()) return NextResponse.json({ error: "d1_required" }, { status: 503 });
  const bounded = await readJsonBody(request, 8_000);
  if (!bounded.ok) return bounded.response;
  const body = bounded.data as { event_id?: number; action?: string; order_code?: string; review_note?: string; note?: string; verified?: boolean } | null;
  const eventId = Number(body?.event_id || 0);
  if (body?.action === "mark_reviewed") return markReviewed(admin.email, eventId, body?.note ?? body?.review_note);
  const manual = body?.action === "confirm_match";
  if (!eventId || !["retry_match", "confirm_match"].includes(String(body?.action))) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  if (manual && (body?.verified !== true || typeof body.order_code !== "string" || !body.order_code.trim()
    || typeof body.review_note !== "string" || body.review_note.trim().length < 10 || body.review_note.length > 500)) {
    return NextResponse.json({ error: "manual_verification_required" }, { status: 400 });
  }
  const event = await queryFirst("SELECT id,amount,status,order_code,created_at,provider,reviewed_by FROM dana_webhook_events WHERE id=?", eventId);
  if (!event) return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  const eventProvider = event.provider ?? "dana";
  if (eventProvider === "klikqris") return NextResponse.json({ error: "klikqris_requires_manual_review", message: "Periksa pembayaran KlikQRIS dan stok secara manual. Pelunasan otomatis setelah 15 menit tidak diizinkan." }, { status: 409 });
  if (eventProvider !== "dana" && eventProvider !== "gopay") return NextResponse.json({ error: "provider_requires_manual_review" }, { status: 409 });
  if (String(event.status) === "matched") return NextResponse.json({ ok: true, status: "already_matched", order_code: event.order_code });
  // Event yang sudah ditandai "sudah dicek" bersifat terminal: tidak boleh
  // dicocokkan ulang secara diam-diam karena admin sudah menyatakan selesai.
  if (event.reviewed_by != null) return NextResponse.json({ error: "event_reviewed", message: "Event ini sudah ditandai sudah dicek." }, { status: 409 });
  // Retry mengikuti provider event (dana vs gopay) agar nominal silang
  // provider tidak saling klaim. Event lama tanpa provider = dana.

  // Same canonical JS expiry check as the webhook: an admin retry must
  // never resurrect an already-expired invoice. Same causal guard: an event
  // observed before the candidate invoice was issued cannot be its payment
  // (issue #2) — it stays in reconciliation instead of settling the order.
  const candidates = await queryAll(
    `SELECT pt.order_code,pt.expires_at,COALESCE(pt.invoice_issued_at,pt.created_at) AS invoice_created_at,o.expires_at AS order_expires_at,o.sales_channel,o.order_kind,
       ${DANA_AMOUNT_REUSED_SQL} AS amount_history
     FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code
     WHERE pt.provider=? AND pt.payable_amount=? AND pt.status='pending'
       AND o.status='pending' LIMIT 3`,
    eventProvider, Number(event.amount),
  );
  const live = candidates.filter((row) => isFutureIso(row.expires_at) && isFutureIso(row.order_expires_at));
  const matches = live.filter((row) =>
    isCausallyPlausiblePayment(event.created_at, row.invoice_created_at)
      && (!manual || row.order_code === body?.order_code?.trim()),
  );
  if (matches.length !== 1) {
    const reason = live.length >= 1 && matches.length === 0
      ? "event_predates_invoice"
      : matches.length > 1 ? "multiple_active_exact_amount" : "no_active_exact_amount";
    await execRun("UPDATE dana_webhook_events SET status='ignored',last_error=?,processed_at=datetime('now') WHERE id=? AND status IN ('received','ignored','failed') AND reviewed_by IS NULL", reason, eventId);
    return NextResponse.json({ error: reason }, { status: 409 });
  }

  const orderCode = String(matches[0].order_code);
  if (!manual && Number(matches[0].amount_history) > 0) {
    await execRun("UPDATE dana_webhook_events SET status='ignored',last_error='amount_reused_requires_review',processed_at=datetime('now') WHERE id=? AND status IN ('received','ignored','failed') AND reviewed_by IS NULL", eventId);
    return NextResponse.json({ error: "amount_reused_requires_review" }, { status: 409 });
  }
  // Same atomic paid+job batch as the webhook (issue #3): the retry path
  // must not reintroduce the crash window either.
  const fulfillmentRouting = ["pedia", "games"].includes(String(matches[0].order_kind)) ? null : await queryFirst(
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
    const consumed = await queryFirst("SELECT status,order_code,reviewed_by FROM dana_webhook_events WHERE id=?", eventId);
    if (consumed?.status === "matched") return NextResponse.json({ ok: true, status: "already_matched", order_code: consumed.order_code });
    if (consumed?.reviewed_by != null) return NextResponse.json({ error: "event_reviewed" }, { status: 409 });
    await execRun("UPDATE dana_webhook_events SET status='failed',order_code=?,last_error='payment_transition_failed',processed_at=datetime('now') WHERE id=? AND status IN ('received','ignored','failed') AND reviewed_by IS NULL", orderCode, eventId);
    return NextResponse.json({ error: "payment_transition_failed" }, { status: 409 });
  }
  await schedulePaidFulfillment(orderCode, matches[0].order_kind, manual ? "admin_confirm_match" : "admin_retry_match");
  if (String(matches[0].sales_channel) === "whatsapp") {
    try {
      const { notifyWhatsAppPaidAdmin } = await import("@/lib/telegram/order-notifications");
      await notifyWhatsAppPaidAdmin(orderCode).catch(() => false);
    } catch { /* cron retry via marker */ }
  }
  return NextResponse.json({ ok: true, status: "matched", order_code: orderCode });
}

function paymentHealth() {
  const siteUrl = (process.env.SITE_URL || "https://axvara.tech").replace(/\/$/, "");
  const provider = activeQrisProvider();
  const providers = {
    klikqris: {
      enabled: process.env.KLIKQRIS_ENABLED === "true",
      payload_configured: Boolean(process.env.KLIKQRIS_API_KEY?.trim()),
      webhook_configured: Boolean(process.env.KLIKQRIS_MERCHANT_ID?.trim()),
      webhook_url: `${siteUrl}/api/payments/klikqris/callback`,
      secret_header: "signature (JSON body)", last_event_at: null as string | null,
    },
    gopay: {
      enabled: process.env.GOPAY_QRIS_ENABLED === "true",
      payload_configured: Boolean(process.env.GOPAY_STATIC_QRIS?.trim()),
      webhook_configured: Boolean(process.env.GOPAY_POLLER_SECRET?.trim()),
      webhook_url: `${siteUrl}/api/webhook/gopay`,
      secret_header: "X-Poller-Secret",
      last_event_at: null as string | null,
    },
  };
  return {
    ...(provider ? providers[provider] : {
      enabled: false, payload_configured: false, webhook_configured: false,
      webhook_url: "", secret_header: "", last_event_at: null,
    }),
    provider,
    providers,
    mode: "dynamic-qris",
  };
}

function clamp(value: number, min: number, max: number) {
  return Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : min;
}

/**
 * POST { action:"mark_reviewed", event_id, note } — tandai event rekonsiliasi
 * "sudah dicek" (keputusan owner 13 November 2026). Catatan wajib (min 5
 * karakter) karena tindakan ini menghentikan badge; jejak admin disimpan di
 * reviewed_by/review_note. HANYA menyentuh dana_webhook_events: order, ledger,
 * dan status pembayaran tidak pernah diubah. Status akhir = `ignored`
 * (terminal) dan idempoten — panggilan kedua mengembalikan already_reviewed.
 */
async function markReviewed(adminEmail: string, eventId: number, rawNote: unknown) {
  if (!eventId) return NextResponse.json({ error: "invalid_request", message: "event_id wajib diisi." }, { status: 400 });
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (note.length < 5 || note.length > 500) {
    return NextResponse.json({ error: "note_required", message: "Catatan wajib diisi (5–500 karakter)." }, { status: 400 });
  }
  const event = await queryFirst("SELECT id, status, reviewed_by FROM dana_webhook_events WHERE id=?", eventId);
  if (!event) return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  const status = String(event.status);
  // Status yang menunggu tindakan = definisi bersama PAYMENT_ATTENTION_WHERE
  // (received/ignored/failed). `ignored` ikut boleh ditandai karena event lama
  // yang gagal dicocokkan otomatis berstatus itu — tanpa itu badge tidak akan
  // pernah berhenti.
  if (status !== "received" && status !== "failed" && status !== "ignored") {
    return NextResponse.json({
      error: "event_not_actionable",
      message: status === "matched" ? "Event ini sudah cocok dengan pesanan." : "Event ini tidak sedang menunggu tindakan.",
    }, { status: 409 });
  }
  if (event.reviewed_by != null) return NextResponse.json({ ok: true, status: "already_reviewed", event_id: eventId });
  const updated = await execRun(
    `UPDATE dana_webhook_events SET status='ignored', reviewed_by=?, review_note=?, processed_at=datetime('now')
      WHERE id=? AND reviewed_by IS NULL AND status IN ('received','ignored','failed')`,
    adminEmail, note, eventId,
  );
  if (!updated.changes) {
    const current = await queryFirst("SELECT status,reviewed_by FROM dana_webhook_events WHERE id=?", eventId);
    if (!current) return NextResponse.json({ error: "event_not_found" }, { status: 404 });
    if (current.status === "ignored" && current.reviewed_by != null) return NextResponse.json({ ok: true, status: "already_reviewed", event_id: eventId });
    return NextResponse.json({ error: "event_not_actionable" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, status: "reviewed", event_id: eventId, reviewed_by: adminEmail });
}
