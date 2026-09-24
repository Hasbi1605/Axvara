// tests/product-require-email.integration.test.ts — Sisi server centang "Wajib
// email pembeli" (products.require_email, migrasi 0033) pada D1 nyata.
//
// Dikunci:
//  - POST /api/products menyimpan requireEmail (dulu tidak ada di skema POST,
//    sehingga produk baru selalu require_email=0 walau dicentang).
//  - PUT tanpa kunci requireEmail tidak menyentuh kolomnya.
//  - GET detail mengembalikan nilai tersimpan, sumber editor saat dibuka ulang.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));

let fixture: ReturnType<typeof createD1Fixture>;

beforeEach(() => {
  fixture = createD1Fixture();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
  fixture.sql.exec(`
    INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, require_email)
      VALUES (1, 2, 'Canva Pro / Premium', 'canva-premium', 'desc', 2000, -1, 1, 1);
    INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, sort_order)
      VALUES (1, 1, 'DEFAULT-1', 'Default', 2000, -1, 1, 0);
  `);
});
afterEach(() => { fixture.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function req(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}
const requireEmailOf = (slug: string) =>
  (fixture.sql.prepare("SELECT require_email FROM products WHERE slug=?").get(slug) as { require_email: number }).require_email;

describe("products.require_email lewat API admin", () => {
  it("produk baru menyimpan centang email; tanpa centang tetap 0", async () => {
    const { POST } = await import("@/app/api/products/route");
    const on = await POST(req("/api/products", "POST", { name: "Ebook Desain", slug: "ebook-desain", price: 15000, categorySlug: "tools-pro", requireEmail: true }));
    expect(on.status).toBe(200);
    expect(requireEmailOf("ebook-desain")).toBe(1);

    const off = await POST(req("/api/products", "POST", { name: "Template Slide", slug: "template-slide", price: 15000, categorySlug: "tools-pro" }));
    expect(off.status).toBe(200);
    expect(requireEmailOf("template-slide")).toBe(0);
  });

  it("PUT tanpa requireEmail tidak menghapus nilai tersimpan; GET detail membacanya", async () => {
    const { PUT, GET } = await import("@/app/api/products/[id]/route");
    const ctx = { params: Promise.resolve({ id: "1" }) };
    const res = await PUT(req("/api/products/1", "PUT", { name: "Canva Pro", slug: "canva-premium", badge: "Terlaris" }), ctx);
    expect(res.status).toBe(200);
    expect(requireEmailOf("canva-premium")).toBe(1);

    const detail = await GET(req("/api/products/1", "GET"), ctx);
    const body = await detail.json() as { product: { requireEmail: boolean } };
    expect(body.product.requireEmail).toBe(true);
  });

  it("PUT requireEmail false mematikan centang", async () => {
    const { PUT } = await import("@/app/api/products/[id]/route");
    const res = await PUT(req("/api/products/1", "PUT", { requireEmail: false }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
    expect(requireEmailOf("canva-premium")).toBe(0);
  });
});
