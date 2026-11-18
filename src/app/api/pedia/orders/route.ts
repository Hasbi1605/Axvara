import { isPaymentMaintenanceEnabled, paymentMaintenanceResponse } from "@/lib/payment-maintenance";
// POST /api/pedia/orders — Buat order Pedia (PD-21/25, §9.2/9.7).
// Publik + rate-limit pedia:orders 10/mnt/IP. Guard ganda sebelum invoice:
// (1) quote JWT valid; (2) harga terkini: bila paket dihapus supplier→404,
// harga berubah→409 price_changed (banding, bukan diam-diam — pola orders),
// margin tersisa < min→410 pedia_guard_margin; (3) email+WA wajib;
// (4) order/job disimpan dalam satu batch D1 atomik, tanpa kredit pembeli.
// Order memakai tabel `orders` existing (order_kind='pedia') agar webhook
// DANA/GoPay + fulfillment existing langsung bekerja. Job Pedia dibuat di
// transaksi checkout; dispatch menunggu order lunas.
import { pediaServiceTypeFor, CUSTOM_COMMENT_MAX_LINES } from "@/lib/pedia/custom-comments";
import { NextRequest, NextResponse } from "next/server";
import { trackFunnelEvent } from "@/lib/analytics/funnel";
import { activeQrisProvider } from "@/lib/payments/dana-qris";
import { assertOrderAccessConfigured, createBuyerAccessSession } from "@/lib/order-access";
import { z } from "zod";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { checkoutSubjects, consumeCheckoutSlot } from "@/lib/checkout-guard";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { verifyPediaQuoteToken } from "@/lib/pedia/quote";
import { pediaBounds } from "@/lib/pedia/bounds";
import { readJsonBody } from "@/lib/http-body";
import { computePediaPrice, pediaMargin } from "@/lib/pedia/pricing";
import { pediaMinOrderRp } from "@/lib/pedia/ops-config";
import { generateOrderCode } from "@/lib/security";
import { isPediaProvider } from "@/lib/pedia/proxy";
import { isPediaSaleProvider, PEDIA_SALE_RETIRED } from "@/lib/pedia/sales-policy";
import { deriveNameFromEmail } from "@/lib/utils";
import { transitionPendingOrder } from "@/lib/db";
import { pediaApiLocale, pick } from "@/lib/pedia/api-locale";
import { pediaPaymentMethodProblem, resolvePediaMethodSelection } from "@/lib/pedia/payment-methods";
import type { Locale } from "@/lib/i18n/locale";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schemaFor = (locale: Locale) => z.object({
  customer_wa: z.string().trim().transform((s) => s.replace(/\s|-/g, ""))
    .refine((s) => /^(\+62|62|0)8\d{8,13}$/.test(s), pick(locale, "No WA harus 08... atau +62... (10-15 digit)", "WhatsApp number must start with 08... or +62... (10-15 digits)")),
  customer_email: z.string().trim().email(pick(locale, "Tulis email aktif yang benar sebelum bayar.", "Enter a valid active email before paying.")).max(160),
  quote_token: z.string().trim().min(20, pick(locale, "Quote checkout wajib disertakan", "Checkout quote is required")).max(20000),
  /** Fase B: id metode dari token bertanda tangan. Default QRIS (perilaku lama). */
  payment_method: z.string().trim().max(64).optional().default("qris"),
});

function normalizeWa(raw: string): string {
  let wa = raw.replace(/\s|-/g, "");
  if (wa.startsWith("+62")) wa = wa.slice(1);
  else if (wa.startsWith("0")) wa = "62" + wa.slice(1);
  return wa;
}

