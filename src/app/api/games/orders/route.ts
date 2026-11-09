// POST /api/games/orders — buat order Games dari quote bertanda tangan.
// Alur mengikuti Pedia: reuse quote_id, admission checkout-guard bersama,
// claim orders + games_order_items dalam SATU db.batch atomik, lalu invoice
// lewat mesin pembayaran Pedia/Market. Tidak pernah menyentuh stok Market.
import { isPaymentMaintenanceEnabled, paymentMaintenanceResponse } from "@/lib/payment-maintenance";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { checkoutSubjects, consumeCheckoutSlot } from "@/lib/checkout-guard";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { transitionPendingOrder } from "@/lib/db";
import { readJsonBody } from "@/lib/http-body";
import { generateOrderCode } from "@/lib/security";
import { deriveNameFromEmail } from "@/lib/utils";
import { gamesMaxPrice } from "@/lib/games/checkout";
import { gamesOrderingOpen, gamesPreviewResponse } from "@/lib/games/ordering";
import { verifyGamesQuoteToken } from "@/lib/games/quote";
import { gamesBrandMatches, gamesRegistryGame } from "@/lib/games/registry";
import { pediaApiLocale, pick } from "@/lib/pedia/api-locale";
import { pediaPaymentMethodProblem, resolvePediaMethodSelection } from "@/lib/pedia/payment-methods";
import { gamesPaymentBlock } from "@/lib/games/lookup";
import type { Locale } from "@/lib/i18n/locale";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schemaFor = (locale: Locale) => z.object({
  // ponytail: 30k fits the 32k JSON boundary; reuse the compact quote codec if the catalog grows.
  quote_token: z.string().trim().min(20).max(30000),
  payment_method: z.string().trim().max(64).optional().default("qris"),
  whatsapp: z.string().trim().transform((s) => s.replace(/\s|-/g, ""))
    .refine((s) => /^(\+62|62|0)8\d{8,13}$/.test(s), pick(locale, "No WA harus 08... atau +62... (10-15 digit)", "WhatsApp number must start with 08... or +62... (10-15 digits)")),
  email: z.string().trim().email(pick(locale, "Tulis email aktif yang benar sebelum bayar.", "Enter a valid active email before paying.")).max(160),
});

function normalizeWa(raw: string): string {
  if (raw.startsWith("+62")) return raw.slice(1);
  return raw.startsWith("0") ? `62${raw.slice(1)}` : raw;
}

const ACTIVE_ITEM_STATUSES = "('awaiting_payment','queued','submitting','pending','needs_check')";

const statusUrl = (code: unknown) => `/games/pesanan/${String(code)}`;

const paymentUnavailable = (code: unknown, locale: Locale) => NextResponse.json({
  error: pediaPaymentMethodProblem(locale), error_code: "payment_method_unavailable", code, status_url: statusUrl(code),
}, { status: 503, headers: { "Cache-Control": "private, no-store" } });

