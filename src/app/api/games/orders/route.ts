// POST /api/games/orders — buat order Games (QRIS) dari quote bertanda tangan.
// Alur mengikuti Pedia: reuse quote_id, admission checkout-guard bersama,
// claim orders + games_order_items dalam SATU db.batch atomik, lalu invoice
// QRIS lewat jalur Pedia. Tidak pernah menyentuh stok Market.
import { isPaymentMaintenanceEnabled, paymentMaintenanceResponse } from "@/lib/payment-maintenance";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { checkoutSubjects, consumeCheckoutSlot } from "@/lib/checkout-guard";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { generateOrderCode } from "@/lib/security";
import { deriveNameFromEmail } from "@/lib/utils";
import { gamesMaxPrice } from "@/lib/games/checkout";
import { gamesOrderingOpen, gamesPreviewResponse } from "@/lib/games/ordering";
import { verifyGamesQuoteToken } from "@/lib/games/quote";
import { gamesBrandMatches, gamesRegistryGame } from "@/lib/games/registry";
import { pediaApiLocale, pick } from "@/lib/pedia/api-locale";
import type { Locale } from "@/lib/i18n/locale";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  quote_token: z.string().trim().min(20).max(20000),
});

const ACTIVE_ITEM_STATUSES = "('awaiting_payment','queued','submitting','pending','needs_check')";

const statusUrl = (code: unknown) => `/games/pesanan/${String(code)}`;