/** Durable checkout already exists: retry only its invoice, never debit again. */
async function checkoutResponse(db: DatabaseAccess, order: Record<string, unknown>, reused: boolean, locale: Locale) {
  const job = await db.queryFirst(`SELECT credit_used FROM pedia_order_items WHERE order_code=?`, order.code);
  if (!job) return NextResponse.json({ error: pick(locale, "Pesanan perlu diperiksa admin.", "The order needs an admin check."), code: order.code }, { status: 503 });
  const creditUsed = Number(job.credit_used), payable = Number(order.subtotal) - creditUsed;
  const method = String(order.payment_method ?? "qris");
  let qris: Record<string, unknown> | null = null;
  let payment: Record<string, unknown> | null = null;
  if (payable > 0 && order.status === "pending") {
    if (method === "qris") {
      try {
        const { createActiveQrisInvoice } = await import("@/lib/payments/dana-qris");
        const inv = await createActiveQrisInvoice(String(order.code), payable);
        qris = { payable_amount: inv.payableAmount, unique_code: inv.uniqueCode, image_url: inv.qrisUrl, expires_at: inv.expiresAt };
      } catch {
        return NextResponse.json({ error: pick(locale, "Pesanan tersimpan. QRIS belum tersedia; coba lanjutkan lagi dengan data yang sama.", "The order is saved. QRIS is not available yet; try continuing again with the same details."), code: order.code }, { status: 503 });
      }
    } else if (method.startsWith("sekalipay_gateway:")) {
      // Saved gateway: read-only view (reconcile berjalan di GET status / cron).
      const tx = await db.queryFirst("SELECT id FROM payment_transactions WHERE order_code=? AND provider='sekalipay_gateway'", order.code).catch(() => null);
      if (!tx) return NextResponse.json({ error: pediaPaymentMethodProblem(locale), error_code: "payment_method_unavailable", code: order.code }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
      const { buildSekalipayGatewayPaymentView } = await import("@/lib/payments/payment-view");
      const view = await buildSekalipayGatewayPaymentView(String(order.code)).catch(() => null);
      if (!view || view.state === "initializing") return NextResponse.json({ error: pediaPaymentMethodProblem(locale), error_code: "payment_method_unavailable", code: order.code }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
      payment = view as unknown as Record<string, unknown>;
    } else if (method.startsWith("nowpayments:")) {
      const tx = await db.queryFirst("SELECT id FROM payment_transactions WHERE order_code=? AND provider='nowpayments'", order.code).catch(() => null);
      const { buildNowpaymentsPaymentView } = await import("@/lib/payments/payment-view");
      const view = tx ? await buildNowpaymentsPaymentView(String(order.code)).catch(() => null) : null;
      if (!view) return NextResponse.json({ error: pediaPaymentMethodProblem(locale), error_code: "payment_method_unavailable", code: order.code }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
      payment = view as unknown as Record<string, unknown>;
    } else {
      return NextResponse.json({ error: pediaPaymentMethodProblem(locale), error_code: "payment_method_unavailable", code: order.code }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
  }
  return NextResponse.json({ code: order.code, buyer_access_session: await createBuyerAccessSession(order), subtotal: order.subtotal, credit_used: creditUsed, payable, status: order.status, qris, ...(payment ? { payment } : {}), reused }, { status: reused ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
}

/** Order expiry = min(batas rail AXVARA, deadline provider) — tidak pernah memanjangkan. */
async function shortenToProviderDeadline(db: DatabaseAccess, code: string) {
  const tx = await db.queryFirst("SELECT expires_at FROM payment_transactions WHERE order_code=? ORDER BY id DESC LIMIT 1", code).catch(() => null);
  const raw = tx?.expires_at == null ? "" : String(tx.expires_at);
  if (!raw) return;
  const parsed = Date.parse(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (!Number.isFinite(parsed)) return;
  const iso = new Date(parsed).toISOString();
  await db.execRun(
    `UPDATE orders SET expires_at=datetime(?)
      WHERE code=? AND status='pending' AND datetime(expires_at)>datetime(?)`,
    iso, code, iso,
  ).catch(() => null);
}

export async function POST(req: NextRequest) {
  const locale = pediaApiLocale(req);
  if (isPaymentMaintenanceEnabled()) return paymentMaintenanceResponse();
  if (!checkRateLimit(req, "pedia:orders")) {
    return NextResponse.json({ error: pick(locale, "Terlalu banyak percobaan, coba lagi 1 menit.", "Too many attempts, try again in 1 minute.") }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (process.env.PEDIA_ENABLED !== "true" || process.env.PEDIA_ORDERS_ENABLED !== "true") {
    return NextResponse.json({ error: pick(locale, "Pedia belum dibuka untuk order.", "Pedia is not open for orders yet.") }, { status: 503 });
  }
  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = schemaFor(locale).safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? pick(locale, "Validasi gagal", "Validation failed") }, { status: 400 });
  }
  const { customer_wa, customer_email, quote_token, payment_method } = parsed.data;
  try { assertOrderAccessConfigured(); } catch {
    return NextResponse.json({ error: pick(locale, "Checkout sementara tidak tersedia.", "Checkout is temporarily unavailable.") }, { status: 503 });
  }
  if (!process.env.ADMIN_JWT_SECRET && process.env.NODE_ENV === "production") return NextResponse.json({ error: pick(locale, "Checkout sementara tidak tersedia.", "Checkout is temporarily unavailable.") }, { status: 503 });
  const quote = await verifyPediaQuoteToken(quote_token);
  if (!quote) {
    return NextResponse.json({ error: pick(locale, "Quote checkout tidak valid atau sudah kedaluwarsa. Muat ulang checkout.", "The checkout quote is invalid or expired. Reload checkout.") }, { status: 409 });
  }
  const db = createDatabaseAccess();
  // INDO-POLICY-20: the existing-checkout lookup runs FIRST. An already
  // persisted order retry (same quote_id) returns the existing order as
  // before — including orders of a supplier this build no longer sells. Only
  // unreserved retired-provider quotes are rejected below, before any DB tier
  // checks, debit/reservation, or invoice.
  const reused = await db.queryFirst(`SELECT code, subtotal, status, payment_method, buyer_access_version,buyer_access_format FROM orders WHERE quote_id=?`, `pedia:${quote.jti}`);
  if (reused) return checkoutResponse(db, reused, true, locale);
  // Persisted retries above retain their original payable, including legacy
  // credits. An unreserved old quote cannot debit or redeem a credit now.
  if (quote.credit_used !== 0 || quote.credit_code_hash) return NextResponse.json({ error: "credits_retired", message: pick(locale, "Muat ulang harga. Kode kredit tidak lagi digunakan; kode lama ditangani admin.", "Reload the price. Credit codes are no longer used; old codes are handled by admin.") }, { status: 409 });
  if (!isPediaSaleProvider(quote.supplier)) {
    return NextResponse.json({ ...PEDIA_SALE_RETIRED, message: pick(locale, String(PEDIA_SALE_RETIRED.message ?? ""), "This service is no longer sold. Choose another available service.") }, { status: 409 });
  }
  const minOrderRp = pediaMinOrderRp();

  // Hitung ulang dari DB (JANGAN percaya angka client/quote — pola orders):
  const product = await db.queryFirst(`SELECT * FROM pedia_products WHERE id=? AND is_active=1`, quote.product_id).catch(() => null);
  const tier = await db.queryFirst(`SELECT * FROM pedia_tiers WHERE id=? AND product_id=? AND is_active=1`, quote.tier_id, quote.product_id).catch(() => null);
  if (!product || !tier) {
    return NextResponse.json({ error: pick(locale, "Produk atau tingkat sudah tidak tersedia. Muat ulang katalog.", "The product or quality level is no longer available. Reload the catalog.") }, { status: 404 });
  }
  if (!isPediaProvider(tier.supplier) || tier.supplier !== quote.supplier || Number(tier.supplier_service_id) !== quote.supplier_service_id) {
    return NextResponse.json({ error: "service_changed", message: pick(locale, "Layanan berubah. Muat ulang checkout.", "The service changed. Reload checkout.") }, { status: 409 });
  }
  const live = await db.queryFirst(
    `SELECT * FROM pedia_supplier_services WHERE supplier=? AND service_id=? AND present=1 AND type=? AND rate_idr_per_1k>0`,
    tier.supplier, Number(tier.supplier_service_id), pediaServiceTypeFor(tier.input_kind),
  ).catch(() => null);
  if (!live) {
    return NextResponse.json({ error: pick(locale, "Layanan sedang tidak tersedia. Coba lagi nanti.", "The service is temporarily unavailable. Try again later.") }, { status: 409 });
  }
  const qty = quote.quantity;
  const limits = pediaBounds(tier.input_kind === "comments" ? { ...live, max_qty: Math.min(Number(live.max_qty), CUSTOM_COMMENT_MAX_LINES) } : live, tier, Number(product.step));
  if (!limits || qty < limits.min || qty > limits.max || qty % limits.step !== 0) {
    return NextResponse.json({ error: pick(locale, "Jumlah tidak lagi valid untuk layanan ini. Muat ulang checkout.", "The quantity is no longer valid for this service. Reload checkout.") }, { status: 409 });
  }
  // Chip paket hanyalah contoh jumlah. Jumlah bebas yang ditandatangani quote
  // tetap sah sepanjang min–max/step layanan live dan margin diperiksa di sini.
  const freshTotal = computePediaPrice({
    supplierRatePer1k: Number(live.rate_idr_per_1k),
    quantity: qty,
    markupPct: Number(tier.markup_pct) || 0,
    minProfitRp: Number(tier.min_profit_rp) || 0,
    minOrderRp,
  });
  if (!Number.isFinite(freshTotal) || freshTotal <= 0) return NextResponse.json({ error: pick(locale, "Layanan sedang tidak tersedia.", "The service is temporarily unavailable.") }, { status: 409 });
  // Guard margin di jalur uang (PD-33): bila margin tersisa < min sejak quote,
  // TOLAK dengan 410 (bukan kirim rugi) — kunci tier untuk admin.
  const margin = pediaMargin({
    supplierRatePer1k: Number(live.rate_idr_per_1k),
    quantity: qty, sellPrice: freshTotal,
  });
  if (margin < Number(tier.min_profit_rp)) {
    const disabled = await db.execRun(
      `UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='margin', updated_at=datetime('now')
        WHERE id=? AND is_active=1`,
      Number(tier.id),
    ).catch(() => ({ changes: 0 }));
    if (Number(disabled?.changes ?? 0) > 0) {
      const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
      await bumpCatalogRevision("pedia", db);
    }
    return NextResponse.json({ error: "pedia_guard_margin", message: pick(locale, "Kualitas ini baru saja dinonaktifkan otomatis (margin). Pilih kualitas lain.", "This quality was just disabled automatically (margin). Choose another quality.") }, { status: 410 });
  }
  if (freshTotal !== quote.total) {
    return NextResponse.json({
      error: "price_changed",
      message: pick(locale, "Harga berubah sejak halaman checkout dibuka. Muat ulang agar kamu membayar harga terbaru.", "The price changed since checkout was opened. Reload so you pay the latest price."),
    }, { status: 409 });
  }

  // Fase B: metode WAJIB berasal dari daftar bertanda tangan di token. Rail
  // crypto/gateway dicek ulang terhadap konfigurasi + snapshot segar (helper
  // Market); tidak ada fallback diam-diam ke QRIS.
  const selection = await resolvePediaMethodSelection({ methods: quote.payment_methods, methodId: payment_method, idrSubtotal: freshTotal, locale });
  if (!selection.ok) {
    return NextResponse.json(
      { error: selection.message, ...(selection.code ? { code: selection.code } : {}), ...(selection.status === 503 ? { error_code: "payment_method_unavailable" } : {}) },
      { status: selection.status, headers: { "Cache-Control": "private, no-store", ...(selection.status === 409 ? {} : {}) } },
    );
  }
  if (selection.kind === "gateway" && (customer_email.length > 100 || deriveNameFromEmail(customer_email).length > 100)) {
    return NextResponse.json({ error: pick(locale, "Data pembeli tidak valid.", "Buyer details are invalid.") }, { status: 400 });
  }

  // Share admission with Market; a stable quote key dedupes parallel retries.
  const guard = await consumeCheckoutSlot(
    db,
    await checkoutSubjects({ ip: clientIp(req), wa: normalizeWa(customer_wa), email: customer_email }),
    `pedia:${quote.jti}`,
  );
  if (!guard.allowed) {
    if (guard.reason === "unavailable") return NextResponse.json(
      { error: "checkout_unavailable", message: pick(locale, "Checkout sementara tidak tersedia. Coba lagi dengan data yang sama.", "Checkout is temporarily unavailable. Try again with the same details.") },
      { status: 503, headers: { "Retry-After": String(guard.retryAfterSeconds) } },
    );
    return NextResponse.json(
      { error: "checkout_rate_limited", message: pick(locale, "Terlalu banyak pesanan baru dari koneksi/nomor ini. Tunggu hingga 15 menit, lalu coba lagi. Pesanan yang sudah dibuat tetap bisa dilacak.", "Too many new orders from this connection/number. Wait up to 15 minutes, then try again. Orders already created can still be tracked.") },
      { status: 429, headers: { "Retry-After": String(guard.retryAfterSeconds) } },
    );
  }

  // Claim the order and job in one transaction; duplicate targets create neither.
  if (!db.d1) return NextResponse.json({ error: pick(locale, "Checkout sementara tidak tersedia.", "Checkout is temporarily unavailable.") }, { status: 503 });
  // The durable guard deliberately consumes before this atomic claim;
  // a different quote rejected for a duplicate target still uses its slot.
  const creditUsed = 0;
  const payable = freshTotal;
  const code = generateOrderCode().replace(/^AXV-/, "AXP-");
  const quoteIdRow = `pedia:${quote.jti}`;
  // customer_name follows Market exactly (orders route): explicit name is not
  // collected, so derive from email at insert time. Read-time fallback below
  // covers legacy rows without overwriting non-empty names.
  const derivedName = deriveNameFromEmail(customer_email);
  const items = JSON.stringify([{
    product_id: quote.product_id, variant_id: null, qty: 1, price: freshTotal, name: String(product.name),
    pedia: { tier_id: quote.tier_id, quantity: qty, target: quote.target_normalized, unit_price: quote.unit_price, credit_used: creditUsed },
  }]);
  // Pedia tidak pernah mereservasi stok Market: semua cancel di rute ini memakai
  // daftar restock kosong (lihat transitionPendingOrder di bawah).
  const snapshot = JSON.stringify({ supplier_target: quote.supplier_target ?? quote.target_normalized, refill_anchor: quote.refill_anchor ?? "created", supplier: quote.supplier, supplier_service_id: quote.supplier_service_id,
    refill_days: quote.refill_days ?? (Number(tier.refill_days) || 0), min_profit_rp: quote.min_profit_rp ?? (Number(tier.min_profit_rp) || 0), service_copy: quote.service_copy, ...(quote.custom_comments ? { custom_comments: quote.custom_comments } : {}) });
  const owned = `EXISTS(SELECT 1 FROM orders WHERE code=? AND quote_id=?)`;
  const statement = (sql: string, ...params: unknown[]) => db.d1!.prepare(sql).bind(...params);
  let claimed = false;
  try {
    const result = await db.d1.batch([
      statement(`INSERT INTO orders(code,quote_id,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,sales_channel,order_kind,payment_status,paid_at,expires_at,buyer_access_version,buyer_access_format,locale)
        SELECT ?,?,?,?,?,?,?,?,?,?,'web','pedia',?,CASE WHEN ?=0 THEN datetime('now') ELSE NULL END,datetime('now','${payment_method.startsWith("sekalipay_gateway:") ? "+30 minutes" : "+60 minutes"}'),1,'pin6',?
        WHERE NOT EXISTS(SELECT 1 FROM pedia_order_items WHERE target_normalized=? AND product_id=? AND status IN ('awaiting_payment','queued','submitting','submitted','in_progress','needs_check'))`,
        code,quoteIdRow,derivedName,normalizeWa(customer_wa),customer_email,items,freshTotal,payment_method,selection.paymentAccount,payable ? "pending" : "lunas",payable ? "pending" : "paid",payable,
        quote.locale ?? locale, quote.target_normalized, quote.product_id),
      statement(`INSERT INTO pedia_order_items(order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,credit_used,supplier,supplier_service_id,supplier_rate_snapshot,status,submit_attempts)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',0 WHERE ${owned}`,
        code,quote.product_id,quote.tier_id,snapshot,quote.target_raw,quote.target_normalized,qty,quote.unit_price,freshTotal,creditUsed,quote.supplier,quote.supplier_service_id,quote.supplier_rate_snapshot,code,quoteIdRow),
    ]);
    claimed = Number(result[0]?.meta?.changes) === 1;
  } catch (error) {
    // 2026-11-01: dulu error ditelan tanpa jejak, sehingga FK tier_id yang
    // menunjuk tabel arsip (lihat migrasi 0084) tidak terlihat di log. Hanya
    // pesan D1 + id tier/produk; tanpa kontak, target atau token.
    console.error("[pedia-orders] claim batch failed", { tier_id: quote.tier_id, product_id: quote.product_id, error: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
    const existing = await db.queryFirst(`SELECT code,subtotal,status,payment_method,buyer_access_version,buyer_access_format FROM orders WHERE quote_id=?`,quoteIdRow).catch(() => null);
    if (existing) return checkoutResponse(db,existing,true,locale);
    return NextResponse.json({ error: pick(locale, "Pesanan belum tersimpan. Coba lagi dengan data yang sama.", "The order was not saved. Try again with the same details.") }, { status: 503 });
  }
  if (!claimed) {
    // A parallel retry of this same quote may have committed between the
    // reuse lookup above and this claim (the durable guard adds awaits in
    // between). That winner is a reuse, never a duplicate-target rejection.
    const raceWinner = await db.queryFirst(`SELECT code,subtotal,status,payment_method,buyer_access_version,buyer_access_format FROM orders WHERE quote_id=?`, quoteIdRow).catch(() => null);
    if (raceWinner) return checkoutResponse(db, raceWinner, true, locale);
    const dup = await db.queryFirst(`SELECT order_code FROM pedia_order_items WHERE target_normalized=? AND product_id=? AND status IN ('awaiting_payment','queued','submitting','submitted','in_progress','needs_check') ORDER BY id DESC LIMIT 1`,quote.target_normalized,quote.product_id);
    if (dup) return NextResponse.json({ error: "duplicate_active_order", message: pick(locale, "Link ini masih memiliki pesanan yang diproses. Tunggu selesai atau hubungi admin.", "This link still has an order in progress. Wait for it to finish or contact admin.") }, { status: 409 });
    return NextResponse.json({ error: "checkout_changed", message: pick(locale, "Pesanan berubah. Periksa ulang sebelum melanjutkan.", "The order changed. Review again before continuing.") }, { status: 409 });
  }
  // Invoice per rail (2026-11-07 fase B). QRIS dibuat di checkoutResponse
  // (perilaku lama); gateway/crypto dibuat DI SINI sebelum view dibangun.
  if (selection.kind === "crypto" && selection.cryptoUsd) {
    try {
      const { createNowpaymentsInvoice } = await import("@/lib/payments/nowpayments");
      await createNowpaymentsInvoice(code, payable, selection.cryptoUsd.payCurrency, {
        payNetwork: selection.cryptoUsd.network,
        priceCurrency: "usd",
        feePayer: "merchant",
        fixedRate: false,
        expectedUsd: selection.cryptoUsd,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown";
      console.error("[pedia-orders] NOWPayments setup failed:", message.slice(0, 120));
      const claimedTx = await db.queryFirst("SELECT id FROM payment_transactions WHERE order_code=? AND provider='nowpayments' AND status IN ('initializing','pending')", code);
      // Ambiguous/mid-finalize: klaim + stok dipertahankan, JANGAN POST ulang/cancel.
      if (claimedTx || message === "nowpayments_network_ambiguous" || message === "nowpayments_finalize_failed_manual_review") {
        return NextResponse.json({ error: pediaPaymentMethodProblem(locale), error_code: "payment_method_unavailable", code }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
      }
      // Definitif: batalkan order + item, pembeli memilih metode lain dengan quote baru.
      await transitionPendingOrder(code, "dibatalkan", `nowpayments_setup_failed:${message.slice(0, 60)}`, []).catch(() => {});
      const { expirePediaCheckouts } = await import("@/lib/pedia/expire");
      await expirePediaCheckouts(db).catch(() => {});
      return NextResponse.json({ error: pediaPaymentMethodProblem(locale), error_code: "payment_method_unavailable", code }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
  } else if (selection.kind === "gateway" && selection.gateway) {
    try {
      const { createSekalipayGatewayInvoice } = await import("@/lib/payments/sekalipay-gateway");
      await createSekalipayGatewayInvoice(code, payable, selection.gateway.channel, { name: derivedName, email: customer_email, phone: normalizeWa(customer_wa) }, selection.gateway.estimated_fee);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown";
      console.error("[pedia-orders] gateway setup failed:", message.slice(0, 120));
      const claimedTx = await db.queryFirst("SELECT id FROM payment_transactions WHERE order_code=? AND provider='sekalipay_gateway'", code);
      // Default lama: klaim tersimpan DIPERTAHANKAN (tanpa POST ulang) dan order
      // pending; preclaim orphan = 503 aman. SATU-SATUNYA jalur batal baru di sini:
      // create ditolak TERBACA (`create_rejected`) DAN GET read-only membuktikan
      // invoice tidak ada. Ambigu (timeout/502/504/unreadable, GET rate-limited/
      // error/bukan 404) selalu jatuh ke perilaku lama.
      if (claimedTx && message === "sekalipay_gateway_create_rejected") {
        const { confirmGatewayInvoiceAbsent, markGatewayInvoiceCreateRejected } = await import("@/lib/payments/sekalipay-gateway");
        const absence = await confirmGatewayInvoiceAbsent(code, db).catch(() => "unknown" as const);
        // Tandai TX terminal DULU agar callback/reconcile telat melihat baris mati,
        // baru batalkan order + keluarkan item dari status aktif (duplicate-target).
        if (absence === "absent" && await markGatewayInvoiceCreateRejected(code, db).catch(() => false)) {
          await transitionPendingOrder(code, "dibatalkan", "gateway_setup_failed", []).catch(() => {});
          const { expirePediaCheckouts } = await import("@/lib/pedia/expire");
          await expirePediaCheckouts(db).catch(() => {});
        }
      }
      if (!claimedTx) {
        await transitionPendingOrder(code, "dibatalkan", "gateway_setup_failed", []).catch(() => {});
        const { expirePediaCheckouts } = await import("@/lib/pedia/expire");
        await expirePediaCheckouts(db).catch(() => {});
      }
      return NextResponse.json({ error: pediaPaymentMethodProblem(locale), error_code: "payment_method_unavailable", code }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
  }
  await shortenToProviderDeadline(db, code);
  const response = await checkoutResponse(db,{ code,subtotal:freshTotal,status:payable ? "pending" : "lunas", payment_method, buyer_access_version: 1, buyer_access_format: "pin6" },false,locale);
  if (response.status === 201) trackFunnelEvent({ stage: "order", orderKind: "pedia", productId: quote.product_id,
    variantId: quote.tier_id, subtotal: freshTotal, quantity: quote.quantity, locale: quote.locale ?? locale,
    method: payment_method === "qris" ? `qris:${activeQrisProvider()}` : payment_method }, req);
  return response;
}
