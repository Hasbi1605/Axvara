// GET /api/pedia/orders/[code] — Status publik (PD-12, §9.7).
// Full checkout contact in x-order-contact is required before any details or wake.
// Tanpa data supplier mentah. Refill eligibility dihitung server.
import { NextRequest, NextResponse } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import { buyerOrderAccessMatches, requiresOrderAccessCode, newOrderAccessFailure } from "@/lib/order-access";
import { checkRateLimit } from "@/lib/rateLimit";
import { readPediaServiceCopy } from "@/lib/pedia/service-copy";
import { whiteLabel } from "@/lib/pedia/terms";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!checkRateLimit(request, "pedia:status")) return NextResponse.json({ error: "Terlalu sering, coba lagi sebentar." }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "private, no-store" } });
  const contact = request.headers.get("x-order-access-code") || request.headers.get("x-order-contact") || "";
  if (!contact && !request.headers.get("x-buyer-access-session")) return NextResponse.json({ error: "contact_required" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const { code } = await params;
  const clean = String(code || "").trim().toUpperCase();
  if (!/^AXP-\d{8}-[A-Z0-9]{8}$/.test(clean)) {
    return NextResponse.json({ error: "Kode tidak valid" }, { status: 400 });
  }
  const db = createDatabaseAccess();
  const order = await db.queryFirst(`SELECT * FROM orders WHERE code=?`, clean).catch(() => null);
  if (order) {
    const failure = await newOrderAccessFailure(request, order, contact, { allowStatusSession: true });
    if (failure) return failure;
  }
  if (!order || (!requiresOrderAccessCode(order) && !(await buyerOrderAccessMatches(contact, order)))) return NextResponse.json({ error: "Pesanan tidak ditemukan atau kode akses tidak cocok." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (order.status === "pending") {
    const payment = await db.queryFirst("SELECT provider,status,requested_amount FROM payment_transactions WHERE order_code=?",clean);
    if (payment?.provider === "klikqris" && ["pending", "initializing"].includes(String(payment.status))) {
      try {
        // Every network check shares a durable 10-second claim. A manual
        // initializing recovery reads the existing gateway order ID only.
        const wake = new URL(request.url).searchParams.get("wake") === "1";
        const {claimKlikQrisPollReconcile, reconcileKlikQrisPayment, createKlikQrisInvoice} = await import("@/lib/payments/klikqris");
        let claimed = false;
        if (!wake || checkRateLimit(request, "pedia:wake")) {
          if (payment.status === "pending") claimed = await claimKlikQrisPollReconcile(clean);
          else if (wake) {
            const result = await db.execRun(`UPDATE payment_transactions SET last_checked_at=datetime('now')
              WHERE order_code=? AND provider='klikqris' AND status='initializing'
              AND (last_checked_at IS NULL OR julianday(last_checked_at)<=julianday('now','-10 seconds'))`,clean);
            claimed = result.changes === 1;
          }
        }
        if (claimed) {
          if (payment.status === "initializing") await createKlikQrisInvoice(clean,Number(payment.requested_amount));
          else await reconcileKlikQrisPayment(clean);
          const refreshed=await db.queryFirst("SELECT status,payment_status,paid_at FROM orders WHERE code=?",clean);
          if (refreshed) Object.assign(order,refreshed);
        }
      } catch { /* Failed confirmation keeps payment pending. */ }
    }
  }
  const item = await db.queryFirst(
    `SELECT i.*, p.name AS product_name, p.slug AS product_slug,
            p.platform AS product_platform,
            t.tier AS tier_name, t.label_note, t.refill_days,
            t.eta_start, t.eta_finish, COALESCE(s.api_refill,0) AS api_refill
       FROM pedia_order_items i
       JOIN pedia_products p ON p.id=i.product_id
       JOIN pedia_tiers t ON t.id=i.tier_id
       LEFT JOIN pedia_supplier_services s ON s.supplier=i.supplier AND s.service_id=i.supplier_service_id
      WHERE i.order_code=?`,
    clean,
  ).catch(() => null);
  if (!item) return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });

  // QRIS aktif (komponen existing di UI memakai payment_transactions).
  const tx = await db.queryFirst(
    `SELECT payable_amount, unique_code, qris_url, expires_at, status
       FROM payment_transactions WHERE order_code=? ORDER BY id DESC LIMIT 1`,
    clean,
  ).catch(() => null);

  let snap: Record<string, unknown> = {};
  try { snap = JSON.parse(String(item.snapshot_json ?? "{}")) ?? {}; } catch { /* legacy */ }
  const qty = Number(item.quantity) || 0;
  const rawRemains = item.remains != null ? Number(item.remains) : NaN;
  const rawStart = item.start_count != null ? Number(item.start_count) : NaN;
  const remains = Number.isSafeInteger(rawRemains) && rawRemains >= 0 && rawRemains <= qty ? rawRemains : null;
  // Reported supplier start count; unknown stays null, never 0.
  const startCount = Number.isSafeInteger(rawStart) && rawStart >= 0 ? rawStart : null;
  const done = item.status === "completed" ? qty : remains != null ? qty - remains : null;
  const percent = qty > 0 && done !== null ? (done / qty) * 100 : null;

  // Refill (PD-25, 2026-11-01): aturan bersama POST refill + halaman /refill.
  const { pediaRefillState } = await import("@/lib/pedia/refill-policy");
  const refill = pediaRefillState(item, snap, Number(item.api_refill) === 1);
  const refillDays = refill.days;
  const refillEligible = refill.eligible;

  return NextResponse.json({
    ok: true,
    order: {
      code: clean,
      order_kind: "pedia",
      product_name: whiteLabel(String(item.product_name)).slice(0, 120),
      product_slug: String(item.product_slug),
      // Snapshot-safe AXVARA public names (never live tier edits, never
      // supplier identity/cost/raw IDs). service_copy already white-labeled.
      service_name: whiteLabel(String(readPediaServiceCopy(snap.service_copy)?.service_name ?? item.label_note ?? item.tier_name)).slice(0, 200),
      tier_name: whiteLabel(String(item.tier_name)).slice(0, 200),
      tier_note: item.label_note != null ? whiteLabel(String(item.label_note)).slice(0, 200) : null,
      quantity: qty,
      target: String(item.target_normalized),
      status: order.status === "pending" ? "awaiting_payment" : ["expired", "batal", "kadaluarsa", "dibatalkan"].includes(String(order.status)) ? "expired" : String(item.status),
      done, percent,
      // Reported supplier counts; null = unknown, never 0.
      start_count: startCount,
      remains,
      eta_start: item.eta_start != null ? String(item.eta_start) : null,
      eta_finish: item.eta_finish != null ? String(item.eta_finish) : null,
      service_copy: readPediaServiceCopy(snap.service_copy),
      refill_days: refillDays,
      refill_eligible: refillEligible,
      refill,
      paid_at: order.paid_at != null ? String(order.paid_at) : null,
      buyer_canceled: order.status === "dibatalkan",
      notified_final: item.notified_final_at != null,
      qris: tx ? {
        payable_amount: tx.payable_amount, unique_code: tx.unique_code,
        image_url: tx.qris_url, expires_at: tx.expires_at, status: tx.status,
      } : null,
    },
  }, { headers: { "Cache-Control": "private, no-store", "Vary": "x-order-contact, x-order-access-code" } });
}
