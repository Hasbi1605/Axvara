// src/lib/orders/checkout/invoice.ts — post-create invoice issuance
// (3B-5b, class E: pure move, no behavior change).
//
// BEFORE: the QRIS / NOWPayments / Sekalipay-gateway invoice block lived
// inline in src/app/api/orders/route.ts right after order creation.
// AFTER: `issueCheckoutInvoice(ctx, deps)` owns that block verbatim and
// returns a simple typed outcome; the route keeps analytics, the created
// 201 response + buyer proofs, and — via the injected `gatewayClaimedProofs`
// callback — the gateway-claimed early response, so proof awaits, key
// ordering, headers, and serialization stay in the route exactly as before.
// Branch order is unchanged: QRIS -> crypto -> gateway; any other rail
// issues no invoice and imports no provider module. Every provider module
// (nowpayments, sekalipay-gateway, payment-view) stays behind the original
// dynamic `await import()`s in the same order — no new static provider
// import, no circular dependency. Queries, binds, cancel reasons, logging,
// and external call counts are verbatim.

import { NextResponse } from "next/server";
import { queryFirst, transitionPendingOrder } from "@/lib/db";
import { paymentMethodProblem } from "@/lib/orders/checkout/response";
import { createActiveQrisInvoice, type QrisInvoice } from "@/lib/payments/qris";
import type { NowpaymentsUsdExpected } from "@/lib/payments/nowpayments";

type InvoiceContext = {
  code: string;
  paymentMethod: string;
  isCryptoMethod: boolean;
  isGatewayMethod: boolean;
  gateway: { channel: string; estimated_fee: number } | null | undefined;
  cryptoUsd: NowpaymentsUsdExpected | null;
  subtotal: number;
  items: Parameters<typeof transitionPendingOrder>[3];
  locale?: string | null;
  quoteId: string;
  fallbackName: string;
  customerEmail: string;
  wa: string;
};

type InvoiceDeps = {
  /** Route-owned gateway-claimed 503 response (proofs + no-store headers). */
  gatewayClaimedProofs: (input: { code: string; quoteId: string; locale?: string | null }) => Promise<NextResponse>;
};

export type InvoiceOutcome =
  | {
      kind: "issued";
      qrisInvoice: QrisInvoice | null;
      cryptoView: import("@/lib/payments/payment-view").NonQrisPaymentView | null;
      gatewayView: Awaited<ReturnType<typeof import("@/lib/payments/payment-view").buildSekalipayGatewayPaymentView>>;
    }
  | { kind: "responded"; response: NextResponse };

export async function issueCheckoutInvoice(
  ctx: InvoiceContext,
  deps: InvoiceDeps,
): Promise<InvoiceOutcome> {
  const { code } = ctx;
  const items = ctx.items;
  let qrisInvoice: QrisInvoice | null = null;
  let cryptoView: import("@/lib/payments/payment-view").NonQrisPaymentView | null = null;
  let gatewayView: Awaited<ReturnType<typeof import("@/lib/payments/payment-view").buildSekalipayGatewayPaymentView>> = null;
  if (ctx.paymentMethod === "qris") {
    try {
      qrisInvoice = await createActiveQrisInvoice(code, ctx.subtotal);
    } catch (error) {
      console.error("QRIS invoice setup failed:", error instanceof Error ? error.message : "unknown");
      if (error instanceof Error && error.message.startsWith("klikqris_")) {
        const pending = await queryFirst("SELECT id FROM payment_transactions WHERE order_code=? AND provider='klikqris' AND status IN ('initializing','pending')", code);
        if (pending) return { kind: "responded", response: NextResponse.json({ error: "Tagihan sedang disiapkan. Tunggu sebentar lalu coba lagi dengan checkout yang sama.", code }, { status: 503 }) };
      }
      try {
        await transitionPendingOrder(code, "dibatalkan", "qris_setup_failed", items);
      } catch { /* A concurrent terminal transition is safe. */ }
      return { kind: "responded", response: NextResponse.json({ error: "QRIS dinamis sedang tidak tersedia. Coba lagi sebentar." }, { status: 503 }) };
    }
  } else if (ctx.isCryptoMethod) {
    const cryptoUsd = ctx.cryptoUsd!;
    try {
      const { createNowpaymentsInvoice } = await import("@/lib/payments/nowpayments");
      const inv = await createNowpaymentsInvoice(code, Number(ctx.subtotal), cryptoUsd.payCurrency, {
        payNetwork: cryptoUsd.network,
        priceCurrency: "usd",
        feePayer: "merchant",
        fixedRate: false,
        expectedUsd: { ...cryptoUsd },
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
        // pola dispatchPayq1Creating di src/lib/telegram/handlers/payment-dispatch.ts), 503 "check status" — JANGAN cancel.
        // No repeat POST: retry quote SAMA memulihkan via GET known id.
        return { kind: "responded", response: NextResponse.json({ error: paymentMethodProblem(ctx.locale), error_code: "payment_method_unavailable", code }, { status: 503 }) };
      }
      if (message === "nowpayments_preflight_invalid" || message === "nowpayments_usd_snapshot_required"
        || message.startsWith("nowpayments_")) {
        try {
          await transitionPendingOrder(code, "dibatalkan", `nowpayments_setup_failed:${message.slice(0, 60)}`, items);
        } catch { /* A concurrent terminal transition is safe. */ }
        return { kind: "responded", response: NextResponse.json({ error: "Pembayaran crypto sedang tidak tersedia. Muat ulang checkout." }, { status: 503 }) };
      }
      try {
        await transitionPendingOrder(code, "dibatalkan", "nowpayments_setup_failed", items);
      } catch { /* A concurrent terminal transition is safe. */ }
      return { kind: "responded", response: NextResponse.json({ error: "Pembayaran crypto sedang tidak tersedia. Muat ulang checkout." }, { status: 503 }) };
    }
  } else if (ctx.isGatewayMethod && ctx.gateway) {
    const gateway = ctx.gateway;
    try {
      const { createSekalipayGatewayInvoice } = await import("@/lib/payments/sekalipay-gateway");
      await createSekalipayGatewayInvoice(code, ctx.subtotal, gateway.channel, { name: ctx.fallbackName, email: ctx.customerEmail, phone: ctx.wa }, gateway.estimated_fee);
      gatewayView = await import("@/lib/payments/payment-view").then((m) => m.buildSekalipayGatewayPaymentView(code));
    } catch {
      const claimed = await queryFirst("SELECT id FROM payment_transactions WHERE order_code=? AND provider='sekalipay_gateway'", code);
      if (!claimed) {
        await transitionPendingOrder(code, "dibatalkan", "gateway_setup_failed", items).catch(() => {});
        return { kind: "responded", response: NextResponse.json({ error: "Metode pembayaran tidak tersedia.", code }, { status: 503, headers: { "Cache-Control": "private, no-store" } }) };
      }
      return { kind: "responded", response: await deps.gatewayClaimedProofs({ code, quoteId: ctx.quoteId, locale: ctx.locale }) };
    }
  }
  return { kind: "issued", qrisInvoice, cryptoView, gatewayView };
}