/** Order tersimpan: kembalikan kode + percobaan invoice QRIS (idempoten). */
async function checkoutResponse(order: Record<string, unknown>, reused: boolean, locale: Locale) {
  const total = Number(order.subtotal);
  let qris: Record<string, unknown> | null = null;
  if (String(order.status) === "pending" && total > 0) {
    try {
      const { createActiveQrisInvoice } = await import("@/lib/payments/dana-qris");
      const invoice = await createActiveQrisInvoice(String(order.code), total);
      qris = {
        payable_amount: invoice.payableAmount,
        unique_code: invoice.uniqueCode,
        image_url: invoice.qrisUrl,
        expires_at: invoice.expiresAt,
      };
    } catch {
      return NextResponse.json({
        error: pick(locale, "Pesanan tersimpan. QRIS belum tersedia; coba lanjutkan lagi dengan data yang sama.", "The order is saved. QRIS is not available yet; try continuing again with the same details."),
        code: order.code,
        status_url: statusUrl(order.code),
      }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
  }
  return NextResponse.json({
    code: order.code,
    status_url: statusUrl(order.code),
    status: order.status,
    total,
    qris,
    reused,
  }, { status: reused ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  const locale = pediaApiLocale(req);
  if (isPaymentMaintenanceEnabled()) return paymentMaintenanceResponse();
  if (!checkRateLimit(req, "games:orders")) {
    return NextResponse.json({ error: pick(locale, "Terlalu banyak percobaan, coba lagi 1 menit.", "Too many attempts, try again in 1 minute.") }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!gamesOrderingOpen()) {
    return NextResponse.json(gamesPreviewResponse(locale), { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: pick(locale, "Quote checkout wajib disertakan", "Checkout quote is required") }, { status: 400 });
  }
  if (!process.env.ADMIN_JWT_SECRET && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: pick(locale, "Checkout sementara tidak tersedia.", "Checkout is temporarily unavailable.") }, { status: 503 });
  }
  const quote = await verifyGamesQuoteToken(parsed.data.quote_token);
  if (!quote) {
    return NextResponse.json({
      error: "quote_expired",
      message: pick(locale, "Quote checkout tidak valid atau sudah kedaluwarsa. Muat ulang checkout.", "The checkout quote is invalid or expired. Reload checkout."),
    }, { status: 409 });
  }
  const game = gamesRegistryGame(quote.slug);
  if (!game) {
    return NextResponse.json({ error: "quote_stale", message: pick(locale, "Muat ulang checkout.", "Reload checkout.") }, { status: 409 });
  }
  const db = createDatabaseAccess();
  const quoteId = `games:${quote.jti}`;
  const reused = await db.queryFirst(`SELECT code,subtotal,status FROM orders WHERE quote_id=?`, quoteId).catch(() => null);
  if (reused) return checkoutResponse(reused, true, locale);

  // Harga & ketersediaan dicek ulang dari DB (jangan percaya token).
  const product = await db.queryFirst(
    `SELECT id, buyer_sku_code, game_brand, cost, sell_price, seller_active, enabled FROM games_products WHERE buyer_sku_code=?`,
    quote.buyer_sku_code,
  ).catch(() => null);
  if (!product || Number(product.id) !== quote.product_id || Number(product.enabled) !== 1 || !gamesBrandMatches(game, product.game_brand)
    || Number(product.seller_active) !== 1 || !Number.isSafeInteger(Number(product.cost)) || Number(product.cost) <= 0) {
    return NextResponse.json({ error: "quote_stale", message: pick(locale, "Nominal ini sudah tidak tersedia. Muat ulang checkout.", "This amount is no longer available. Reload checkout.") }, { status: 409 });
  }
  const price = Number(product.sell_price);
  if (!Number.isSafeInteger(price) || price <= 0 || price !== quote.total || price !== quote.unit_price) {
    return NextResponse.json({ error: "quote_stale", message: pick(locale, "Harga berubah sejak checkout dibuka. Muat ulang agar kamu membayar harga terbaru.", "The price changed since checkout was opened. Reload so you pay the latest price.") }, { status: 409 });
  }

  // Admission bersama Market/Pedia; quote id stabil mendedup retry paralel.
  const guard = await consumeCheckoutSlot(
    db,
    await checkoutSubjects({ ip: clientIp(req), wa: quote.customer_wa, email: quote.customer_email }),
    quoteId,
  );
  if (!guard.allowed) {
    if (guard.reason === "unavailable") {
      return NextResponse.json({
        error: "checkout_unavailable",
        message: pick(locale, "Checkout sementara tidak tersedia. Coba lagi dengan data yang sama.", "Checkout is temporarily unavailable. Try again with the same details."),
      }, { status: 503, headers: { "Retry-After": String(guard.retryAfterSeconds) } });
    }
    return NextResponse.json({
      error: "checkout_rate_limited",
      message: pick(locale, "Terlalu banyak pesanan baru dari koneksi/nomor ini. Tunggu hingga 15 menit, lalu coba lagi.", "Too many new orders from this connection/number. Wait up to 15 minutes, then try again."),
    }, { status: 429, headers: { "Retry-After": String(guard.retryAfterSeconds) } });
  }

  if (!db.d1) {
    return NextResponse.json({ error: pick(locale, "Checkout sementara tidak tersedia.", "Checkout is temporarily unavailable.") }, { status: 503 });
  }
  const code = generateOrderCode().replace(/^AXV-/, "AXG-");
  const maxPrice = gamesMaxPrice(price, Number(product.cost));
  const derivedName = deriveNameFromEmail(quote.customer_email);
  const statement = (sql: string, ...params: unknown[]) => db.d1!.prepare(sql).bind(...params);
  const owned = `EXISTS(SELECT 1 FROM orders WHERE code=? AND quote_id=?)`;
  let claimed = false;
  try {
    const result = await db.d1.batch([
      statement(
        `INSERT INTO orders(code,quote_id,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,payment_status,sales_channel,order_kind,expires_at,buyer_access_version,buyer_access_format,locale)
         SELECT ?,?,?,?,?,'[]',?,'qris','QRIS','pending','pending','web','games',datetime('now','+15 minutes'),0,'code26',?
          WHERE EXISTS(SELECT 1 FROM games_products WHERE id=? AND buyer_sku_code=?
            AND enabled=1 AND seller_active=1 AND sell_price=? AND cost=? AND lower(trim(game_brand))=?)
            AND NOT EXISTS(SELECT 1 FROM games_order_items WHERE customer_no=? AND buyer_sku_code=? AND status IN ${ACTIVE_ITEM_STATUSES})`,
         code, quoteId, derivedName, quote.customer_wa, quote.customer_email, price,
         quote.locale, quote.product_id, quote.buyer_sku_code, price, Number(product.cost),
         String(product.game_brand).trim().toLowerCase(), quote.customer_no, quote.buyer_sku_code,
      ),
      statement(
        `INSERT INTO games_order_items(order_code,product_id,buyer_sku_code,customer_no,customer_nickname,quantity,unit_price,total,cost_snapshot,max_price,status,attempt_no)
         SELECT ?,?,?,?,?,1,?,?,?,?,'awaiting_payment',1 WHERE ${owned}`,
        code, Number(product.id), quote.buyer_sku_code, quote.customer_no, quote.customer_nickname,
        quote.unit_price, quote.total, Number(product.cost), maxPrice, code, quoteId,
      ),
    ]);
    claimed = Number(result[0]?.meta?.changes) === 1;
  } catch (error) {
    console.error("[games-orders] claim batch failed", {
      product_id: Number(product.id),
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    const existing = await db.queryFirst(`SELECT code,subtotal,status FROM orders WHERE quote_id=?`, quoteId).catch(() => null);
    if (existing) return checkoutResponse(existing, true, locale);
    return NextResponse.json({ error: pick(locale, "Pesanan belum tersimpan. Coba lagi dengan data yang sama.", "The order was not saved. Try again with the same details.") }, { status: 503 });
  }
  if (!claimed) {
    const raceWinner = await db.queryFirst(`SELECT code,subtotal,status FROM orders WHERE quote_id=?`, quoteId).catch(() => null);
    if (raceWinner) return checkoutResponse(raceWinner, true, locale);
    const duplicate = await db.queryFirst(
      `SELECT order_code FROM games_order_items WHERE customer_no=? AND buyer_sku_code=? AND status IN ${ACTIVE_ITEM_STATUSES} ORDER BY id DESC LIMIT 1`,
      quote.customer_no, quote.buyer_sku_code,
    ).catch(() => null);
    if (duplicate) {
      return NextResponse.json({
        error: "duplicate_active_order",
        message: pick(locale, "ID ini masih memiliki pesanan yang diproses. Tunggu selesai atau hubungi admin.", "This ID still has an order in progress. Wait for it to finish or contact admin."),
      }, { status: 409 });
    }
    return NextResponse.json({ error: "quote_stale", message: pick(locale, "Nominal atau harga berubah. Muat ulang checkout.", "The amount or price changed. Reload checkout.") }, { status: 409 });
  }
  return checkoutResponse({ code, subtotal: price, status: "pending" }, false, locale);
}
