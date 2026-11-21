import { wrJaspayCoveredSql, wrNewSaleAllowed } from "@/lib/warung-rebahan/new-sales";
import { readAutomaticProgress } from "@/lib/warung-rebahan/progress";
import { isPaymentMaintenanceEnabled, paymentMaintenanceResponse } from "@/lib/payment-maintenance";
import { NextRequest, NextResponse } from "next/server";
import { trackFunnelEvent } from "@/lib/analytics/funnel";
import { activeQrisProvider } from "@/lib/payments/qris";
import { deriveNameFromEmail } from "@/lib/utils";
import { z } from "zod";
import { assertSameBuyerCode, buyerFieldsSchema, withoutPrivateBuyerData } from "@/lib/buyer-fields";
import { createOrderWithStock, queryAll, queryFirst, StockReservationError, transitionPendingOrder } from "@/lib/db";
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
import type { NowpaymentsUsdExpected } from "@/lib/payments/nowpayments";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Copy pembeli saat invoice gateway (Sekalipay) atau crypto gagal dibuat,
 * ambigu, atau masih `initializing` saat checkout. Menggantikan kalimat
 * "Tagihan sedang disiapkan. Coba checkout yang sama." yang membingungkan
 * (keputusan owner 7 Nov 2026). QRIS punya copy persiapan sendiri dan tidak
 * memakai helper ini. Locale mengikuti pesanan/kutipan; default ID.
 */
