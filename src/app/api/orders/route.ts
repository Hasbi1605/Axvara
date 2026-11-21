import { wrJaspayCoveredSql, wrNewSaleAllowed } from "@/lib/warung-rebahan/new-sales";
import { readAutomaticProgress } from "@/lib/warung-rebahan/progress";
import { EMPTY_STATUS_FLAGS, maybeRefreshStatusFlags, readStatusFlags, type StatusFlags } from "@/lib/orders/status-flags";
import { buildStatusDetailView, maskBuyerContact } from "@/lib/orders/detail-view";
import { isPaymentMaintenanceEnabled, paymentMaintenanceResponse } from "@/lib/payment-maintenance";
import { NextRequest, NextResponse } from "next/server";
import { trackFunnelEvent } from "@/lib/analytics/funnel";
import { activeQrisProvider } from "@/lib/payments/qris";
import { deriveNameFromEmail } from "@/lib/utils";
import { z } from "zod";
import { assertSameBuyerCode, buyerFieldsSchema, withoutPrivateBuyerData } from "@/lib/buyer-fields";
import { createOrderWithStock, queryAll, queryFirst, StockReservationError, transitionPendingOrder } from "@/lib/db";
import { createdCheckoutResponse, existingCheckoutResponse, paymentMethodProblem } from "@/lib/orders/checkout/response";
import { decideEmailNeed, decideMinCap, findStalePriceItem } from "@/lib/orders/checkout/guards";
import { assertOrderAccessConfigured, buyerOrderAccessMatches, requestOrderAccessCode, createBuyerAccessSession, createCheckoutCredentialGrant, requiresOrderAccessCode, newOrderAccessFailure, orderAccessDenied } from "@/lib/order-access";
import { generateOrderCode as generateCode, aggregateQty } from "@/lib/security";
import { verifyCheckoutQuoteToken } from "@/lib/auth";
import { createActiveQrisInvoice, MAX_QRIS_REISSUES, type QrisInvoice } from "@/lib/payments/qris";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { expandDeliveryLines } from "@/lib/fulfillment/units";
import { createDatabaseAccess } from "@/lib/db-access";
import { checkoutSubjects, consumeCheckoutSlot } from "@/lib/checkout-guard";
import { readJsonBody } from "@/lib/http-body";
import { cryptoRailEnabled, cryptoTickerOfMethodId, isCryptoTotalStillPayable, isFxSnapshotAcceptable } from "@/lib/payments/crypto-preflight";
import { getCryptoAsset } from "@/lib/payments/crypto-assets";
import { CRYPTO_SURCHARGE_BPS, centsToUsdText, cryptoPricing } from "@/lib/payments/crypto-pricing";
import { isNowpaymentsConfigured } from "@/lib/payments/rails";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function routeDeps() {
  return {
    readFreshOrder: (code: unknown) =>
      queryFirst(
        "SELECT code,quote_id,subtotal,status,payment_status,payment_method,locale,buyer_access_version,buyer_access_format FROM orders WHERE code=?",
        code,
      ).catch(() => null),
    readTransaction: (code: unknown) =>
      queryFirst("SELECT provider,requested_amount FROM payment_transactions WHERE order_code=?", code),
    readOrderStatus: (code: unknown) => queryFirst("SELECT status FROM orders WHERE code=?", code),
    createBuyerAccessSession,
    createCheckoutCredentialGrant,
    createActiveQrisInvoice: (code: string, amount: number) => createActiveQrisInvoice(code, amount),
    reconcileNowpayments: async (code: string) => {
      const { reconcileNowpaymentsPayment, claimNowpaymentsPollReconcile } = await import("@/lib/payments/nowpayments");
      const claimed = await claimNowpaymentsPollReconcile(code);
      if (claimed) {
        await reconcileNowpaymentsPayment(code).catch(() => null);
      }
      const { buildNowpaymentsPaymentView } = await import("@/lib/payments/payment-view");
      const payment = await buildNowpaymentsPaymentView(code).catch(() => null);
      return { claimed, payment };
    },
    createSekalipayGatewayPreclaimView: async (live: Record<string, unknown>) => {
      const { buildSekalipayGatewayPaymentView } = await import("@/lib/payments/payment-view");
      let payment = await buildSekalipayGatewayPaymentView(String(live.code));
      if (payment?.state === "initializing") {
        try {
          const { claimSekalipayGatewayPoll } = await import("@/lib/payments/payment-view");
          if (!await claimSekalipayGatewayPoll(String(live.code))) throw new Error("gateway_poll_deferred");
          const saved = await queryFirst(`SELECT o.customer_name,o.customer_email,o.customer_wa,pt.gateway_channel,pt.gateway_estimated_fee FROM orders o JOIN payment_transactions pt ON pt.order_code=o.code WHERE o.code=? AND pt.provider='sekalipay_gateway'`, live.code);
          if (saved) {
            const { createSekalipayGatewayInvoice } = await import("@/lib/payments/sekalipay-gateway");
            await createSekalipayGatewayInvoice(String(live.code), Number(live.subtotal), String(saved.gateway_channel), { name: String(saved.customer_name), email: String(saved.customer_email), phone: String(saved.customer_wa) }, Number(saved.gateway_estimated_fee));
            payment = await buildSekalipayGatewayPaymentView(String(live.code));
          }
        } catch (error) {
          if (error instanceof Error && error.message === "gateway_poll_deferred") return { kind: "deferred" as const };
          try {
            const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
            await reconcileSekalipayGatewayPayment(String(live.code));
            payment = await buildSekalipayGatewayPaymentView(String(live.code));
          } catch { /* Saved claim stays bound; retry uses GET only. */ }
        }
      }
      if (!payment || payment.state === "initializing") return { kind: "generic" as const };
      return { kind: "reused" as const, payment };
    },
  };
}

