import { getD1 } from "@/lib/db";

type EdgeCache = {
  match: (key: Request) => Promise<Response | undefined>;
  put: (key: Request, response: Response) => Promise<void>;
};
const pending = new WeakMap<EdgeCache, Map<string, Promise<Response>>>();
const STORED_AT = "X-Axvara-Cache-Stored-At";

function result(response: Response, status: "HIT" | "MISS" | "BYPASS"): Response {
  const copy = response.clone();
  const headers = new Headers(copy.headers);
  const stored = Number(headers.get(STORED_AT));
  if (stored > 0) headers.set("Age", String(Math.max(0, Math.floor((Date.now() - stored) / 1000))));
  headers.delete(STORED_AT);
  headers.set("X-Axvara-Cache", status);
  return new Response(copy.body, { status: copy.status, statusText: copy.statusText, headers });
}

/** Public catalog responses only. Used inside the handler, so SSR direct calls
 * share the same cache as HTTP. Checkout, auth and order state never use this.
 * No in-memory data fallback: absent/failing Cache API always reads fresh data. */
export async function cachePublicCatalog(key: string, ttl: number, load: () => Promise<Response> | Response): Promise<Response> {
  const scope = key.startsWith("telegram") ? "telegram_catalog" : key.startsWith("market") ? "market_catalog"
    : key.startsWith("pedia") ? "pedia_catalog" : "categories";
  const report = (response: Response, status: "HIT" | "MISS" | "BYPASS") => {
    try { console.info("[catalog-cache]", JSON.stringify({ scope, status })); } catch { /* telemetry is best-effort */ }
    return result(response, status);
  };
  const cache = (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default;
  if (!cache || !getD1()) return report(await load(), "BYPASS");
  const request = new Request(`https://axvara.tech/__catalog-cache/d1-v1/${key}`);
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
      headers.set("Cache-Control", `public, max-age=${ttl}`);
      headers.set(STORED_AT, String(Date.now()));
      try { await cache.put(request, new Response(stored.body, { status: 200, headers })); }
      catch { /* Cache availability must not affect catalog availability. */ }
    }
    return response;
  })();
  // Bound pending keys during bursts with many distinct searches.
  if (flights.size < 128) flights.set(request.url, fill);
  try { return report(await fill, "MISS"); }
  finally { if (flights.get(request.url) === fill) flights.delete(request.url); }
}
