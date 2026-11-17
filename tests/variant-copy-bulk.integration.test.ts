import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Miniflare } from "miniflare";
import { POST } from "@/app/api/admin/variant-copy/bulk/route";
import { GET, PUT } from "@/app/api/admin/variant-copy/route";
import { VARIANT_COPY_MAX_CHARS } from "@/lib/product-copy/format";
import { supplierFingerprint } from "@/lib/product-copy/text";
import { clearRateLimitBucketsForTest, rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { createD1Fixture } from "./helpers/d1-fixture";

const auth = vi.hoisted(() => ({ admin: true }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => auth.admin ? { email: "fixture@example.test" } : null) }));

let fixture: ReturnType<typeof createD1Fixture>;
const seed = `
  INSERT INTO products(id,name,slug,price) VALUES(1,'Copy','copy',10000),(2,'Other','other',10000);
  INSERT INTO product_variants(id,product_id,sku,label,price,wr_variant_id,sk_variant_id)
    VALUES(1,1,'WR-COPY','WR',10000,'wr-copy',NULL),
          (2,1,'SK-COPY','SK',10000,NULL,'sk-copy'),
          (3,1,'MANUAL-COPY','Manual',10000,NULL,NULL),
          (4,2,'OTHER','Other product',10000,NULL,NULL);
  INSERT INTO wr_products(wr_product_id,wr_product_name) VALUES('wr-product','WR');
  INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_terms,wr_delivery_terms)
    VALUES('wr-copy','wr-product','WR',10000,'WR rules','WR login');
  INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_description,sk_seller_note)
    VALUES('sk-copy','sk-product','SK','SK',10000,'SK rules','SK login');`;
const payload = {
  product_id: 1, variant_ids: [1, 2], terms: "Detail paket:\n- Salinan admin", activation: "1. Login",
  terms_en: "Package details:\n- Admin copy", activation_en: "1. Log in",
};
const columns = "admin_terms,admin_activation,admin_terms_en,admin_activation_en,admin_copy_fingerprint";
const request = (body: unknown) => new NextRequest("http://localhost/api/admin/variant-copy/bulk", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  auth.admin = true;
  clearRateLimitBucketsForTest();
  fixture = createD1Fixture();
  fixture.sql.exec(seed);
});
afterEach(() => { fixture.close(); vi.restoreAllMocks(); });

