import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

let fixture: ReturnType<typeof createD1Fixture>;
let cache: ReturnType<typeof memoryCache>;

function memoryCache() {
  const entries = new Map<string, { response: Response; expiresAt: number }>();
  return {
    entries,
    match: vi.fn(async (request: Request) => {
      const entry = entries.get(request.url);
      return entry && entry.expiresAt > Date.now() ? entry.response.clone() : undefined;
    }),
    put: vi.fn(async (request: Request, response: Response) => {
      const ttl = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ?? 60);
      entries.set(request.url, { response: response.clone(), expiresAt: Date.now() + ttl * 1000 });
    }),
    delete: vi.fn(async (request: Request) => entries.delete(request.url)),
  };
}

beforeEach(() => {
  fixture = createD1Fixture();
  cache = memoryCache();
  vi.stubGlobal("caches", { default: cache });
});

afterEach(() => {
  fixture.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cachePublicCatalog browser cache & revision headers", () => {
  it("returns Cache-Control: no-cache and X-Axvara-Catalog-Revision on HIT/MISS without leaking internal headers", async () => {
    const {
      cachePublicCatalog,
      bumpCatalogRevision,
      PUBLIC_CATALOG_BROWSER_CACHE_CONTROL,
      CATALOG_REVISION_HEADER,
    } = await import("@/lib/catalog-cache");

    expect(PUBLIC_CATALOG_BROWSER_CACHE_CONTROL).toBe("no-cache");
    expect(CATALOG_REVISION_HEADER).toBe("X-Axvara-Catalog-Revision");

    let loads = 0;
    const miss = await cachePublicCatalog(
      "test:live",
      180,
      async () => Response.json({ loads: ++loads }, { headers: { "Cache-Control": "public, max-age=60" } }),
      "market",
    );
    expect(miss.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect(miss.headers.get("Cache-Control")).toBe("no-cache");
    expect(miss.headers.get(CATALOG_REVISION_HEADER)).toBe("0");
    expect(miss.headers.has("X-Axvara-Cache-Stored-At")).toBe(false);
    expect(miss.headers.has("X-Axvara-Origin-Cache-Control")).toBe(false);

    // Stored copy in Cache API keeps edge TTL max-age=180
    const storedEntry = [...cache.entries.values()][0];
    expect(storedEntry.response.headers.get("Cache-Control")).toBe("public, max-age=180");

    const hit = await cachePublicCatalog(
      "test:live",
      180,
      async () => Response.json({ loads: ++loads }),
      "market",
    );
    expect(hit.headers.get("X-Axvara-Cache")).toBe("HIT");
    expect(hit.headers.get("Cache-Control")).toBe("no-cache");
    expect(hit.headers.get(CATALOG_REVISION_HEADER)).toBe("0");
    expect(hit.headers.has("X-Axvara-Cache-Stored-At")).toBe(false);
    expect(hit.headers.has("X-Axvara-Origin-Cache-Control")).toBe(false);
    expect(loads).toBe(1);

    const nextRev = await bumpCatalogRevision("market");
    expect(nextRev).toBeTruthy();

    const afterBump = await cachePublicCatalog(
      "test:live",
      180,
      async () => Response.json({ loads: ++loads }),
      "market",
    );
    expect(afterBump.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect(afterBump.headers.get("Cache-Control")).toBe("no-cache");
    expect(afterBump.headers.get(CATALOG_REVISION_HEADER)).toBe(nextRev);
    expect(loads).toBe(2);
  });

  it("sets no-cache and omits X-Axvara-Catalog-Revision on BYPASS, and preserves private/no-store origin headers", async () => {
    const { cachePublicCatalog, CATALOG_REVISION_HEADER } = await import("@/lib/catalog-cache");

    // Origin private/no-store is never stored and keeps its Cache-Control
    const privMiss = await cachePublicCatalog(
      "test:priv",
      180,
      async () => Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } }),
      "market",
    );
    expect(privMiss.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect(privMiss.headers.get("Cache-Control")).toBe("private, no-store");
    expect(cache.put).not.toHaveBeenCalled();

    // BYPASS when Cache API throws or is absent
    cache.match.mockRejectedValueOnce(new Error("cache down"));
    const bypassPublic = await cachePublicCatalog(
      "test:bypass",
      180,
      async () => Response.json({ ok: true }, { headers: { "Cache-Control": "public, max-age=60" } }),
      "market",
    );
    expect(bypassPublic.headers.get("X-Axvara-Cache")).toBe("BYPASS");
    expect(bypassPublic.headers.get("Cache-Control")).toBe("no-cache");
    expect(bypassPublic.headers.has(CATALOG_REVISION_HEADER)).toBe(false);

    vi.stubGlobal("caches", undefined);
    const bypassNoStore = await cachePublicCatalog(
      "test:bypass-nostore",
      180,
      async () => Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }),
      "market",
    );
    expect(bypassNoStore.headers.get("X-Axvara-Cache")).toBe("BYPASS");
    expect(bypassNoStore.headers.get("Cache-Control")).toBe("no-store");
    expect(bypassNoStore.headers.has(CATALOG_REVISION_HEADER)).toBe(false);
  });
});

describe("GET /api/catalog/revision", () => {
  it("returns 200 with private, no-store, defaults scope to market, validates scope, and falls back to '0' on D1 errors", async () => {
    const { GET } = await import("@/app/api/catalog/revision/route");
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");

    const defRes = await GET(new Request("https://axvara.tech/api/catalog/revision"));
    expect(defRes.status).toBe(200);
    expect(defRes.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await defRes.json()).toEqual({ scope: "market", revision: "0" });

    const pediaRev = await bumpCatalogRevision("pedia");
    const pediaRes = await GET(new Request("https://axvara.tech/api/catalog/revision?scope=pedia"));
    expect(pediaRes.status).toBe(200);
    expect(pediaRes.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await pediaRes.json()).toEqual({ scope: "pedia", revision: pediaRev });

    const gamesRev = await bumpCatalogRevision("games");
    const gamesRes = await GET(new Request("https://axvara.tech/api/catalog/revision?scope=games"));
    expect(gamesRes.status).toBe(200);
    expect(await gamesRes.json()).toEqual({ scope: "games", revision: gamesRev });

    const invalid = await GET(new Request("https://axvara.tech/api/catalog/revision?scope=invalid"));
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await invalid.json()).toEqual({ error: "invalid_scope" });

    const empty = await GET(new Request("https://axvara.tech/api/catalog/revision?scope="));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "invalid_scope" });

    // D1 failure / missing D1 -> "0", never 500
    vi.stubGlobal("DB", undefined);
    const noDbRes = await GET(new Request("https://axvara.tech/api/catalog/revision?scope=market"));
    expect(noDbRes.status).toBe(200);
    expect(await noDbRes.json()).toEqual({ scope: "market", revision: "0" });
  });
});
