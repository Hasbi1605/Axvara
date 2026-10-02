// tests/unique-effective-stock.integration.test.ts — Stok jujur varian unique
// (insiden Head 18 Bulan 2026-10-02: kolom stock=2 tapi inventory available=1,
// PDP bilang "Sisa 2" padahal kredensial tersisa 1).
//
// Kontrak yang dikunci:
//  - effectiveVariantStock = min(stock, available) untuk unique; -1 ikut
//    inventory; non-unique = kolom apa adanya.
//  - /api/catalog?slug= membawa inventory_available + PDP memakai angka efektif.
//  - quote menolak saat inventory habis walau kolom stock > 0 (pesan "stok habis").
//  - import inventory menyelaraskan kolom stock unique (syncUniqueVariantStock).
//  - GET fulfillment membawa variant_stock + stock_mismatch untuk banner admin.
//  - Cache slug PDP (catalog + products) = 10 detik, bukan 30.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";
import { effectiveVariantStock, isUniqueInventoryEmpty } from "@/lib/catalog";
import { isPurchasableStock } from "@/lib/catalog-availability";
import { syncUniqueVariantStock } from "@/lib/fulfillment/inventory";
import { encryptSecret } from "@/lib/fulfillment/crypto";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";

const auth = vi.hoisted(() => ({ admin: true as boolean }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireAdmin: vi.fn(async () => (auth.admin ? { email: "fixture@example.test" } : null)),
  };
});

let fixture: ReturnType<typeof createD1Fixture>;

async function seedInventory(productId: number, variantId: number | null, statuses: string[]) {
  for (let i = 0; i < statuses.length; i++) {
    const s = await encryptSecret(`SECRET-${variantId ?? "legacy"}-${i}-${Math.random()}`);
    fixture.sql.prepare(
      "INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint,status) VALUES(?,?,?,?,?,?)",
    ).run(productId, variantId, s.ciphertext, s.iv, `fp-${variantId}-${i}-${Math.random()}`, statuses[i]);
  }
}

