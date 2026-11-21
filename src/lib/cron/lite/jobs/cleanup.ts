// src/lib/cron/lite/jobs/cleanup.ts — `cleanup` job body (3A-2 diff 2,
// class E: pure move, no behavior change).
//
// BEFORE: `runCleanup(db, failedCore)` + its `runCryptoMarketRefresh(db)`
// helper lived inline in src/app/api/cron/lite/route.ts. AFTER: this module
// exports `run(ctx)` with the verbatim bodies merged (the market-refresh
// helper stays module-private, like the route's local function). The route
// dispatches via dynamic `await import("@/lib/cron/lite/jobs/cleanup")`.
// Static imports are exactly the lite `context` helpers the body already
// used (`monitorRecovery`) plus db-access (budget throw) and the `LiteContext`
// type — every payload module (maintenance-cleanup, sync-staleness,
// finance/expenses, supplier-pairs, product-copy/review-alert, market
// snapshot refresh) stays behind the original `await import()`s.

import { QueryBudgetExceeded } from "@/lib/db-access";
import { monitorRecovery, type LiteContext } from "@/lib/cron/lite/context";

// cleanup: baris kedaluwarsa (sesi WA, inbox WA 7 hari, event bayar tuntas 30 hari,
// revokasi sesi admin). Murah dan idempoten.
export async function run(ctx: LiteContext): Promise<Record<string, unknown>> {
  const { db, failedCore } = ctx;
  const { runMaintenanceCleanup } = await import("@/lib/maintenance-cleanup");
  const out: Record<string, unknown> = {};
  const recover = monitorRecovery(db, "cleanup", out, failedCore);
  const cleanup = await recover("maintenance_cleanup", () => runMaintenanceCleanup(db), null);
  if (cleanup && db.canSpend(1)) await db.execRun(`DELETE FROM store_settings WHERE key='cleanup_recovery_last_error'`);
  // Hourly maintenance uses at most 10 statements. Give the watchdog first
  // access to the remaining budget before the optional recurring/group work.
  let staleness: Record<string, unknown>;
  try {
    const { checkSyncStaleness } = await import("@/lib/sync-staleness");
    staleness = { staleness: await checkSyncStaleness(db) };
  } catch {
    staleness = { staleness: { checked: false, error: "check_failed" } };
  }
  if (db.canSpend(3)) {
    const { materializeRecurring } = await import("@/lib/finance/expenses");
    await materializeRecurring(db);
  }
  if (!db.canSpend(3)) return { ...out, ...cleanup, ...staleness };
  // Drain WR-only changes and failed VPS pair requests on the existing cron.
  // Critical order work has its own jobs; this drain is bounded and resumable.
  const { decideDirtyWinners } = await import("@/lib/supplier-pairs");
  const pairs = await decideDirtyWinners(db);
  const copy: Record<string, unknown> = {};
  // Optional admin alert: <=4 statements, 30-minute CAS; never block cleanup.
  if (db.canSpend(4)) {
    try {
      const { checkCopyReviewChanges } = await import("@/lib/product-copy/review-alert");
      copy.copy_review = await checkCopyReviewChanges(db);
    } catch { copy.copy_review = { checked: false, error: "check_failed" }; }
  }
  const market = await runCryptoMarketRefresh(ctx);
  return { ...out, ...cleanup, pairs_decided: pairs.decided, pairs_changed: pairs.changed, ...copy, ...market, ...staleness };
}

/**
 * Refresh kurs USD/IDR + katalog koin NOWPayments (D1 `crypto_market_snapshot`).
 * Dipasang di akhir job `cleanup` (tick 5 menit existing, tanpa trigger baru):
 * kerja ini hanya jatuh tempo tiap 30 menit sehingga pada tick lain ia hanya
 * 1 baca D1 murah; panggilan jaringannya (~25 GET, timeout 8 dtk, total 30 dtk)
 * tidak boleh memengaruhi job payments/expiry/fulfillment yang berjalan di
 * request cron lite TERPISAH dengan budget sendiri. Dijalankan paling akhir
 * setelah maintenance + pair drain, dan setiap kegagalan/timeout ditelan di sini
 * (hanya ditandai di hasil) agar cleanup tidak 500 karena sisi pasar.
 */
async function runCryptoMarketRefresh(ctx: LiteContext): Promise<Record<string, unknown>> {
  const { db } = ctx;
  try {
    if (!db.canSpend(4)) return {};
    const { refreshCryptoMarketSnapshot } = await import("@/lib/payments/market-snapshot-refresh");
    const result = await refreshCryptoMarketSnapshot(db);
    return result.status === "not_due" || result.status === "skipped_no_key" ? {} : { crypto_market: result.status, ...(result.errors ? { crypto_market_errors: result.errors } : {}) };
  } catch (error) {
    // Termasuk QueryBudgetExceeded: budget habis di sini tidak boleh membuang
    // hasil cleanup/pair drain yang sudah selesai; tick berikut mencoba lagi.
    return { crypto_market: error instanceof QueryBudgetExceeded ? "budget_exhausted" : "error" };
  }
}
