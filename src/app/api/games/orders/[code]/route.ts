// GET /api/games/orders/[code] — status pesanan Games.
// Bukti kontak checkout penuh (sama seperti Pedia); status jujur: `success`
// hanya bila item Digiflazz benar-benar sukses.
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { buyerOrderAccessMatches, newOrderAccessFailure, requiresOrderAccessCode } from "@/lib/order-access";
import { gamesGameForBrand } from "@/lib/games/registry";
import { gamesBuyerStatus } from "@/lib/games/status";
import { gamesPaymentBlock, gamesQrisBlock, loadGamesOrder, maskedContact } from "@/lib/games/lookup";
import { pediaApiLocale, pick } from "@/lib/pedia/api-locale";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const ORDER_CODE = /^AXG-\d{8}-[A-Z0-9]{8}$/;

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const locale = pediaApiLocale(request);
  if (!checkRateLimit(request, "games:status")) {
    return NextResponse.json({ error: pick(locale, "Terlalu sering, coba lagi sebentar.", "Too many requests, try again shortly.") }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "private, no-store" } });
  }
  const contact = request.headers.get("x-order-access-code") || request.headers.get("x-order-contact") || "";
  if (!contact && !request.headers.get("x-buyer-access-session")) {
    return NextResponse.json({ error: "contact_required" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }
  const { code } = await params;
  const clean = String(code || "").trim().toUpperCase();
  if (!ORDER_CODE.test(clean)) {
    return NextResponse.json({ error: pick(locale, "Kode tidak valid", "Invalid code") }, { status: 400 });
  }
  const loaded = await loadGamesOrder(clean);
  if (!loaded) {
    return NextResponse.json({ error: pick(locale, "Pesanan tidak ditemukan atau kode akses tidak cocok.", "Order not found or the access code does not match.") }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }
  const { db, order, item, tx } = loaded;
  const failure = await newOrderAccessFailure(request, order, contact, { allowStatusSession: true });
  if (failure) return failure;
  if (!requiresOrderAccessCode(order) && !(await buyerOrderAccessMatches(contact, order))) {
    return NextResponse.json({ error: pick(locale, "Pesanan tidak ditemukan atau kode akses tidak cocok.", "Order not found or the access code does not match.") }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }

  // KlikQRIS (bila menjadi provider QRIS aktif): satu klaim durable untuk
  // menarik status vendor. Provider QRIS lain ditangani poller/cron existing.
  if (order.status === "pending" && tx?.provider === "klikqris" && ["pending", "initializing"].includes(String(tx.status))) {
    try {
      const { claimKlikQrisPollReconcile, reconcileKlikQrisPayment, createKlikQrisInvoice } = await import("@/lib/payments/klikqris");
      const wake = new URL(request.url).searchParams.get("wake") === "1";
      let claimed = false;
      if (!wake || checkRateLimit(request, "games:wake")) {
        if (String(tx.status) === "pending") claimed = await claimKlikQrisPollReconcile(clean);
        else if (wake) {
          const result = await db.execRun(
            `UPDATE payment_transactions SET last_checked_at=datetime('now')
              WHERE order_code=? AND provider='klikqris' AND status='initializing'
                AND (last_checked_at IS NULL OR julianday(last_checked_at)<=julianday('now','-10 seconds'))`,
            clean,
          );
          claimed = Number(result.changes) === 1;
        }
      }
      if (claimed) {
        if (String(tx.status) === "initializing") await createKlikQrisInvoice(clean, Number(tx.requested_amount));
        else await reconcileKlikQrisPayment(clean);
        const refreshed = await db.queryFirst("SELECT status,payment_status,paid_at FROM orders WHERE code=?", clean);
        if (refreshed) Object.assign(order, refreshed);
        const refreshedTx = await db.queryFirst(
          `SELECT provider,payable_amount,unique_code,qris_url,expires_at,status FROM payment_transactions WHERE order_code=? ORDER BY id DESC LIMIT 1`,
          clean,
        );
        if (refreshedTx) Object.assign(tx, refreshedTx);
      }
    } catch { /* view tersimpan tetap dilayani */ }
  }

  if (order.status === "pending" && tx && ["pending", "initializing"].includes(String(tx.status))
    && ["sekalipay_gateway", "nowpayments"].includes(String(tx.provider))) {
    try {
      const wake = new URL(request.url).searchParams.get("wake") === "1";
      if (!wake || checkRateLimit(request, "games:wake")) {
        if (tx.provider === "sekalipay_gateway") {
          const { claimSekalipayGatewayPoll } = await import("@/lib/payments/payment-view");
          if (await claimSekalipayGatewayPoll(clean, false, db)) {
            const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
            await reconcileSekalipayGatewayPayment(clean, db).catch(() => null);
          }
          const view = await gamesPaymentBlock(clean, tx, db);
          if (view?.state === "initializing") {
            const saved = await db.queryFirst(`SELECT pt.provider_payment_id,pt.gateway_channel,pt.gateway_estimated_fee
              FROM payment_transactions pt WHERE pt.order_code=? AND pt.provider='sekalipay_gateway'`, clean);
            if (saved?.provider_payment_id) {
              // Same known invoice recovery as Pedia: the adapter can only GET.
              const { createSekalipayGatewayInvoice } = await import("@/lib/payments/sekalipay-gateway");
              await createSekalipayGatewayInvoice(clean, Number(tx.requested_amount), String(saved.gateway_channel), {
                name: String(order.customer_name), email: String(order.customer_email), phone: String(order.customer_wa),
              }, Number(saved.gateway_estimated_fee));
            }
          }
        } else {
          const { claimNowpaymentsPollReconcile, reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
          if (await claimNowpaymentsPollReconcile(clean)) await reconcileNowpaymentsPayment(clean);
        }
        const refreshed = await db.queryFirst("SELECT status,payment_status,paid_at FROM orders WHERE code=?", clean);
        if (refreshed) Object.assign(order, refreshed);
        const refreshedItem = await db.queryFirst("SELECT status,sn,supplier_message FROM games_order_items WHERE order_code=?", clean);
        if (refreshedItem) Object.assign(item, refreshedItem);
      }
    } catch { /* Saved view remains available; cron recovers interrupted work. */ }
  }

  const game = gamesGameForBrand(item.game_brand);
  const status = gamesBuyerStatus(order.status, item.status);
  const success = status === "success";
  return NextResponse.json({
    ok: true,
    order: {
      code: clean,
      order_kind: "games",
      ...maskedContact(order),
      game: game ? { slug: game.slug, name: game.name, publisher: game.publisher } : null,
      product_name: String(item.product_name ?? "").slice(0, 200),
      customer_no: String(item.customer_no ?? ""),
      customer_nickname: item.customer_nickname != null ? String(item.customer_nickname) : null,
      quantity: Number(item.quantity) || 1,
      unit_price: Number(item.unit_price),
      total: Number(item.total),
      subtotal: order.subtotal,
      status: order.status,
      games_status: status,
      games_status_raw: item.status,
      sn: success && item.sn != null ? String(item.sn) : null,
      supplier_message: success && item.supplier_message != null ? String(item.supplier_message) : null,
      paid_at: order.paid_at != null ? String(order.paid_at) : null,
      created_at: order.created_at,
      expires_at: order.expires_at,
      payment_method: String(order.payment_method ?? "qris"),
      payment_account: order.payment_account ?? null,
      payment_status: order.payment_status ?? null,
      locale: String(order.locale ?? "id"),
      buyer_canceled: order.status === "dibatalkan",
      qris: gamesQrisBlock(tx),
      payment: await gamesPaymentBlock(clean, tx, db),
    },
  }, { headers: { "Cache-Control": "private, no-store", "Vary": "x-order-contact, x-order-access-code" } });
}
