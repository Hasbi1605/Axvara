// src/lib/cron/lite/jobs/catalog.ts — four supplier catalog publish flows
// (3A-8a, class E: pure move, no behavior change).
//
// BEFORE: aivault/storebat/mirai/tunvn catalog branches lived inline in
// src/app/api/cron/lite/route.ts, each repeating the FX-gated publish flow.
// AFTER: `run(ctx, job)` shares that flow with explicit supplier selection;
// the route keeps HTTP responses (503 shapes), the generic marker tail,
// and every other branch. Per-supplier order is preserved: dynamic client
// import first, config getters in original order (TUNVN checks
// sync-enabled before configured; the other three check configured
// first), FX snapshot from `db.d1` + parseRateRational, recordSyncError
// with the exact job key before an fx_unavailable outcome, publisher
// imported only after valid FX, `{force:false}`, one Object.assign into
// the shared result object, and drain only on `ok:true` — except StoreBat,
// which skips drain whenever `unchanged` is PRESENT (even false).

import { drainDirtyGroupsIfBudget, type LiteContext } from "@/lib/cron/lite/context";

export type CatalogJob = "aivault_catalog" | "storebat_catalog" | "mirai_catalog" | "tunvn_catalog";

export type CatalogOutcome = "done" | "fx_unavailable" | "publish_failed";

type Synced = Record<string, unknown>;

export async function run(ctx: LiteContext, job: CatalogJob): Promise<CatalogOutcome> {
  const { db, result } = ctx;
  let configured = false;
  let publish: ((db: LiteContext["db"], rate: number, opts: { force: boolean }) => Promise<Synced>) | null = null;
  if (job === "aivault_catalog") {
    const { isAivaultConfigured, isAivaultSyncEnabled } = await import("@/lib/aivault/client");
    configured = Boolean(isAivaultConfigured() && isAivaultSyncEnabled());
    if (configured) publish = async (d, rate, opts) => (await import("@/lib/aivault/catalog")).publishAivaultCatalog(d, rate, opts) as Promise<Synced>;
  } else if (job === "storebat_catalog") {
    const { isStorebatConfigured, isStorebatSyncEnabled } = await import("@/lib/storebat/client");
    configured = Boolean(isStorebatConfigured() && isStorebatSyncEnabled());
    if (configured) publish = async (d, rate, opts) => (await import("@/lib/storebat/catalog")).publishStorebatCatalog(d, rate, opts) as Promise<Synced>;
  } else if (job === "mirai_catalog") {
    const { isMiraiConfigured, isMiraiSyncEnabled } = await import("@/lib/mirai/client");
    configured = Boolean(isMiraiConfigured() && isMiraiSyncEnabled());
    if (configured) publish = async (d, rate, opts) => (await import("@/lib/mirai/catalog")).publishMiraiCatalog(d, rate, opts) as Promise<Synced>;
  } else {
    const { isTunvnSyncEnabled, isTunvnConfigured } = await import("@/lib/tunvn/client");
    configured = Boolean(isTunvnSyncEnabled() && isTunvnConfigured());
    if (configured) publish = async (d, rate, opts) => (await import("@/lib/tunvn/catalog")).publishTunvnCatalog(d, rate, opts) as Promise<Synced>;
  }
  if (!configured || !publish) {
    result.skipped = "not_configured";
    return "done";
  }
  const { loadCurrentFxSnapshot } = await import("@/lib/payments/market-snapshot");
  const { parseRateRational } = await import("@/lib/payments/fx");
  const fx = await loadCurrentFxSnapshot(db.d1), rate = fx ? parseRateRational(fx.rateText) : null;
  if (!rate) {
    const { recordSyncError } = await import("@/lib/sync-status");
    await recordSyncError(db, job, "fx_unavailable");
    return "fx_unavailable";
  }
  const synced = await publish(db, Number(rate.num) / Number(rate.den), { force: false });
  Object.assign(result, synced);
  if ("ok" in synced && !synced.ok) return "publish_failed";
  if ("ok" in synced && synced.ok) {
    if (job === "storebat_catalog") {
      if (!("unchanged" in synced)) await drainDirtyGroupsIfBudget(db, result);
    } else {
      await drainDirtyGroupsIfBudget(db, result);
    }
  }
  return "done";
}
