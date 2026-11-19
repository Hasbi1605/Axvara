// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { createD1Fixture } from "./helpers/d1-fixture";
import type { Product } from "@/lib/products";
import type { OrderableCategory } from "@/lib/product-order";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "netflix-premium" }),
  usePathname: () => "/",
  useRouter: () => ({ push: nav.push, replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

let fx: ReturnType<typeof createD1Fixture>;

function memoryCache() {
  const entries = new Map<string, { response: Response; expiresAt: number }>();
  return {
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

function stubBrowserGlobals() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
  vi.stubGlobal("IntersectionObserver", class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
    root = null; rootMargin = ""; thresholds = [];
  });
}

async function flush(rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("VARIANTS_READ_ENABLED", "true");
  fx.sql.exec(`
    INSERT OR IGNORE INTO categories(id, name, slug, icon, sort_order) VALUES(1, 'Streaming', 'streaming', 'play', 1);
    INSERT INTO products(id, name, slug, description, price, stock, is_active, category_id) VALUES(1, 'Netflix Premium', 'netflix-premium', 'Streaming', 26000, 5, 1, 1);
    INSERT INTO product_variants(id, product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order)
    VALUES (11, 1, 'N1', '1 Bulan', 26000, 5, 'manual', 1, 0),
           (12, 1, 'N3', '3 Bulan', 70000, 3, 'manual', 1, 1);
  `);
});

afterEach(() => {
  cleanup();
  fx.close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SSR passes initialRevision from catalog-cache header", () => {
  it("HomePage forwards X-Axvara-Catalog-Revision as initialRevision to HomeClient", async () => {
    vi.stubGlobal("caches", { default: memoryCache() });
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    const rev = await bumpCatalogRevision("market");

    const { default: HomePage } = await import("@/app/(shop)/page");
    const tree = (await HomePage()) as ReactElement<{
      children: ReactElement<{ initialProducts?: Product[]; initialRevision?: string | null }>[];
    }>;
    const children = Array.isArray(tree.props.children) ? tree.props.children : [tree.props.children];
    const client = children.find((c) => (c?.props as { initialProducts?: Product[] } | undefined)?.initialProducts !== undefined);
    expect(client?.props.initialRevision).toBe(rev);
  }, 15000);

  it("ProductDetailPage forwards X-Axvara-Catalog-Revision as initialRevision to ProductDetailClient", async () => {
    vi.stubGlobal("caches", { default: memoryCache() });
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    const rev = await bumpCatalogRevision("market");

    const { default: ProductDetailPage } = await import("@/app/(shop)/produk/[slug]/page");
    const tree = (await ProductDetailPage({ params: Promise.resolve({ slug: "netflix-premium" }) })) as ReactElement<{
      children: ReactElement<{ initialRevision?: string | null }>[];
    }>;
    const children = Array.isArray(tree.props.children) ? tree.props.children : [tree.props.children];
    const client = children.find((c) => (c?.props as { slug?: string } | undefined)?.slug === "netflix-premium");
    expect(client?.props.initialRevision).toBe(rev);
  }, 15000);
});

describe("HomeClient silent live catalog refresh", () => {
  it("refetches silently on revision bump without skeleton or resetting active category", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    stubBrowserGlobals();

    let rev = "rev-1";
    let currentStock = 5;
    const initialCategories: OrderableCategory[] = [
      { id: 1, name: "Streaming", slug: "streaming", sort_order: 1 },
      { id: 2, name: "AI Tools", slug: "ai-chatbot", sort_order: 2 },
    ];
    const initialProducts: Product[] = [
      {
        id: "1", slug: "netflix-premium", name: "Netflix Premium", description: "Streaming",
        price: 26000, categorySlug: "streaming", image: "", images: [], soldCount: 0, stock: 5,
      } as unknown as Product,
    ];

    const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input.startsWith("/api/catalog/revision")) {
        return new Response(JSON.stringify({ scope: "market", revision: rev }), { status: 200 });
      }
      if (input === "/api/products?active=1") {
        return new Response(
          JSON.stringify({ products: [{ ...initialProducts[0], stock: currentStock }] }),
          { status: 200 },
        );
      }
      if (input === "/api/categories") {
        return new Response(JSON.stringify({ categories: initialCategories }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { HomeClient } = await import("@/app/(shop)/home-client");
    render(
      <HomeClient
        initialProducts={initialProducts}
        initialCategories={initialCategories}
        initialRevision="rev-1"
      />,
    );
    await act(async () => { await flush(); });

    // Select specific category filter before revision changes
    fireEvent.click(screen.getByRole("button", { name: "Streaming" }));
    expect(screen.getByRole("button", { name: "Streaming" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("soldout-overlay")).toBeNull();

    // Revision bumps -> stock becomes 0
    rev = "rev-2";
    currentStock = 0;
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flush();
    });

    // No skeleton shown, stock updated to 0 (soldout overlay), category filter preserved
    expect(screen.queryByLabelText(/Memuat katalog/i)).toBeNull();
    expect(screen.getByTestId("soldout-overlay")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Streaming" }).getAttribute("aria-pressed")).toBe("true");

    const refreshCalls = fetchMock.mock.calls.filter((c) => c[0] === "/api/products?active=1");
    expect(refreshCalls).toHaveLength(1);
    expect((refreshCalls[0][1] as RequestInit).cache).toBe("no-cache");
  });
});

describe("ProductDetailClient silent live refresh", () => {
  it("silently updates variant stock without skeleton and preserves selected variant (or falls back when removed)", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    stubBrowserGlobals();

    let rev = "rev-1";
    let variantsPayload = [
      { id: 11, label: "1 Bulan", price: 26_000, compare_price: null, stock: 5, min_qty: 1, is_active: 1, warranty_type: "none", fulfillment_mode: "manual" },
      { id: 12, label: "3 Bulan", price: 70_000, compare_price: null, stock: 3, min_qty: 1, is_active: 1, warranty_type: "none", fulfillment_mode: "manual" },
    ];
    let productStock = 8;

    const initialProduct = {
      id: "1", slug: "netflix-premium", name: "Netflix Premium", description: "Streaming",
      price: 26_000, categorySlug: "streaming", image: "/brand/axvara-mark.svg", images: [], stock: 8, variantCount: 2,
    } as unknown as Product;
    const initialCatalog = {
      slug: "netflix-premium",
      product: { id: 1, slug: "netflix-premium", name: "Netflix Premium", variants: variantsPayload },
      variantsEnabled: true,
    };

    const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input.startsWith("/api/catalog/revision")) {
        return new Response(JSON.stringify({ scope: "market", revision: rev }), { status: 200 });
      }
      if (input.startsWith("/api/products?active=1&slug=")) {
        return new Response(
          JSON.stringify({ products: [{ ...initialProduct, stock: productStock }] }),
          { status: 200 },
        );
      }
      if (input.startsWith("/api/catalog?slug=")) {
        return new Response(
          JSON.stringify({
            product: { id: 1, slug: "netflix-premium", name: "Netflix Premium", variants: variantsPayload },
            variantsEnabled: true,
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ products: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { default: ProductDetailClient } = await import("@/app/(shop)/produk/[slug]/product-detail-client");
    render(
      <ProductDetailClient
        slug="netflix-premium"
        initialProducts={[initialProduct]}
        initialCatalog={initialCatalog as never}
        initialRevision="rev-1"
      />,
    );
    await act(async () => { await flush(); });

    // Buyer selects variant 12 ("3 Bulan")
    const getDesktopVariantBtn = (label: RegExp) =>
      screen.getAllByRole("button", { name: label }).find((el) => !el.hasAttribute("aria-label"))!;
    fireEvent.click(getDesktopVariantBtn(/3 Bulan/));
    expect(getDesktopVariantBtn(/3 Bulan/).className).toContain("border-[#00E5FF]/50");

    // 1. Revision changes: variant 12 stock drops to 0 (still present) -> stays selected, no skeleton
    rev = "rev-2";
    productStock = 5;
    variantsPayload = [
      { id: 11, label: "1 Bulan", price: 26_000, compare_price: null, stock: 5, min_qty: 1, is_active: 1, warranty_type: "none", fulfillment_mode: "manual" },
      { id: 12, label: "3 Bulan", price: 70_000, compare_price: null, stock: 0, min_qty: 1, is_active: 1, warranty_type: "none", fulfillment_mode: "manual" },
    ];
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flush();
    });

    expect(screen.queryByText("Memuat detail produk…")).toBeNull();
    const var3mAfter = getDesktopVariantBtn(/3 Bulan/);
    expect(var3mAfter.className).toContain("border-[#00E5FF]/50");
    expect(var3mAfter.textContent).toMatch(/Habis/i);

    // 2. Revision changes: variant 12 removed -> auto-falls back to sole buyable variant 11 ("1 Bulan")
    rev = "rev-3";
    variantsPayload = [
      { id: 11, label: "1 Bulan", price: 26_000, compare_price: null, stock: 4, min_qty: 1, is_active: 1, warranty_type: "none", fulfillment_mode: "manual" },
    ];
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flush();
    });

    expect(screen.queryByRole("button", { name: /3 Bulan/ })).toBeNull();
    expect(getDesktopVariantBtn(/1 Bulan/).className).toContain("border-[#00E5FF]/50");
    expect(screen.getAllByText(/Sisa 4|Tersedia \(4\)/i).length).toBeGreaterThan(0);
  });
});
