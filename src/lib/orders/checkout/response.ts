// src/lib/orders/checkout/response.ts — POST response builders (3B-2, class E:
// pure move, no behavior change).
//
// BEFORE: the reused/closed/created response builders lived inline in
// src/app/api/orders/route.ts (≈72–166 and ≈622–636).
// AFTER: this module owns the plain body+status+headers; the route only wraps
// them in NextResponse. Bodies keep identical keys in identical order, same
// status codes, same Cache-Control headers. Guard, validation, quote,
// payment, and createOrderWithStock code stays in the route (later steps).
// Leaf module for the response SHAPE: keeps the NextResponse import so the
// construction is verbatim, but takes every DB/auth/payment dependency as an
// injected callback — no new lib/orders ↔ lib/* import edges.

import { NextResponse } from "next/server";

export type CheckoutLocale = "en" | "id";

export type StoreNoCache = { status: number; headers: { "Cache-Control": string } };

export const STORE_NO_CACHE: StoreNoCache["headers"] = { "Cache-Control": "private, no-store" };

export type BuyerProofs = {
  buyer_access_session: unknown;
  checkout_credential_grant: unknown;
};

export type SavedOrderRow = Record<string, unknown>;

export type RouteDeps = {
  readFreshOrder: (code: unknown) => Promise<Record<string, unknown> | null | undefined>;
  readTransaction: (code: unknown) => Promise<Record<string, unknown> | null | undefined>;
  readOrderStatus: (code: unknown) => Promise<Record<string, unknown> | null | undefined>;
  createBuyerAccessSession: (order: Record<string, unknown>) => Promise<unknown>;
  createCheckoutCredentialGrant: (order: Record<string, unknown>) => Promise<unknown>;
  createActiveQrisInvoice: (
    code: string,
    amount: number,
  ) => Promise<{ payableAmount: number; uniqueCode: number; qrisUrl: string; expiresAt: string }>;
  reconcileNowpayments: (code: string) => Promise<{ claimed: boolean; payment: unknown }>;
  createSekalipayGatewayPreclaimView: (live: Record<string, unknown>) => Promise<{
    kind: "deferred" | "reused" | "generic";
    payment?: unknown;
    status?: unknown;
  }>;
  readSavedGatewayRow: (code: unknown) => Promise<Record<string, unknown> | null>;
  createSekalipayGatewayInvoice: (
    code: string,
    subtotal: number,
    channel: string,
    buyer: { name: string; email: string; phone: string },
    fee: number,
  ) => Promise<unknown>;
  reconcileSekalipayGateway: (code: string) => Promise<{ payment: unknown; deferred: boolean }>;
};

/**
 * Copy pembeli saat invoice gateway (Sekalipay) atau crypto gagal dibuat,
 * ambigu, atau masih `initializing` saat checkout. Menggantikan kalimat
 * "Tagihan sedang disiapkan. Coba checkout yang sama." yang membingungkan
 * (keputusan owner 7 Nov 2026). QRIS punya copy persiapan sendiri dan tidak
 * memakai helper ini. Locale mengikuti pesanan/kutipan; default ID.
 * Verbatim move of paymentMethodProblem (route.ts:38-42).
 */
export function paymentMethodProblem(locale: string | null | undefined): string {
  return locale === "en"
    ? "This payment method is having problems. Please try another payment method."
    : "Metode pembayaran ini sedang gangguan. Silakan coba metode pembayaran lain.";
}

