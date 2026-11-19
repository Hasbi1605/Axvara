import type { DatabaseAccess } from "@/lib/db-access";

export const SYNC_ERROR_MAX_LEN = 200;

const SECRET_ENV_KEYS = [
  "TUNVN_API_KEY",
  "AIVAULT_API_KEY",
  "STOREBAT_API_KEY",
  "MIRAI_API_KEY",
  "SEKALIPAY_API_KEY",
  "WARUNG_REBAHAN_API_KEY",
  "WARUNG_REBAHAN_PROXY_TOKEN",
  "DIGIFLAZZ_API_KEY",
  "DIGIFLAZZ_USERNAME",
  "NOWPAYMENTS_API_KEY",
  "NOWPAYMENTS_IPN_SECRET",
  "SEKALIPAY_GATEWAY_API_KEY",
  "SEKALIPAY_GATEWAY_SECRET_KEY",
  "TELEGRAM_BOT_TOKEN",
  "CRON_SECRET",
  "SUPPLIER_SYNC_TOKEN",
] as const;

/** Sanitize an error message for durable storage (no secrets, single line, <= 200 chars). */
export function sanitizeSyncError(raw: unknown): string {
  let text = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : String(raw ?? "failed");
  text = text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) text = "failed";

  text = text
    .replace(/(https?:\/\/)[^/\s:@]+:[^@\s]+@/gi, "$1[redacted]@")
    .replace(/\b(bearer\s+)[a-z0-9._\-+/=]{4,}/gi, "$1[redacted]")
    .replace(/([?&](?:api_?key|token|secret|key|sign|signature|password)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/((?:x-api-key|x-reseller-key|x-proxy-token|x-supplier-sync-token|authorization)\s*[:=]\s*)\S+/gi, "$1[redacted]");

  for (const envKey of SECRET_ENV_KEYS) {
    const val = (process.env[envKey] ?? "").trim();
    if (val.length >= 6 && text.includes(val)) {
      text = text.split(val).join("[redacted]");
    }
  }

  return text.slice(0, SYNC_ERROR_MAX_LEN);
}

/** Record full sync/publish completion (ms epoch) and clear any prior error in one statement. */
export async function recordSyncSuccess(
  db: DatabaseAccess,
  prefix: string,
  now = Date.now(),
): Promise<void> {
  await db.execRun(
    `INSERT INTO store_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now')), (?, '', datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
    `${prefix}_success_at`,
    String(now),
    `${prefix}_last_error`,
  );
}

/** Record a sanitized sync error and its timestamp without exceeding remaining budget. */
export async function recordSyncError(
  db: DatabaseAccess,
  prefix: string,
  error: unknown,
  now = Date.now(),
): Promise<void> {
  if (!db.canSpend(1)) return;
  const payload = JSON.stringify({
    at: new Date(now).toISOString(),
    error: sanitizeSyncError(error),
  });
  try {
    await db.execRun(
      `INSERT INTO store_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
      `${prefix}_last_error`,
      payload,
    );
  } catch {
    // Best-effort error recording; never mask the original sync outcome.
  }
}

/** Keep the in-flight 45s claim, but allow retry 10s after failure.
 * Store the error and shorten only this attempt's claim in one statement. */
export function catalogFailureRecorder(
  db: DatabaseAccess,
  prefix: string,
  now: number,
  minInterval: number,
  lease?: { key: string; value: string },
) {
  const started = Date.now();
  const syncKey = `${prefix}_sync_at`;
  return async (error: string, responseError = error) => {
    if (db.canSpend(lease ? 2 : 1)) {
      const at = now + Math.max(0, Date.now() - started);
      // Keep the checkpoint numeric for existing readers, including older code.
      const retryCheckpoint = at + 10_000 - minInterval;
      await db.execRun(
        `INSERT INTO store_settings(key,value,updated_at)
         SELECT j.value->>0,j.value->>1,datetime('now') FROM json_each(?) j
         WHERE (? IS NULL OR EXISTS(SELECT 1 FROM store_settings WHERE key=? AND value=?))
           AND (j.key=0 OR EXISTS(SELECT 1 FROM store_settings WHERE key=? AND value=?))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
        JSON.stringify([
          [`${prefix}_last_error`, JSON.stringify({ at: new Date(at).toISOString(), error: sanitizeSyncError(error) })],
          [syncKey, String(retryCheckpoint)],
        ]),
        lease?.key ?? null, lease?.key ?? null, lease?.value ?? null, syncKey, String(now),
      ).catch(() => undefined);
    }
    return { ok: false, error: sanitizeSyncError(responseError) } as const;
  };
}

/** Report useful D1 failure classes without persisting SQL, bound values or response text. */
export function catalogWriteFailure(error: unknown): string {
  const text = sanitizeSyncError(error);
  const reasons = [
    [/Local query budget exhausted/i, "query_budget"],
    [/CHECK constraint failed:\s*valid\s*=\s*1/i, "operation_guard"],
    [/(?:UNIQUE|NOT NULL|CHECK|FOREIGN KEY) constraint failed/i, "constraint"],
    [/SQLITE_BUSY|database is locked|\boverloaded\b/i, "database_busy"],
    [/no such (?:table|column|index)/i, "schema_mismatch"],
    [/time[ -]?out|deadline exceeded/i, "timeout"],
    [/network|transport|connection/i, "transport"],
  ] as const;
  return `catalog_write_failed:${reasons.find(([pattern]) => pattern.test(text))?.[1] ?? "unexpected"}`;
}

/** Parse a stored error JSON `{ at, error }` or plain error string safely. */
export function parseStoredSyncError(raw: unknown): { at: string | null; error: string } | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as { at?: unknown; error?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed.error === "string" && parsed.error.trim()) {
      return {
        at: typeof parsed.at === "string" ? parsed.at : null,
        error: sanitizeSyncError(parsed.error),
      };
    }
  } catch {
    return { at: null, error: sanitizeSyncError(trimmed) };
  }
  return null;
}

/** Read the last success and error together; only use the legacy timestamp when no error is recorded. */
export async function readSyncStatusSettings(
  db: DatabaseAccess,
  prefix: string,
  legacySyncKey: string,
) {
  const rows = await db.queryAll(
    `SELECT key, value FROM store_settings WHERE key IN (?, ?, ?)`,
    `${prefix}_success_at`,
    legacySyncKey,
    `${prefix}_last_error`,
  );
  const get = (k: string) => {
    const v = rows.find((r) => r.key === k)?.value;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const successAt = get(`${prefix}_success_at`);
  const error = get(`${prefix}_last_error`);
  return { lastSyncAt: successAt ?? (error ? null : get(legacySyncKey)), lastError: parseStoredSyncError(error) };
}

export async function readSyncTimestampSetting(db: DatabaseAccess, prefix: string, legacySyncKey: string): Promise<string | null> {
  return (await readSyncStatusSettings(db, prefix, legacySyncKey)).lastSyncAt;
}
