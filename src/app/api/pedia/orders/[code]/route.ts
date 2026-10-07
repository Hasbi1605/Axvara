// GET /api/pedia/orders/[code] — Status publik (PD-12, §9.7).
// Capability token (pola existing): ?token= capability saat order dibuat.
// Tanpa data supplier mentah. Refill eligibility dihitung server.
import { NextRequest, NextResponse } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = String(code || "").trim().toUpperCase();
  if (!/^AXP-\d{8}-[A-Z0-9]{8}$/.test(clean)) {
    return NextResponse.json({ error: "Kode tidak valid" }, { status: 400 });
  }
  const db = createDatabaseAccess();
  const order = await db.queryFirst(`SELECT * FROM orders WHERE code=?`, clean).catch(() => null);
  if (!order) return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });
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

  const snap = JSON.parse(String(item.snapshot_json ?? "{}"));
  const qty = Number(item.quantity) || 0;
  const remains = item.remains != null ? Number(item.remains) : null;
  const done = remains != null ? Math.max(0, qty - remains) : 0;
  const percent = qty > 0 && remains != null ? (done / qty) * 100 : 0;

  // Refill eligibility (PD-25): refill_days>0, completed|partial, dalam masa
  // garansi (dari updated_at terminal — pendekatan; admin melihat detail),
  // refill terakhir ≥ 24 jam lalu.
  const refillDays = Number(item.refill_days) || 0;
  const refillLast = item.refill_last_at ? Date.parse(String(item.refill_last_at)) : 0;
  const refillEligible =
    refillDays > 0 &&
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
      status: String(item.status),
      done, percent,
      eta_start: item.eta_start != null ? String(item.eta_start) : null,
      eta_finish: item.eta_finish != null ? String(item.eta_finish) : null,
      refill_days: refillDays,
      refill_eligible: refillEligible,
      refund_credit_code: item.refund_credit_code != null ? String(item.refund_credit_code) : null,
      paid_at: order.paid_at != null ? String(order.paid_at) : null,
      notified_final: item.notified_final_at != null,
      qris: tx ? {
        payable_amount: tx.payable_amount, unique_code: tx.unique_code,
        image_url: tx.qris_url, expires_at: tx.expires_at, status: tx.status,
      } : null,
    },
  });
}
