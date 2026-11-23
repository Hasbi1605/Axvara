import { QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";
import { drainSupplierPairs } from "@/lib/cron/supplier-pairs";
import type { LiteJob } from "./jobs";

type Db = DatabaseAccess;

export type LiteContext = {
  job: LiteJob;
  db: Db;
  deadline: number;
  result: Record<string, unknown>;
  failedCore: string[];
};

export async function drainDirtyGroupsIfBudget(db: Db, result: Record<string, unknown>) {
  if (!db.canSpend(4)) return;
  try {
    const pairs = await drainSupplierPairs(db, { mode: "dirty" });
    result.pairs_decided = pairs.decided;
    result.pairs_changed = pairs.changed;
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) throw error;
  }
}

export function monitorRecovery(db: Db, job: string, out: Record<string, unknown>, failedCore: string[]) {
  return async <T,>(name: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await run(); } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      failedCore.push(name);
      out.recovery_failed = Number(out.recovery_failed ?? 0) + 1;
      const { recordSyncError, sanitizeSyncError } = await import("@/lib/sync-status");
      const summary = `${name}: ${sanitizeSyncError(error)}`;
      if (typeof out.error !== "string") out.error = summary;
      await recordSyncError(db, `${job}_recovery`, summary);
      return fallback;
    }
  };
}
