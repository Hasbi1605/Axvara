// src/lib/expiry.ts — Canonical expiry semantics shared by every TTL path.
//
// Writers persist `expires_at` as ISO-8601 UTC (`toISOString()`), while
// older rows may hold legacy space-separated `YYYY-MM-DD HH:MM:SS` values.
// Legacy timestamps without an offset are UTC, just like D1 datetime('now').
// Normalize them before Date.parse so every cron/webhook/session check goes
// through these helpers instead of raw SQL string comparison
// (`expires_at < datetime('now')`), which can never match an ISO value
// because 'T' (0x54) sorts after ' ' (0x20).

export function parseExpiry(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  const utc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(text)
    ? `${text.replace(" ", "T")}Z` : text;
  const parsed = Date.parse(utc);
  return Number.isFinite(parsed) ? parsed : null;
}

/** True when an expiry timestamp exists and is at or past `now`. */
export function isExpiredIso(value: unknown, now = Date.now()): boolean {
  const parsed = parseExpiry(value);
  return parsed !== null && parsed <= now;
}

/** True when there is no expiry or it is still in the future. */
export function isFutureIso(value: unknown, now = Date.now()): boolean {
  const parsed = parseExpiry(value);
  return parsed === null || parsed > now;
}