beforeEach(() => {
  auth.admin = true;
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
  vi.stubEnv("FULFILLMENT_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  stubFulfillmentKey();
  clearRateLimitBucketsForTest();
  fixture = createD1Fixture();
  fixture.sql.exec(`
    INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active)
      VALUES (60, 1, 'Google AI Pro / Antigravity', 'google-ai-pro-antigravity', 'Deskripsi', 14000, 22, 1);
    INSERT INTO product_variants (id, product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order)
      VALUES (101, 60, 'HEAD-18', 'Google AI Pro Head - 18 Bulan', 18000, 2, 'unique', 1, 0);
    INSERT INTO product_variants (id, product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order)
      VALUES (102, 60, 'INVITE-18', 'Google AI Pro Invite - 18 Bulan', 14000, 20, 'manual', 1, 1);
  `);
});

afterEach(() => {
  fixture.close();
  vi.unstubAllEnvs();
  clearRateLimitBucketsForTest();
});

describe("effectiveVariantStock (unit murni)", () => {
  it("unique: min(stock, available) — kasus Head 2 vs 1 = 1", () => {
    expect(effectiveVariantStock({ stock: 2, fulfillment_mode: "unique", inventory_available: 1 })).toBe(1);
  });
  it("unique tanpa data inventory (null) = kolom stock (perilaku lama)", () => {
    expect(effectiveVariantStock({ stock: 2, fulfillment_mode: "unique", inventory_available: null })).toBe(2);
    expect(effectiveVariantStock({ stock: 2, fulfillment_mode: "unique" })).toBe(2);
  });
  it("unique unlimited (-1) ikut inventory, bukan janji ∞ palsu", () => {
    expect(effectiveVariantStock({ stock: -1, fulfillment_mode: "unique", inventory_available: 3 })).toBe(3);
    expect(effectiveVariantStock({ stock: -1, fulfillment_mode: "unique", inventory_available: 0 })).toBe(0);
  });
  it("non-unique tidak disentuh (shared/manual ikut kolom)", () => {
    expect(effectiveVariantStock({ stock: 20, fulfillment_mode: "manual", inventory_available: 0 })).toBe(20);
    expect(effectiveVariantStock({ stock: 5, fulfillment_mode: "shared", inventory_available: 0 })).toBe(5);
  });
  it("isUniqueInventoryEmpty jujur saat kolom > 0 tapi unit habis", () => {
    expect(isUniqueInventoryEmpty({ stock: 2, fulfillment_mode: "unique", inventory_available: 0 })).toBe(true);
    expect(isUniqueInventoryEmpty({ stock: 0, fulfillment_mode: "unique", inventory_available: 0 })).toBe(false);
    expect(isUniqueInventoryEmpty({ stock: 2, fulfillment_mode: "manual", inventory_available: 0 })).toBe(false);
  });
  it("isPurchasableStock menolak unique yang unitnya habis walau kolom > 0", () => {
    expect(isPurchasableStock(2, 1, 0)).toBe(false);
    expect(isPurchasableStock(2, 1, 1)).toBe(true);
    expect(isPurchasableStock(2, 1, null)).toBe(true);
  });
});

describe("/api/catalog?slug= membawa inventory_available", () => {
  it("varian unique Head membawa available=1 saat stock=2", async () => {
    await seedInventory(60, 101, ["available", "delivered", "delivered"]);
    const { GET } = await import("@/app/api/catalog/route");
    const res = await GET(new Request("http://localhost/api/catalog?slug=google-ai-pro-antigravity"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      product: { variants: { id: number; stock: number; inventory_available: number | null; fulfillment_mode: string }[] };
    };
    const head = body.product.variants.find((v) => v.id === 101)!;
    expect(head.stock).toBe(2);
    expect(head.inventory_available).toBe(1);
    expect(effectiveVariantStock({ ...head })).toBe(1);
    const invite = body.product.variants.find((v) => v.id === 102)!;
    expect(invite.inventory_available).toBe(0);
    // Manual: inventory_available 0 tidak menurunkan kolom (helper yang jaga).
    expect(effectiveVariantStock({ ...invite })).toBe(20);
  });

  it("cache slug PDP 10 detik (bukan 30)", async () => {
    const { GET } = await import("@/app/api/catalog/route");
    const res = await GET(new Request("http://localhost/api/catalog?slug=google-ai-pro-antigravity"));
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=10, stale-while-revalidate=30");
  });

  it("cache ?slug= products 10 detik, daftar tetap 30 detik", async () => {
    const { GET } = await import("@/app/api/products/route");
    const bySlug = await GET(new NextRequest("http://localhost/api/products?active=1&slug=google-ai-pro-antigravity"));
    expect(bySlug.headers.get("Cache-Control")).toBe("public, max-age=10, s-maxage=10, stale-while-revalidate=30");
    const list = await GET(new NextRequest("http://localhost/api/products?active=1"));
    expect(list.headers.get("Cache-Control")).toBe("public, max-age=30, s-maxage=30, stale-while-revalidate=60");
  });
});

describe("quote menolak unique yang unitnya habis", () => {
  it("stock=2 + available=0 → out_of_stock (bukan lolos lalu gagal di guard)", async () => {
    vi.stubEnv("DANA_QRIS_ENABLED", "false");
    fixture.sql.exec(`INSERT OR IGNORE INTO payment_methods(id,label,account_number,account_name,is_active,sort_order) VALUES('qris','QRIS','-','AXVARA',1,1)`);
    const { POST } = await import("@/app/api/checkout/quote/route");
    const res = await POST(new NextRequest("http://localhost/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.9" },
      body: JSON.stringify({ items: [{ product_id: 60, variant_id: 101, qty: 1, expected_price: 18000 }] }),
    }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { issues: { type: string; message: string }[] };
    expect(body.issues[0].type).toBe("out_of_stock");
  });

  it("stock=2 + available=1 → lolos dengan stock efektif 1", async () => {
    await seedInventory(60, 101, ["available"]);
    vi.stubEnv("DANA_QRIS_ENABLED", "false");
    fixture.sql.exec(`INSERT OR IGNORE INTO payment_methods(id,label,account_number,account_name,is_active,sort_order) VALUES('qris','QRIS','-','AXVARA',1,1)`);
    const { POST } = await import("@/app/api/checkout/quote/route");
    const res = await POST(new NextRequest("http://localhost/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.10" },
      body: JSON.stringify({ items: [{ product_id: 60, variant_id: 101, qty: 1, expected_price: 18000 }] }),
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { stock: number }[] };
    expect(body.items[0].stock).toBe(1);
  });
});

describe("syncUniqueVariantStock + banner admin", () => {
  it("import menyelaraskan kolom stock unique ke available", async () => {
    await seedInventory(60, 101, ["available", "available", "available", "delivered"]);
    expect(await syncUniqueVariantStock(60, 101)).toBe(3);
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=101").get()?.stock).toBe(3);
  });

  it("varian manual tidak disentuh sync", async () => {
    await seedInventory(60, 102, ["available"]);
    expect(await syncUniqueVariantStock(60, 102)).toBeNull();
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=102").get()?.stock).toBe(20);
  });

  it("GET fulfillment membawa variant_stock + stock_mismatch=true saat selisih", async () => {
    await seedInventory(60, 101, ["available"]);
    const { GET } = await import("@/app/api/admin/fulfillment/route");
    const res = await GET(new NextRequest("http://localhost/api/admin/fulfillment?product_id=60&variant_id=101"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { variant_stock: number; stock_mismatch: boolean; available: number };
    expect(body.variant_stock).toBe(2);
    expect(body.available).toBe(1);
    expect(body.stock_mismatch).toBe(true);
  });

  it("stock_mismatch=false setelah diselaraskan", async () => {
    await seedInventory(60, 101, ["available"]);
    await syncUniqueVariantStock(60, 101);
    const { GET } = await import("@/app/api/admin/fulfillment/route");
    const res = await GET(new NextRequest("http://localhost/api/admin/fulfillment?product_id=60&variant_id=101"));
    const body = (await res.json()) as { variant_stock: number; stock_mismatch: boolean };
    expect(body.variant_stock).toBe(1);
    expect(body.stock_mismatch).toBe(false);
  });
});
