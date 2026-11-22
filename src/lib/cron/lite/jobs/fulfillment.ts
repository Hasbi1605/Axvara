import { QueryBudgetExceeded } from "@/lib/db-access";
import type { LiteContext } from "@/lib/cron/lite/context";

const FULFILLMENT_PER_RUN = 20;
const FULFILLMENT_ITEMS_PER_JOB = 10;

export async function run({ db, deadline }: LiteContext): Promise<Record<string, unknown>> {
  if (process.env.AUTO_FULFILLMENT_ENABLED !== "true") return { skipped: "auto_fulfillment_disabled" };
  const { getDueJobs, processJobItems, releaseStaleJobs } = await import("@/lib/fulfillment/deliver");
  const released = await releaseStaleJobs(db).catch(() => 0);
  const jobs = await getDueJobs(FULFILLMENT_PER_RUN, db);
  let processed = 0;
  for (const job of jobs) {
    if (Date.now() >= deadline) break;
    const order = await db.queryFirst(`SELECT * FROM orders WHERE code=?`, String(job.order_code));
    if (!order) continue;
    try {
      const unit = await processJobItems(Number(job.id), order, {}, FULFILLMENT_ITEMS_PER_JOB, () => Date.now() < deadline, db);
      if (unit.done || unit.attempted > 0) processed++;
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
    }
  }
  return { stale_locks_released: released, due_jobs_processed: processed };
}
