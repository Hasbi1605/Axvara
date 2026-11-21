// GET /api/pedia/orders/[code] — Status publik (PD-12, §9.7).
// Full checkout contact in x-order-contact is required before any details or wake.
// Tanpa data supplier mentah. Refill eligibility dihitung server.
import { NextRequest, NextResponse } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import { buyerOrderAccessMatches, requiresOrderAccessCode, newOrderAccessFailure } from "@/lib/order-access";
import { checkRateLimit } from "@/lib/rateLimit";
import { readPediaServiceCopy } from "@/lib/pedia/service-copy";
import { whiteLabel } from "@/lib/pedia/terms";
import { pediaApiLocale, pick } from "@/lib/pedia/api-locale";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const locale = pediaApiLocale(request);
  if (!checkRateLimit(request, "pedia:status")) return NextResponse.json({ error: pick(locale, "Terlalu sering, coba lagi sebentar.", "Too many requests, try again shortly.") }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "private, no-store" } });
  const contact = request.headers.get("x-order-access-code") || request.headers.get("x-order-contact") || "";
  if (!contact && !request.headers.get("x-buyer-access-session")) return NextResponse.json({ error: "contact_required" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const { code } = await params;
  const clean = String(code || "").trim().toUpperCase();
  if (!/^AXP-\d{8}-[A-Z0-9]{8}$/.test(clean)) {
    return NextResponse.json({ error: pick(locale, "Kode tidak valid", "Invalid code") }, { status: 400 });
  }
  const db = createDatabaseAccess();
  const order = await db.queryFirst(`SELECT * FROM orders WHERE code=?`, clean).catch(() => null);
  if (order) {
    const failure = await newOrderAccessFailure(request, order, contact, { allowStatusSession: true });
    if (failure) return failure;
  }
  if (!order || (!requiresOrderAccessCode(order) && !(await buyerOrderAccessMatches(contact, order)))) return NextResponse.json({ error: pick(locale, "Pesanan tidak ditemukan atau kode akses tidak cocok.", "Order not found or the access code does not match.") }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (order.status === "pending") {
    const payment = await db.queryFirst("SELECT provider,status,requested_amount FROM payment_transactions WHERE order_code=?",clean);
    const wake = new URL(request.url).searchParams.get("wake") === "1";
    if (payment?.provider === "nowpayments" && ["pending", "initializing"].includes(String(payment.status))) {
      try {
        // Klaim durable ±10 dtk; `wake=1` memaksa satu putaran. Gagal = tetap pending.
        const { claimNowpaymentsPollReconcile, reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
        if (wake) await db.execRun("UPDATE payment_transactions SET last_checked_at=NULL WHERE order_code=? AND provider='nowpayments'", clean).catch(() => null);
        if (!wake || checkRateLimit(request, "pedia:wake")) {
          if (await claimNowpaymentsPollReconcile(clean)) {
            await reconcileNowpaymentsPayment(clean).catch(() => null);
            const refreshed = await db.queryFirst("SELECT status,payment_status,paid_at FROM orders WHERE code=?", clean);
            if (refreshed) Object.assign(order, refreshed);
          }
        }
      } catch { /* view tersimpan tetap dilayani */ }
    } else if (payment?.provider === "sekalipay_gateway" && ["pending", "initializing"].includes(String(payment.status))) {
      try {
        const { claimSekalipayGatewayPoll, buildSekalipayGatewayPaymentView } = await import("@/lib/payments/payment-view");
        if (!wake || checkRateLimit(request, "pedia:wake")) {
          if (await claimSekalipayGatewayPoll(clean)) {
            const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
            await reconcileSekalipayGatewayPayment(clean).catch(() => null);
            const refreshed = await db.queryFirst("SELECT status,payment_status,paid_at FROM orders WHERE code=?", clean);
            if (refreshed) Object.assign(order, refreshed);
          }
        }
        // Initializing dengan id tersimpan: pulihkan hanya lewat GET (tanpa POST ulang).
        const view = await buildSekalipayGatewayPaymentView(clean, db).catch(() => null);
        if (view?.state === "initializing") {
          const saved = await db.queryFirst(`SELECT o.customer_name,o.customer_email,o.customer_wa,pt.gateway_channel,pt.gateway_estimated_fee,pt.provider_payment_id,pt.order_code
            FROM orders o JOIN payment_transactions pt ON pt.order_code=o.code WHERE o.code=? AND pt.provider='sekalipay_gateway'`, clean);
          if (saved?.provider_payment_id) {
            const { createSekalipayGatewayInvoice } = await import("@/lib/payments/sekalipay-gateway");
            await createSekalipayGatewayInvoice(String(saved.order_code), Number(payment.requested_amount), String(saved.gateway_channel), { name: String(saved.customer_name), email: String(saved.customer_email), phone: String(saved.customer_wa) }, Number(saved.gateway_estimated_fee)).catch(() => null);
          }
        }
      } catch { /* view tersimpan tetap dilayani */ }
    }
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
  if (!item) return NextResponse.json({ error: pick(locale, "Pesanan tidak ditemukan", "Order not found") }, { status: 404 });

  // QRIS aktif (komponen existing di UI memakai payment_transactions).
  const tx = await db.queryFirst(
    `SELECT provider, payable_amount, unique_code, qris_url, expires_at, status
       FROM payment_transactions WHERE order_code=? ORDER BY id DESC LIMIT 1`,
    clean,
  ).catch(() => null);
  // Fase B: rail non-QRIS memakai view kanonis Market; QRIS tetap blok lama.
  let payment: unknown = null;
  if (order.status === "pending" && tx && tx.provider !== "qris") {
    try {
      if (tx.provider === "nowpayments") {
        const { buildNowpaymentsPaymentView } = await import("@/lib/payments/payment-view");
        payment = await buildNowpaymentsPaymentView(clean, db);
      } else if (tx.provider === "sekalipay_gateway") {
        const { buildSekalipayGatewayPaymentView } = await import("@/lib/payments/payment-view");
        payment = await buildSekalipayGatewayPaymentView(clean, db);
      }
    } catch { payment = null; }
  }
  const qrisProvider = tx ? ["dana", "gopay", "klikqris"].includes(String(tx.provider ?? "dana")) : false;

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
      payment_method: String(order.payment_method ?? "qris"),
      qris: tx && qrisProvider ? {
        payable_amount: tx.payable_amount, unique_code: tx.unique_code,
        image_url: tx.qris_url, expires_at: tx.expires_at, status: tx.status,
      } : null,
      ...(payment ? { payment } : {}),
    },
  }, { headers: { "Cache-Control": "private, no-store", "Vary": "x-order-contact, x-order-access-code" } });
}
