// tests/catalog-public-payload.test.ts — Audit AU-C1-1 (21 Nov 2026).
//
// Payload publik /api/catalog?slug= TIDAK boleh membocorkan modal/cost supplier
// (manual_cost) maupun ID tautan supplier (wr_variant_id/sk_variant_id/...).
// Rute admin GET /api/products/[id] tetap mengembalikan manual_cost. Storefront
// tetap menerima penanda turunan (supplier_variant, automatic_processing,
// sk_duration) sehingga badge/ETA/label tidak berubah.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));

const DENYLIST = [
  "manual_cost", "wr_variant_id", "sk_variant_id", "wr_auto_managed", "sk_auto_managed",
  "tunvn_source_product_id", "tunvn_buff_quantity_b", "aivault_service_id", "storebat_product_id",
  "mirai_package_code", "supplier_cost", "supplier_cost_source",
];

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("ADMIN_JWT_SECRET", "catalog-public-fixture-secret");
  vi.stubEnv("ADMIN_EMAIL", "admin@example.test");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "b".repeat(64));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external requests in fixtures"); }));
});
afterEach(() => { fx.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function seed() {
  fx.sql.exec(`
    INSERT INTO products(id, name, slug, price, stock, is_active, sk_product_id)
      VALUES(1, 'Fixture', 'fixture', 10000, 10, 1, 'sku-parent');
    INSERT INTO product_variants(id, product_id, sku, label, price, stock, manual_cost, is_active, sk_variant_id, aivault_service_id, storebat_product_id, mirai_package_code, tunvn_source_product_id)
      VALUES(1, 1, 'SKU-1', 'Variant 1', 10000, 10, 4321, 1, 'sk-1', 'av-1', 'sb-1', 'mp-1', 'tv-1');
  `);
}

describe("AU-C1-1 — public catalog payload strips supplier cost + IDs", () => {
  it("GET /api/catalog?slug= has no manual_cost or supplier link IDs, keeps storefront markers", async () => {
    seed();
    const { GET } = await import("@/app/api/catalog/route");
    const response = await GET(new Request("https://axvara.tech/api/catalog?slug=fixture"));
    expect(response.status).toBe(200);
    const body = await response.json() as { product: { variants: Record<string, unknown>[] } };
    const variant = body.product.variants[0];
    for (const key of DENYLIST) expect(variant, key).not.toHaveProperty(key);
    // Teks mentah tetap dibuang (kontrak lama).
    expect(variant.terms).toBeNull();
    expect(variant.sk_description).toBeUndefined();
    // Penanda turunan tetap ada untuk storefront.
    expect(variant.supplier_variant).toBe("sk");
    expect(variant).toHaveProperty("sk_duration");
  });

  it("WR variants expose supplier_variant='wr' and Jaspay marker without leaking wr_variant_id", async () => {
    fx.sql.exec(`
      INSERT INTO products(id, name, slug, price, stock, is_active) VALUES(2, 'Jaspay', 'jaspay-fixture', 20000, 5, 1);
      INSERT INTO wr_products(wr_product_id, wr_product_name) VALUES('wr-product', 'WR');
      INSERT INTO wr_variants(wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_delivery_class)
        VALUES('jaspay:42', 'wr-product', 'Jaspay VIP', 20000, 'made_by_order');
      INSERT INTO product_variants(id, product_id, sku, label, price, stock, manual_cost, is_active, wr_variant_id)
        VALUES(2, 2, 'JSP-1', 'Jaspay VIP', 20000, 5, 999, 1, 'jaspay:42');
    `);
    const { GET } = await import("@/app/api/catalog/route");
    const body = await (await GET(new Request("https://axvara.tech/api/catalog?slug=jaspay-fixture"))).json() as { product: { variants: Record<string, unknown>[] } };
    const variant = body.product.variants[0];
    expect(variant).not.toHaveProperty("wr_variant_id");
    expect(variant).not.toHaveProperty("manual_cost");
    expect(variant.supplier_variant).toBe("wr");
    expect(variant.automatic_processing).toBe(true);
    // Badge pembeli tetap "Diproses otomatis" (tidak berubah oleh strip).
    const { buyerDeliveryBadge } = await import("@/lib/catalog");
    expect(buyerDeliveryBadge(variant as { wr_delivery_class?: string | null })).toBe("Diproses otomatis");
  });
  // Jalur admin TIDAK disentuh sanitizer publik: GET /api/products/[id] tetap
  // mengembalikan manual_cost (dibutuhkan editor harga modal admin).
  it("admin GET /api/products/[id] still returns manual_cost", async () => {
    seed();
    const { GET } = await import("@/app/api/products/[id]/route");
    const response = await GET(new NextRequest("https://axvara.test/api/products/1"), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(200);
    const body = await response.json() as { product: { variants: Record<string, unknown>[] } };
    expect(body.product.variants).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, manual_cost: 4321 }),
    ]));
  });
});