/** Saved non-QRIS invoices are read-only: never retry the provider POST. */
async function checkoutResponse(db: DatabaseAccess, order: Record<string, unknown>, reused: boolean, locale: Locale) {
  const total = Number(order.subtotal);
  const method = String(order.payment_method ?? "qris");
  let qris: Record<string, unknown> | null = null;
  let payment = null;
  if (String(order.status) === "pending" && total > 0) {
    if (method !== "qris") {
      const provider = method.startsWith("sekalipay_gateway:") ? "sekalipay_gateway" : method.startsWith("nowpayments:") ? "nowpayments" : "";
      payment = await gamesPaymentBlock(String(order.code), { provider }, db).catch(() => null);
      if (!payment || payment.state === "initializing") return paymentUnavailable(order.code, locale);
    } else {
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
  }
  return NextResponse.json({
    code: order.code,
    status_url: statusUrl(order.code),
    status: order.status,
    total,
    qris,
    ...(payment ? { payment } : {}),
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
  const parsed = schemaFor(locale).safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? pick(locale, "Validasi gagal", "Validation failed") }, { status: 400 });
  }
  const customerWa = normalizeWa(parsed.data.whatsapp), customerEmail = parsed.data.email;
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
  const reused = await db.queryFirst(`SELECT code,subtotal,status,payment_method FROM orders WHERE quote_id=?`, quoteId).catch(() => null);
  if (reused) return checkoutResponse(db, reused, true, locale);
  if (!quote.payment_methods) return NextResponse.json({ error: "quote_stale" }, { status: 409 });
  const paymentMethod = parsed.data.payment_method;
  const selection = await resolvePediaMethodSelection({ methods: quote.payment_methods, methodId: paymentMethod, idrSubtotal: quote.total, locale });
  if (!selection.ok) return NextResponse.json({ error: selection.code ?? selection.message,
    ...(selection.status === 503 ? { error_code: "payment_method_unavailable" } : {}), message: selection.message,
  }, { status: selection.status, headers: { "Cache-Control": "private, no-store" } });
  if (selection.kind === "gateway" && (customerEmail.length > 100 || deriveNameFromEmail(customerEmail).length > 100)) {
    return NextResponse.json({ error: pick(locale, "Data pembeli tidak valid.", "Buyer details are invalid.") }, { status: 400 });
  }

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
    await checkoutSubjects({ ip: clientIp(req), wa: customerWa, email: customerEmail }),
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
  const derivedName = deriveNameFromEmail(customerEmail);
  const statement = (sql: string, ...params: unknown[]) => db.d1!.prepare(sql).bind(...params);
  const owned = `EXISTS(SELECT 1 FROM orders WHERE code=? AND quote_id=?)`;
  let claimed = false;
  try {
    const result = await db.d1.batch([
      statement(
        `INSERT INTO orders(code,quote_id,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,payment_status,sales_channel,order_kind,expires_at,buyer_access_version,buyer_access_format,locale)
         SELECT ?,?,?,?,?,'[]',?,?,?,'pending','pending','web','games',datetime('now',?),0,'code26',?
          WHERE EXISTS(SELECT 1 FROM games_products WHERE id=? AND buyer_sku_code=?
            AND enabled=1 AND seller_active=1 AND sell_price=? AND cost=? AND lower(trim(game_brand))=?)
            AND NOT EXISTS(SELECT 1 FROM games_order_items WHERE customer_no=? AND buyer_sku_code=? AND status IN ${ACTIVE_ITEM_STATUSES})`,
         code, quoteId, derivedName, customerWa, customerEmail, price,
          paymentMethod, selection.paymentAccount, selection.kind === "gateway" ? "+30 minutes" : selection.kind === "crypto" ? "+60 minutes" : "+15 minutes",
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
    const existing = await db.queryFirst(`SELECT code,subtotal,status,payment_method FROM orders WHERE quote_id=?`, quoteId).catch(() => null);
    if (existing) return checkoutResponse(db, existing, true, locale);
    return NextResponse.json({ error: pick(locale, "Pesanan belum tersimpan. Coba lagi dengan data yang sama.", "The order was not saved. Try again with the same details.") }, { status: 503 });
  }
  if (!claimed) {
    const raceWinner = await db.queryFirst(`SELECT code,subtotal,status,payment_method FROM orders WHERE quote_id=?`, quoteId).catch(() => null);
    if (raceWinner) return checkoutResponse(db, raceWinner, true, locale);
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
  if (selection.kind !== "qris") {
    try {
      if (selection.kind === "crypto" && selection.cryptoUsd) {
        const { createNowpaymentsInvoice } = await import("@/lib/payments/nowpayments");
        await createNowpaymentsInvoice(code, price, selection.cryptoUsd.payCurrency, {
          payNetwork: selection.cryptoUsd.network, priceCurrency: "usd", feePayer: "merchant", fixedRate: false, expectedUsd: selection.cryptoUsd,
        });
      } else if (selection.kind === "gateway" && selection.gateway) {
        const { createSekalipayGatewayInvoice } = await import("@/lib/payments/sekalipay-gateway");
        await createSekalipayGatewayInvoice(code, price, selection.gateway.channel,
          { name: derivedName, email: customerEmail, phone: customerWa }, selection.gateway.estimated_fee);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      let definitive = false;
      if (selection.kind === "crypto") {
        const tx = await db.queryFirst("SELECT id FROM payment_transactions WHERE order_code=? AND provider='nowpayments' AND status IN ('initializing','pending')", code);
        definitive = !tx && message !== "nowpayments_network_ambiguous" && message !== "nowpayments_finalize_failed_manual_review";
      } else {
        const tx = await db.queryFirst("SELECT id FROM payment_transactions WHERE order_code=? AND provider='sekalipay_gateway'", code);
        definitive = !tx;
        if (tx && message === "sekalipay_gateway_create_rejected") {
          const { confirmGatewayInvoiceAbsent, markGatewayInvoiceCreateRejected } = await import("@/lib/payments/sekalipay-gateway");
          const absence = await confirmGatewayInvoiceAbsent(code, db).catch(() => "unknown" as const);
          definitive = absence === "absent" && await markGatewayInvoiceCreateRejected(code, db).catch(() => false);
        }
      }
      if (definitive) {
        await transitionPendingOrder(code, "dibatalkan", selection.kind === "crypto" ? `nowpayments_setup_failed:${message.slice(0, 60)}` : "gateway_setup_failed", []).catch(() => {});
        const { expireGamesCheckouts } = await import("@/lib/games/expire");
        await expireGamesCheckouts(db).catch(() => {});
      }
      return paymentUnavailable(code, locale);
    }
  }
  // Only shorten the saved deadline; provider invoices can never extend it.
  await db.execRun(`UPDATE orders SET expires_at=datetime((SELECT expires_at FROM payment_transactions WHERE order_code=?))
    WHERE code=? AND status='pending' AND julianday(expires_at)>julianday((SELECT expires_at FROM payment_transactions WHERE order_code=?))`, code, code, code);
  return checkoutResponse(db, { code, subtotal: price, status: "pending", payment_method: paymentMethod }, false, locale);
}