describe("POST /api/admin/variant-copy/bulk", () => {
  it("writes two variants in one batch using each CURRENT WR/SK fingerprint and the GET serializer", async () => {
    fixture.sql.exec("UPDATE product_variants SET admin_copy_fingerprint='old'; UPDATE wr_variants SET wr_terms='Updated WR rules'");
    const batch = vi.spyOn(fixture.db, "batch");
    const response = await POST(request(payload));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toHaveLength(2);
    const body = await response.json();
    const get = await GET(new NextRequest("http://localhost/api/admin/variant-copy?product_id=1"));
    expect(body.variants).toEqual((await get.json()).variants.filter((row: { variantId: number }) => row.variantId !== 3));
    for (const [id, key] of [[1, supplierFingerprint("Updated WR rules", "WR login")], [2, supplierFingerprint("SK rules", "SK login")]]) {
      expect(fixture.sql.prepare(`SELECT ${columns} FROM product_variants WHERE id=?`).get(id)).toEqual({
        admin_terms: payload.terms, admin_activation: payload.activation, admin_terms_en: payload.terms_en,
        admin_activation_en: payload.activation_en, admin_copy_fingerprint: key,
      });
    }
    expect(body.variants.every((row: { status: string; adminStale: boolean }) => row.status === "admin" && !row.adminStale)).toBe(true);
  });

  it("normalizes newlines/whitespace, clears empty strings to NULL, and uses empty fingerprint for Manual", async () => {
    expect((await POST(request({ ...payload, variant_ids: [3], terms: "  - Manual\r\n- Rule  ", activation: "", terms_en: "  ", activation_en: "" }))).status).toBe(200);
    expect(fixture.sql.prepare(`SELECT ${columns} FROM product_variants WHERE id=3`).get()).toEqual({
      admin_terms: "- Manual\n- Rule", admin_activation: null, admin_terms_en: null, admin_activation_en: null, admin_copy_fingerprint: "",
    });
    expect((await POST(request({ ...payload, terms: "", activation: "", terms_en: "", activation_en: "" }))).status).toBe(200);
    expect(fixture.sql.prepare(`SELECT ${columns} FROM product_variants WHERE id=1`).get()).toEqual({
      admin_terms: null, admin_activation: null, admin_terms_en: null, admin_activation_en: null,
      admin_copy_fingerprint: supplierFingerprint("WR rules", "WR login"),
    });
  });

  it.each([[1, 4], [1, 999]])("rejects foreign or missing variants %j without writing", async (...variant_ids) => {
    const batch = vi.spyOn(fixture.db, "batch");
    const response = await POST(request({ ...payload, variant_ids }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "foreign_variant" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(batch).not.toHaveBeenCalled();
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE admin_terms IS NOT NULL").get()).toEqual({ n: 0 });
  });

  it.each([[], [1, 1], Array.from({ length: 21 }, (_, i) => i + 1), [0], [1.5], ["1"]])("rejects invalid ids %j", async (...variant_ids) => {
    const response = await POST(request({ ...payload, variant_ids }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_ids" });
    expect(fixture.control.queries).toBe(0);
  });

  it.each(["terms", "activation", "terms_en", "activation_en"])("bounds and requires %s", async field => {
    expect((await POST(request({ ...payload, [field]: "x".repeat(VARIANT_COPY_MAX_CHARS + 1) }))).status).toBe(400);
    expect((await POST(request({ ...payload, [field]: undefined }))).status).toBe(400);
    expect(fixture.control.queries).toBe(0);
  });

  it("requires admin before reading or writing", async () => {
    auth.admin = false;
    const response = await POST(request(payload));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fixture.control.queries).toBe(0);
  });

  it("returns 404 for an unknown product without writing", async () => {
    const response = await POST(request({ ...payload, product_id: 999 }));
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fixture.control.queries).toBe(1);
  });

  it("uses the same rate-limit bucket as PUT and includes no-store/Retry-After", async () => {
    const req = request(payload);
    for (let i = 0; i < 30; i++) expect(rateLimit(rateLimitKey(req, "variant-copy:write"), 30)).toBe(true);
    const response = await POST(req);
    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("60");
    expect((await PUT(new NextRequest("http://localhost/api/admin/variant-copy", { method: "PUT" }))).status).toBe(429);
    expect(fixture.control.queries).toBe(0);
  });

  it("bounds actual streamed bytes and rejects malformed JSON before DB work", async () => {
    const oversized = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(" ".repeat(32_001))); controller.close(); } });
    const response = await POST(new NextRequest("http://localhost/api/admin/variant-copy/bulk", { method: "POST", body: oversized, duplex: "half" } as ConstructorParameters<typeof NextRequest>[1]));
    expect(response.status).toBe(413);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await POST(new NextRequest("http://localhost/api/admin/variant-copy/bulk", { method: "POST", body: "{" }))).status).toBe(400);
    expect(fixture.control.queries).toBe(0);
  });

  it("rolls back the whole batch when a later write fails", async () => {
    fixture.control.fail = (sql, params) => sql.startsWith("UPDATE product_variants") && params[5] === 2;
    await expect(POST(request(payload))).rejects.toThrow("Injected database interruption");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE admin_terms IS NOT NULL").get()).toEqual({ n: 0 });
  });

  it("executes the endpoint batch on native D1/workerd", async () => {
    const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06", script: 'export default {fetch(){return new Response("fixture")}}', d1Databases: ["DB"] });
    try {
      const db = await runtime.getD1Database("DB");
      const tables = fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { sql: string }[];
      await db.batch(tables.map(row => db.prepare(row.sql)));
      await db.batch(seed.split(";").map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql)));
      (globalThis as Record<string, unknown>).DB = db;
      const response = await POST(request({ ...payload, variant_ids: [1, 2, 3], activation_en: "" }));
      expect(response.status).toBe(200);
      expect((await response.json()).variants).toHaveLength(3);
      expect(await db.prepare("SELECT admin_copy_fingerprint FROM product_variants ORDER BY id").all()).toMatchObject({ results: [
        { admin_copy_fingerprint: supplierFingerprint("WR rules", "WR login") },
        { admin_copy_fingerprint: supplierFingerprint("SK rules", "SK login") },
        { admin_copy_fingerprint: "" }, { admin_copy_fingerprint: null },
      ] });
      expect(await db.prepare("SELECT COUNT(*) n FROM product_variants WHERE admin_terms=? AND admin_activation_en IS NULL").bind(payload.terms).first()).toEqual({ n: 3 });
    } finally { await runtime.dispose(); }
  }, 30000);
});