const schema = z.object({
  // Revamp 2026-09-23 ala Sekalipay: nama dihapus dari form web. Opsional di
  // API (fallback prefix email di handler); kanal TG/WA tetap kirim nama.
  customer_name: z.string().trim().max(80).optional().or(z.literal("")),
  customer_wa: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s|-/g, ""))
    .refine((s) => /^(\+62|62|0)8\d{8,13}$/.test(s), "No WA harus 08... atau +62... (10-15 digit)"),
  // Revamp 2026-09-23: email SELALU wajib (semua produk digital — order
  // tanpa email = macet). Sebelumnya opsional kecuali varian butuh-email.
  customer_email: z.string().trim().email("Tulis email aktif yang benar sebelum bayar.").max(120),
  items: z.array(z.object({
    product_id: z.coerce.number().int().safe().min(1).optional(),
    slug: z.string().trim().min(1).max(100).optional(),
    variant_id: z.coerce.number().int().min(1).optional(),
    // Batas atas web = 100/baris (paritas Telegram) agar varian min-besar
    // (mis. GSuite min 50) tetap bisa dibeli dari web. Minimum per varian
    // ditegakkan ulang dari DB di bawah (JANGAN percaya angka client).
    qty: z.coerce.number().int().min(1).max(100),
    buyer_fields: buyerFieldsSchema.optional(),
  }).refine((item) => item.product_id || item.slug)).min(1).max(20),
  // W3 Web crypto: opaque id nowpayments:<ticker kurasi> ONLY (server-mapped asset/
  // network; client MUST NOT send currency/network/price). Legacy manual
  // bank/ewallet tetap ditolak 503 di bawah, bukan dibangkitkan.
  payment_method: z.string().trim().max(64),
  proof_url: z.string().trim().max(600).nullable().optional().default(null),
  quote_token: z.string().trim().min(20, "Quote checkout wajib disertakan").max(8000),
});

// Rate-limit terpusat (issue #14): satu implementasi di src/lib/rateLimit.ts
// agar batas tidak tersebar + IP anti-spoof (cf-connecting-ip > x-real-ip,
// x-forwarded-for TIDAK dipakai karena dapat di-spoof client). WAF Free (1
// rule, counting IP) tetap menjadi lapis pertama; ini lapis kedua per isolate.

