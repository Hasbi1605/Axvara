// GET /api/pedia/orders/[code] — Status publik (PD-12, §9.7).
// Full checkout contact in x-order-contact is required before any details or wake.
// Tanpa data supplier mentah. Refill eligibility dihitung server.
import { NextRequest, NextResponse } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import { buyerContactMatches } from "@/lib/order-contact";
import { checkRateLimit } from "@/lib/rateLimit";
import { readPediaServiceCopy } from "@/lib/pedia/service-copy";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!checkRateLimit(request, "pedia:status")) return NextResponse.json({ error: "Terlalu sering, coba lagi sebentar." }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "private, no-store" } });
  const contact = request.headers.get("x-order-contact") || "";
  if (!contact) return NextResponse.json({ error: "contact_required" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const { code } = await params;
  const clean = String(code || "").trim().toUpperCase();
  if (!/^AXP-\d{8}-[A-Z0-9]{8}$/.test(clean)) {
    return NextResponse.json({ error: "Kode tidak valid" }, { status: 400 });
  }
  const db = createDatabaseAccess();
  const order = await db.queryFirst(`SELECT * FROM orders WHERE code=?`, clean).catch(() => null);
  if (!order || !buyerContactMatches(contact, order)) return NextResponse.json({ error: "Pesanan tidak ditemukan atau kontak tidak cocok." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
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
            t.eta_start, t.eta_finish
       FROM pedia_order_items i
       JOIN pedia_products p ON p.id=i.product_id
       JOIN pedia_tiers t ON t.id=i.tier_id
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
  const remains = Number.isSafeInteger(rawRemains) && rawRemains >= 0 && rawRemains <= qty ? rawRemains : null;
  const done = item.status === "completed" ? qty : remains != null ? qty - remains : null;
  const percent = qty > 0 && done !== null ? (done / qty) * 100 : null;

  // Refill eligibility (PD-25): refill_days>0, completed|partial, dalam masa
  // garansi (dari updated_at terminal — pendekatan; admin melihat detail),
  // refill terakhir ≥ 24 jam lalu.
  const refillDays = Number(snap?.refill_days ?? item.refill_days) || 0;
  const { parseExpiry } = await import("@/lib/expiry");
  const refillLast = parseExpiry(String(item.refill_last_at ?? "")) ?? 0;
  const created = parseExpiry(String(snap.refill_anchor === "completed" ? item.completed_at ?? "" : item.created_at));
  const refillEligible =
    refillDays > 0 &&
    ((item.refill_status == null && item.refill_supplier_id == null && item.refill_last_at == null)
      || ["completed", "rejected", "canceled", "cancelled", "supplier_rejected"].includes(String(item.refill_status))) &&
    created !== null && Date.now() <= created + refillDays * 86400000 &&
    (item.status === "completed" || item.status === "partial") &&
    (!Number.isFinite(refillLast) || Date.now() - refillLast >= 24 * 3600 * 1000);

  return NextResponse.json({
    ok: true,
    order: {
      code: clean,
      product_name: String(item.product_name),
      product_slug: String(item.product_slug),
      tier_name: String(item.tier_name),
      tier_note: item.label_note != null ? String(item.label_note) : null,
      quantity: qty,
      target: String(item.target_normalized),
      status: order.status === "pending" ? "awaiting_payment" : ["expired", "batal", "kadaluarsa", "dibatalkan"].includes(String(order.status)) ? "expired" : String(item.status),
      done, percent,
      eta_start: item.eta_start != null ? String(item.eta_start) : null,
      eta_finish: item.eta_finish != null ? String(item.eta_finish) : null,
      service_copy: readPediaServiceCopy(snap.service_copy),
      refill_days: refillDays,
      refill_eligible: refillEligible,
      paid_at: order.paid_at != null ? String(order.paid_at) : null,
      notified_final: item.notified_final_at != null,
      qris: tx ? {
        payable_amount: tx.payable_amount, unique_code: tx.unique_code,
        image_url: tx.qris_url, expires_at: tx.expires_at, status: tx.status,
      } : null,
    },
  }, { headers: { "Cache-Control": "private, no-store", "Vary": "x-order-contact" } });
}
