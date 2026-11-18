import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";

let fixture: ReturnType<typeof createD1Fixture>;
let cache: ReturnType<typeof memoryCache>;
let funnelWrite: ReturnType<typeof vi.fn>;

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

function seedMarket() {
  fixture.sql.exec(`
    INSERT OR IGNORE INTO categories(id, name, slug, icon, sort_order) VALUES (1, 'AI Tools', 'ai-chatbot', 'bot', 10);
    INSERT INTO products(id, category_id, name, slug, description, price, stock, is_active, sort_order, telegram_enabled, source, fulfillment_mode)
    VALUES (1, 1, 'ChatGPT Plus', 'chatgpt-plus', 'Desc', 25000, 5, 1, 10, 1, 'manual', 'manual');
    INSERT INTO product_variants(id, product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order)
    VALUES (1, 1, 'CGPT-1M', '1 Bulan', 25000, 5, 'manual', 1, 0);
  `);
}

function seedGames() {
  fixture.sql.exec(`
    INSERT INTO games_products(
      buyer_sku_code, supplier, supplier_active, sk_variant_id, sk_sku, sk_product_id, sk_product_name,
      game_slug, game_brand, product_type, product_type_name, product_name, cost, sell_price, stock,
      min_order, unlimited_stock, description, enabled
    ) VALUES (
      'sk:101', 'sekalipay', 1, '101', 'ML86', '33', 'Mobile Legends',
      'mobile-legends', 'Mobile Legends', 'Top Up', 'Top Up', '86 Diamond', 10000, 11000, 10,
      1, 0, 'ALL REGION KECUALI MY', 1
    );
  `);
}

beforeEach(() => {
  fixture = createD1Fixture();
  cache = memoryCache();
  funnelWrite = vi.fn();
  vi.stubGlobal("caches", { default: cache });
  vi.stubGlobal("FUNNEL_ANALYTICS", { writeDataPoint: funnelWrite });
  vi.stubEnv("VARIANTS_READ_ENABLED", "true");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("GAMES_SK_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_API_KEY", "sk-key");
  vi.stubEnv("SEKALIPAY_SECRET_KEY", "sk-sec");
  vi.stubEnv("CRON_SECRET", "fixture-cron");
});

afterEach(() => {
  fixture.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/catalog revision cache & view funnel", () => {
  it("caches list and ?slug= under market scope, preserves headers, emits view on HIT & MISS, excludes probes, and invalidates on revision bump", async () => {
    seedMarket();
    const { GET } = await import("@/app/api/catalog/route");
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");

    // 1. List endpoint: MISS -> HIT (0 D1 queries), no view event
    const list1 = await GET(new Request("https://axvara.tech/api/catalog"));
    expect(list1.status).toBe(200);
    expect(list1.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect(list1.headers.get("Cache-Control")).toBe("public, s-maxage=30, stale-while-revalidate=60");
    expect(funnelWrite).not.toHaveBeenCalled();

    const qAfterListMiss = fixture.control.queries;
    const list2 = await GET(new Request("https://axvara.tech/api/catalog"));
    expect(list2.headers.get("X-Axvara-Cache")).toBe("HIT");
    expect(list2.headers.get("Cache-Control")).toBe("public, s-maxage=30, stale-while-revalidate=60");
    expect(fixture.control.queries).toBe(qAfterListMiss);
    expect(funnelWrite).not.toHaveBeenCalled();

    // 2. Detail (?slug=) MISS emits view, HIT emits view with 0 D1 queries
    const detailMiss = await GET(new Request("https://axvara.tech/api/catalog?slug=chatgpt-plus"));
    expect(detailMiss.status).toBe(200);
    expect(detailMiss.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect(detailMiss.headers.get("Cache-Control")).toBe("public, s-maxage=10, stale-while-revalidate=30");
    expect((await detailMiss.json()).product.variants[0].price).toBe(25000);
    expect(funnelWrite).toHaveBeenCalledTimes(1);
    expect(funnelWrite.mock.calls[0][0].blobs.slice(0, 7)).toEqual(["view", "apps", "web", "none", "none", "1", "id"]);

    const qAfterDetailMiss = fixture.control.queries;
    const detailHit = await GET(new Request("https://axvara.tech/api/catalog?slug=chatgpt-plus", {
      headers: { cookie: "axv_locale=en" },
    }));
    expect(detailHit.status).toBe(200);
    expect(detailHit.headers.get("X-Axvara-Cache")).toBe("HIT");
    expect(detailHit.headers.get("Cache-Control")).toBe("public, s-maxage=10, stale-while-revalidate=30");
    expect(fixture.control.queries).toBe(qAfterDetailMiss);
    expect(funnelWrite).toHaveBeenCalledTimes(2);
    expect(funnelWrite.mock.calls[1][0].blobs.slice(0, 7)).toEqual(["view", "apps", "web", "none", "none", "1", "en"]);

    // 3. Synthetic probes do NOT emit view even on HIT
    await GET(new Request("https://axvara.tech/api/catalog?slug=chatgpt-plus", {
      headers: { "user-agent": "axvara-synth/1.0" },
    }));
    await GET(new Request("https://axvara.tech/api/catalog?slug=chatgpt-plus", {
      headers: { "x-axvara-synthetic": "1", authorization: "Bearer fixture-cron" },
    }));
    expect(funnelWrite).toHaveBeenCalledTimes(2);

    // 4. 404 is not cached and emits no view
    const missing = await GET(new Request("https://axvara.tech/api/catalog?slug=unknown-slug"));
    expect(missing.status).toBe(404);
    expect(funnelWrite).toHaveBeenCalledTimes(2);

    // 5. Revision bump -> fresh data on next request
    fixture.sql.prepare("UPDATE product_variants SET price=29000 WHERE id=1").run();
    await bumpCatalogRevision("market");
    const afterBump = await GET(new Request("https://axvara.tech/api/catalog?slug=chatgpt-plus"));
    expect(afterBump.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect((await afterBump.json()).product.variants[0].price).toBe(29000);
    expect(funnelWrite).toHaveBeenCalledTimes(3);
  });
});

