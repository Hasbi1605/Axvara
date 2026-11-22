// src/lib/cron/phases/cleanup.ts — operations cleanup phase (3C cleanup,
// class E: pure move, no behavior change).
//
// BEFORE: `runCleanup` lived inline in src/app/api/cron/operations/route.ts.
// AFTER: `run(ctx)` owns the verbatim body; the route's dispatch callback
// returns this promise directly (no added await/wrapper). Gate, deferral,
// mutation order, and error propagation are unchanged.

import type { OperationsContext } from "@/lib/cron/operations-context";

const COST_PER_CLEANUP = 10;

export async function run(ctx: OperationsContext): Promise<void> {
  const { budget, database, results, deferredOut } = ctx;
  const { pendingJobs, pendingNotify, waWorkPending, pendingExpiryAny } = ctx.counts;
  // === FASE CLEANUP: ringan, jalan tiap run bila budget sisa ===
  // RR3-01: JANGAN paksakan cleanup tiap run — 4 query kosong tiap run =
  // setengah item kirim. Cleanup jalan bila (a) tidak ada pekerjaan
  // fulfillment/notify yang menunggu, ATAU (b) budget tersisa longgar
  // (sisa ≥ 10 setelah cadangan ekor). Deferred cleanup adalah normal,
  // bukan kegagalan.
  const fulfilOrNotifyWaiting = pendingJobs > 0 || pendingNotify > 0 || waWorkPending > 0 || pendingExpiryAny > 0;
  if (!fulfilOrNotifyWaiting && budget.fits(COST_PER_CLEANUP)) {
    const { runMaintenanceCleanup } = await import("@/lib/maintenance-cleanup");
    const cleaned = await runMaintenanceCleanup(database);
    results.whatsapp_rows_cleaned = cleaned.whatsapp_rows_cleaned;
    if ("cleanup_skipped" in cleaned) results.cleanup_skipped = cleaned.cleanup_skipped;
  } else if (!deferredOut.includes("cleanup")) {
    deferredOut.push("cleanup");
  }
}
