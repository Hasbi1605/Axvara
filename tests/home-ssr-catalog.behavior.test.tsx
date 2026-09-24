// @vitest-environment jsdom
// SEO/GEO: HTML beranda produksi berisi "0 produk" tanpa satu link produk
// karena katalog dimuat di browser. Kini page.tsx (server) memuat katalog
// lewat handler /api/products dan mengirimnya ke HomeClient.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { createD1Fixture } from "./helpers/d1-fixture";
import type { Product } from "@/lib/products";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  fx.sql.prepare(`INSERT INTO products(id,name,slug,price,stock,is_active,category_id) VALUES(1,'Netflix Premium','netflix-premium',26000,0,1,1)`).run();
  fx.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active) VALUES(1,1,'N1','1 Bulan',26000,5,'manual',1)`).run();
});
afterEach(() => { cleanup(); fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("server memuat katalog D1 dan menyerahkannya ke klien", async () => {
  const { default: HomePage } = await import("@/app/page");
  const tree = (await HomePage()) as ReactElement<{ children: ReactElement<{ initialProducts?: Product[] }>[] }>;
  const client = tree.props.children[1];
  expect(client.props.initialProducts?.map((p) => p.slug)).toEqual(["netflix-premium"]);
});

it("klien dengan data awal langsung merender kartu + link produk tanpa fetch", async () => {
  // jsdom tidak punya dua API browser yang dipakai hero/kartu (pola storefront-catalog-ux).
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
  vi.stubGlobal("IntersectionObserver", class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
    root = null; rootMargin = ""; thresholds = [];
  });
  const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchSpy);
  const { HomeClient } = await import("@/app/home-client");
  render(<HomeClient initialProducts={[{ id: "1", slug: "netflix-premium", name: "Netflix Premium", description: "", price: 26000, categorySlug: "akun-premium", image: "", images: [], soldCount: 0, stock: 5 } as unknown as Product]} />);
  expect(screen.getAllByText("Netflix Premium").length).toBeGreaterThan(0);
  expect(document.querySelector('a[href="/produk/netflix-premium"]')).not.toBeNull();
  const productCalls = fetchSpy.mock.calls.filter((call) => String((call as unknown[])[0]).includes("/api/products"));
  expect(productCalls).toHaveLength(0);
});
