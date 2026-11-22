// src/lib/cron/lite/jobs/jaspay-catalog.ts — jaspay_catalog job body
// (3A-8b, class E: pure move, no behavior change).
//
// BEFORE: the jaspay_catalog branch lived inline in
// src/app/api/cron/lite/route.ts. AFTER: `run(ctx)` owns the verbatim
// body and returns whether the route must answer the existing spread
// 503; the route keeps that NextResponse, the generic marker tail, and
// the 400-statement selection line. The old
// `@/lib/warung-rebahan/sync` dynamic import, the single
// `(db, undefined, {maxProducts: 10})` call, Object.assign order, the
// exact errors predicate, and drain-only-on-empty-errors are preserved.

import { drainDirtyGroupsIfBudget, type LiteContext } from "@/lib/cron/lite/context";

/** Plafon produk Jaspay per tick; budget 400 menjadi batas pengaman. */
const JASPAY_PRODUCTS_PER_TICK = 10;

export async function run(ctx: LiteContext): Promise<{ failed: boolean }> {
  const { db, result } = ctx;
  const { syncJaspayCatalog } = await import("@/lib/warung-rebahan/sync");
  const synced = await syncJaspayCatalog(db, undefined, { maxProducts: JASPAY_PRODUCTS_PER_TICK });
  Object.assign(result, synced);
  if (synced.errors.length && !synced.errors.includes("warung_rebahan_disabled")) {
    return { failed: true };
  }
  if (!synced.errors.length) await drainDirtyGroupsIfBudget(db, result);
  return { failed: false };
}
