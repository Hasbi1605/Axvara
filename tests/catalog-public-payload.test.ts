// tests/catalog-public-payload.test.ts — Audit AU-C1-1 (21 Nov 2026).
//
// Payload publik /api/catalog?slug= TIDAK boleh membocorkan modal/cost supplier
// (manual_cost) maupun ID tautan supplier (wr_variant_id/sk_variant_id/...).
// Rute admin GET /api/products/[id] tetap mengembalikan manual_cost. Storefront
// menerima penanda pengiriman dan durasi label tanpa identitas pemasok.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { buyerDeliveryBadge, buyerDeliveryKind, formatVariantLabel, getProductDetail } from "@/lib/catalog";
import { catalogDeliveryBadge, catalogDeliveryEta } from "@/lib/i18n/catalog-copy";
import { withVariantCopy, type StorefrontProductDetail } from "@/lib/product-copy/resolve";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));

const PUBLIC_KEYS = [
  "id", "product_id", "label", "label_duration", "warranty_type", "warranty_value", "warranty_unit", "warranty_label",
  "price", "compare_price", "stock", "min_qty", "max_qty", "buyer_field_key", "fulfillment_mode", "is_active",
  "bulk_pricing_enabled", "bulk_pricing_invalid", "bulk_pricing_tiers", "inventory_available",
  "terms", "delivery_terms", "supplier_variant", "delivery_kind", "copy", "copy_en",
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
    INSERT INTO sk_products(sk_variant_id, sk_product_id, sk_product_name, sk_variant_name, sk_price, sk_order_process, sk_description)
      VALUES('sk-1', 'sku-parent', 'Fixture', 'Variant 1', 10000, 'auto', 'Durasi 1 Bulan');
    INSERT INTO product_variants(id, product_id, sku, label, price, stock, manual_cost, is_active, sk_variant_id, aivault_service_id, storebat_product_id, mirai_package_code, tunvn_source_product_id)
      VALUES(1, 1, 'SKU-1', 'Standard', 10000, 10, 4321, 1, 'sk-1', 'av-1', 'sb-1', 'mp-1', 'tv-1');
  `);
}

describe("AU-C1-1 — public catalog payload strips supplier cost + IDs", () => {
  it("allows only public fields and uses a neutral supplier marker", async () => {
    seed();
    const { GET } = await import("@/app/api/catalog/route");
    const response = await GET(new Request("https://axvara.tech/api/catalog?slug=fixture"));
    expect(response.status).toBe(200);
    const body = await response.json() as { product: StorefrontProductDetail };
    const variant = body.product.variants[0];
    expect(Object.keys(variant).sort()).toEqual([...PUBLIC_KEYS].sort());
    // Teks mentah tetap dibuang (kontrak lama).
    expect(variant.terms).toBeNull();
    expect(variant).not.toHaveProperty("sk_description");
    // Penanda turunan tetap ada untuk storefront.
    expect(variant.supplier_variant).toBe(true);
    expect(buyerDeliveryKind(variant)).toBe("instant");
    expect(formatVariantLabel(variant, "en")).toBe("Standard - 1 Month");
  });

  it("preserves the 12-hour queue ETA and duration for raw and public WR variants", async () => {
    seed();
    const detail = (await getProductDetail("fixture"))!;
    const raw = {
      ...detail.variants[0],
      wr_variant_id: "wr-fixture", sk_variant_id: null, wr_delivery_class: "made_by_order", wr_type: "Invite",
      duration_label: "3 Bulan", future_internal_column: "private",
    };
    const [variant] = withVariantCopy({ ...detail, variants: [raw] }).variants;
    expect(Object.keys(variant).sort()).toEqual([...PUBLIC_KEYS, "queue_has_eta"].sort());
    expect(variant.supplier_variant).toBe(true);
    for (const locale of ["id", "en"] as const) {
      expect(formatVariantLabel(variant, locale)).toBe(formatVariantLabel(raw, locale));
      expect(catalogDeliveryEta(raw, locale)).toContain(locale === "id" ? "12 jam" : "12 hours");
      expect(catalogDeliveryEta(variant, locale)).toBe(catalogDeliveryEta(raw, locale));
    }
  });

  it("Jaspay keeps neutral markers and the same buyer-facing copy as raw rows", async () => {
    fx.sql.exec(`
      INSERT INTO products(id, name, slug, price, stock, is_active) VALUES(2, 'Jaspay', 'jaspay-fixture', 20000, 5, 1);
      INSERT INTO wr_products(wr_product_id, wr_product_name) VALUES('wr-product', 'WR');
      INSERT INTO wr_variants(wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_delivery_class)
        VALUES('jaspay:42', 'wr-product', 'Jaspay VIP', 20000, 'made_by_order');
      INSERT INTO product_variants(id, product_id, sku, label, price, stock, manual_cost, is_active, wr_variant_id)
        VALUES(2, 2, 'JSP-1', 'Jaspay VIP', 20000, 5, 999, 1, 'jaspay:42');
    `);
    const { GET } = await import("@/app/api/catalog/route");
    const body = await (await GET(new Request("https://axvara.tech/api/catalog?slug=jaspay-fixture"))).json() as { product: StorefrontProductDetail };
    const variant = body.product.variants[0];
    expect(variant).not.toHaveProperty("wr_variant_id");
    expect(variant).not.toHaveProperty("manual_cost");
    expect(variant.supplier_variant).toBe(true);
    expect(variant.automatic_processing).toBe(true);
    // Badge pembeli tetap "Diproses otomatis" (tidak berubah oleh strip).
    expect(buyerDeliveryBadge(variant)).toBe("Diproses otomatis");
    const raw = (await getProductDetail("jaspay-fixture"))!.variants[0];
    expect(buyerDeliveryKind(variant)).toBe("queued");
    for (const locale of ["id", "en"] as const) {
      expect(formatVariantLabel(variant, locale)).toBe(formatVariantLabel(raw, locale));
      expect(catalogDeliveryBadge(raw, locale)).toBe(catalogDeliveryBadge(variant, locale));
      expect(catalogDeliveryEta(raw, locale)).toBe(catalogDeliveryEta(variant, locale));
    }
    expect(catalogDeliveryBadge(raw, "en")).toBe("Processed automatically");
    expect(catalogDeliveryEta(raw, "en")).toContain("15 minutes–1 hour");
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
