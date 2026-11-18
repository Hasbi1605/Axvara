import { getD1, type D1 } from "@/lib/db";
import { unwrapD1, type DatabaseAccess } from "@/lib/db-access";

export type CatalogScope = "market" | "pedia" | "games";

export const REVISION_MEMO_TTL_MS = 5_000;
export const CATALOG_REVISION_KEYS: Record<CatalogScope, string> = {
  market: "catalog_revision_market",
  pedia: "catalog_revision_pedia",
  games: "catalog_revision_games",
};
const ALL_REVISION_KEYS = [
  CATALOG_REVISION_KEYS.market,
  CATALOG_REVISION_KEYS.pedia,
  CATALOG_REVISION_KEYS.games,
] as const;

type EdgeCache = {
  match: (key: Request) => Promise<Response | undefined>;
  put: (key: Request, response: Response) => Promise<void>;
  delete?: (key: Request) => Promise<boolean>;
};

type RevisionEntry = { value: string; fetchedAt: number; expiresAt: number };
type RevisionMemo = Partial<Record<CatalogScope, RevisionEntry>>;

const pending = new WeakMap<EdgeCache, Map<string, Promise<Response>>>();
const memoByD1 = new WeakMap<D1, RevisionMemo>();
const inFlightReadByD1 = new WeakMap<D1, Promise<Record<CatalogScope, string>>>();
const bumpSeqByD1 = new WeakMap<D1, Record<CatalogScope, number>>();
const revCounterByD1 = new WeakMap<object, number>();
const recentUrlsByScope = new Map<CatalogScope, Set<string>>();

const NO_D1_KEY = {};
const STORED_AT = "X-Axvara-Cache-Stored-At";
const ORIGIN_CACHE_CONTROL = "X-Axvara-Origin-Cache-Control";
const MAX_RECENT_URLS_PER_SCOPE = 32;

function inferScope(key: string): CatalogScope {
  if (key.startsWith("pedia")) return "pedia";
  if (key.startsWith("games")) return "games";
  return "market";
}

function logScopeFor(key: string, scope: CatalogScope): string {
  if (key.startsWith("telegram")) return "telegram_catalog";
  if (key.startsWith("categories")) return "categories";
  if (scope === "pedia") return "pedia_catalog";
  if (scope === "games") return "games_catalog";
  return "market_catalog";
}

function resolveD1(database?: D1 | DatabaseAccess | null): D1 | null {
  let raw: D1 | null;
  if (database === undefined) raw = getD1();
  else if (database && typeof (database as DatabaseAccess).getD1 === "function") {
    raw = (database as DatabaseAccess).getD1();
  } else {
    raw = database as D1 | null;
  }
  const d1 = unwrapD1(raw);
  if (!d1 || typeof d1 !== "object" || typeof d1.prepare !== "function") return null;
  return d1;
}

function getBumpSeq(d1: D1): Record<CatalogScope, number> {
  let seq = bumpSeqByD1.get(d1);
  if (!seq) {
    seq = { market: 0, pedia: 0, games: 0 };
    bumpSeqByD1.set(d1, seq);
  }
  return seq;
}

function recordRecentUrl(scope: CatalogScope, url: string): void {
  let set = recentUrlsByScope.get(scope);
  if (!set) {
    set = new Set<string>();
    recentUrlsByScope.set(scope, set);
  }
  if (set.has(url)) {
    set.delete(url);
  } else if (set.size >= MAX_RECENT_URLS_PER_SCOPE) {
    const oldest = set.values().next().value;
    if (oldest) set.delete(oldest);
  }
  set.add(url);
}

