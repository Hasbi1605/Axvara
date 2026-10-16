import type { D1 } from "./db/types";

// One indexed row, never a COUNT/scan of business data. No D1 writes.
export const D1_AVAILABILITY_SQL = "SELECT key FROM store_settings LIMIT 1";
type Status = { maintenance: boolean; until: number };
type StatusCache = { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<unknown> };
const states = new WeakMap<D1, Status>();
const pending = new WeakMap<D1, Promise<boolean>>();

export function nextD1Reset(now = Date.now()): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

/** Only Cloudflare's daily row quota errors activate this screen. */
export function isD1DailyQuotaError(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let depth = 0; error && depth < 8 && !seen.has(error); depth++) {
    seen.add(error);
    const message = typeof error === "string" ? error
      : typeof error === "object" && "message" in error ? String(error.message) : "";
    if (/exceeded D1['’]s free tier daily row (?:read|write) limit/i.test(message)) return true;
    error = typeof error === "object" && "cause" in error ? error.cause : undefined;
  }
  return false;
}

/** Resolve bindings like the DB client, without importing its seeds/order code. */
export function maintenanceDatabase(): D1 | null {
  const globals = globalThis as unknown as { DB?: D1 };
  const env = process.env as unknown as { DB?: D1 };
  return globals.DB ?? env.DB ?? null;
}

export async function isD1InMaintenance(db: D1 | null, origin: string): Promise<boolean> {
  if (!db) return false; // Local development without D1 keeps its existing seed behavior.
  const now = Date.now();
  const state = states.get(db);
  if (state && state.until > now) return state.maintenance;
  const running = pending.get(db);
  if (running) return running;

  const check = async () => {
    const cache = (globalThis as unknown as { caches?: { default?: StatusCache } }).caches?.default;
    // UTC day in key + bounded local TTL: yesterday's quota never blocks the new day.
    const key = new Request(`${origin}/__service-status/d1-quota-v1/${new Date(now).toISOString().slice(0, 10)}`);
    if (cache) {
      try {
        const cached = await cache.match(key);
        const value = cached && await cached.json() as Status | undefined;
        if (value && typeof value.maintenance === "boolean" && Number.isFinite(value.until)
          && value.until > now && value.until <= Math.min(now + 60_000, nextD1Reset(now))) {
          states.set(db, value);
          return value.maintenance;
        }
      } catch { /* Cache failure must not hide the live D1 status. */ }
    }
    let maintenance = false;
    let ttl = 60;
    try {
      await db.prepare(D1_AVAILABILITY_SQL).first();
    } catch (error) {
      maintenance = isD1DailyQuotaError(error);
      if (!maintenance) ttl = 10; // Other failures keep their original error handling.
    }
    const value = { maintenance, until: Math.min(now + ttl * 1000, nextD1Reset(now)) };
    states.set(db, value);
    if (cache) {
      try {
        await cache.put(key, Response.json(value, { headers: { "Cache-Control": `public, max-age=${Math.max(1, Math.floor((value.until - now) / 1000))}` } }));
      } catch { /* A broken cache must not break the maintenance page. */ }
    }
    return maintenance;
  };
  const promise = check();
  pending.set(db, promise);
  try { return await promise; } finally { pending.delete(db); }
}
