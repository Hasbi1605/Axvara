import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { buyerDeliveryBadge, buyerDeliveryKind, getProductDetail } from "@/lib/catalog";
import { catalogDeliveryBadge, catalogDeliveryEta } from "@/lib/i18n/catalog-copy";
import { withVariantCopy } from "@/lib/product-copy/resolve";
import { isBulkEligibleForm } from "@/components/admin/BulkTierEditor";

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireAdmin: vi.fn(async () => ({ sid: "fixture", email: "admin@example.test" })),
}));

let fx: ReturnType<typeof createD1Fixture>;

const pvFields = {
  pv_email: "buyer.fixture@gmail.com",
  pv_password: "fixture-password",
  pv_totp_secret: "JBSWY3DPEHPK3PXP",
};

const req = (url: string, body?: unknown, method = "POST") =>
  new NextRequest(`http://localhost${url}`, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
  vi.stubEnv("PIXELVERIF_ENABLED", "true");
  vi.stubEnv("PIXELVERIF_API_KEY", "pv-fixture");
  vi.stubEnv("PIXELVERIF_API_BASE_URL", "https://pixel.test");
  fx = createD1Fixture();
  clearRateLimitBucketsForTest();
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,image_url,images,pixelverif_family)
    VALUES(1,'Google AI Pro 3 Bulan','google-ai-pro-3-bulan',24700,1,1,'/brand/catalog/products/google-ai-pro-pv.webp','["/brand/catalog/products/google-ai-pro-pv.webp"]','google_ai_pro_3m');
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,max_qty,pixelverif_flow_type,pixelverif_validity,pixelverif_cost_usd,pixelverif_fx_idr_per_usd)
    VALUES(1,1,'PV-NORMAL-3','Link Redeem 3 Bulan',24700,1,1,1,'normal',3,1,18300),
          (2,1,'PV-FULL-3','Aktivasi Langsung 3 Bulan',37100,1,0,1,'full',3,1.5,18300);`);
});

afterEach(() => {
  fx.close();
  vi.unstubAllEnvs();
});

describe("Pixel Verification admin product identity and image allowlist", () => {
  it("reports supplier='Pixel' and pixelverif_family in admin product APIs (never 'Manual')", async () => {
    const { GET: listProducts } = await import("@/app/api/products/route");
    const { GET: getProduct } = await import("@/app/api/products/[id]/route");

    const listRes = await listProducts(req("/api/products", undefined, "GET"));
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { products: Array<Record<string, unknown>> };
    const prod = listBody.products.find((p) => p.id === "1");
    expect(prod).toMatchObject({ supplier: "Pixel", pixelverif_family: "google_ai_pro_3m" });

    const detailRes = await getProduct(req("/api/products/1", undefined, "GET"), { params: Promise.resolve({ id: "1" }) });
    expect(detailRes.status).toBe(200);
    const detailBody = await detailRes.json() as { product: Record<string, unknown> };
    expect(detailBody.product).toMatchObject({ pixelverif_family: "google_ai_pro_3m" });
    expect(isBulkEligibleForm({ pixelverif_family: "google_ai_pro_3m", supplier: "Pixel" })).toBe(false);
  });

  it("allows saving a renamed product with its first-party /brand/catalog/products/* image while rejecting unsafe URLs", async () => {
    const { PUT } = await import("@/app/api/products/[id]/route");
    const okRes = await PUT(
      req("/api/products/1", {
        name: "Google AI Pro 3 Bulan (testing)",
        imageUrl: "/brand/catalog/products/google-ai-pro-pv.webp",
        images: ["/brand/catalog/products/google-ai-pro-pv.webp"],
      }, "PUT"),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(okRes.status).toBe(200);
    expect(fx.sql.prepare("SELECT name, image_url FROM products WHERE id=1").get()).toEqual({
      name: "Google AI Pro 3 Bulan (testing)",
      image_url: "/brand/catalog/products/google-ai-pro-pv.webp",
    });

    for (const bad of [
      "/brand/catalog/products/../evil.webp",
      "/brand/catalog/other/evil.webp",
      "/brand/catalog/products/evil.js",
      "https://evil.example/image.webp",
    ]) {
      const badRes = await PUT(
        req("/api/products/1", { imageUrl: bad, images: [bad] }, "PUT"),
        { params: Promise.resolve({ id: "1" }) },
      );
      expect(badRes.status, bad).toBe(400);
    }
  });

  it("records pixelverif_admin_price_idr only when price actually changes and activates a variant on parent toggle", async () => {
    const { PUT } = await import("@/app/api/products/[id]/route");

    const unchanged = await PUT(
      req("/api/products/1", {
        variants: [{ id: 1, sku: "PV-NORMAL-3", label: "Link Redeem 3 Bulan", price: 24700, stock: 1, is_active: 1 }],
      }, "PUT"),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(unchanged.status).toBe(200);
    expect(fx.sql.prepare("SELECT pixelverif_admin_price_idr FROM product_variants WHERE id=1").get())
      .toEqual({ pixelverif_admin_price_idr: null });

    const edited = await PUT(
      req("/api/products/1", {
        variants: [{ id: 1, sku: "PV-NORMAL-3", label: "Link Redeem 3 Bulan", price: 29000, stock: 1, is_active: 1 }],
      }, "PUT"),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(edited.status).toBe(200);
    expect(fx.sql.prepare("SELECT price, pixelverif_admin_price_idr FROM product_variants WHERE id=1").get())
      .toEqual({ price: 29000, pixelverif_admin_price_idr: 29000 });

    fx.sql.exec("UPDATE products SET is_active=0 WHERE id=1; UPDATE product_variants SET is_active=0 WHERE product_id=1;");
    const reactivated = await PUT(
      req("/api/products/1", { isActive: true }, "PUT"),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(reactivated.status).toBe(200);
    expect(fx.sql.prepare("SELECT is_active FROM product_variants WHERE id=1").get()).toEqual({ is_active: 1 });
  });
});

describe("Pixel Verification storefront delivery badge and checkout quote", () => {
  it("shows 'Diproses otomatis' / 'Processed automatically' (1–5 min) instead of 'Made By Order' or 'Kirim otomatis'", async () => {
    const detail = await getProductDetail("google-ai-pro-3-bulan");
    expect(detail).toBeTruthy();
    const storefront = withVariantCopy(detail!);
    const v = storefront.variants[0];

    expect(v.delivery_kind).toBe("queued");
    expect(v.automatic_processing).toBe(true);
    expect(v.pixelverif_input).toBe(true);
    expect(v).not.toHaveProperty("automatic_delivery");
    expect(v).not.toHaveProperty("pixelverif_flow_type");

    expect(buyerDeliveryKind(v)).toBe("queued");
    expect(buyerDeliveryBadge(v)).toBe("Diproses otomatis");
    expect(catalogDeliveryBadge(v, "id")).toBe("Diproses otomatis");
    expect(catalogDeliveryBadge(v, "en")).toBe("Processed automatically");

    const etaId = catalogDeliveryEta(v, "id");
    const etaEn = catalogDeliveryEta(v, "en");
    expect(etaId).toContain("1–5 menit");
    expect(etaId).not.toContain("15 menit–1 jam");
    expect(etaId.toLowerCase()).not.toContain("pixel");
    expect(etaEn).toContain("1–5 minutes");
    expect(etaEn.toLowerCase()).not.toContain("pixel");
  });

  it("marks Pixel items in POST /api/checkout/quote as queued_delivery + automatic_processing", async () => {
    const { POST: quote } = await import("@/app/api/checkout/quote/route");
    const res = await quote(req("/api/checkout/quote", {
      items: [{ product_id: 1, variant_id: 1, qty: 1, buyer_fields: pvFields }],
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { items: Array<Record<string, unknown>> };
    expect(body.items[0]).toMatchObject({
      queued_delivery: true,
      automatic_processing: true,
    });
  });
});
