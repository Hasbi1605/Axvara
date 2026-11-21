import { QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";
import type { LiteJob } from "./jobs";

type Db = DatabaseAccess;

export type LiteContext = {
  job: LiteJob;
  db: Db;
  deadline: number;
  result: Record<string, unknown>;
  failedCore: string[];
};

type Items = { product_id: number; variant_id?: number; qty: number }[];
export const parseItems = (raw: unknown): Items => {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export async function saveServiceHealth(db: Db, key: string, value: string) {
  try {
    await db.execRun(`INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`, key, value);
  } catch {
    // A failed sample write must not change payment/notification handling.
    console.warn("[cron-health] sample_write_failed", key);
  }
}

export async function drainDirtyGroupsIfBudget(db: Db, result: Record<string, unknown>) {
  if (!db.canSpend(4)) return;
  try {
    const { decideDirtyWinners } = await import("@/lib/supplier-pairs");
    const pairs = await decideDirtyWinners(db);
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
      await recordSyncError(db, `${job}_recovery`, `${name}: ${sanitizeSyncError(error)}`);
      return fallback;
    }
  };
}
