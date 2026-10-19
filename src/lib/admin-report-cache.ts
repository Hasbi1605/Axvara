// Internal Cache API entries are encrypted and never returned as HTTP responses.
// Callers must authenticate and check revocation BEFORE reaching this helper.
export const FINANCIAL_SNAPSHOT_TTL_MS = 5 * 60_000;
type EdgeCache = { match(key: Request): Promise<Response | undefined>; put(key: Request, value: Response): Promise<void> };

export async function readPrivateFinancialSnapshot<T extends { generatedAt: string }>(scope: string, load: () => Promise<T>): Promise<T> {
  const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
  const cacheStorage = (globalThis as unknown as { caches?: { open(name: string): Promise<EdgeCache> } }).caches;
  if (process.env.NODE_ENV !== "production" || !secret || !cacheStorage?.open) return load();
  let cache: EdgeCache, request: Request, key: CryptoKey;
  const encoder = new TextEncoder();
  try {
    // Domain separation from JWT signing; rotation also changes the cache URL.
    const material = await crypto.subtle.digest("SHA-256", encoder.encode(`axvara-private-financial-v1:${secret}`));
    key = await crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
    const id = await crypto.subtle.digest("SHA-256", encoder.encode(`${scope}:${Array.from(new Uint8Array(material)).join(",")}`));
    const hex = Array.from(new Uint8Array(id), byte => byte.toString(16).padStart(2, "0")).join("");
    request = new Request(`https://axvara.tech/__private-financial-cache/v1/${hex}`);
    cache = await cacheStorage.open("axvara-private-financial-v1");
    const hit = await cache.match(request);
    if (hit) {
      const bytes = new Uint8Array(await hit.arrayBuffer());
      const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: encoder.encode(request.url) }, key, bytes.slice(12));
      const value = JSON.parse(new TextDecoder().decode(clear)) as T;
      const age = Date.now() - Date.parse(value.generatedAt);
      if (Number.isFinite(age) && age >= 0 && age < FINANCIAL_SNAPSHOT_TTL_MS) return value;
    }
  } catch {
    // Cache/decryption failure is never an empty or stale financial report.
    return load();
  }
  const value = await load(); // Errors propagate; failed calculations are not stored.
  try {
    const remaining = Date.parse(value.generatedAt) + FINANCIAL_SNAPSHOT_TTL_MS - Date.now();
    if (remaining > 0 && remaining <= FINANCIAL_SNAPSHOT_TTL_MS) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(request.url) }, key, encoder.encode(JSON.stringify(value))));
      const body = new Uint8Array(iv.length + sealed.length);
      body.set(iv); body.set(sealed, iv.length);
      await cache.put(request, new Response(body, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": `max-age=${Math.floor(remaining / 1000)}` } }));
    }
  } catch { /* A cache write must not fail a successful report. */ }
  return value;
}
