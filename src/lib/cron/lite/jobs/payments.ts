// src/lib/cron/lite/jobs/payments.ts — payments job body (3A-5, class E:
// pure move, no behavior change).
//
// BEFORE: the `payments` branch lived inline in
// src/app/api/cron/lite/route.ts, including its immediate 503 return.
// AFTER: `run(ctx)` owns the branch payload verbatim and reports
// `paymentsFailed` so the route keeps owning HTTP serialization: the route
// still returns the same immediate 503 (`{ ...result, ok: false,
// failed_subjobs? }`) right after this job runs, before the generic
// failedCore marker, including a positive `payments_failed` without any
// failedCore entry. Every payload (klikqris-reconcile, payment-view,
// sekalipay-gateway, service-health) stays behind the original
// `await import()`s, in the same order; this module's only static imports
// are the budget throw and context helpers/types the route already loads.
// `ctx.result`/`ctx.failedCore` are mutated in place exactly as the inline
// branch did; `ctx.deadline` drives the same `Date.now()` admission math.

import { QueryBudgetExceeded } from "@/lib/db-access";
import { saveServiceHealth, type LiteContext } from "@/lib/cron/lite/context";

export type PaymentsOutcome = { paymentsFailed: boolean };

export async function run(ctx: LiteContext): Promise<PaymentsOutcome> {
  const { db, deadline, result, failedCore } = ctx;
  // A status GET has a 10s timeout. Reserve an extra 10s if reconciliation
  // can send an inline admin review notice, plus time to settle the row.
  const pollReserve = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ADMIN_CHAT_ID ? 21_000 : 11_000;
  result.payments_deferred = 0;
  const admit = (remaining: number) => {
    if (Date.now() + pollReserve <= deadline) return true;
    result.payments_deferred = Number(result.payments_deferred) + remaining;
    return false;
  };
  // Bounded (Paid 300-budget): KlikQRIS (limit 20) + NOWPayments (limit 20,
  // shared budget/CAS, incl. known-id initializing for manual review)
  // + late known-id (limit 20, 6h recheck, no revive/fulfill) + Sekalipay gateway (12/4/5).
  // NOWPayments passes read key only => run saved-invoice flag-off (key
  // present => readable; key absent => passes quietly return zeros).
  const { reconcileDueKlikQrisPayments } = await import("@/lib/payments/klikqris-reconcile");
  const klik = await reconcileDueKlikQrisPayments(db, admit);
  Object.assign(result, klik);
  try {
    const { reconcileDueNowpaymentsPayments, reconcileLateKnownNowpaymentsPayments } = await import("@/lib/payments/payment-view");
    const now = await reconcileDueNowpaymentsPayments(db, admit);
    (result as Record<string, unknown>).nowpayments_checked = now.payments_checked;
    (result as Record<string, unknown>).nowpayments_confirmed = now.payments_confirmed;
    (result as Record<string, unknown>).nowpayments_manual_review = now.manual_review;
    (result as Record<string, unknown>).payments_checked =
      Number(result.payments_checked ?? 0) + now.payments_checked;
    (result as Record<string, unknown>).payments_confirmed =
      Number(result.payments_confirmed ?? 0) + now.payments_confirmed;
    (result as Record<string, unknown>).payments_failed =
      Number(result.payments_failed ?? 0) + now.payments_failed;
    if (db.canSpend(6)) {
      const late = await reconcileLateKnownNowpaymentsPayments(db, admit);
      (result as Record<string, unknown>).nowpayments_late_checked = late.late_checked;
      (result as Record<string, unknown>).nowpayments_late_manual_review = late.late_manual_review;
    }
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) throw error;
    (result as Record<string, unknown>).nowpayments_error = "pass_failed";
    failedCore.push("nowpayments");
  }
  if (db.canSpend(6)) {
    try {
      const { reconcileDueSekalipayGatewayPayments } = await import("@/lib/payments/payment-view");
      Object.assign(result, await reconcileDueSekalipayGatewayPayments(db, admit));
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      result.gateway_error = "pass_failed";
      failedCore.push("sekalipay_gateway");
    }
  }
  if (db.canSpend(4)) {
    try {
      const { reconcileStaleSekalipayGatewayPayments } = await import("@/lib/payments/sekalipay-gateway");
      Object.assign(result, await reconcileStaleSekalipayGatewayPayments(db, { admit }));
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      result.gateway_stale_error = "pass_failed";
      failedCore.push("sekalipay_gateway_stale");
    }
  }
  if (klik.payments_checked > 0 && db.canSpend(1) && Date.now() + 1_000 <= deadline) {
    const { KLIKQRIS_POLL_HEALTH_KEY } = await import("@/lib/service-health");
    await saveServiceHealth(db, KLIKQRIS_POLL_HEALTH_KEY, String(klik.payments_failed));
  }
  return { paymentsFailed: Number(result.payments_failed) > 0 || failedCore.length > 0 };
}