/** Verbatim move of closedCheckoutResponse (route.ts:74-80). */
export function closedCheckoutResponse(status: unknown, locale: CheckoutLocale) {
  if (!["dibatalkan", "kadaluarsa"].includes(String(status))) return null;
  return NextResponse.json({
    error: locale === "en" ? "This order is closed. Get a new quote to continue." : "Pesanan ini sudah ditutup. Ambil harga terbaru untuk lanjut.",
    error_code: "checkout_order_closed",
  }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
}

type QrisReuseInvoice = { payableAmount: number; uniqueCode: number; qrisUrl: string; expiresAt: string };

function reusedQrisResponse(
  live: Record<string, unknown>,
  status: unknown,
  locale: CheckoutLocale,
  proofs: BuyerProofs,
  inv: QrisReuseInvoice,
) {
  return NextResponse.json({
    code: live.code,
    subtotal: live.subtotal,
    status,
    buyer_access_session: proofs.buyer_access_session,
    checkout_credential_grant: proofs.checkout_credential_grant,
    reused: true,
    locale,
    qris: {
      payable_amount: inv.payableAmount,
      unique_code: inv.uniqueCode,
      image_url: inv.qrisUrl,
      expires_at: inv.expiresAt,
    },
  }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Verbatim move of existingCheckoutResponse (route.ts:82-166). Saved retry
 * SELALU baca ulang status + locale terbaru dari DB (snapshot stale tidak
 * pernah dikembalikan). Same order, same provider binding, access-safe
 * recovery. Never reserve again; never POST blind; never switch provider
 * (reconcile known id via GET only).
 */
export async function existingCheckoutResponse(
  existing: Record<string, unknown>,
  deps: RouteDeps,
) {
  const fresh = await deps.readFreshOrder(existing.code).catch(() => null);
  const live = (fresh ?? existing) as Record<string, unknown>;
  const locale = (live.locale === "en" ? "en" : "id") as CheckoutLocale;
  const closed = closedCheckoutResponse(live.status, locale);
  if (closed) return closed;
  const buyer_access_session = await deps.createBuyerAccessSession(live);
  const checkout_credential_grant = await deps.createCheckoutCredentialGrant(live);
  if (live.status === "pending") {
    const tx = await deps.readTransaction(live.code);
    if (!tx && String(live.payment_method ?? "").startsWith("sekalipay_gateway:")) {
      // ponytail: a preclaim orphan expires unless its original request finishes; add durable dispatch if recovery is required.
      return NextResponse.json({ error: paymentMethodProblem(locale), error_code: "payment_method_unavailable", code: live.code, buyer_access_session, checkout_credential_grant }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
    if (tx?.provider === "klikqris") {
      try {
        const inv = await deps.createActiveQrisInvoice(String(live.code), Number(tx.requested_amount));
        const current = await deps.readOrderStatus(live.code);
        const status = current?.status ?? live.status;
        return closedCheckoutResponse(status, locale) ?? reusedQrisResponse(
          live, status, locale, { buyer_access_session, checkout_credential_grant }, inv,
        );
      } catch {
        return NextResponse.json({ error: "Tagihan sedang disiapkan. Tunggu sebentar lalu coba lagi dengan checkout yang sama.", code: existing.code }, { status: 503 });
      }
    }
    if (tx?.provider === "nowpayments") {
      // Saved crypto: flag-off/new-config irrelevant — status/reconcile runs
      // via saved binding (readable). Ambiguous/initializing-with-id recovers
      // inside reconcile; failure => 503 retry-same-quote (no cancel, no POST).
      try {
        const { claimed, payment } = await deps.reconcileNowpayments(String(live.code));
        void claimed;
        if (payment) {
          const current = await deps.readOrderStatus(live.code);
          const status = current?.status ?? live.status;
          return closedCheckoutResponse(status, locale) ?? NextResponse.json({ code: live.code, subtotal: live.subtotal, status, buyer_access_session, checkout_credential_grant, reused: true, locale, payment }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
        }
      } catch { /* fall through to generic reuse below */ }
      return NextResponse.json({ error: paymentMethodProblem(locale), error_code: "payment_method_unavailable", code: live.code }, { status: 503 });
    }
    if (tx?.provider === "sekalipay_gateway") {
      const outcome = await deps.createSekalipayGatewayPreclaimView(live);
      if (outcome.kind === "deferred") {
        return NextResponse.json({ error: paymentMethodProblem(locale), error_code: "payment_method_unavailable", code: live.code, buyer_access_session, checkout_credential_grant }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
      }
      if (outcome.kind === "reused") {
        const current = await deps.readOrderStatus(live.code);
        const status = current?.status ?? live.status;
        return closedCheckoutResponse(status, locale) ?? NextResponse.json({ code: live.code, subtotal: live.subtotal, status, buyer_access_session, checkout_credential_grant, reused: true, locale, payment: outcome.payment }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
      }
      if (outcome.payment == null) {
        return NextResponse.json({ error: paymentMethodProblem(locale), error_code: "payment_method_unavailable", code: live.code, buyer_access_session, checkout_credential_grant }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
      }
      const current = await deps.readOrderStatus(live.code);
      const status = current?.status ?? live.status;
      return closedCheckoutResponse(status, locale) ?? NextResponse.json({ code: live.code, subtotal: live.subtotal, status, buyer_access_session, checkout_credential_grant, reused: true, locale, payment: outcome.payment }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
    }
  }
  return NextResponse.json({ code: live.code, subtotal: live.subtotal, status: live.status, buyer_access_session, checkout_credential_grant, reused: true, locale }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
}

export type CreatedCheckoutInput = {
  code: string;
  quoteId: string;
  subtotal: number;
  locale: CheckoutLocale;
  qrisInvoice: {
    payableAmount: number;
    uniqueCode: number;
    qrisUrl: string;
    expiresAt: string;
  } | null;
  cryptoView: unknown | null;
  gatewayView: unknown | null;
  proofs: BuyerProofs & { quote_id: string };
};

/**
 * Verbatim move of the 201 created response (route.ts:622-636): same keys
 * in the same order, same conditional `payment` spread, same 201 + no-store.
 */
export function createdCheckoutResponse(input: CreatedCheckoutInput) {
  const { code, quoteId, subtotal, locale, qrisInvoice, cryptoView, gatewayView, proofs } = input;
  void quoteId;
  return NextResponse.json({
    code,
    buyer_access_session: proofs.buyer_access_session,
    checkout_credential_grant: proofs.checkout_credential_grant,
    subtotal,
    status: "pending",
    locale,
    qris: qrisInvoice ? {
      payable_amount: qrisInvoice.payableAmount,
      unique_code: qrisInvoice.uniqueCode,
      image_url: qrisInvoice.qrisUrl,
      expires_at: qrisInvoice.expiresAt,
    } : null,
    ...((cryptoView || gatewayView) ? { payment: cryptoView ?? gatewayView } : {}),
  }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