function paymentMethodProblem(locale: string | null | undefined): string {
  return locale === "en"
    ? "This payment method is having problems. Please try another payment method."
    : "Metode pembayaran ini sedang gangguan. Silakan coba metode pembayaran lain.";
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

function closedCheckoutResponse(status: unknown, locale: "en" | "id") {
  if (!["dibatalkan", "kadaluarsa"].includes(String(status))) return null;
  return NextResponse.json({
    error: locale === "en" ? "This order is closed. Get a new quote to continue." : "Pesanan ini sudah ditutup. Ambil harga terbaru untuk lanjut.",
    error_code: "checkout_order_closed",
  }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
}

async function existingCheckoutResponse(existing: Record<string, unknown>) {
  // Saved retry SELALU baca ulang status + locale terbaru dari DB (snapshot
  // stale tidak pernah dikembalikan): fresh row di sini untuk reuse decision
  // + locale respons.
  const fresh = await queryFirst(
    "SELECT code,quote_id,subtotal,status,payment_status,payment_method,locale,buyer_access_version,buyer_access_format FROM orders WHERE code=?",
    existing.code,
  ).catch(() => null);
  const live = (fresh ?? existing) as Record<string, unknown>;
  const locale = live.locale === "en" ? "en" : "id";
  const closed = closedCheckoutResponse(live.status, locale);
  if (closed) return closed;
  const buyer_access_session = await createBuyerAccessSession(live);
  const checkout_credential_grant = await createCheckoutCredentialGrant(live);
  // Saved retry: resolves BEFORE new-order flags/FX checks — same order, same
  // provider binding, access-safe recovery. Never reserve again; never POST
  // blind; never switch provider (reconcile known id via GET only).
  if (live.status === "pending") {
    const tx = await queryFirst("SELECT provider,requested_amount FROM payment_transactions WHERE order_code=?", live.code);
    if (!tx && String(live.payment_method ?? "").startsWith("sekalipay_gateway:")) {
      // ponytail: a preclaim orphan expires unless its original request finishes; add durable dispatch if recovery is required.
      return NextResponse.json({ error: paymentMethodProblem(locale), error_code: "payment_method_unavailable", code: live.code, buyer_access_session, checkout_credential_grant }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
    if (tx?.provider === "klikqris") {
      try {
        const inv = await createActiveQrisInvoice(String(live.code), Number(tx.requested_amount));
        const current = await queryFirst("SELECT status FROM orders WHERE code=?", live.code);
        const status = current?.status ?? live.status;
        return closedCheckoutResponse(status, locale) ?? NextResponse.json({ code: live.code, subtotal: live.subtotal, status, buyer_access_session, checkout_credential_grant, reused: true, locale, qris: {
          payable_amount: inv.payableAmount, unique_code: inv.uniqueCode,
          image_url: inv.qrisUrl, expires_at: inv.expiresAt,
        } }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
      } catch {
        return NextResponse.json({ error: "Tagihan sedang disiapkan. Tunggu sebentar lalu coba lagi dengan checkout yang sama.", code: existing.code }, { status: 503 });
      }
    }
    if (tx?.provider === "nowpayments") {
      // Saved crypto: flag-off/new-config irrelevant — status/reconcile runs
      // via saved binding (readable). Ambiguous/initializing-with-id recovers
      // inside reconcile; failure => 503 retry-same-quote (no cancel, no POST).
      try {
        const { reconcileNowpaymentsPayment, claimNowpaymentsPollReconcile } = await import("@/lib/payments/nowpayments");
        if (await claimNowpaymentsPollReconcile(String(live.code))) {
          await reconcileNowpaymentsPayment(String(live.code)).catch(() => null);
        }
        const { buildNowpaymentsPaymentView } = await import("@/lib/payments/payment-view");
        const payment = await buildNowpaymentsPaymentView(String(live.code)).catch(() => null);
        if (payment) {
          const current = await queryFirst("SELECT status FROM orders WHERE code=?", live.code);
          const status = current?.status ?? live.status;
          return closedCheckoutResponse(status, locale) ?? NextResponse.json({ code: live.code, subtotal: live.subtotal, status, buyer_access_session, checkout_credential_grant, reused: true, locale, payment }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
        }
      } catch { /* fall through to generic reuse below */ }
      return NextResponse.json({ error: paymentMethodProblem(locale), error_code: "payment_method_unavailable", code: live.code }, { status: 503 });
    }
    if (tx?.provider === "sekalipay_gateway") {
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
          if (error instanceof Error && error.message === "gateway_poll_deferred") return NextResponse.json({ error: paymentMethodProblem(locale), error_code: "payment_method_unavailable", code: live.code, buyer_access_session, checkout_credential_grant }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
          try {
            const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
            await reconcileSekalipayGatewayPayment(String(live.code));
            payment = await buildSekalipayGatewayPaymentView(String(live.code));
          } catch { /* Saved claim stays bound; retry uses GET only. */ }
        }
      }
      if (!payment || payment.state === "initializing") return NextResponse.json({ error: paymentMethodProblem(locale), error_code: "payment_method_unavailable", code: live.code, buyer_access_session, checkout_credential_grant }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
      const current = await queryFirst("SELECT status FROM orders WHERE code=?", live.code);
      const status = current?.status ?? live.status;
      return closedCheckoutResponse(status, locale) ?? NextResponse.json({ code: live.code, subtotal: live.subtotal, status, buyer_access_session, checkout_credential_grant, reused: true, locale, payment }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
    }
  }
  return NextResponse.json({ code: live.code, subtotal: live.subtotal, status: live.status, buyer_access_session, checkout_credential_grant, reused: true, locale }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
}

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
  if (previous) return existingCheckoutResponse(previous);

  // Guard email lapis kedua (migrasi 0033 + revamp 2026-09-23): zod di atas
  // SUDAH mewajibkan email valid untuk semua order web, jadi blok ini kini
  // defense-in-depth — hitung ulang dari DB, JANGAN percaya flag client.
  // Invite/Link WR atau produk require_email=1 tanpa email valid = 422
  // sebelum order dibuat (order lunas tanpa email = macet di WR).
  try {
    const { needsEmailForVariant } = await import("@/lib/warung-rebahan/delivery-class");
    const variantIds = [...new Set(quote.items.map((i) => Number(i.variant_id || 0)).filter((v) => v > 0))];
    let emailNeeded = false;
    if (variantIds.length > 0) {
      const rows = await queryAll(
        `SELECT pv.id, wv.wr_type AS wr_type, p.require_email AS require_email
         FROM product_variants pv
         LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
         LEFT JOIN products p ON p.id = pv.product_id
         WHERE pv.id IN (${variantIds.map(() => "?").join(",")})`,
        ...variantIds,
      );
      for (const r of rows) {
        if (needsEmailForVariant({
          wrType: r.wr_type != null ? String(r.wr_type) : null,
          requireEmail: Number(r.require_email ?? 0),
        })) { emailNeeded = true; break; }
      }
    } else {
      const productIds = [...new Set(quote.items.map((i) => Number(i.product_id || 0)).filter((v) => v > 0))];
      if (productIds.length > 0) {
        const rows = await queryAll(
          `SELECT require_email FROM products WHERE id IN (${productIds.map(() => "?").join(",")})`,
          ...productIds,
        );
        emailNeeded = rows.some((r) => Number(r.require_email ?? 0) === 1);
      }
    }
    const emailOk = typeof customer_email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email.trim());
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
      const minById = new Map<number, { min: number; name: string }>();
      const capById = new Map<number, { cap: number | null; jaspay: boolean; name: string }>();
      for (const r of rows) {
        if (!wrNewSaleAllowed(r)) return NextResponse.json({ error: "Paket ini tidak lagi tersedia. Pilih paket otomatis terbaru." }, { status: 409 });
        minById.set(Number(r.id), {
          min: Math.max(1, Number(r.min_qty ?? 1) || 1),
          name: `${String(r.product_name ?? "Produk")} — ${String(r.label ?? "")}`.trim(),
        });
        const wrId = r.wr_variant_id == null ? "" : String(r.wr_variant_id).trim();
        if (wrId.startsWith("jaspay:")) {
          const capRaw = r.wr_max_quantity;
          const cap = capRaw == null ? null : Math.floor(Number(capRaw));
          capById.set(Number(r.id), {
            cap: cap != null && Number.isFinite(cap) && cap >= 1 ? cap : null,
            jaspay: true,
            name: `${String(r.product_name ?? "Produk")} — ${String(r.label ?? "")}`.trim(),
          });
        }
      }
      // Qty agregat per varian (keranjang bisa kirim baris ganda varian sama).
      const qtyByVariant = new Map<number, number>();
      for (const qi of quote.items) {
        const vid = Number(qi.variant_id || 0);
        if (vid > 0) qtyByVariant.set(vid, (qtyByVariant.get(vid) ?? 0) + Number(qi.qty || 0));
      }
      for (const [vid, qty] of qtyByVariant) {
        const rule = minById.get(vid);
        const need = rule?.min ?? 1;
        if (need > 1 && qty < need) {
          return NextResponse.json({ error: `${rule?.name ?? "Produk ini"} minimal pembelian ${need} (kamu pilih ${qty}). Tambah jumlahnya lalu checkout ulang.` }, { status: 409 });
        }
        const capRule = capById.get(vid);
        if (capRule) {
          if (capRule.cap == null) {
            return NextResponse.json({ error: `${capRule.name} sedang tidak tersedia.` }, { status: 409 });
          }
          if (qty > capRule.cap) {
            return NextResponse.json({ error: `${capRule.name} maksimal pembelian ${capRule.cap} (kamu pilih ${qty}). Kurangi jumlahnya lalu checkout ulang.` }, { status: 409 });
          }
        }
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
      const rows = await queryAll(
        `SELECT pv.id, pv.price, pv.bulk_pricing_enabled, pv.bulk_pricing_tiers,
                p.source AS p_source, p.wr_product_id AS p_wr_product_id, p.wr_auto_managed AS p_wr_auto_managed,
                p.sk_product_id AS p_sk_product_id, p.sk_auto_managed AS p_sk_auto_managed
           FROM product_variants pv
           JOIN products p ON p.id = pv.product_id
          WHERE pv.id IN (${variantIds.map(() => "?").join(",")})`,
        ...variantIds,
      );
      const priceById = new Map(rows.map((r) => [Number(r.id), r]));
      const { bulkOwnerFromJoinedRow, resolveBulkPriceForProduct } = await import("@/lib/bulk-pricing");
      const stale = quote.items.find((qi) => {
        const vid = Number(qi.variant_id || 0);
        if (vid <= 0) return false;
        const live = priceById.get(vid);
        if (!live) return true;
        try {
          const qty = quote.items.filter((item) => item.variant_id === vid).reduce((n, item) => n + item.qty, 0);
          const current = resolveBulkPriceForProduct(Number(live.price), qty, live.bulk_pricing_enabled, live.bulk_pricing_tiers, bulkOwnerFromJoinedRow(live));
          return current.price !== qi.price || (qi.base_price !== undefined && qi.base_price !== Number(live.price)) || current.tier !== qi.applied_tier_min_qty;
        } catch { return true; }
      });
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

  // Metode terpilih HARUS ada di token bertanda (anti-tamper client).
  const selected = quote.payment_methods.find((method) => method.id === payment_method);
  if (!selected) {
    return NextResponse.json({ error: "Metode pembayaran berubah atau sudah tidak aktif. Muat ulang checkout." }, { status: 409 });
  }
  // Metode nonaktif (mis. di luar batas min/max merchant) tidak pernah ditandatangani; jaga eksplisit bila payload aneh lolos verifikasi.
  if ((selected as { available?: unknown }).available === false) {
    return NextResponse.json({ error: "Metode pembayaran berubah atau sudah tidak aktif. Muat ulang checkout." }, { status: 409 });
  }
  const quoteHasQris = quote.payment_methods.some((method) => method.id === "qris");
  // Web crypto gate: NEW creation requires live config (keys+enabled+asset+
  // fresh FX). Saved retry (same quote_id) resolves BEFORE these checks below
  // — same order, same binding, no re-gate, no provider switch.
  let cryptoUsd: NowpaymentsUsdExpected | null = null;
  if (isCryptoMethod && cryptoTicker) {
    const asset = getCryptoAsset(cryptoTicker)!;
    const stale = (error = "Metode pembayaran berubah atau sudah tidak aktif. Muat ulang checkout.") =>
      NextResponse.json({ error, code: "quote_stale" }, { status: 409 });
    if (selected.fee_payer !== "merchant" || selected.fixed_rate !== false) return stale("Perbarui checkout untuk menyetujui biaya pembayaran.");
    const row = selected as unknown as Record<string, unknown>;
    const snap = row.usd as Record<string, unknown> | undefined;
    // Validated extraction, no blind casts: kind/currency/asset/network/
    // snapshot shape + exact USD price re-derived server-side from BASE cents
    // (+ biaya layanan crypto). Wrong body overrides (price/currency/FX) =>
    // rejected (409) or ignored (server values win); tampered token => verify
    // fails earlier.
    if (row.kind !== "crypto" || row.currency !== "USD" || !snap || typeof snap !== "object" || Array.isArray(snap)) return stale();
    if (String(row.pay_currency).toLowerCase() !== cryptoTicker || String(row.network).toLowerCase() !== asset.network
      || String(snap.pay_currency) !== cryptoTicker || String(snap.network) !== asset.network) return stale();
    if (typeof row.amount_text !== "string" || !/^[0-9]+\.[0-9]{2}$/.test(row.amount_text)) return stale();
    const snapCents = typeof snap.cents === "string" && /^[0-9]{1,20}$/.test(snap.cents) ? snap.cents : null;
    const snapRateNum = typeof snap.rate_num === "string" && /^[0-9]{1,32}$/.test(snap.rate_num) ? snap.rate_num : null;
    const snapRateDen = typeof snap.rate_den === "string" && /^[0-9]{1,32}$/.test(snap.rate_den) ? snap.rate_den : null;
    const snapRateText = typeof snap.rate_text === "string" && /^[0-9]+(\.[0-9]+)?$/.test(snap.rate_text.trim())
      && snap.rate_text.length <= 32 ? snap.rate_text.trim() : null;
    const snapEffective = typeof snap.effective_at === "string" && Number.isFinite(Date.parse(snap.effective_at)) ? snap.effective_at : null;
    const snapSubtotal = typeof snap.idr_subtotal === "number" && Number.isSafeInteger(snap.idr_subtotal) && snap.idr_subtotal > 0 ? snap.idr_subtotal : null;
    if (!snapCents || BigInt(snapCents) <= BigInt(0) || !snapRateNum || BigInt(snapRateNum) <= BigInt(0)
      || !snapRateDen || BigInt(snapRateDen) <= BigInt(0) || !snapRateText || !snapEffective || snapSubtotal === null) return stale();
    // Rincian harga diturunkan ulang di server dari base bertanda; field di token hanya dibandingkan.
    const pricing = cryptoPricing(BigInt(snapCents), cryptoTicker);
    if (row.surcharge_bps !== CRYPTO_SURCHARGE_BPS || row.base_cents !== Number(pricing.baseCents)
      || row.surcharge_cents !== Number(pricing.surchargeCents) || row.total_cents !== Number(pricing.totalCents)
      || pricing.totalCents <= BigInt(0)) return stale();
    const { getCryptoMarketSnapshot } = await import("@/lib/payments/market-snapshot");
    const sameConfigQuote = await queryFirst("SELECT code FROM orders WHERE quote_id=?", quote.quote_id);
    if (!sameConfigQuote) {
      // Pembuatan BARU: koin harus ada di snapshot segar sekarang dan total bertanda masih memenuhi
      // minimum terbaru x 1,15. Retry quote yang sama (sameConfigQuote) memakai binding tersimpan tanpa gate ulang.
      const market = await getCryptoMarketSnapshot();
      const current = market.fx;
      const liveOk = isNowpaymentsConfigured() && cryptoRailEnabled() && current !== null;
      if (!liveOk) {
        return NextResponse.json({ error: "Pembayaran crypto sedang tidak tersedia. Muat ulang checkout." }, { status: 503 });
      }
      if (Number(snap.idr_subtotal) !== Number(quote.subtotal) || !Number.isSafeInteger(Number(snap.idr_subtotal))) {
        return NextResponse.json({ error: "Harga berubah sejak checkout. Muat ulang checkout." }, { status: 409 });
      }
      if (!isCryptoTotalStillPayable(Number(pricing.totalCents), cryptoTicker, market.coins)) {
        return stale("Koin ini tidak tersedia atau minimumnya berubah. Muat ulang checkout.");
      }
      // Kurs otomatis berubah tiap refresh: toleransi 2% + snapshot bertanda <=24 jam
      // (bukan kesamaan ketat). Harga USD tetap dari cents bertanda di bawah.
      if (!isFxSnapshotAcceptable(current, { rate_num: snapRateNum, rate_den: snapRateDen, effective_at: snapEffective })) {
        return stale("Kurs berubah sejak checkout. Muat ulang checkout.");
      }
    }
    // Exact USD re-derived server-side: signed base cents -> total canonical
    // price. Forged body price overrides ignored (mismatch => tamper => 409).
    const exactPrice = centsToUsdText(pricing.totalCents);
    if (exactPrice !== String(row.amount_text)) return stale();
    cryptoUsd = {
      cents: snapCents, priceText: exactPrice, rateText: snapRateText,
      surchargeBps: pricing.surchargeBps, surchargeCents: pricing.surchargeCents.toString(), totalCents: pricing.totalCents.toString(),
      rateNum: snapRateNum, rateDen: snapRateDen, effectiveAt: snapEffective,
      idrSubtotal: Number(quote.subtotal), payCurrency: cryptoTicker, network: asset.network,
    };
  } else if (isGatewayMethod) {
    if (selected.kind !== "gateway" || !selected.gateway || selected.currency !== "IDR") return NextResponse.json({ error: "Metode pembayaran berubah." }, { status: 409 });
    const { isSekalipayGatewayConfigured } = await import("@/lib/payments/rails");
    if (!isSekalipayGatewayConfigured()) return NextResponse.json({ error: "Metode pembayaran tidak tersedia." }, { status: 503 });
    const { listSekalipayMethods } = await import("@/lib/payments/sekalipay-gateway");
    const methods = await listSekalipayMethods(quote.subtotal).catch(() => []);
    if (!methods.some((m) => m.code === selected.gateway!.channel)) return NextResponse.json({ error: "Metode pembayaran tidak tersedia." }, { status: 503 });
    if (customer_email.length > 100 || (customer_name?.length ?? 0) > 100) return NextResponse.json({ error: "Data pembeli tidak valid." }, { status: 400 });
  } else if (payment_method !== "qris") {
    return NextResponse.json({ error: "E-Wallet & Transfer Bank sedang maintenance. Muat ulang checkout dan bayar via QRIS." }, { status: 503 });
  } else if (!quoteHasQris) {
    return NextResponse.json({ error: "E-Wallet & Transfer Bank sedang maintenance. Muat ulang checkout dan bayar via QRIS." }, { status: 503 });
  }
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
      if (winner) return existingCheckoutResponse(winner);
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      const existing = await queryFirst("SELECT code,quote_id,subtotal,status,payment_status,locale,buyer_access_version,buyer_access_format FROM orders WHERE quote_id=?", quote.quote_id);
      if (existing) {
        return existingCheckoutResponse(existing);
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
  return NextResponse.json({
    code,
    buyer_access_session: await createBuyerAccessSession({ code, buyer_access_version: 1, buyer_access_format: "pin6" }),
    checkout_credential_grant: await createCheckoutCredentialGrant({ code, quote_id: quote.quote_id, buyer_access_version: 1, buyer_access_format: "pin6" }),
    subtotal: quote.subtotal,
    status: "pending",
    locale: quote.locale,
    qris: qrisInvoice ? {
      payable_amount: qrisInvoice.payableAmount,
      unique_code: qrisInvoice.uniqueCode,
      image_url: qrisInvoice.qrisUrl,
      expires_at: qrisInvoice.expiresAt,
    } : null,
    ...(cryptoView || gatewayView ? { payment: cryptoView ?? gatewayView } : {}),
  }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
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
    // PII minimal on public endpoint: mask WA + email
    const waFull = String(row.customer_wa ?? "");
    const waMasked = waFull.length >= 7 ? waFull.slice(0, 5) + "****" + waFull.slice(-4) : waFull ? waFull.slice(0, 3) + "****" : "";
    const emailFull = String(row.customer_email ?? "");
    const emailMasked = emailFull.includes("@") ? emailFull.replace(/(^.).+(@.*)/, (_, a, b) => `${a}***${b}`) : emailFull ? "***" : null;
    // Panel "Detail Akun Digital" di /pesanan/[code] hanya boleh tampil bila
    // detail akun BENAR-BENAR sudah ada. Produk fulfillment manual tidak
    // pernah punya baris wr_order_links, jadi sebelumnya form verifikasi WA
    // muncul untuk semua order lunas dan selalu berakhir "not_ready" —
    // form mati yang bikin pembeli panik tepat setelah bayar.
    // Boolean saja (tanpa isi kredensial); retrieval tetap wajib verifikasi
    // WA/capability token di /api/orders/[code]/credentials.
    let credentialsReady = false;
    let queuedDelivery = false;
    let instantDelivery = false;
    let supplierOwned = false;
    let supplierRunning = false;
    let hasAutomaticProgress = false;
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
      // bukan 500.
      const flags = await queryFirst(
        `WITH lines AS (
            SELECT CAST(json_extract(je.value,'$.variant_id') AS INTEGER) AS variant_id,
                   (((json_extract(je.value,'$.aivault_eligibility.version')=1 AND json_extract(je.value,'$.aivault_eligibility.cost_usd')>0) OR (json_extract(je.value,'$.storebat_eligibility.version')=1 AND json_extract(je.value,'$.storebat_eligibility.cost_usd')>0) OR (json_extract(je.value,'$.mirai_eligibility.version')=1 AND json_extract(je.value,'$.mirai_eligibility.cost_usdt')>0) OR (json_extract(je.value,'$.tunvn_eligibility.version')=1
                    AND json_extract(je.value,'$.tunvn_eligibility.kind') IN ('account','buff')
                    AND json_extract(je.value,'$.tunvn_eligibility.cost_usdt')>0))
                    AND ?=0) AS automatic
           FROM json_each(CASE WHEN json_valid(?) THEN ? ELSE '[]' END) je
         )
          SELECT
           EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND wr_variant_id LIKE 'jaspay:%') AS has_automatic_progress,
           (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND status='completed'
                    AND wr_account_details IS NOT NULL)
           OR EXISTS(SELECT 1 FROM fulfillment_items WHERE order_code=? AND status='delivered'
                    AND delivered_ciphertext IS NOT NULL)) AS creds,
           (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=?)
             OR EXISTS(SELECT 1 FROM sk_order_links WHERE order_code=?)
             OR EXISTS(SELECT 1 FROM lines WHERE automatic=1)) AS supplier_owned,
           (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND (status IN ('processing','submitted','ordering') OR (status='claimed' AND request_sent_at IS NOT NULL)))
            OR EXISTS(SELECT 1 FROM sk_order_links WHERE order_code=? AND (status IN ('processing','submitted','ordering') OR (status='claimed' AND request_sent_at IS NOT NULL)))) AS supplier_running,
          EXISTS(SELECT 1 FROM lines l
                 JOIN product_variants pv ON pv.id = l.variant_id
                 LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
                 LEFT JOIN sk_products sp ON sp.sk_variant_id = pv.sk_variant_id
                  WHERE CASE WHEN l.automatic=1 THEN 0
                             WHEN pv.wr_variant_id IS NOT NULL
                            THEN COALESCE(wv.wr_delivery_class,'made_by_order') <> 'restock'
                            WHEN pv.sk_variant_id IS NOT NULL
                            THEN COALESCE(sp.sk_order_process,'manual') <> 'auto'
                            ELSE pv.fulfillment_mode = 'manual' END) AS queued,
          (EXISTS(SELECT 1 FROM lines)
           AND NOT EXISTS(SELECT 1 FROM lines l
                          LEFT JOIN product_variants pv ON pv.id = l.variant_id
                          LEFT JOIN sk_products sp ON sp.sk_variant_id = pv.sk_variant_id
                          WHERE pv.id IS NULL
                             OR pv.wr_variant_id IS NOT NULL
                             OR (pv.sk_variant_id IS NOT NULL AND COALESCE(sp.sk_order_process,'manual') <> 'auto')
                             OR (pv.wr_variant_id IS NULL AND pv.sk_variant_id IS NULL
                                 AND COALESCE(pv.fulfillment_mode,'manual') NOT IN ('shared','unique')))) AS instant`,
        Number(row.supplier_purchase_disabled ?? 0),
        String(row.items ?? "[]"),
        String(row.items ?? "[]"),
        code,
        code,
        code,
        code,
        code,
        code,
        code,
      ).catch(() => null);
      hasAutomaticProgress = Number(flags?.has_automatic_progress ?? 0) === 1;
      credentialsReady = Number(flags?.creds ?? 0) === 1;
      queuedDelivery = Number(flags?.queued ?? 0) === 1;
      instantDelivery = Number(flags?.instant ?? 0) === 1;
      supplierOwned = Number((flags as Record<string, unknown> | null)?.supplier_owned ?? 0) === 1;
      supplierRunning = Number((flags as Record<string, unknown> | null)?.supplier_running ?? 0) === 1;
    }
    // Pembeli yang sedang menunggu adalah pemicu termurah untuk status
    // supplier terbaru (meniru SK yang sinkron via webhook): tarik status
    // vendor SEKARANG lewat gerbang throttle (20 dtk/order), lalu hitung
    // ulang flag agar respons ini tidak basi satu siklus. Bila refresh
    // barusan menyelesaikan kredensial, halaman langsung menampilkannya
    // detik ini juga. Kegagalan = diam (cron lite tetap penjamin).
    // credentialsReady means ANY item is ready, not that every supplier finished.
    if (String(row.status) === "lunas" && supplierRunning) {
      try {
        const { createDatabaseAccess } = await import("@/lib/db-access");
        const { maybeRefreshSupplierOrder } = await import("@/lib/orders/supplier-refresh");
        const refreshDb = createDatabaseAccess();
        const { refreshed } = await maybeRefreshSupplierOrder(code, refreshDb);
        if (refreshed) {
          const after = await refreshDb
            .queryFirst(
              `SELECT fulfillment_status,
                      (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND status='completed' AND wr_account_details IS NOT NULL)
                       OR EXISTS(SELECT 1 FROM fulfillment_items WHERE order_code=? AND status='delivered' AND delivered_ciphertext IS NOT NULL)) AS creds,
                      (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND (status IN ('processing','submitted','ordering') OR (status='claimed' AND request_sent_at IS NOT NULL)))
                       OR EXISTS(SELECT 1 FROM sk_order_links WHERE order_code=? AND (status IN ('processing','submitted','ordering') OR (status='claimed' AND request_sent_at IS NOT NULL)))) AS running
               FROM orders WHERE code=?`,
              code, code, code, code, code,
            )
            .catch(() => null);
          if (after) {
            credentialsReady = Number(after.creds ?? 0) === 1;
            supplierRunning = Number(after.running ?? 0) === 1;
            if (after.fulfillment_status != null) {
              (row as Record<string, unknown>).fulfillment_status = after.fulfillment_status;
            }
          }
        }
      } catch { /* penyegaran best-effort; status lama tetap sah */ }
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
    const payment = row.payment_provider === "nowpayments"
      ? await import("@/lib/payments/payment-view").then((m) => m.buildNowpaymentsPaymentView(code)).catch(() => null)
      : row.payment_provider === "sekalipay_gateway" ? await import("@/lib/payments/payment-view").then((m) => m.buildSekalipayGatewayPaymentView(code)).catch(() => null)
      : null;
    return NextResponse.json({
      order: {
        code: row.code,
        customer_name: row.customer_name,
        customer_wa: waMasked,
        customer_wa_full: undefined,
        customer_email: emailMasked,
        items: withoutPrivateBuyerData(JSON.parse(String(row.items || "[]"))),
        subtotal: row.subtotal,
        payment_method: row.payment_method,
        payment_account: row.payment_account,
        status: row.status,
        locale: (row.locale as string) ?? "id",
        created_at: row.created_at,
        // An incomplete KlikQRIS invoice already has its local 15-minute cap.
        expires_at: row.payment_provider === "klikqris" && row.payment_expires_at ? row.payment_expires_at : row.expires_at,
        qris_preparation_error: qrisPreparationError,
        credentials_ready: credentialsReady,
        buyer_pin_required: requiresOrderAccessCode(row),
        queued_delivery: queuedDelivery,
        instant_delivery: instantDelivery,
        supplier_owned: supplierOwned,
        supplier_running: supplierRunning,
        // /pesanan/[code] membutuhkan ini untuk membedakan lunas-terkirim dari
        // lunas-gagal-kirim (audit ronde 4, W-H1); /api/orders/lookup sudah punya.
        fulfillment_status: row.fulfillment_status ?? null,
        automatic_progress: hasAutomaticProgress ? await readAutomaticProgress(code, { queryAll }).catch(() => []) : [],
        unique_units_progress: uniqueUnitsProgress,
        qris_reissue_allowed: row.payment_provider === "gopay" && row.status === "pending" && row.sales_channel !== "whatsapp" && Number(row.qris_reissue_count || 0) < MAX_QRIS_REISSUES,
        qris: row.dynamic_qris_url ? {
          payable_amount: row.payable_amount,
          unique_code: row.unique_code,
          image_url: row.dynamic_qris_url,
          expires_at: row.payment_expires_at,
          status: row.transaction_status,
        } : null,
        ...(payment ? { payment } : {}),
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  }
  // Without code, don't leak all orders — require admin endpoint
  return NextResponse.json({ error: "Gunakan ?code=AXV-... atau akses via admin." }, { status: 400 });
}
