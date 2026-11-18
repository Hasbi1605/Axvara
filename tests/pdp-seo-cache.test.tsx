import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";

vi.mock("react", async original => {
  const react = await original<typeof import("react")>();
  const { createRequire } = await import("node:module");
  const server = createRequire(import.meta.url)("next/dist/compiled/react/cjs/react.react-server.development.js");
  // Exercise Next's real RSC React.cache with a request-scoped cache dispatcher.
  const cache = new Map();
  server.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.A = {
    getCacheForType: (factory: () => unknown) => { if (!cache.has(factory)) cache.set(factory, factory()); return cache.get(factory); },
  };
  return { ...react, cache: server.cache };
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "axvara-synth/1.0" }) }));
vi.mock("@/lib/i18n/server-locale", () => ({ requestLocale: async () => "id" }));
vi.mock("@/app/(shop)/produk/[slug]/product-detail-client", () => ({ default: () => null }));
vi.mock("@/app/api/products/route", () => ({ GET: async () => Response.json({ products: [] }) }));
vi.mock("@/app/api/catalog/route", () => ({ GET: vi.fn(async () => Response.json({ product: {}, variantsEnabled: true })) }));
afterEach(() => vi.restoreAllMocks());

it("metadata + render reuse the SEO query pair; a new RSC request gets fresh product data", async () => {
  const f = createD1Fixture();
  try {
    stubFulfillmentKey(); await insertTestProduct(f.sql);
    const prepare = vi.spyOn(f.db, "prepare");
    const { generateMetadata, default: page } = await import("@/app/(shop)/produk/[slug]/page");
    const params = Promise.resolve({ slug: "fixture" });
    const metadata = await generateMetadata({ params });
    const rendered = await page({ params });
    expect(metadata.title).toBe("Fixture | AXVARA");
    expect(rendered.props.children.some((element: { props?: { type?: string } }) => element?.props?.type === "application/ld+json")).toBe(true);
    expect(prepare.mock.calls.filter(([sql]) => sql.includes("SELECT p.slug, p.name"))).toHaveLength(1);
    expect(prepare.mock.calls.filter(([sql]) => sql.includes("SELECT pv.price, pv.compare_price"))).toHaveLength(1);
    const { GET } = await import("@/app/api/catalog/route");
    expect(vi.mocked(GET).mock.calls[0][0].headers.get("user-agent")).toBe("axvara-synth/1.0");
    const server = createRequire(import.meta.url)("next/dist/compiled/react/cjs/react.react-server.development.js");
    const requestCache = new Map();
    server.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.A = {
      getCacheForType: (factory: () => unknown) => { if (!requestCache.has(factory)) requestCache.set(factory, factory()); return requestCache.get(factory); },
    };
    f.sql.exec("UPDATE products SET name='Fresh name' WHERE id=1");
    expect((await generateMetadata({ params })).title).toBe("Fresh name | AXVARA");
  } finally { f.close(); }
});
