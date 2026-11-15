// tests/admin-supplier-price-controls.test.ts — kontrol harga supplier AIVault/TUNVN.
// Bug 1: menyimpan Produk tidak boleh membekukan harga rumus menjadi manual.
// Bug 2: PATCH Buff Muse harus menyegarkan ringkasan produk induk.
// Bug 3: admin_price_idr 0 = "ikut rumus" (disimpan NULL).
// Feature 4: flag excluded/product_archived/archived untuk panel admin.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));

let fx: ReturnType<typeof createD1Fixture>;

const AV_SERVICE = "service_gemini_plus_6m";
const AV_SKU = `AV-${AV_SERVICE}`;
const req = (url: string, body: unknown, method = "PUT") => new NextRequest(`http://localhost${url}`, {
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const variantRow = (sku: string) => fx.sql.prepare("SELECT * FROM product_variants WHERE sku=?").get(sku) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
  fx = createD1Fixture();
  clearRateLimitBucketsForTest();
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active) VALUES
      (1,'ChatGPT Private','chatgpt-tunvn',112400,22,1),
      (2,'Google AI / Gemini Plus','gemini-plus-av',13500,5,1);
    UPDATE products SET aivault_family='gemini' WHERE id=2;
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,tunvn_source_product_id,aivault_service_id) VALUES
      (1,1,'TUNVN-86','Business 1 Bulan',112400,22,1,86,NULL),
      (2,2,'${AV_SKU}','Plus 6 Bulan',13500,5,1,NULL,'${AV_SERVICE}');
    INSERT INTO tunvn_products(supplier_product_id,name,price_usdt,fx_idr_per_usdt,axvara_product_id) VALUES
      (86,'Business',4.6,18086,1);`);
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); });

describe("Produk save never freezes formula prices into manual overrides", () => {
  const putProduct = async (id: number, variants: unknown[]) => {
    const { PUT } = await import("@/app/api/products/[id]/route");
    return PUT(req(`/api/products/${id}`, { variants }, "PUT"), { params: Promise.resolve({ id: String(id) }) });
  };

  it("leaves manual columns NULL when the submitted prices are unchanged", async () => {
    const res = await putProduct(1, [{ id: 1, sku: "TUNVN-86", label: "Business 1 Bulan", price: 112400 }]);
    expect(res.status).toBe(200);
    expect(variantRow("TUNVN-86")).toMatchObject({ price: 112400, tunvn_admin_price_idr: null });

    const av = await putProduct(2, [{ id: 2, sku: AV_SKU, label: "Plus 6 Bulan", price: 13500 }]);
    expect(av.status).toBe(200);
    expect(variantRow(AV_SKU)).toMatchObject({ price: 13500, aivault_admin_price_idr: null });
  });

  it("still records a manual price when the admin really edits it", async () => {
    expect((await putProduct(1, [{ id: 1, sku: "TUNVN-86", label: "Business 1 Bulan", price: 130000 }])).status).toBe(200);
    expect(variantRow("TUNVN-86")).toMatchObject({ price: 130000, tunvn_admin_price_idr: 130000 });

    expect((await putProduct(2, [{ id: 2, sku: AV_SKU, label: "Plus 6 Bulan", price: 14000 }])).status).toBe(200);
    expect(variantRow(AV_SKU)).toMatchObject({ price: 14000, aivault_admin_price_idr: 14000 });
  });
});

describe("admin variant endpoints keep formula prices when the value is unchanged", () => {
  it("single PUT with the stored price leaves the override untouched", async () => {
    const { PUT } = await import("@/app/api/admin/variants/route");
    const res = await PUT(req("/api/admin/variants?id=1", { price: 112400 }, "PUT"));
    expect(res.status).toBe(200);
    expect(variantRow("TUNVN-86").tunvn_admin_price_idr).toBeNull();
  });

  it("single PUT records a changed price as the manual override", async () => {
    const { PUT } = await import("@/app/api/admin/variants/route");
    expect((await PUT(req("/api/admin/variants?id=1", { price: 125000 }, "PUT"))).status).toBe(200);
    expect(variantRow("TUNVN-86")).toMatchObject({ price: 125000, tunvn_admin_price_idr: 125000 });
  });

  it("bulk save leaves an unchanged TUNVN price automatic", async () => {
    const { POST } = await import("@/app/api/admin/variants/route");
    const res = await POST(req("/api/admin/variants", {
      product_id: 1,
      variants: [{ id: 1, product_id: 1, sku: "TUNVN-86", label: "Business 1 Bulan", price: 112400 }],
    }, "POST"));
    expect(res.status).toBe(200);
    expect(variantRow("TUNVN-86").tunvn_admin_price_idr).toBeNull();
  });

  it("bulk save records a changed price as the manual override", async () => {
    const { POST } = await import("@/app/api/admin/variants/route");
    const res = await POST(req("/api/admin/variants", {
      product_id: 1,
      variants: [{ id: 1, product_id: 1, sku: "TUNVN-86", label: "Business 1 Bulan", price: 120000 }],
    }, "POST"));
    expect(res.status).toBe(200);
    expect(variantRow("TUNVN-86")).toMatchObject({ price: 120000, tunvn_admin_price_idr: 120000 });
  });
});

describe("Buff Muse control refreshes the parent product summary", () => {
  const buffPatch = async (body: unknown) => {
    const { PATCH } = await import("@/app/api/admin/tunvn/buff/[sku]/route");
    return PATCH(req("/api/admin/tunvn/buff/TUNVN-BUFF-1B", body, "PATCH"), { params: Promise.resolve({ sku: "TUNVN-BUFF-1B" }) });
  };

  beforeEach(() => {
    fx.sql.exec(`UPDATE products SET price=16000, stock=0 WHERE id=1;
      INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,tunvn_buff_quantity_b,tunvn_cost_usdt,tunvn_markup_percent,tunvn_fx_idr_per_usdt) VALUES
        (3,1,'TUNVN-BUFF-1B','Buff per 1B',1500,-1,1,1,0.0588,40,18086),
        (4,1,'MUSE-ACCOUNT','Account',16000,20,0,NULL,NULL,NULL,NULL);`);
  });

  it("recomputes products.price and products.stock after a markup change", async () => {
    expect((await buffPatch({ markup_percent: 40 })).status).toBe(200);
    expect(fx.sql.prepare("SELECT price,stock FROM products WHERE id=1").get()).toEqual({ price: 1500, stock: -1 });
  });

  it("treats admin_price_idr 0 as 'follow formula' and stores NULL", async () => {
    fx.sql.exec("UPDATE product_variants SET tunvn_admin_price_idr=99900, price=99900 WHERE sku='TUNVN-BUFF-1B'");
    expect((await buffPatch({ admin_price_idr: 0 })).status).toBe(200);
    expect(fx.sql.prepare("SELECT tunvn_admin_price_idr,price FROM product_variants WHERE sku='TUNVN-BUFF-1B'").get())
      .toEqual({ tunvn_admin_price_idr: null, price: 1500 });
  });

  it("still reports fx_missing for 0 without stored FX", async () => {
    fx.sql.exec(`UPDATE product_variants SET tunvn_fx_idr_per_usdt=NULL,tunvn_cost_usdt=NULL,tunvn_admin_price_idr=NULL,price=99900
      WHERE sku='TUNVN-BUFF-1B'`);
    expect((await buffPatch({ admin_price_idr: 0 })).status).toBe(409);
    expect(fx.sql.prepare("SELECT price,tunvn_admin_price_idr FROM product_variants WHERE sku='TUNVN-BUFF-1B'").get())
      .toEqual({ price: 99900, tunvn_admin_price_idr: null });
  });
});

describe("TUNVN product control treats 0 as formula", () => {
  it("normalizes admin_price_idr 0 to NULL and prices from the formula", async () => {
    fx.sql.exec("UPDATE product_variants SET tunvn_admin_price_idr=99000, price=99000 WHERE sku='TUNVN-86'");
    const { PATCH } = await import("@/app/api/admin/tunvn/products/[id]/route");
    const res = await PATCH(req("/api/admin/tunvn/products/86", { admin_price_idr: 0 }, "PATCH"), { params: Promise.resolve({ id: "86" }) });
    expect(res.status).toBe(200);
    expect(variantRow("TUNVN-86")).toMatchObject({ tunvn_admin_price_idr: null, price: 112400 });
  });
});

describe("admin catalog flags for the UI", () => {
  beforeEach(() => { fx.sql.exec("UPDATE products SET slug='muse-ai-1-miliar-token' WHERE id=1"); });

  it("tags excluded and archived TUNVN mirrors", async () => {
    fx.sql.exec("INSERT INTO tunvn_products(supplier_product_id,name,price_usdt,description) VALUES(60,'API TEST',1,'Supplier copy line')");
    const { GET } = await import("@/app/api/admin/tunvn/products/route");
    const list = async () => (await GET(new NextRequest("http://localhost/api/admin/tunvn/products"))).json();
    const row = (body: { items: { supplier_product_id: number }[] }, id: number) =>
      body.items.find((item) => item.supplier_product_id === id) as Record<string, unknown>;

    let body = await list();
    expect(row(body, 86)).toMatchObject({ excluded: 0, product_archived: 0 });
    expect(row(body, 60)).toMatchObject({ excluded: 1, supplier_description: "Supplier copy line" });

    fx.sql.exec("UPDATE products SET is_active=0, archived_at=datetime('now') WHERE id=1");
    body = await list();
    expect(row(body, 86)).toMatchObject({ product_archived: 1 });
  });

  it("tags the archived AIVault parent and keeps product_name", async () => {
    fx.sql.exec(`INSERT INTO aivault_products(service_id,name,stock,unit_price_usd,pricing_tiers_json,axvara_product_id)
      VALUES('${AV_SERVICE}','Gemini',5,0.5,'[]',2)`);
    const { GET } = await import("@/app/api/admin/aivault/products/route");
    const list = async () => (await GET(new NextRequest("http://localhost/api/admin/aivault/products"))).json();

    let body = await list();
    expect(body.items[0]).toMatchObject({ service_id: AV_SERVICE, product_name: "Google AI / Gemini Plus", product_archived: 0 });

    fx.sql.exec("UPDATE products SET is_active=0, archived_at=datetime('now') WHERE id=2");
    body = await list();
    expect(body.items[0].product_archived).toBe(1);
  });

  it("exposes archived on the Buff Muse product", async () => {
    const { GET } = await import("@/app/api/admin/tunvn/buff/route");
    const list = async () => (await GET(new NextRequest("http://localhost/api/admin/tunvn/buff"))).json();

    expect((await list()).muse_product).toMatchObject({ archived: 0 });
    fx.sql.exec("UPDATE products SET is_active=0, archived_at=datetime('now') WHERE id=1");
    expect((await list()).muse_product).toMatchObject({ archived: 1 });
  });
});
