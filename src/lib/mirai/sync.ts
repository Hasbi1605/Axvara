import type { DatabaseAccess } from "@/lib/db-access";
import { recordSyncError, recordSyncSuccess } from "@/lib/sync-status";
import { fetchMiraiPackages, isMiraiConfigured, isMiraiSyncEnabled } from "./client";
import { miraiCostUsdtFromVnd } from "./pricing";

export const MIRAI_SYNC_KEY = "mirai_catalog_sync_at";
export const MIRAI_RETRY_AFTER_KEY = "mirai_catalog_retry_until";
export const MIRAI_CATALOG_MIN_INTERVAL_MS = 45_000;

export async function syncMiraiCatalog(
  db: DatabaseAccess,
  opts: { force?: boolean; now?: number; skipSuccessMark?: boolean } = {},
) {
  if (!db.d1 || !isMiraiConfigured() || !isMiraiSyncEnabled()) {
    return { skipped: "not_configured" } as const;
  }
  const now = opts.now ?? Date.now();
  const fail = async <T extends string>(error: T) => {
    await recordSyncError(db, "mirai_catalog", error, now);
    return { ok: false, error } as const;
  };
  if (!db.canSpend(16)) return fail("catalog_budget_exceeded");

  const settings = await db.queryAll(
    "SELECT key, value FROM store_settings WHERE key IN (?, ?)",
    MIRAI_SYNC_KEY,
    MIRAI_RETRY_AFTER_KEY,
  );
  const prevSync = settings.find((r) => r.key === MIRAI_SYNC_KEY);
  const prevRetry = settings.find((r) => r.key === MIRAI_RETRY_AFTER_KEY);
  const last = Number(prevSync?.value);
  const retryUntil = Number(prevRetry?.value);

  if (!opts.force) {
    if (Number.isFinite(retryUntil) && now < retryUntil && retryUntil - now <= 3_600_000) {
      return { skipped: "throttled" } as const;
    }
    if (prevSync && Number.isFinite(last) && now - last >= 0 && now - last < MIRAI_CATALOG_MIN_INTERVAL_MS) {
      return { skipped: "throttled" } as const;
    }
  }

  const claim = prevSync
    ? await db.execRun(
        "UPDATE store_settings SET value=?, updated_at=datetime('now') WHERE key=? AND value=?",
        String(now),
        MIRAI_SYNC_KEY,
        prevSync.value,
      )
    : await db.execRun(
        "INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO NOTHING",
        MIRAI_SYNC_KEY,
        String(now),
      );
  if (claim.changes !== 1) return { skipped: "claimed_elsewhere" } as const;

  const response = await fetchMiraiPackages();
  if (response.kind !== "ok") {
    if (response.kind === "ambiguous" && response.retryAfterSeconds != null && db.canSpend(1)) {
      await db.execRun(
        `INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
        MIRAI_RETRY_AFTER_KEY,
        String(now + response.retryAfterSeconds * 1000),
      ).catch(() => undefined);
    }
    return fail(`packages_${response.kind}`);
  }

  const items = response.data;
  if (!items.length) return fail("invalid_or_empty_catalog");
  if (!db.canSpend(Math.ceil(items.length / 50) + (opts.skipSuccessMark ? 10 : 11))) {
    return fail("catalog_budget_exceeded");
  }

  const at = new Date(now).toISOString();
  try {
    const mirrorRows = items.map((item) => ({
      package_code: item.code,
      group_key: item.group,
      name: item.name,
      quota_tokens: item.quota_tokens,
      duration_seconds: item.duration_seconds,
      reseller_price_vnd: item.reseller_price_vnd,
      cost_usdt: miraiCostUsdtFromVnd(item.reseller_price_vnd),
      min_quantity: item.min_quantity,
      max_quantity: item.max_quantity,
      preset_quantities_json: JSON.stringify(item.preset_quantities),
      models_json: JSON.stringify(item.models),
      unlimited: item.unlimited ? 1 : 0,
      remaining_today: item.remaining_today,
    }));

    for (let i = 0; i < mirrorRows.length; i += 50) {
      await db.execRun(
        `INSERT INTO mirai_packages(
           package_code, group_key, name, quota_tokens, duration_seconds,
           reseller_price_vnd, cost_usdt, min_quantity, max_quantity,
           preset_quantities_json, models_json, unlimited, remaining_today,
           is_active, last_seen_at, synced_at
         )
         SELECT
           json_extract(value,'$.package_code'),
           json_extract(value,'$.group_key'),
           json_extract(value,'$.name'),
           json_extract(value,'$.quota_tokens'),
           json_extract(value,'$.duration_seconds'),
           json_extract(value,'$.reseller_price_vnd'),
           json_extract(value,'$.cost_usdt'),
           json_extract(value,'$.min_quantity'),
           json_extract(value,'$.max_quantity'),
           json_extract(value,'$.preset_quantities_json'),
           json_extract(value,'$.models_json'),
           json_extract(value,'$.unlimited'),
           json_extract(value,'$.remaining_today'),
           1, ?, ?
         FROM json_each(?) WHERE true
         ON CONFLICT(package_code) DO UPDATE SET
           group_key=excluded.group_key,
           name=excluded.name,
           quota_tokens=excluded.quota_tokens,
           duration_seconds=excluded.duration_seconds,
           reseller_price_vnd=excluded.reseller_price_vnd,
           cost_usdt=excluded.cost_usdt,
           min_quantity=excluded.min_quantity,
           max_quantity=excluded.max_quantity,
           preset_quantities_json=excluded.preset_quantities_json,
           models_json=excluded.models_json,
           unlimited=excluded.unlimited,
           remaining_today=excluded.remaining_today,
           is_active=1,
           last_seen_at=excluded.last_seen_at,
           synced_at=excluded.synced_at,
           updated_at=datetime('now')`,
        at,
        at,
        JSON.stringify(mirrorRows.slice(i, i + 50)),
      );
    }

    await db.execRun(
      "UPDATE mirai_packages SET is_active=0, unlimited=0, remaining_today=0, updated_at=datetime('now') WHERE synced_at IS NOT NULL AND synced_at<>?",
      at,
    );

    if (!opts.skipSuccessMark) await recordSyncSuccess(db, "mirai_catalog", now);
    return { ok: true, fetched: items.length } as const;
  } catch (error) {
    await recordSyncError(db, "mirai_catalog", error, now);
    throw error;
  }
}