export async function POST(req: NextRequest) {
  if (isPaymentMaintenanceEnabled()) return paymentMaintenanceResponse();
  if (!checkRateLimit(req, "checkout:orders")) return NextResponse.json({ error: "Terlalu banyak percobaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });

  const { customer_name, customer_wa, customer_email, items, payment_method, proof_url, quote_token } = parsed.data;
  try { assertOrderAccessConfigured(); } catch {
    return NextResponse.json({ error: "Checkout sementara tidak tersedia." }, { status: 503 });
  }

  // Proofs are private R2 objects. External URLs would bypass the protected
  // admin viewer and could be used as a tracking pixel.
  // Legacy manual E-Wallet/Bank tetap nonaktif (bukan dibangkitkan untuk
  // gateway): hanya qris + nowpayments:<ticker kurasi> + gateway yang lolos ke validasi token.
  const cryptoTicker = cryptoTickerOfMethodId(payment_method);
  const isCryptoMethod = cryptoTicker !== null;
  if (!isCryptoMethod && payment_method.startsWith("nowpayments:")) {
    // Koin di luar katalog kurasi tidak pernah ditandatangani/dibuat.
    return NextResponse.json({ error: "Metode pembayaran berubah atau sudah tidak aktif. Muat ulang checkout.", code: "quote_stale" }, { status: 409 });
  }
  const isGatewayMethod = /^sekalipay_gateway:[A-Za-z0-9_-]{1,64}$/.test(payment_method) && !/qris/i.test(payment_method);
  if (payment_method !== "qris" && !isCryptoMethod && !isGatewayMethod) {
    return NextResponse.json({ error: "E-Wallet & Transfer Bank sedang maintenance. Silakan bayar via QRIS." }, { status: 503 });
  }
  if (proof_url) {
    return NextResponse.json({ error: "Upload bukti sedang dinonaktifkan. Silakan bayar via QRIS." }, { status: 503 });
  }
  if (proof_url && (!proof_url.startsWith("/r2/bukti/") || proof_url.includes(".."))) {
    return NextResponse.json({ error: "URL bukti tidak valid" }, { status: 400 });
  }

  const quote = await verifyCheckoutQuoteToken(quote_token);
  if (!quote) {
    return NextResponse.json({ error: "Quote checkout tidak valid atau sudah kedaluwarsa. Muat ulang checkout." }, { status: 409 });
  }

  const slugs = [...new Set(items.flatMap((item) => item.slug ? [item.slug] : []))];
  const slugRows = slugs.length ? await queryAll(`SELECT id,slug FROM products WHERE slug IN (${slugs.map(() => "?").join(",")})`, ...slugs) : [];
  const slugIds = new Map(slugRows.map((row) => [String(row.slug), Number(row.id)]));
  const canonicalItems = items.map((item) => ({ ...item, product_id: item.slug ? slugIds.get(item.slug) : item.product_id }));
  if (canonicalItems.some((item, index) => !item.product_id || (items[index].product_id && item.product_id !== items[index].product_id))) return NextResponse.json({ error: "Isi keranjang berubah." }, { status: 409 });
  const requested = aggregateQty(canonicalItems as { product_id: number; variant_id?: number; qty: number }[]);
  const quoted = aggregateQty(quote.items);
  const sameItems = requested.size === quoted.size
    && [...requested.entries()].every(([key, qty]) => quoted.get(key) === qty);
  if (!sameItems) {
    return NextResponse.json({ error: "Isi keranjang berubah setelah harga dikunci. Muat ulang checkout." }, { status: 409 });
  }
  try {
    assertSameBuyerCode(items);
    for (const item of canonicalItems) {
      const signed = quote.items.find(q => q.product_id === item.product_id && q.variant_id === item.variant_id);
      if ((signed?.buyer_fields?.muse_invite_code ?? "") !== (item.buyer_fields?.muse_invite_code ?? "")) throw new Error("changed");
    }
  } catch { return NextResponse.json({ error: "Input pembeli berubah. Muat ulang checkout." }, { status: 409 }); }

  const previous = await queryFirst("SELECT code,quote_id,subtotal,status,payment_status,locale,buyer_access_version,buyer_access_format FROM orders WHERE quote_id=?", quote.quote_id);
  if (previous) return existingCheckoutResponse(previous, routeDeps());

  // Guard email lapis kedua (migrasi 0033 + revamp 2026-09-23): zod di atas
  // SUDAH mewajibkan email valid untuk semua order web, jadi blok ini kini
  // defense-in-depth — hitung ulang dari DB, JANGAN percaya flag client.
  // Invite/Link WR atau produk require_email=1 tanpa email valid = 422
  // sebelum order dibuat (order lunas tanpa email = macet di WR).
  try {
    const { needsEmailForVariant } = await import("@/lib/warung-rebahan/delivery-class");
    const variantIds = [...new Set(quote.items.map((i) => Number(i.variant_id || 0)).filter((v) => v > 0))];
    // DB reads stay HERE (same queries, same order) — guards.ts only owns
    // the pure computation over the fetched rows.
    let variantRows: Record<string, unknown>[] = [];
    let productRows: Record<string, unknown>[] = [];
    if (variantIds.length > 0) {
      variantRows = await queryAll(
        `SELECT pv.id, wv.wr_type AS wr_type, p.require_email AS require_email
         FROM product_variants pv
         LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
         LEFT JOIN products p ON p.id = pv.product_id
         WHERE pv.id IN (${variantIds.map(() => "?").join(",")})`,
        ...variantIds,
      );
    } else {
      const productIds = [...new Set(quote.items.map((i) => Number(i.product_id || 0)).filter((v) => v > 0))];
      if (productIds.length > 0) {
        productRows = await queryAll(
          `SELECT require_email FROM products WHERE id IN (${productIds.map(() => "?").join(",")})`,
          ...productIds,
        );
      }
    }
    const { emailNeeded, emailOk } = decideEmailNeed(
      { variantRows, productRows, hasVariants: variantIds.length > 0, customerEmail: customer_email },
      needsEmailForVariant,
    );
    if (emailNeeded && !emailOk) {
      return NextResponse.json({ error: "Produk ini dikirim via email invite — tulis email aktif yang benar sebelum bayar." }, { status: 422 });
    }
  } catch {
    // Guard email best-effort: bila query gagal (DB glitch), biarkan order
    // jalan agar checkout tidak mati total karena helper. Respons 422 di
    // atas sudah return langsung, jadi tidak perlu diteruskan.
  }

  // Minimum pembelian per varian (migrasi 0034): hitung ulang dari DB —
  // JANGAN percaya angka client. GSuite (min 50) yang lolos quote tapi
  // diubah client jadi qty kecil DITOLAK 409 di sini sebelum order dibuat.
  // WR3 Jaspay: maksimum qty (wr_max_quantity) ditegakkan ulang di sini
  // dengan qty agregat lintas baris ganda — fail-closed bila cap
  // invalid/missing (bukan unlimited). Quote retry yang tak berubah
  // (sameItems di atas) tetap reuse via quote_id seperti legacy.
  try {
    const variantIds = [...new Set(quote.items.map((i) => Number(i.variant_id || 0)).filter((v) => v > 0))];
    if (variantIds.length > 0) {
      // Same single query, same order — rows flow into the pure decider.
      const rows = await queryAll(
        `SELECT pv.id, pv.min_qty AS min_qty, pv.label AS label, p.name AS product_name,
                pv.wr_variant_id AS wr_variant_id, wv.wr_delivery_class AS wr_delivery_class, wv.wr_max_quantity AS wr_max_quantity,
                ${wrJaspayCoveredSql("pv.product_id")} AS wr_jaspay_covered
         FROM product_variants pv
         LEFT JOIN products p ON p.id = pv.product_id
         LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
         WHERE pv.id IN (${variantIds.map(() => "?").join(",")})`,
        ...variantIds,
      );
      const { violation } = decideMinCap({ rows, quoteItems: quote.items, isNewSaleAllowed: wrNewSaleAllowed });
      if (violation) {
        if (violation.kind === "unavailable") return NextResponse.json({ error: "Paket ini tidak lagi tersedia. Pilih paket otomatis terbaru." }, { status: 409 });
        if (violation.kind === "below_min") return NextResponse.json({ error: `${violation.name} minimal pembelian ${violation.need} (kamu pilih ${violation.qty}). Tambah jumlahnya lalu checkout ulang.` }, { status: 409 });
        if (violation.cap === -1) return NextResponse.json({ error: `${violation.name} sedang tidak tersedia.` }, { status: 409 });
        return NextResponse.json({ error: `${violation.name} maksimal pembelian ${violation.cap} (kamu pilih ${violation.qty}). Kurangi jumlahnya lalu checkout ulang.` }, { status: 409 });
      }
    }
  } catch {
    // Guard best-effort: bila query gagal (DB glitch), biarkan guard atomik
    // createOrderWithStock yang memutuskan agar checkout tidak mati total.
  }

  // This read gives the buyer a specific price-change response. The stock
  // transaction also binds each quoted price and the active parent product,
  // covering read failures and changes between this lookup and reservation.
  try {
    const variantIds = [...new Set(quote.items.map((i) => Number(i.variant_id || 0)).filter((v) => v > 0))];
    if (variantIds.length > 0) {
      // Same query + JOIN (bulk only for manual products), same order.
      const rows = await queryAll(
        `SELECT pv.id, pv.price, pv.bulk_pricing_enabled, pv.bulk_pricing_tiers,
                p.source AS p_source, p.wr_product_id AS p_wr_product_id, p.wr_auto_managed AS p_wr_auto_managed,
                p.sk_product_id AS p_sk_product_id, p.sk_auto_managed AS p_sk_auto_managed
           FROM product_variants pv
           JOIN products p ON p.id = pv.product_id
          WHERE pv.id IN (${variantIds.map(() => "?").join(",")})`,
        ...variantIds,
      );
      const { bulkOwnerFromJoinedRow, resolveBulkPriceForProduct } = await import("@/lib/bulk-pricing");
      const stale = findStalePriceItem({ rows, quoteItems: quote.items, bulkOwnerFromJoinedRow, resolveBulkPriceForProduct });
      if (stale) {
        return NextResponse.json(
          {
            error: "price_changed",
            message: "Harga produk berubah sejak halaman checkout dibuka. Muat ulang agar kamu membayar harga terbaru.",
          },
          { status: 409 },
        );
      }
    }
  } catch {
    // The atomic reservation must still verify the signed quote price.
  }

  // Normalize WA to 62
  let wa = customer_wa.replace(/\s|-/g, "");
  if (wa.startsWith("+62")) wa = wa.slice(1);
  else if (wa.startsWith("0")) wa = "62" + wa.slice(1);

  // Preflight metode bertanda sebelum mengambil slot atau membuat pesanan.
  const { resolveCheckoutMethod } = await import("@/lib/orders/checkout/methods");
  const methodOutcome = await resolveCheckoutMethod(
    quote,
    { isCryptoMethod, cryptoTicker, isGatewayMethod },
    { paymentMethod: payment_method, customer_email, customer_name },
    {
      getCryptoAsset: (ticker) => getCryptoAsset(ticker),
      cryptoPricing: (base, ticker) => cryptoPricing(base, ticker),
      centsToUsdText,
      cryptoSurchargeBps: CRYPTO_SURCHARGE_BPS,
      isNowpaymentsConfigured,
      cryptoRailEnabled,
      getCryptoMarketSnapshot: async () => {
        const { getCryptoMarketSnapshot } = await import("@/lib/payments/market-snapshot");
        return getCryptoMarketSnapshot();
      },
      isCryptoTotalStillPayable,
      isFxSnapshotAcceptable,
      isSekalipayGatewayConfigured: async () => {
        const { isSekalipayGatewayConfigured } = await import("@/lib/payments/rails");
        return isSekalipayGatewayConfigured();
      },
      listSekalipayMethods: async (subtotal) => {
        const { listSekalipayMethods } = await import("@/lib/payments/sekalipay-gateway");
        return listSekalipayMethods(subtotal);
      },
      readSameConfigQuote: (quoteId) => queryFirst("SELECT code FROM orders WHERE quote_id=?", quoteId),
    },
  );
  if (methodOutcome.kind === "rejected") {
    return NextResponse.json(methodOutcome.body, { status: methodOutcome.status });
  }
  const { selected, cryptoUsd } = methodOutcome;
  const code = generateCode();
  const pm = String(payment_method);
  const paymentId = pm.startsWith("bank:") ? pm.slice(5) : pm;
  const payment = quote.payment_methods.find((method) => method.id === paymentId);

  // Resolve saved orders first; durable quote admission also dedupes retries
  // that reach this point before the winning request has saved its order.
  const guard = await consumeCheckoutSlot(
    createDatabaseAccess(),
    await checkoutSubjects({ ip: clientIp(req), wa, email: customer_email }),
    quote.quote_id,
  );
  if (!guard.allowed) {
    if (guard.reason === "unavailable") return NextResponse.json(
      { error: "Checkout sementara tidak tersedia. Coba lagi dengan data yang sama." },
      { status: 503, headers: { "Retry-After": String(guard.retryAfterSeconds) } },
    );
    return NextResponse.json(
      { error: "Terlalu banyak pesanan baru dari koneksi/nomor ini. Tunggu hingga 15 menit, lalu coba lagi. Pesanan yang sudah dibuat tetap bisa dilacak." },
      { status: 429, headers: { "Retry-After": String(guard.retryAfterSeconds) } },
    );
  }

  // Revamp 2026-09-23: customer_name opsional dari web (form tanpa nama).
  // Fallback DIBERSIHKAN (2026-09-23): prefix email mentah bukan nama —
  // `budi123@…` dulu tersimpan apa adanya lalu merembes ke sapaan halaman
  // pesanan, notifikasi Telegram admin, prefill tombol WA, pencarian admin,
  // dan CSV. Nama yang diisi pembeli sendiri tidak pernah disentuh.
  const fallbackName = customer_name?.trim()
    ? customer_name.trim().slice(0, 80)
    : deriveNameFromEmail(customer_email);
  try {
    await createOrderWithStock({
      code,
      quoteId: quote.quote_id,
      customerName: fallbackName,
      customerWa: wa,
      customerEmail: customer_email,
      items: quote.items,
      subtotal: quote.subtotal,
      paymentMethod: pm,
      paymentAccount: isCryptoMethod ? "NOWPayments" : isGatewayMethod ? "Sekalipay" : (payment?.account_number ?? "QRIS"),
      proofUrl: proof_url,
      locale: quote.locale ?? "id",
    });
  } catch (e: unknown) {
    if (e instanceof StockReservationError) {
      const winner = await queryFirst("SELECT code,quote_id,subtotal,status,payment_status,locale,buyer_access_version,buyer_access_format FROM orders WHERE quote_id=?", quote.quote_id).catch(() => null);
      if (winner) return existingCheckoutResponse(winner, routeDeps());
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      const existing = await queryFirst("SELECT code,quote_id,subtotal,status,payment_status,locale,buyer_access_version,buyer_access_format FROM orders WHERE quote_id=?", quote.quote_id);
      if (existing) {
        return existingCheckoutResponse(existing, routeDeps());
      }
      return NextResponse.json({ error: "Kode pesanan bentrok, coba lagi." }, { status: 409 });
    }
    console.error("POST /api/orders insert failed:", msg);
    return NextResponse.json({ error: "Terjadi kesalahan pada server. Coba lagi." }, { status: 500 });
  }

  let qrisInvoice: QrisInvoice | null = null;
  let cryptoView: import("@/lib/payments/payment-view").NonQrisPaymentView | null = null;
  let gatewayView: Awaited<ReturnType<typeof import("@/lib/payments/payment-view").buildSekalipayGatewayPaymentView>> = null;
  if (pm === "qris") {
    try {
      qrisInvoice = await createActiveQrisInvoice(code, quote.subtotal);
    } catch (error) {
      console.error("QRIS invoice setup failed:", error instanceof Error ? error.message : "unknown");
      if (error instanceof Error && error.message.startsWith("klikqris_")) {
        const pending = await queryFirst("SELECT id FROM payment_transactions WHERE order_code=? AND provider='klikqris' AND status IN ('initializing','pending')", code);
        if (pending) return NextResponse.json({ error: "Tagihan sedang disiapkan. Tunggu sebentar lalu coba lagi dengan checkout yang sama.", code }, { status: 503 });
      }
      try {
        await transitionPendingOrder(code, "dibatalkan", "qris_setup_failed", quote.items);
      } catch { /* A concurrent terminal transition is safe. */ }
      return NextResponse.json({ error: "QRIS dinamis sedang tidak tersedia. Coba lagi sebentar." }, { status: 503 });
    }
  } else if (isCryptoMethod) {
    try {
      const { createNowpaymentsInvoice } = await import("@/lib/payments/nowpayments");
      const inv = await createNowpaymentsInvoice(code, Number(quote.subtotal), cryptoUsd!.payCurrency, {
        payNetwork: cryptoUsd!.network,
        priceCurrency: "usd",
        feePayer: "merchant",
        fixedRate: false,
        expectedUsd: { ...cryptoUsd! },
      });
      const { buildNowpaymentsPaymentView } = await import("@/lib/payments/payment-view");
      cryptoView = await buildNowpaymentsPaymentView(code).catch(() => null);
      void inv;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown";
      console.error("NOWPayments invoice setup failed:", message);
      const claimed = await queryFirst("SELECT id FROM payment_transactions WHERE order_code=? AND provider='nowpayments' AND status IN ('initializing','pending')", code);
      if (claimed || message === "nowpayments_network_ambiguous" || message === "nowpayments_finalize_failed_manual_review") {
        // Ambiguous/mid-finalize: claim+stok dipertahankan (Telegram
        // invoice.ts:322 pattern), 503 "check status" — JANGAN cancel.
        // No repeat POST: retry quote SAMA memulihkan via GET known id.
        return NextResponse.json({ error: paymentMethodProblem(quote.locale), error_code: "payment_method_unavailable", code }, { status: 503 });
      }
      if (message === "nowpayments_preflight_invalid" || message === "nowpayments_usd_snapshot_required"
        || message.startsWith("nowpayments_")) {
        try {
          await transitionPendingOrder(code, "dibatalkan", `nowpayments_setup_failed:${message.slice(0, 60)}`, quote.items);
        } catch { /* A concurrent terminal transition is safe. */ }
        return NextResponse.json({ error: "Pembayaran crypto sedang tidak tersedia. Muat ulang checkout." }, { status: 503 });
      }
      try {
        await transitionPendingOrder(code, "dibatalkan", "nowpayments_setup_failed", quote.items);
      } catch { /* A concurrent terminal transition is safe. */ }
      return NextResponse.json({ error: "Pembayaran crypto sedang tidak tersedia. Muat ulang checkout." }, { status: 503 });
    }
  } else if (isGatewayMethod && selected.gateway) {
    try {
      const { createSekalipayGatewayInvoice } = await import("@/lib/payments/sekalipay-gateway");
      await createSekalipayGatewayInvoice(code, quote.subtotal, selected.gateway.channel, { name: fallbackName, email: customer_email, phone: wa }, selected.gateway.estimated_fee);
      gatewayView = await import("@/lib/payments/payment-view").then((m) => m.buildSekalipayGatewayPaymentView(code));
    } catch {
      const claimed = await queryFirst("SELECT id FROM payment_transactions WHERE order_code=? AND provider='sekalipay_gateway'", code);
      if (!claimed) {
        await transitionPendingOrder(code, "dibatalkan", "gateway_setup_failed", quote.items).catch(() => {});
        return NextResponse.json({ error: "Metode pembayaran tidak tersedia.", code }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
      }
      return NextResponse.json({ error: paymentMethodProblem(quote.locale), error_code: "payment_method_unavailable", code,
        buyer_access_session: await createBuyerAccessSession({ code, buyer_access_version: 1, buyer_access_format: "pin6" }),
        checkout_credential_grant: await createCheckoutCredentialGrant({ code, quote_id: quote.quote_id, buyer_access_version: 1, buyer_access_format: "pin6" }) }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
  }

  // Tanpa notif "Order Baru" ke admin (keputusan owner 2026-09-25): order web
  // dinotif sekali saat LUNAS lewat notifyWebPaidAdmin (ensureFulfillmentForPaidOrder).

  trackFunnelEvent({ stage: "order", method: payment_method === "qris" ? `qris:${activeQrisProvider()}` : payment_method,
    subtotal: quote.subtotal, locale: quote.locale, productId: quote.items[0]?.product_id,
    variantId: quote.items[0]?.variant_id, quantity: quote.items.reduce((sum, item) => sum + item.qty, 0) }, req);
  // Created 201 body (keys/order/values/status) owned by
  // src/lib/orders/checkout/response.ts (3B-2); the route only awaits the
  // buyer proofs and wraps.
  return createdCheckoutResponse({
    code,
    subtotal: quote.subtotal,
    locale: quote.locale ?? "id",
    qrisInvoice: qrisInvoice ? {
      payableAmount: qrisInvoice.payableAmount,
      uniqueCode: qrisInvoice.uniqueCode,
      qrisUrl: qrisInvoice.qrisUrl,
      expiresAt: qrisInvoice.expiresAt,
    } : null,
    cryptoView,
    gatewayView,
    proofs: {
      buyer_access_session: await createBuyerAccessSession({ code, buyer_access_version: 1, buyer_access_format: "pin6" }),
      checkout_credential_grant: await createCheckoutCredentialGrant({ code, quote_id: quote.quote_id, buyer_access_version: 1, buyer_access_format: "pin6" }),
    },
  });
}

export async function GET(req: NextRequest) {
  if (!checkRateLimit(req, "orders:lookup")) return NextResponse.json({ error: "Terlalu sering, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code")?.trim();
  if (code) {
    if (!/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) return NextResponse.json({ error: "Kode tidak valid" }, { status: 400 });
    const row = (await queryFirst(
      `SELECT o.*, pt.requested_amount, pt.payable_amount, pt.unique_code, pt.qris_url AS dynamic_qris_url,
              pt.expires_at AS payment_expires_at, pt.status AS transaction_status,
              pt.provider AS payment_provider, pt.last_checked_at AS payment_last_checked_at
       FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
       WHERE o.code=?`,
      code,
    )) as Record<string, unknown> | undefined;
    if (!row) return orderAccessDenied();
    const accessFailure = await newOrderAccessFailure(req, row, undefined, { allowStatusSession: true });
    if (accessFailure) return accessFailure;
    if (row.payment_provider === "sekalipay_gateway" && !requiresOrderAccessCode(row) && !await buyerOrderAccessMatches(requestOrderAccessCode(req), row)) return orderAccessDenied();
    // 2026-10-10: tombol "Cek Status Sekarang" mengirim `wake=1` (polling
    // otomatis TIDAK) → bangunkan poller GoPay di VPS agar mutasi langsung
    // dicek. Hanya untuk invoice GoPay yang masih pending; best-effort.
    if (searchParams.get("wake") === "1" && String(row.status) === "pending"
      && String(row.payment_provider ?? "") === "gopay" && String(row.transaction_status ?? "") === "pending") {
      const { scheduleGopayWake } = await import("@/lib/payments/gopay-wake");
      await scheduleGopayWake("web_check").catch(() => false);
    }
    let qrisPreparationError = false;
    if (searchParams.get("wake") === "1" && row.payment_provider === "klikqris" && ["initializing", "pending"].includes(String(row.transaction_status))) {
      try {
        const { createKlikQrisInvoice, reconcileKlikQrisPayment } = await import("@/lib/payments/klikqris");
        if (row.transaction_status === "initializing" && row.status === "pending") {
          // Existing ledger: createKlikQrisInvoice only GETs this order ID.
          await createKlikQrisInvoice(code, Number(row.requested_amount));
        } else if (row.transaction_status === "pending") {
          await reconcileKlikQrisPayment(code);
        }
        const refreshed = await queryFirst(`SELECT o.status,o.payment_status,o.fulfillment_status,o.expires_at,
          pt.status AS transaction_status,pt.payable_amount,pt.unique_code,pt.qris_url AS dynamic_qris_url,
          pt.expires_at AS payment_expires_at FROM orders o JOIN payment_transactions pt ON pt.order_code=o.code WHERE o.code=?`, code);
        if (refreshed) Object.assign(row, refreshed);
      } catch { qrisPreparationError = row.transaction_status === "initializing"; }
    } else if (row.payment_provider === "nowpayments"
      && ["initializing", "pending"].includes(String(row.transaction_status)) && row.status === "pending") {
      // Saved crypto, flag-off safe: bounded reconcile via saved binding
      // (wake=1 forces slot by resetting last_checked_at claim window).
      try {
        const { claimNowpaymentsPollReconcile, reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
        if (searchParams.get("wake") === "1") {
          await queryFirst("SELECT 1").catch(() => null);
          const { execRun } = await import("@/lib/db");
          await execRun("UPDATE payment_transactions SET last_checked_at=NULL WHERE order_code=? AND provider='nowpayments'", code).catch(() => {});
        }
        if (await claimNowpaymentsPollReconcile(code)) {
          await reconcileNowpaymentsPayment(code).catch(() => null);
          const refreshed = await queryFirst(`SELECT o.status,o.payment_status,o.fulfillment_status,o.expires_at,
            pt.status AS transaction_status,pt.pay_amount_text,pt.pay_currency,pt.pay_network,pt.pay_address,
            pt.price_amount_text,pt.price_currency,pt.actually_paid_text,pt.expires_at AS payment_expires_at
            FROM orders o JOIN payment_transactions pt ON pt.order_code=o.code WHERE o.code=?`, code);
          if (refreshed) Object.assign(row, refreshed);
        }
      } catch { /* Saved view tetap dilayani di bawah via buildNowpaymentsPaymentView. */ }
    } else if (row.payment_provider === "sekalipay_gateway" && ["initializing", "pending"].includes(String(row.transaction_status)) && row.status === "pending") {
      try {
        const { claimSekalipayGatewayPoll } = await import("@/lib/payments/payment-view");
        if (await claimSekalipayGatewayPoll(code)) {
          const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
          await reconcileSekalipayGatewayPayment(code);
          const refreshed = await queryFirst("SELECT status,payment_status,fulfillment_status,expires_at FROM orders WHERE code=?", code);
          if (refreshed) Object.assign(row, refreshed);
        }
      } catch { /* Cached buyer view remains available. */ }
    } else if (row.payment_provider === "klikqris" && row.transaction_status === "pending" && row.status === "pending") {
      // Deteksi lunas tidak boleh hanya menunggu callback gateway (teramati
      // tiba ±28 dtk sesudah pembayaran). Polling halaman yang sudah berjalan
      // menumpang reconcile ter-throttle ±10 dtk/order: klaim atomik pada
      // last_checked_at memastikan satu pemanggil yang bertanya ke gateway,
      // polling lain membaca status lokal seperti biasa. Best-effort — gagal
      // konfirmasi tidak pernah mengubah status.
      try {
        const { claimKlikQrisPollReconcile, reconcileKlikQrisPayment } = await import("@/lib/payments/klikqris");
        if (await claimKlikQrisPollReconcile(code)) {
          await reconcileKlikQrisPayment(code);
          const refreshed = await queryFirst(`SELECT o.status,o.payment_status,o.fulfillment_status,o.expires_at,
            pt.status AS transaction_status,pt.payable_amount,pt.unique_code,pt.qris_url AS dynamic_qris_url,
            pt.expires_at AS payment_expires_at FROM orders o JOIN payment_transactions pt ON pt.order_code=o.code WHERE o.code=?`, code);
          if (refreshed) Object.assign(row, refreshed);
        }
      } catch { /* Callback/manual check tetap menjadi penjamin. */ }
    }
    // PII minimal on public endpoint: mask WA + email (shared builder).
    const { waMasked, emailMasked } = maskBuyerContact(row as Record<string, unknown>);
    // Panel "Detail Akun Digital" di /pesanan/[code] hanya boleh tampil bila
    // detail akun BENAR-BENAR sudah ada. Produk fulfillment manual tidak
    // pernah punya baris wr_order_links, jadi sebelumnya form verifikasi WA
    // muncul untuk semua order lunas dan selalu berakhir "not_ready" —
    // form mati yang bikin pembeli panik tepat setelah bayar.
    // Boolean saja (tanpa isi kredensial); retrieval tetap wajib verifikasi
    // WA/capability token di /api/orders/[code]/credentials.
    let flags: StatusFlags = { ...EMPTY_STATUS_FLAGS };
    if (String(row.status) === "lunas") {
      // Satu query untuk tiga flag halaman pesanan (hemat statement):
      // - creds: detail akun sudah siap diambil pembeli (WR completed ATAU
      //   item terkirim dengan ciphertext — termasuk lisensi SK yang ditulis
      //   handleSkOrderCompleted ke fulfillment_items).
      // - queued: ada baris yang dikerjakan sesuai antrean (varian WR
      //   non-restock, varian SK non-auto, atau varian manual non-supplier) →
      //   teks estimasi TIDAK boleh bilang 5–15 menit.
      // - instant: SEMUA baris dikirim otomatis (varian WR restock, varian SK
      //   auto, atau shared/unique non-supplier) → selesai hitungan detik,
      //   halaman memeriksa rapat. SK auto ikut instan walau fulfillment_mode
      //   lokalnya 'manual' (diselesaikan via sk_order_links, pola wr_link_id).
      // .catch: D1 lama tanpa tabel WR/SK (pra-0027/0049) → semua flag false,
      // bukan 500. Query + refresh kini di src/lib/orders/status-flags.ts.
      flags = await readStatusFlags(code, row as Record<string, unknown>, { queryFirst });
    }
    // Pembeli yang sedang menunggu adalah pemicu termurah untuk status
    // supplier terbaru (meniru SK yang sinkron via webhook): tarik status
    // vendor SEKARANG lewat gerbang throttle (20 dtk/order), lalu hitung
    // ulang flag agar respons ini tidak basi satu siklus. Bila refresh
    // barusan menyelesaikan kredensial, halaman langsung menampilkannya
    // detik ini juga. Kegagalan = diam (cron lite tetap penjamin).
    // credentialsReady means ANY item is ready, not that every supplier finished.
    if (String(row.status) === "lunas") {
      try {
        const { createDatabaseAccess } = await import("@/lib/db-access");
        const { maybeRefreshSupplierOrder } = await import("@/lib/orders/supplier-refresh");
        await maybeRefreshStatusFlags(
          code,
          row as Record<string, unknown>,
          flags,
          {
            createAccess: () => createDatabaseAccess(),
            maybeRefresh: (orderCode, refreshDb) => maybeRefreshSupplierOrder(orderCode, refreshDb),
          },
        );
      } catch {
        /* penyegaran best-effort; status lama tetap sah (termasuk gagal impor bundle) */
      }
      if (flags.fulfillmentStatus != null) {
        (row as Record<string, unknown>).fulfillment_status = flags.fulfillmentStatus;
      }
    }
     let uniqueUnitsProgress: {ready:number;total:number} | undefined;
    if (String(row.status) === "lunas") {
      const units = expandDeliveryLines(row.items).filter(line=>line.unique_units === true);
      if (units.length > 1) {
        const progress = await queryFirst("SELECT COUNT(*) AS n FROM fulfillment_items WHERE order_code=? AND fulfillment_mode='unique' AND status='delivered' AND delivered_ciphertext IS NOT NULL", code).catch(()=>null);
        uniqueUnitsProgress={ready:Math.min(units.length,Number(progress?.n||0)),total:units.length};
      }
    }
    // Non-QRIS view (W3): buyer-safe crypto panel AFTER the same guard above
    // (proof/session). No secrets, no hosted-URL fabrication for direct payment.
    // Body builder shared via src/lib/orders/detail-view.ts (receives the
    // post-refresh row so credentials_ready cannot regress).
    const payment = row.payment_provider === "nowpayments"
      ? await import("@/lib/payments/payment-view").then((m) => m.buildNowpaymentsPaymentView(code)).catch(() => null)
      : row.payment_provider === "sekalipay_gateway" ? await import("@/lib/payments/payment-view").then((m) => m.buildSekalipayGatewayPaymentView(code)).catch(() => null)
      : null;
    return NextResponse.json({
      order: buildStatusDetailView({
        row: row as Record<string, unknown>,
        code,
        waMasked,
        emailMasked,
        items: withoutPrivateBuyerData(JSON.parse(String(row.items || "[]"))),
        qrisPreparationError,
        flags,
        automaticProgress: flags.hasAutomaticProgress ? await readAutomaticProgress(code, { queryAll }).catch(() => []) : [],
        uniqueUnitsProgress,
        qrisBlock: row.dynamic_qris_url ? {
          payable_amount: row.payable_amount,
          unique_code: row.unique_code,
          image_url: row.dynamic_qris_url,
          expires_at: row.payment_expires_at,
          status: row.transaction_status,
        } : null,
        payment,
        buyerPinRequired: requiresOrderAccessCode(row),
        qrisReissueAllowed: row.payment_provider === "gopay" && row.status === "pending" && row.sales_channel !== "whatsapp" && Number(row.qris_reissue_count || 0) < MAX_QRIS_REISSUES,
        maxQrisReissues: MAX_QRIS_REISSUES,
      }),
    }, { headers: { "Cache-Control": "private, no-store" } });
  }
  // Without code, don't leak all orders — require admin endpoint
  return NextResponse.json({ error: "Gunakan ?code=AXV-... atau akses via admin." }, { status: 400 });
}
