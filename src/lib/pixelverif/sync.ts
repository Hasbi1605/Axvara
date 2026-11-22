import type { DatabaseAccess } from "@/lib/db-access";
import { catalogFailureRecorder, catalogWriteFailure, recordSyncError, recordSyncSuccess } from "@/lib/sync-status";
import { fetchPixelverifPricing, isPixelverifConfigured, isPixelverifSyncEnabled } from "./client";

export const PIXELVERIF_SYNC_KEY = "pixelverif_catalog_sync_at";
export const PIXELVERIF_RETRY_AFTER_KEY = "pixelverif_catalog_retry_until";
export const PIXELVERIF_CATALOG_MIN_INTERVAL_MS = 45_000;

export async function syncPixelverifCatalog(
  db: DatabaseAccess,
  opts: { force?: boolean; now?: number; onFailure?: ReturnType<typeof catalogFailureRecorder> } = {},
) {
  if (!db.d1 || !isPixelverifConfigured() || !isPixelverifSyncEnabled()) {
    return { skipped: "not_configured" } as const;
  }
  const now = opts.now ?? Date.now();
  const fail = opts.onFailure ?? catalogFailureRecorder(db, "pixelverif_catalog", now, PIXELVERIF_CATALOG_MIN_INTERVAL_MS);
  if (!db.canSpend(16)) {
    await recordSyncError(db, "pixelverif_catalog", "catalog_budget_exceeded", now);
    return { ok: false, error: "catalog_budget_exceeded" } as const;
  }

  const settings = await db.queryAll(
    "SELECT key, value FROM store_settings WHERE key IN (?, ?)",
    PIXELVERIF_SYNC_KEY,
    PIXELVERIF_RETRY_AFTER_KEY,
  );
  const prevSync = settings.find((r) => r.key === PIXELVERIF_SYNC_KEY);
  const prevRetry = settings.find((r) => r.key === PIXELVERIF_RETRY_AFTER_KEY);
  const last = Number(prevSync?.value);
  const retryUntil = Number(prevRetry?.value);

  if (!opts.force) {
    if (Number.isFinite(retryUntil) && now < retryUntil && retryUntil - now <= 3_600_000) {
      return { skipped: "throttled" } as const;
    }
    if (prevSync && Number.isFinite(last) && now - last >= 0 && now - last < PIXELVERIF_CATALOG_MIN_INTERVAL_MS) {
      return { skipped: "throttled" } as const;
    }
  }

  const claim = prevSync
    ? await db.execRun(
        "UPDATE store_settings SET value=?, updated_at=datetime('now') WHERE key=? AND value=?",
        String(now),
        PIXELVERIF_SYNC_KEY,
        prevSync.value,
      )
    : await db.execRun(
        "INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO NOTHING",
        PIXELVERIF_SYNC_KEY,
        String(now),
      );
  if (claim.changes !== 1) return { skipped: "claimed_elsewhere" } as const;

  const response = await fetchPixelverifPricing();
  if (response.kind !== "ok") {
    if (response.kind === "ambiguous" && response.retryAfterSeconds != null && db.canSpend(1)) {
      await db.execRun(
        `INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
        PIXELVERIF_RETRY_AFTER_KEY,
        String(now + response.retryAfterSeconds * 1000),
      ).catch(() => undefined);
    }
    const reason = response.kind === "http_error" ? `http_${response.status}` : response.reason;
    return fail(`pricing_${response.kind}:${reason}`, `pricing_${response.kind}`);
  }

  const pricing = response.data;
  if (!pricing.allowed_validities.includes(3)) return fail("invalid_or_empty_catalog");
  const at = new Date(now).toISOString();
  try {
    const rows: { service_key: string; flow_type: string; validity: number; credit_cost: number; available: number; pricing_version: number }[] = [];
    for (const flow of ["normal", "full"] as const) {
      const cost = pricing.pricing[flow]?.["3"];
      const available = pricing.allowed_validities.includes(3) && typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? 1 : 0;
      rows.push({
        service_key: `${flow}_3`,
        flow_type: flow,
        validity: 3,
        credit_cost: typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : 0.01,
        available,
        pricing_version: pricing.version,
      });
    }
    // filter out unavailable from mirror? keep both but mark available flag
    if (!db.canSpend(Math.ceil(rows.length / 50) + (opts.onFailure ? 10 : 11))) {
      return fail("catalog_budget_exceeded");
    }
    for (const r of rows) {
      await db.execRun(
        `INSERT INTO pixelverif_services(service_key, flow_type, validity, credit_cost, available, pricing_version, synced_at, updated_at)
         VALUES(?,?,?,?,?,?,?,datetime('now'))
         ON CONFLICT(service_key) DO UPDATE SET
           flow_type=excluded.flow_type,
           validity=excluded.validity,
           credit_cost=excluded.credit_cost,
           available=excluded.available,
           pricing_version=excluded.pricing_version,
           synced_at=excluded.synced_at,
           updated_at=datetime('now')`,
        r.service_key,
        r.flow_type,
        r.validity,
        r.credit_cost,
        r.available,
        r.pricing_version,
        at,
      );
    }
    if (!opts.onFailure) await recordSyncSuccess(db, "pixelverif_catalog", now);
    return { ok: true, fetched: rows.length } as const;
  } catch (error) {
    return await fail(catalogWriteFailure(error));
  }
}
