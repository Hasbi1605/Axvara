import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { cachePublicCatalog } from "@/lib/catalog-cache";
import { GET as market } from "@/app/api/products/route";
import { GET as pedia } from "@/app/api/pedia/catalog/route";
import { GET as categories } from "@/app/api/categories/route";
import { PEDIA_CATALOG_BOUNDS_SQL } from "@/lib/pedia/catalog-queries";
import { createD1Fixture } from "./helpers/d1-fixture";

let fixture: ReturnType<typeof createD1Fixture>;
function memoryCache() {
  const entries = new Map<string, { response: Response; expiresAt: number }>();
  return {
    match: vi.fn(async (request: Request) => {
      const entry = entries.get(request.url);
      return entry && entry.expiresAt > Date.now() ? entry.response.clone() : undefined;
    }),
    put: vi.fn(async (request: Request, response: Response) => {
      const ttl = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1]);
      entries.set(request.url, { response: response.clone(), expiresAt: Date.now() + ttl * 1000 });
    }),
  };
}
let cache: ReturnType<typeof memoryCache>;
beforeEach(() => {
  fixture = createD1Fixture(); cache = memoryCache();
  vi.stubGlobal("caches", { default: cache });
  vi.stubEnv("VARIANTS_READ_ENABLED", "true");
  fixture.sql.exec("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Fixture','fixture',10000,10); INSERT INTO product_variants(id,product_id,sku,label,price,stock) VALUES(1,1,'FIX','Fixture',10000,10)");
});
afterEach(() => { fixture.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
const req = (query = "active=1") => new NextRequest(`https://axvara.tech/api/products?${query}`);

it("shares a public Market response across direct handler calls, expires and keeps search/slug keys separate", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-16T16:00:00Z"));
  const first = await market(req());
  expect(first.headers.get("X-Axvara-Cache")).toBe("MISS");
  expect((await first.json()).products[0].price).toBe(10000);
  const reads = fixture.control.queries;
  fixture.sql.exec("UPDATE product_variants SET price=20000; UPDATE products SET price=20000");
  const hit = await market(req());
  expect(hit.headers.get("X-Axvara-Cache")).toBe("HIT");
  expect((await hit.json()).products[0].price).toBe(10000);
  expect(fixture.control.queries).toBe(reads);
  expect((await (await market(req("active=1&q=missing"))).json()).products).toEqual([]);
  expect((await (await market(req("active=1&slug=fixture"))).json()).products[0].price).toBe(20000);
  vi.setSystemTime(new Date("2026-10-16T16:00:31Z"));
  const fresh = await market(req());
  expect(fresh.headers.get("X-Axvara-Cache")).toBe("MISS");
  expect((await fresh.json()).products[0].price).toBe(20000);
});

it("never routes private/admin requests through the public cache or bypasses category authorization", async () => {
  await market(req());
  const lookups = cache.match.mock.calls.length;
  const response = await market(req("all=1"));
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("X-Axvara-Cache")).toBeNull();
  expect(cache.match.mock.calls).toHaveLength(lookups);
  expect((await categories(new NextRequest("https://axvara.tech/api/categories?all=1"))).status).toBe(401);
  expect(cache.match.mock.calls).toHaveLength(lookups);
});

it("Pedia caches only successful reads and retries a transient missing-bounds load", async () => {
  vi.stubEnv("PEDIA_ENABLED", "true");
  fixture.control.fail = sql => sql === PEDIA_CATALOG_BOUNDS_SQL;
  const failed = await pedia();
  expect(failed.headers.get("cache-control")).toBe("no-store");
  expect(cache.put).not.toHaveBeenCalled();
  fixture.control.fail = null;
  expect((await pedia()).headers.get("X-Axvara-Cache")).toBe("MISS");
  const reads = fixture.control.queries;
  expect((await pedia()).headers.get("X-Axvara-Cache")).toBe("HIT");
  expect(fixture.control.queries).toBe(reads);
  vi.stubEnv("PEDIA_ENABLED", "false");
  expect((await pedia()).status).toBe(503);
});

it("falls back to fresh data if Cache API fails or is unavailable", async () => {
  cache.match.mockRejectedValue(new Error("cache unavailable"));
  const load = vi.fn(async () => Response.json({ ok: true }));
  expect((await cachePublicCatalog("fallback", 30, load)).headers.get("X-Axvara-Cache")).toBe("BYPASS");
  expect((await cachePublicCatalog("fallback", 30, load)).status).toBe(200);
  expect(load).toHaveBeenCalledTimes(2);
  vi.stubGlobal("caches", undefined);
  expect((await cachePublicCatalog("fallback", 30, load)).status).toBe(200);
  expect(load).toHaveBeenCalledTimes(3);
});

it("coalesces concurrent misses without sharing consumed response bodies and retries after load failure", async () => {
  const load = vi.fn(async () => Response.json({ products: ["safe"] }));
  const responses = await Promise.all(Array.from({ length: 12 }, () => cachePublicCatalog("concurrent", 30, load)));
  expect(load).toHaveBeenCalledTimes(1);
  expect(await Promise.all(responses.map(response => response.json()))).toEqual(Array.from({ length: 12 }, () => ({ products: ["safe"] })));
  const failed = vi.fn(async () => { throw new Error("D1 unavailable"); });
  await expect(cachePublicCatalog("retry", 30, failed)).rejects.toThrow("D1 unavailable");
  expect((await cachePublicCatalog("retry", 30, load)).status).toBe(200);
});

it.each([
  () => Response.json({ error: "failed" }, { status: 503 }),
  () => Response.json({ private: true }, { headers: { "Cache-Control": "private, no-store" } }),
  () => Response.json({ session: true }, { headers: { "Set-Cookie": "test=x" } }),
])("never stores failed, private or cookie responses", async load => {
  await cachePublicCatalog("unsafe", 30, load);
  expect(cache.put).not.toHaveBeenCalled();
});

it("cache write failure still returns a usable response", async () => {
  cache.put.mockRejectedValue(new Error("cache write failed"));
  expect(await (await cachePublicCatalog("write-fail", 30, async () => Response.json({ ok: true }))).json()).toEqual({ ok: true });
});
