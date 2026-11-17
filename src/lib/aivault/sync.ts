import type { DatabaseAccess } from "@/lib/db-access";
import { recordSyncError, recordSyncSuccess } from "@/lib/sync-status";
import { fetchAivaultProducts, isAivaultConfigured, isAivaultSyncEnabled, parseAivaultProducts } from "./client";
export const AIVAULT_SYNC_KEY = "aivault_catalog_sync_at";
export const AIVAULT_CATALOG_MIN_INTERVAL_MS = 45_000;
export async function syncAivaultCatalog(db: DatabaseAccess, opts: { force?: boolean; now?: number; skipSuccessMark?: boolean } = {}) {
  if (!db.d1 || !isAivaultConfigured() || !isAivaultSyncEnabled()) return { skipped: "not_configured" } as const;
  const now = opts.now ?? Date.now();
  const fail = async <T extends string>(error: T) => {
    await recordSyncError(db, "aivault_catalog", error, now);
    return { ok: false, error } as const;
  };
  if (!db.canSpend(16)) return fail("catalog_budget_exceeded");
  const prev = await db.queryFirst("SELECT value FROM store_settings WHERE key=?", AIVAULT_SYNC_KEY);
  const last = Number(prev?.value);
  if (!opts.force && prev && Number.isFinite(last) && now-last >= 0 && now-last < AIVAULT_CATALOG_MIN_INTERVAL_MS) return { skipped: "throttled" } as const;
  const claim = prev
    ? await db.execRun("UPDATE store_settings SET value=?, updated_at=datetime('now') WHERE key=? AND value=?", String(now), AIVAULT_SYNC_KEY, prev.value)
    : await db.execRun("INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO NOTHING", AIVAULT_SYNC_KEY, String(now));
  if (claim.changes !== 1) return { skipped: "claimed_elsewhere" } as const;
  const response = await fetchAivaultProducts();
  if (response.kind !== "ok") return fail(`products_${response.kind}`);
  const items = parseAivaultProducts(response.json);
  if (!items?.length) return fail("invalid_or_empty_catalog");
  if (!db.canSpend(Math.ceil(items.length / 50) + (opts.skipSuccessMark ? 10 : 11))) return fail("catalog_budget_exceeded");
  const at = new Date(now).toISOString();
  try {
    for (let i=0; i<items.length; i+=50) {
      await db.execRun(`INSERT INTO aivault_products(service_id,name,stock,unit_price_usd,pricing_tiers_json,custom_pricing,synced_at)
        SELECT json_extract(value,'$.service_id'),json_extract(value,'$.name'),json_extract(value,'$.stock'),json_extract(value,'$.unit_price_usd'),json_extract(value,'$.pricing_tiers'),json_extract(value,'$.custom_pricing'),?
        FROM json_each(?) WHERE true ON CONFLICT(service_id) DO UPDATE SET name=excluded.name,stock=excluded.stock,unit_price_usd=excluded.unit_price_usd,
        pricing_tiers_json=excluded.pricing_tiers_json,custom_pricing=excluded.custom_pricing,synced_at=excluded.synced_at,updated_at=datetime('now')`, at, JSON.stringify(items.slice(i,i+50)));
    }
    await db.execRun("UPDATE aivault_products SET stock=0 WHERE synced_at IS NOT NULL AND synced_at<>?", at);
    if (!opts.skipSuccessMark) await recordSyncSuccess(db, "aivault_catalog", now);
    return { ok: true, fetched: items.length } as const;
  } catch (error) {
    await recordSyncError(db, "aivault_catalog", error, now);
    throw error;
  }
}