function evictLocalCacheForScope(scope: CatalogScope): void {
  const cache = (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default;
  if (!cache || typeof cache.delete !== "function") return;
  const urls = recentUrlsByScope.get(scope);
  if (!urls || urls.size === 0) return;
  const toDelete = [...urls];
  urls.clear();
  for (const url of toDelete) {
    try {
      void cache.delete(new Request(url)).catch(() => false);
    } catch { /* best-effort */ }
  }
}

export function generateCatalogRevision(database?: D1 | DatabaseAccess | null): string {
  const d1 = resolveD1(database);
  const counterKey = d1 ?? NO_D1_KEY;
  const nextSeq = (revCounterByD1.get(counterKey) ?? 0) + 1;
  revCounterByD1.set(counterKey, nextSeq);
  return `${Date.now().toString(36)}-${nextSeq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function noteCatalogRevisionUpdated(
  scope: CatalogScope,
  revision: string,
  database?: D1 | DatabaseAccess | null,
): void {
  const d1 = resolveD1(database);
  if (d1) {
    const seq = getBumpSeq(d1);
    seq[scope] += 1;
    const now = Date.now();
    const memo = memoByD1.get(d1) ?? {};
    memo[scope] = { value: revision, fetchedAt: now, expiresAt: now + REVISION_MEMO_TTL_MS };
    memoByD1.set(d1, memo);
  }
  evictLocalCacheForScope(scope);
}

/** Read the current catalog revision for a scope, memoized for 5s per isolate. */
export async function getCatalogRevision(
  scope: CatalogScope,
  database?: D1 | DatabaseAccess | null,
): Promise<string> {
  const d1 = resolveD1(database);
  if (!d1) return "0";
  const now = Date.now();
  const memo = memoByD1.get(d1);
  const existing = memo?.[scope];
  if (existing && now >= existing.fetchedAt && now < existing.expiresAt) {
    return existing.value;
  }

  let flight = inFlightReadByD1.get(d1);
  if (!flight) {
    const seqSnapshot = { ...getBumpSeq(d1) };
    flight = (async () => {
      const defaults: Record<CatalogScope, string> = { market: "0", pedia: "0", games: "0" };
      try {
        const res = await d1.prepare(
          `SELECT key, value FROM store_settings WHERE key IN (?,?,?)`,
        ).bind(...ALL_REVISION_KEYS).all();
        const rows = (res?.results ?? []) as { key?: unknown; value?: unknown }[];
        for (const row of rows) {
          const k = String(row.key ?? "");
          const v = String(row.value ?? "").trim() || "0";
          if (k === CATALOG_REVISION_KEYS.market) defaults.market = v;
          else if (k === CATALOG_REVISION_KEYS.pedia) defaults.pedia = v;
          else if (k === CATALOG_REVISION_KEYS.games) defaults.games = v;
        }
        const loadedAt = Date.now();
        const nextMemo = memoByD1.get(d1) ?? {};
        const currentSeq = getBumpSeq(d1);
        for (const s of ["market", "pedia", "games"] as const) {
          if (currentSeq[s] === seqSnapshot[s]) {
            nextMemo[s] = { value: defaults[s], fetchedAt: loadedAt, expiresAt: loadedAt + REVISION_MEMO_TTL_MS };
          } else if (nextMemo[s]) {
            defaults[s] = nextMemo[s]!.value;
          }
        }
        memoByD1.set(d1, nextMemo);
      } catch {
        /* Missing table or transient D1 failure falls back to "0" without poisoning memo. */
      }
      return defaults;
    })();
    inFlightReadByD1.set(d1, flight);
    try {
      const resolved = await flight;
      return resolved[scope];
    } finally {
      if (inFlightReadByD1.get(d1) === flight) inFlightReadByD1.delete(d1);
    }
  }

  const resolved = await flight;
  return resolved[scope];
}

/** Bump catalog revision once after a committed mutation (best-effort, <=1 D1 write). */
export async function bumpCatalogRevision(
  scope: CatalogScope,
  database?: D1 | DatabaseAccess | null,
  options?: { metered?: boolean },
): Promise<string | null> {
  const d1 = resolveD1(database);
  const nextRev = generateCatalogRevision(d1);
  if (!d1) {
    evictLocalCacheForScope(scope);
    return null;
  }
  const sql = `INSERT INTO store_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
  try {
    if (options?.metered && database && typeof (database as DatabaseAccess).execRun === "function") {
      await (database as DatabaseAccess).execRun(sql, CATALOG_REVISION_KEYS[scope], nextRev);
    } else {
      await d1.prepare(sql).bind(CATALOG_REVISION_KEYS[scope], nextRev).run();
    }
    noteCatalogRevisionUpdated(scope, nextRev, d1);
    return nextRev;
  } catch {
    evictLocalCacheForScope(scope);
    return null;
  }
}

function result(response: Response, status: "HIT" | "MISS" | "BYPASS"): Response {
  const copy = response.clone();
  const headers = new Headers(copy.headers);
  const stored = Number(headers.get(STORED_AT));
  if (stored > 0) headers.set("Age", String(Math.max(0, Math.floor((Date.now() - stored) / 1000))));
  headers.delete(STORED_AT);
  const originCacheControl = headers.get(ORIGIN_CACHE_CONTROL);
  if (status === "HIT" && originCacheControl) {
    headers.set("Cache-Control", originCacheControl);
  }
  headers.delete(ORIGIN_CACHE_CONTROL);
  headers.set("X-Axvara-Cache", status);
  return new Response(copy.body, { status: copy.status, statusText: copy.statusText, headers });
}

/** Public catalog responses only. Used inside the handler, so SSR direct calls
 * share the same cache as HTTP. Checkout, auth and order state never use this.
 * No in-memory data fallback: absent/failing Cache API always reads fresh data. */
export async function cachePublicCatalog(
  key: string,
  ttl: number,
  load: () => Promise<Response> | Response,
  scope?: CatalogScope,
): Promise<Response> {
  const resolvedScope = scope ?? inferScope(key);
  const logScope = logScopeFor(key, resolvedScope);
  const report = (response: Response, status: "HIT" | "MISS" | "BYPASS") => {
    try { console.info("[catalog-cache]", JSON.stringify({ scope: logScope, status })); } catch { /* telemetry is best-effort */ }
    return result(response, status);
  };
  const cache = (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default;
  if (!cache || !getD1()) return report(await load(), "BYPASS");
  const revision = await getCatalogRevision(resolvedScope);
  const request = new Request(`https://axvara.tech/__catalog-cache/d1-v2/${resolvedScope}/${encodeURIComponent(revision)}/${key}`);
  try {
    const hit = await cache.match(request);
    if (hit) return report(hit, "HIT");
  } catch { return report(await load(), "BYPASS"); }

  let flights = pending.get(cache);
  if (!flights) { flights = new Map(); pending.set(cache, flights); }
  const existing = flights.get(request.url);
  if (existing) return report(await existing, "MISS");
  const fill = (async () => {
    const response = await load();
    // Never preserve a failed/degraded load, a cookie or a private response.
    if (response.status === 200 && !response.headers.has("set-cookie")
        && !/private|no-store/i.test(response.headers.get("cache-control") ?? "")) {
      const stored = response.clone();
      const headers = new Headers(stored.headers);
      const originCacheControl = headers.get("cache-control");
      if (originCacheControl) headers.set(ORIGIN_CACHE_CONTROL, originCacheControl);
      headers.set("Cache-Control", `public, max-age=${ttl}`);
      headers.set(STORED_AT, String(Date.now()));
      try {
        await cache.put(request, new Response(stored.body, { status: 200, headers }));
        recordRecentUrl(resolvedScope, request.url);
      } catch { /* Cache availability must not affect catalog availability. */ }
    }
    return response;
  })();
  // Bound pending keys during bursts with many distinct searches.
  if (flights.size < 128) flights.set(request.url, fill);
  try { return report(await fill, "MISS"); }
  finally { if (flights.get(request.url) === fill) flights.delete(request.url); }
}
