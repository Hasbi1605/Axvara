// sync/state.ts - sweep state, catalog validation, sync log (3D-5, class E: pure move).
import type { DatabaseAccess } from "@/lib/db-access";
import type { SyncResult } from "./types";

/** Baca state sync durable (cursor/generation). Aman bila tabel belum ada. */
export async function readSyncState(
  db: DatabaseAccess,
): Promise<{ cursor: number; generation: string; snapshotComplete: boolean }> {
  const out = { cursor: 0, generation: "", snapshotComplete: false };
  try {
    const rows = await db.queryAll(`SELECT key, value FROM wr_sync_state`);
    for (const row of rows) {
      const key = String(row.key || "");
      if (key === "products_cursor") out.cursor = Math.max(0, Number(row.value || 0));
      else if (key === "products_generation") out.generation = String(row.value || "");
      else if (key === "products_snapshot_complete") out.snapshotComplete = String(row.value) === "1";
    }
  } catch {
    /* DB pre-0029: mulai dari awal */
  }
  return out;
}

export async function writeSyncState(db: DatabaseAccess, key: string, value: string): Promise<void> {
  try {
    await db.execRun(
      `INSERT INTO wr_sync_state (key, value, updated_at) VALUES (?,?,datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
       WHERE wr_sync_state.value IS NOT excluded.value`,
      key,
      value,
    );
  } catch {
    /* DB pre-0029: cursor best-effort */
  }
}

/**
 * Validasi respons katalog upstream (P0-4): tolak data mencurigakan SEBELUM
 * menyentuh stok lokal.
 * - bukan array / null / object → malformed (jangan zero apa pun).
 * - array kosong padahal generasi sebelumnya punya produk → suspicious
 *   (upstream error / akun kena suspend) — JANGAN zero seluruh katalog.
 * Mengembalikan { ok, reason } — reason null bila aman diproses.
 */
export function validateCatalogResponse(
  products: unknown,
  previousGeneration: string,
  previousCount: number,
): { ok: boolean; reason: string | null } {
  if (!Array.isArray(products)) return { ok: false, reason: "catalog_malformed_not_array" };
  if (products.length === 0 && previousCount > 0) {
    return { ok: false, reason: "catalog_suspicious_empty" };
  }
  return { ok: true, reason: null };
}


export async function logSync(
  result: SyncResult & { status: "success" | "partial" | "failed" },
  db: DatabaseAccess,
  trigger: "manual" | "cron" = "manual",
): Promise<void> {
  await db.execRun(
    `INSERT INTO wr_sync_log
      (sync_type, status, products_total, products_synced, products_excluded,
        products_new, variants_synced, stock_changes, price_changes,
        error_message, duration_ms, trigger)
      VALUES ('products',?,?,?,?,?,?,?,?,?,?,?)`,
    result.status,
    result.total,
    result.synced,
    result.excluded,
    result.newProducts,
    result.variantsSynced,
    result.stockChanges,
    result.priceChanges,
    result.errors.length ? result.errors.slice(0, 5).join(" | ").slice(0, 1000) : null,
    result.durationMs,
    trigger,
  );
}
