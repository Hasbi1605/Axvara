import type { DatabaseAccess } from "@/lib/db-access";
import { catalogFailureRecorder, catalogWriteFailure, recordSyncError, recordSyncSuccess } from "@/lib/sync-status";
import { fetchPixelverifPricing, isPixelverifConfigured, isPixelverifSyncEnabled } from "./client";
import { PIXELVERIF_VARIANTS } from "./families";

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
  const disabled = new Set(pricing.disabled_plans);
  const plans = PIXELVERIF_VARIANTS.map((spec) => {
    const cost = pricing.pricing[spec.flow_type]?.[String(spec.validity)];
    const explicitlyDisabled = disabled.has(`${spec.flow_type}:${spec.validity}`);
    const available = pricing.allowed_validities.includes(spec.validity) && !explicitlyDisabled && Number.isFinite(cost) && cost > 0;
    return { spec, cost, explicitlyDisabled, available };
  });
  // A priced plan of another duration is valid feed data, not a failed sync.
  // An empty feed is only authoritative when every local plan is explicitly disabled.
  const hasPublishedPrice = plans.some(({ spec }) => pricing.allowed_validities.some((validity) => {
    const cost = pricing.pricing[spec.flow_type]?.[String(validity)];
    return Number.isFinite(cost) && cost > 0;
  }));
  if (!hasPublishedPrice && !plans.every((plan) => plan.explicitlyDisabled)) return fail("invalid_or_empty_catalog");
  const at = new Date(now).toISOString();
  try {
    if (!db.canSpend(plans.length + (opts.onFailure ? 11 : 1))) {
      return fail("catalog_budget_exceeded");
    }
    for (const { spec, cost, available } of plans) {
      if (!available) {
        // Retain the last real cost, and do not create unpriced services.
        await db.execRun(
          `UPDATE pixelverif_services SET available=0, pricing_version=?, synced_at=?, updated_at=datetime('now') WHERE service_key=?`,
          pricing.version,
          at,
          spec.service_key,
        );
        continue;
      }
      await db.execRun(
        `INSERT INTO pixelverif_services(service_key, flow_type, validity, credit_cost, available, pricing_version, synced_at, updated_at)
         VALUES(?,?,?,?,1,?,?,datetime('now'))
         ON CONFLICT(service_key) DO UPDATE SET
           credit_cost=excluded.credit_cost,
           available=excluded.available,
           pricing_version=excluded.pricing_version,
           synced_at=excluded.synced_at,
           updated_at=datetime('now')`,
        spec.service_key,
        spec.flow_type,
        spec.validity,
        cost,
        pricing.version,
        at,
      );
    }
    if (!opts.onFailure) await recordSyncSuccess(db, "pixelverif_catalog", now);
    return { ok: true, fetched: plans.filter((plan) => plan.available).length } as const;
  } catch (error) {
    return await fail(catalogWriteFailure(error));
  }
}
