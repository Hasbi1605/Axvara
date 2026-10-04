// Status diff katalog VPS → Pages untuk kartu admin "Sync terakhir"
// (2026-10-04). Kiriman diff tidak masuk *_sync_log; penandanya disimpan di
// `wr_sync_state` / `sk_sync_state` oleh syncProducts/syncSkProducts mode
// applyOnly. Aman bila tabel/key belum ada (mengembalikan null).

import type { DatabaseAccess } from "@/lib/db-access";

export const DIFF_FRESH_MS = 10 * 60 * 1000;

export interface DiffStatus {
  last_at: string | null;
  healthy: boolean;
  last_change_at: string | null;
  last_change: { products?: number; variants?: number; stock?: number; price?: number; removed?: number; status?: string } | null;
  last_error: { at?: string; error?: string } | null;
  full_sweep_at: string | null;
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== "string" || !value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

export async function readDiffStatus(
  queryAll: DatabaseAccess["queryAll"],
  table: "wr_sync_state" | "sk_sync_state",
  now = Date.now(),
): Promise<DiffStatus> {
  const rows = await queryAll(
    `SELECT key, value FROM ${table}
     WHERE key IN ('diff_last_at','diff_last_change_at','diff_last_change','diff_last_error','products_full_sweep_at')`,
  ).catch(() => [] as Record<string, unknown>[]);
  const get = (k: string) => {
    const v = rows.find((r) => r.key === k)?.value;
    return typeof v === "string" && v ? v : null;
  };
  const lastAt = get("diff_last_at");
  const lastTs = lastAt ? Date.parse(lastAt) : NaN;
  return {
    last_at: lastAt,
    healthy: Number.isFinite(lastTs) && now - lastTs < DIFF_FRESH_MS,
    last_change_at: get("diff_last_change_at"),
    last_change: parseJson(get("diff_last_change")),
    last_error: parseJson(get("diff_last_error")),
    full_sweep_at: get("products_full_sweep_at"),
  };
}
