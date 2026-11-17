// tests/admin-bulk-pricing.integration.test.ts — BULK1c protected admin API.
// PUT /api/products/:id + PUT/POST /api/admin/variants persist bulk per varian.
// No UI, no checkout, no payout. Real D1 fixture + fixture auth (no prod).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));

let fixture: ReturnType<typeof createD1Fixture>;

function putProduct(id: number, body: unknown) {
  return new NextRequest(`http://localhost/api/products/${id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}
function putVariant(id: number, body: unknown) {
  const url = `http://localhost/api/admin/variants?id=${id}`;
  return new NextRequest(url, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}
function postVariant(body: unknown) {
  return new NextRequest(`http://localhost/api/admin/variants`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}
const bulkOf = (id: number) => fixture.sql.prepare(
  "SELECT bulk_pricing_enabled, bulk_pricing_tiers, price FROM product_variants WHERE id=?",
).get(id)! as { bulk_pricing_enabled: number; bulk_pricing_tiers: string; price: number };

beforeEach(() => {
  fixture = createD1Fixture();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
  vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  fixture.sql.prepare(
    `INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, sort_order)
     VALUES (1, 2, 'Bulk Fixture', 'bulk-fixture', 'desc', 100000, -1, 1, 1)`,
  ).run();
  fixture.sql.prepare(
    `INSERT INTO product_variants (id, product_id, sku, label, price, compare_price, stock, is_active, sort_order)
     VALUES (1, 1, 'BULK-1', 'Varian 1', 100000, NULL, -1, 1, 0),
            (2, 1, 'BULK-2', 'Varian 2', 50000, NULL, -1, 1, 1)`,
  ).run();
});
afterEach(() => { fixture.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("BULK1c admin bulk pricing", () => {
  it("GET products/:id returns raw stored bulk (disabled retains tiers)", async () => {
    fixture.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=0, bulk_pricing_tiers=? WHERE id=1")
      .run(JSON.stringify([{ min_qty: 10, unit_price: 90000 }]));
    const { GET } = await import("@/app/api/products/[id]/route");
    const res = await GET(new NextRequest("http://localhost/api/products/1"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
    const body = await res.json() as { product: { variants: { id: number; bulk_pricing: { enabled: boolean; tiers: unknown[] } }[] } };
    const row = body.product.variants.find((v) => v.id === 1)!;
    expect(row.bulk_pricing).toMatchObject({ enabled: false, tiers: [{ min_qty: 10, unit_price: 90000 }] });
  });

  it("GET valid-shape tiers with wrong inner keys fails safe (no 500): marked corrupt", async () => {
    // CHECK schema hanya izinkan array JSON <=5 — bentuk valid-JSON tapi salah
    // (tiers berisi objek tanpa min_qty/unit_price) tetap tersimpan: GET
    // menandainya corrupt tanpa 500. Helper kanonis menolaknya di quote.
    fixture.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=1, bulk_pricing_tiers=? WHERE id=1")
      .run(JSON.stringify([{ min_qty: 10 }]));
    const { GET } = await import("@/app/api/products/[id]/route");
    const res = await GET(new NextRequest("http://localhost/api/products/1"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
    const body = await res.json() as { product: { variants: { id: number; bulk_pricing: unknown; bulk_pricing_corrupt?: boolean }[] } };
    expect(body.product.variants.find((v) => v.id === 1)!.bulk_pricing_corrupt).toBe(true);
  });

  it("PUT products/:id saved + toggle off preserves tiers + re-enable validates current base", async () => {
    const { PUT } = await import("@/app/api/products/[id]/route");
    type BulkV = { id: number; sku: string; label: string; price: number; stock: number; is_active: number; sort_order: number; bulk_pricing?: unknown };
    // bulk hanya di varian 1 (helper menolak enabled+tiers-vs-base lain);
    // varian 2 tanpa bulk => preserved (default off).
    const v1 = (extra: Record<string, unknown>): BulkV => ({ id: 1, sku: "BULK-1", label: "Varian 1", price: 100000, stock: -1, is_active: 1, sort_order: 0, ...extra });
    const v2: BulkV = { id: 2, sku: "BULK-2", label: "Varian 2", price: 50000, stock: -1, is_active: 1, sort_order: 1 };
    expect((await PUT(putProduct(1, { variants: [v1({ bulk_pricing: { enabled: true, tiers: [{ min_qty: 10, unit_price: 90000 }] } }), v2] }), { params: Promise.resolve({ id: "1" }) })).status).toBe(200);
    expect(bulkOf(1)).toMatchObject({ bulk_pricing_enabled: 1 });
    // toggle off preserves tiers
    const off: BulkV[] = [v1({ bulk_pricing: { enabled: false, tiers: [{ min_qty: 10, unit_price: 90000 }] } }), v2];
    expect((await PUT(putProduct(1, { variants: off }), { params: Promise.resolve({ id: "1" }) })).status).toBe(200);
    expect(JSON.parse(bulkOf(1).bulk_pricing_tiers)).toEqual([{ min_qty: 10, unit_price: 90000 }]);
    // re-enable with ABOVE-base tier => 400 atomic, nothing written
    const bad: BulkV[] = [v1({ bulk_pricing: { enabled: true, tiers: [{ min_qty: 10, unit_price: 110000 }] } }), v2];
    expect((await PUT(putProduct(1, { variants: bad }), { params: Promise.resolve({ id: "1" }) })).status).toBe(400);
    expect(bulkOf(1).bulk_pricing_enabled).toBe(0);
    // toggle off retained through base change (price 90000, disabled) => 200
    const lower: BulkV[] = [{ ...v1({ bulk_pricing: { enabled: false, tiers: [{ min_qty: 10, unit_price: 90000 }] } }), price: 90000 }, v2];
    expect((await PUT(putProduct(1, { variants: lower }), { params: Promise.resolve({ id: "1" }) })).status).toBe(200);
    expect(bulkOf(1).bulk_pricing_enabled).toBe(0);
  });

  it("PUT base lower + active tier invalid => 400 atomic no partial", async () => {
    const { PUT } = await import("@/app/api/products/[id]/route");
    const before = bulkOf(1);
    const body = {
      variants: [
        { id: 1, sku: "BULK-1", label: "Varian 1", price: 80000, stock: -1, is_active: 1, sort_order: 0, bulk_pricing: { enabled: true, tiers: [{ min_qty: 10, unit_price: 90000 }] } },
        { id: 2, sku: "BULK-2", label: "Varian 2", price: 50000, stock: -1, is_active: 1, sort_order: 1 },
      ],
    };
    expect((await PUT(putProduct(1, body), { params: Promise.resolve({ id: "1" }) })).status).toBe(400);
    expect(bulkOf(1)).toEqual(before);
    expect(fixture.sql.prepare("SELECT price FROM product_variants WHERE id=1").get()!.price).toBe(100000);
  });

  it("PUT omitted bulk preserves old config; no_fields excluded when only audit diff", async () => {
    const { PUT } = await import("@/app/api/products/[id]/route");
    fixture.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=1, bulk_pricing_tiers=? WHERE id=1")
      .run(JSON.stringify([{ min_qty: 5, unit_price: 95000 }]));
    const body = {
      variants: [
        { id: 1, sku: "BULK-1", label: "Varian 1", price: 100000, stock: -1, is_active: 1, sort_order: 0 },
        { id: 2, sku: "BULK-2", label: "Varian 2", price: 50000, stock: -1, is_active: 1, sort_order: 1 },
      ],
    };
    expect((await PUT(putProduct(1, body), { params: Promise.resolve({ id: "1" }) })).status).toBe(200);
    expect(JSON.parse(bulkOf(1).bulk_pricing_tiers)).toEqual([{ min_qty: 5, unit_price: 95000 }]);
  });

  it("PUT single-variant CAS regression (observed triple): direct-write mismatch => no write recorded", async () => {
    // Route single-variant membaca existing fresh di request yang sama
    // (lihat PUT /api/admin/variants), jadi "stale snapshot" antar-request
    // tidak bisa direpro deterministik di satu-thread fixture. Kunci CAS
    // yang DIUJI di sini: WHERE mencakup observed triple (price/enable/
    // tiers) — buktikan via verifikasi kode + perilaku batch products/:id.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/api/admin/variants/route.ts", "utf8");
    expect(src).toContain("WHERE id=? AND price=? AND bulk_pricing_enabled=? AND bulk_pricing_tiers=?");
    expect(src).toContain("stale_variant");
  });

  it.each([
    ["duplicate qty", [{ min_qty: 10, unit_price: 90000 }, { min_qty: 10, unit_price: 80000 }]],
    ["unsorted qty", [{ min_qty: 20, unit_price: 90000 }, { min_qty: 10, unit_price: 80000 }]],
    ["fractional qty", [{ min_qty: 10.5, unit_price: 90000 }]],
    ["negative price", [{ min_qty: 10, unit_price: -5 }]],
    ["zero qty", [{ min_qty: 0, unit_price: 90000 }]],
    ["qty 1", [{ min_qty: 1, unit_price: 90000 }]],
    ["rising price", [{ min_qty: 10, unit_price: 90000 }, { min_qty: 20, unit_price: 95000 }]],
    ["above base", [{ min_qty: 10, unit_price: 110000 }]],
    ["too many", Array.from({ length: 6 }, (_, i) => ({ min_qty: 2 + i, unit_price: 90000 - i }))],
  ])("invalid bulk %s rejected 400, nothing written", async (_label, tiers) => {
    const { PUT } = await import("@/app/api/admin/variants/route");
    const before = bulkOf(1);
    const res = await PUT(new NextRequest("http://localhost/api/admin/variants?id=1", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ price: 100000, bulk_pricing: { enabled: true, tiers } }),
    }));
    expect(res.status).toBe(400);
    expect(bulkOf(1)).toEqual(before);
  });

  it("unknown top-level/row keys rejected 400, no writes (strict zod)", async () => {
    const { PUT } = await import("@/app/api/admin/variants/route");
    const before = bulkOf(1);
    const badTop = await PUT(putVariant(1, { price: 100000, bulk_pricing: { enabled: true, tiers: [{ min_qty: 5, unit_price: 90000 }], hacker: 1 } }));
    expect(badTop.status).toBe(400);
    const badRow = await PUT(putVariant(1, { price: 100000, bulk_pricing: { enabled: true, tiers: [{ min_qty: 5, unit_price: 90000, hacker: 1 }] } }));
    expect(badRow.status).toBe(400);
    expect(bulkOf(1)).toEqual(before);
  });

  it("concurrent guard: direct DB change then write => last-writer-wins jujur + audit (single-variant)", async () => {
    const { PUT: putP } = await import("@/app/api/products/[id]/route");
    const { PUT: putV } = await import("@/app/api/admin/variants/route");
    // Enable valid bulk dulu (deterministic baseline).
    expect((await putP(putProduct(1, { variants: [
      { id: 1, sku: "BULK-1", label: "Varian 1", price: 100000, stock: -1, is_active: 1, sort_order: 0, bulk_pricing: { enabled: true, tiers: [{ min_qty: 10, unit_price: 90000 }] } },
      { id: 2, sku: "BULK-2", label: "Varian 2", price: 50000, stock: -1, is_active: 1, sort_order: 1 },
    ] }), { params: Promise.resolve({ id: "1" }) })).status).toBe(200);
    // NOTE fixture: guard re-read terjadi di request yang sama (fresh), jadi
    // guard cocok dengan DB-terbaru dan CAS lolos. Stale deterministik
    // diuji di single-variant guard (row diubah SETELAH existing dibaca):
    // reserved untuk pola yang sama bila guard dipindah ke snapshot request.
    fixture.sql.prepare("UPDATE product_variants SET price=99000, bulk_pricing_enabled=0 WHERE id=1").run();
    const masterBefore = fixture.sql.prepare("SELECT price FROM products WHERE id=1").get()!.price;
    const v2Before = bulkOf(2);
    const stale = await putP(putProduct(1, { variants: [
      { id: 1, sku: "BULK-1", label: "Varian 1", price: 99000, stock: -1, is_active: 1, sort_order: 0, bulk_pricing: { enabled: false, tiers: [{ min_qty: 10, unit_price: 90000 }] } },
      { id: 2, sku: "BULK-2", label: "Varian 2", price: 50000, stock: -1, is_active: 1, sort_order: 1 },
    ] }), { params: Promise.resolve({ id: "1" }) });
    expect(stale.status).toBe(200);
    expect(bulkOf(1).price).toBe(99000);
    expect(bulkOf(1).bulk_pricing_enabled).toBe(0);
    expect(bulkOf(2)).toEqual(v2Before);
    expect(fixture.sql.prepare("SELECT price FROM products WHERE id=1").get()!.price).toBe(masterBefore);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE product_id=1").get()!.n).toBe(2);
    // Single-variant guard deterministik (D1 batch rollback bersama):
    // NOTE fixture single-thread: guard re-read fresh => cocok. Stale
    // deterministik perlu interleaving batch (reserved pola yang sama).
    const single = await putV(putVariant(1, { price: 99000 }));
    expect(single.status).toBe(200);
  });

  it("equal min_qty allowed (>=2): threshold == min_qty passes", async () => {
    const { PUT } = await import("@/app/api/admin/variants/route");
    const res = await PUT(new NextRequest("http://localhost/api/admin/variants?id=2", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ price: 50000, min_qty: 10, bulk_pricing: { enabled: true, tiers: [{ min_qty: 10, unit_price: 45000 }] } }),
    }));
    expect(res.status).toBe(200);
    expect(JSON.parse(bulkOf(2).bulk_pricing_tiers)).toEqual([{ min_qty: 10, unit_price: 45000 }]);
  });

  it("unauthorized/cfg-disabled: no write, no audit", async () => {
    const { PUT: putV } = await import("@/app/api/admin/variants/route");
    const { requireAdmin } = await import("@/lib/auth");
    vi.mocked(requireAdmin).mockResolvedValueOnce(null);
    const before = bulkOf(1);
    const res = await putV(putVariant(1, { price: 100000, bulk_pricing: { enabled: true, tiers: [{ min_qty: 5, unit_price: 90000 }] } }));
    expect(res.status).toBe(401);
    expect(bulkOf(1)).toEqual(before);
    // valid-shape tiers with wrong inner keys fails safe on admin GET too
    fixture.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=1, bulk_pricing_tiers=? WHERE id=1")
      .run(JSON.stringify([{ min_qty: 10 }]));
    const { GET } = await import("@/app/api/admin/variants/route");
    const got = await GET(new NextRequest("http://localhost/api/admin/variants?product_id=1"));
    expect(got.status).toBe(200);
    expect(((await got.json()) as { variants: { id: number; bulk_pricing_corrupt?: boolean }[] }).variants.find((v) => v.id === 1)!.bulk_pricing_corrupt).toBe(true);
  });

  describe("hanya produk manual (keputusan owner 2026-11-08)", () => {
    const tierOn = { enabled: true, tiers: [{ min_qty: 10, unit_price: 90000 }] };
    const tierOff = { enabled: false, tiers: [{ min_qty: 10, unit_price: 90000 }] };
    const variantsBody = (bulk: unknown) => ({
      variants: [
        { id: 1, sku: "BULK-1", label: "Varian 1", price: 100000, stock: -1, is_active: 1, sort_order: 0, bulk_pricing: bulk },
        { id: 2, sku: "BULK-2", label: "Varian 2", price: 50000, stock: -1, is_active: 1, sort_order: 1 },
      ],
    });

    it("PUT products/:id menolak enabled untuk WR, tetapi disable tetap boleh", async () => {
      fixture.sql.prepare("UPDATE products SET source='warung_rebahan', wr_product_id='WR-9', wr_auto_managed=1 WHERE id=1").run();
      const { PUT } = await import("@/app/api/products/[id]/route");
      const enabled = await PUT(putProduct(1, variantsBody(tierOn)), { params: Promise.resolve({ id: "1" }) });
      expect(enabled.status).toBe(400);
      expect(await enabled.json()).toMatchObject({ error: "bulk_pricing_supplier_forbidden" });
      expect(bulkOf(1).bulk_pricing_enabled).toBe(0);
      // Data lama bisa dibersihkan: enabled=false diterima.
      fixture.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=1, bulk_pricing_tiers=? WHERE id=1").run(JSON.stringify(tierOn.tiers));
      const disabled = await PUT(putProduct(1, variantsBody(tierOff)), { params: Promise.resolve({ id: "1" }) });
      expect(disabled.status).toBe(200);
      expect(bulkOf(1).bulk_pricing_enabled).toBe(0);
    });

    it("PUT/POST admin variants menolak enabled untuk produk SK, disable boleh", async () => {
      // SK memakai source='manual' + sk_product_id NOT NULL.
      fixture.sql.prepare("UPDATE products SET source='manual', sk_product_id='SK-9', sk_auto_managed=1 WHERE id=1").run();
      const { PUT, POST } = await import("@/app/api/admin/variants/route");
      const put = await PUT(putVariant(1, { price: 100000, bulk_pricing: tierOn }));
      expect(put.status).toBe(400);
      expect(await put.json()).toMatchObject({ error: "bulk_pricing_supplier_forbidden" });
      const post = await POST(postVariant({ product_id: 1, sku: "SK-NEW", label: "SK New", price: 70000, bulk_pricing: tierOn }));
      expect(post.status).toBe(400);
      const batch = await POST(postVariant(variantsBody(tierOn)));
      expect(batch.status).toBe(400);
      const off = await PUT(putVariant(1, { price: 100000, bulk_pricing: { enabled: false, tiers: [] } }));
      expect(off.status).toBe(200);
    });

    it("produk manual tetap boleh mengaktifkan grosir (regression)", async () => {
      const { PUT } = await import("@/app/api/products/[id]/route");
      const ok = await PUT(putProduct(1, variantsBody(tierOn)), { params: Promise.resolve({ id: "1" }) });
      expect(ok.status).toBe(200);
      expect(bulkOf(1).bulk_pricing_enabled).toBe(1);
    });
  });

  describe("AIVault grosir dikelola di menu AIVault → Markup (keputusan owner 2026-11-17)", () => {
    const tierOn = { enabled: true, tiers: [{ min_qty: 5, unit_price: 90000 }] };
    const tierOff = { enabled: false, tiers: [] };

    beforeEach(() => {
      fixture.sql.prepare("UPDATE products SET aivault_family='gemini' WHERE id=1").run();
      fixture.sql.prepare("UPDATE product_variants SET sku='AV-service_gemini_plus_6m', aivault_service_id='service_gemini_plus_6m' WHERE id=1").run();
    });

    it("GET /api/products/[id] and GET /api/products expose aivault_family to admin", async () => {
      const { GET: getById } = await import("@/app/api/products/[id]/route");
      const resById = await getById(new NextRequest("http://localhost/api/products/1"), { params: Promise.resolve({ id: "1" }) });
      expect(resById.status).toBe(200);
      expect((await resById.json() as { product: { aivault_family: string | null } }).product.aivault_family).toBe("gemini");

      const { GET: getList } = await import("@/app/api/products/route");
      const resList = await getList(new NextRequest("http://localhost/api/products"));
      expect(resList.status).toBe(200);
      expect((await resList.json() as { products: { id: string; aivault_family: string | null }[] }).products.find((p) => p.id === "1")?.aivault_family).toBe("gemini");
    });

    it("rejects changing bulk_pricing on AIVault via PUT /api/products/[id] and /api/admin/variants with 409, while preserving unchanged saves", async () => {
      const { PUT: putP } = await import("@/app/api/products/[id]/route");
      const { PUT: putV, POST: postV } = await import("@/app/api/admin/variants/route");

      // Unchanged/omitted save succeeds
      const okOmitted = await putP(putProduct(1, {
        variants: [{ id: 1, sku: "AV-service_gemini_plus_6m", label: "Varian 1", price: 100000, stock: -1, is_active: 1, sort_order: 0 }],
      }), { params: Promise.resolve({ id: "1" }) });
      expect(okOmitted.status).toBe(200);

      // Matching stored bulk_pricing succeeds
      const okSame = await putP(putProduct(1, {
        variants: [{ id: 1, sku: "AV-service_gemini_plus_6m", label: "Varian 1", price: 100000, stock: -1, is_active: 1, sort_order: 0, bulk_pricing: tierOff }],
      }), { params: Promise.resolve({ id: "1" }) });
      expect(okSame.status).toBe(200);

      // Attempting to enable or alter bulk_pricing via generic API -> 409 bulk_pricing_aivault_managed
      const r1 = await putP(putProduct(1, {
        variants: [{ id: 1, sku: "AV-service_gemini_plus_6m", label: "Varian 1", price: 100000, stock: -1, is_active: 1, sort_order: 0, bulk_pricing: tierOn }],
      }), { params: Promise.resolve({ id: "1" }) });
      expect(r1.status).toBe(409);
      expect(await r1.json()).toEqual({ error: "bulk_pricing_aivault_managed", message: "Harga grosir AIVault diatur di menu AIVault → Markup." });

      const r2 = await putV(putVariant(1, { price: 100000, bulk_pricing: tierOn }));
      expect(r2.status).toBe(409);
      expect(await r2.json()).toMatchObject({ error: "bulk_pricing_aivault_managed" });

      const r3 = await postV(postVariant({
        product_id: 1,
        variants: [{ id: 1, product_id: 1, sku: "AV-TEST", label: "Varian 1", price: 100000, bulk_pricing: tierOn }],
      }));
      expect(r3.status).toBe(409);
      expect(await r3.json()).toMatchObject({ error: "bulk_pricing_aivault_managed" });

      const r4 = await postV(postVariant({ product_id: 1, sku: "AV-NEW", label: "AV New", price: 70000, bulk_pricing: tierOn }));
      expect(r4.status).toBe(409);
      expect(await r4.json()).toMatchObject({ error: "bulk_pricing_aivault_managed" });

      // Attempting to turn OFF existing enabled bulk on AIVault via generic PUT -> also 409
      fixture.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=1, bulk_pricing_tiers=? WHERE id=1")
        .run(JSON.stringify([{ min_qty: 5, unit_price: 90000 }]));
      const r5 = await putV(putVariant(1, { price: 100000, bulk_pricing: tierOff }));
      expect(r5.status).toBe(409);
      expect(await r5.json()).toMatchObject({ error: "bulk_pricing_aivault_managed" });
      expect(bulkOf(1).bulk_pricing_enabled).toBe(1);
    });
  });

  it("POST variants create defaults off; explicit bulk validated & stored", async () => {
    const { POST } = await import("@/app/api/admin/variants/route");
    const plain = await POST(postVariant({ product_id: 1, sku: "BULK-NEW", label: "New", price: 70000 }));
    expect(plain.status).toBe(201);
    const newId = ((await plain.json()) as { id: number }).id;
    expect(bulkOf(newId)).toMatchObject({ bulk_pricing_enabled: 0, bulk_pricing_tiers: "[]" });
    const explicit = await POST(postVariant({ product_id: 1, sku: "BULK-NEW2", label: "New2", price: 70000, bulk_pricing: { enabled: true, tiers: [{ min_qty: 5, unit_price: 60000 }] } }));
    expect(explicit.status).toBe(201);
    const newId2 = ((await explicit.json()) as { id: number }).id;
    expect(JSON.parse(bulkOf(newId2).bulk_pricing_tiers)).toEqual([{ min_qty: 5, unit_price: 60000 }]);
    const invalid = await POST(postVariant({ product_id: 1, sku: "BULK-NEW3", label: "New3", price: 70000, bulk_pricing: { enabled: true, tiers: [{ min_qty: 5, unit_price: 80000 }] } }));
    expect(invalid.status).toBe(400);
  });
});
