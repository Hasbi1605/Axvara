// src/lib/cron/phases/fulfillment.ts — operations fulfillment phase
// (3C fulfillment, class E: pure move, no behavior change).
//
// BEFORE: `runFulfillment` lived inline in src/app/api/cron/operations/route.ts.
// AFTER: `run(ctx)` owns the verbatim body; the route dispatch returns
// this promise directly. Frozen ctx, metered DB, hasTime, SQL order,
// caps and deferred behavior are unchanged.

import { DELIVERY_LINE_COUNT_SQL } from "@/lib/fulfillment/units";
import {
  COST_PER_JOB_FRAME, COST_PER_DELIVERY_ITEM, COST_PER_ORPHAN_LIGHT,
  getDueJobs, ensureFulfillmentItems, processJobItems, reconcileOrphanLight, reconcileSettledJobs, releaseStaleJobs,
} from "@/lib/fulfillment/deliver";
import type { OperationsContext } from "@/lib/cron/operations-context";

const COST_PER_STALE_RELEASE = 2;
const FULFILLMENT_PER_RUN = 20;
const TIME_FULFILLMENT_UNIT = 10_000;

export async function run(ctx: OperationsContext): Promise<void> {
  const { budget, database, results, deferredOut, activePhases, hasTime } = ctx;
  const { pendingStale, pendingJobs } = ctx.counts;
  const { queryAll, queryFirst } = database;

      // Materialization and delivery are resumable units in the same request budget.
      if (activePhases.has("fulfillment")) {
        if (pendingStale > 0 && budget.fits(COST_PER_STALE_RELEASE)) {
          results.stale_locks_released = await releaseStaleJobs(database);
        }
        if (budget.fits(1 + COST_PER_ORPHAN_LIGHT)) {
          const orphans = await queryAll(
            `SELECT o.code FROM orders o LEFT JOIN fulfillment_jobs fj ON fj.order_code=o.code
             WHERE o.status='lunas' AND o.payment_status='paid' AND fj.order_code IS NULL
               AND COALESCE(o.order_kind,'apps') NOT IN ('pedia','games')
             ORDER BY o.created_at ASC LIMIT ?`, FULFILLMENT_PER_RUN,
          );
          for (const orphan of orphans) {
            if (!budget.fits(COST_PER_ORPHAN_LIGHT)) { deferredOut.push("fulfillment"); break; }
            try { if (await reconcileOrphanLight(String(orphan.code), database)) results.fulfillment_orphans_healed = Number(results.fulfillment_orphans_healed) + 1; }
            catch { deferredOut.push("fulfillment"); }
          }
        }
        if (budget.fits(6)) results.fulfillment_aggregates_repaired = await reconcileSettledJobs(2, database);
        if (budget.fits(1)) {
          const jobs = process.env.AUTO_FULFILLMENT_ENABLED === "true"
            ? await getDueJobs(FULFILLMENT_PER_RUN, database)
            : await queryAll(
              `SELECT fj.* FROM fulfillment_jobs fj JOIN orders o ON o.code=fj.order_code
               WHERE fj.status IN ('queued','retry') AND o.status='lunas' AND o.payment_status='paid'
                 AND COALESCE(o.order_kind,'apps') NOT IN ('pedia','games')
                 AND (fj.locked_until IS NULL OR datetime(fj.locked_until)<datetime('now'))
                 AND (SELECT COUNT(*) FROM fulfillment_items fi WHERE fi.order_code=o.code)
                   < ${DELIVERY_LINE_COUNT_SQL}
               ORDER BY fj.created_at ASC, fj.id ASC LIMIT ?`, FULFILLMENT_PER_RUN,
            );
          for (const job of jobs) {
            if (!budget.fits(2 + COST_PER_JOB_FRAME + COST_PER_DELIVERY_ITEM)) { deferredOut.push("fulfillment"); break; }
            // Pengiriman item memanggil kanal luar (Telegram/WA) — hormati
            // deadline invocation agar run tidak dipotong platform.
            if (!hasTime(TIME_FULFILLMENT_UNIT)) { deferredOut.push("fulfillment"); break; }
            const order = await queryFirst(`SELECT * FROM orders WHERE code=?`, String(job.order_code));
            if (!order) continue;
            // processJobItems resolves each item's product; no eager products scan.
            try {
              if (process.env.AUTO_FULFILLMENT_ENABLED !== "true") {
                // Populate the admin queue in bounded steps, without dispatching.
                await ensureFulfillmentItems(order, database, 2);
                continue;
              }
              const unit = await processJobItems(Number(job.id), order, {}, 2, undefined, database);
              if (unit.done || unit.attempted > 0) results.due_jobs_processed = Number(results.due_jobs_processed) + 1;
              if (!unit.finished && !["not_owned", "not_paid", "no_work"].includes("reason" in unit ? unit.reason : "")) deferredOut.push("fulfillment");
            } catch { deferredOut.push("fulfillment"); }
          }
          if (jobs.length >= FULFILLMENT_PER_RUN) deferredOut.push("fulfillment");
        }
      } else if (pendingJobs > 0 || pendingStale > 0) deferredOut.push("fulfillment");
}
