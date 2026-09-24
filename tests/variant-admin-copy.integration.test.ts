// tests/variant-admin-copy.integration.test.ts — S&K + cara aktivasi yang
// bisa disunting admin per varian (migrasi 0041, permintaan owner 2026-09-24).
//
// Kontrak yang dikunci:
//  - Suntingan admin tampil di storefront selama teks WR masih sama dengan
//    saat disimpan. Bila WR mengubah teksnya, suntingan DIJEDA (teks WR
//    terbaru tampil) dan panel menandai "perlu ditinjau" sampai disimpan ulang.
//  - Sync WR dan simpan form produk tidak pernah menyentuh kolom admin, jadi
//    menyimpan foto/badge tidak diam-diam menandai suntingan dijeda sebagai
//    sudah ditinjau.
//  - Teks yang sama dengan salinan otomatis tidak dibekukan ke DB.
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import snapshot from "./fixtures/product-copy-snapshot.json";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { syncProducts } from "@/lib/warung-rebahan/sync";
import { supplierFingerprint } from "@/lib/product-copy/text";
import { parseProductDescription, type VariantCopyEntry } from "@/lib/product-copy/format";

const auth = vi.hoisted(() => ({ admin: true as boolean }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => (auth.admin ? { email: "fixture@example.test" } : null)),
}));

const legal = snapshot.pairs.find((p) => p.variants.some((v) => v.startsWith("netflix-premium · Premium Legal")))!;
let fixture: ReturnType<typeof createD1Fixture>;

beforeEach(() => {
  auth.admin = true;
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
  fixture = createD1Fixture();
  fixture.sql.exec(`
    INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, source, wr_product_id, wr_auto_managed)
      VALUES (1, 2, 'Netflix Premium', 'netflix-premium', 'Deskripsi WR', 55000, 3, 1, 'warung_rebahan', 'prod-nf', 1);
    INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, sort_order, wr_variant_id, wr_auto_managed)
      VALUES (1, 1, 'WR-NF-LEGAL', 'Premium Legal', 55000, 3, 1, 0, 'var-legal', 1);
    INSERT INTO wr_products (wr_product_id, wr_product_name, axvara_product_id) VALUES ('prod-nf', 'Netflix Premium', 1);
    INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active)
      VALUES (2, 2, 'Canva Pro', 'canva-premium', 'Canva Pro untuk desain.', 2000, -1, 1);
    INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, sort_order)
      VALUES (2, 2, 'CANVA-3', 'Head 1 Bulan', 5000, 10, 1, 0);
  `);
  fixture.sql.prepare(
    `INSERT INTO wr_variants (wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_stock, wr_terms, wr_delivery_terms, axvara_variant_id, axvara_sell_price)
     VALUES ('var-legal', 'prod-nf', 'Premium Legal', 40000, 3, ?, ?, 1, 55000)`,
  ).run(legal.terms, legal.deliveryTerms);
});

afterEach(() => {
  fixture.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function getCopy(productId: number): Promise<VariantCopyEntry[]> {
  const { GET } = await import("@/app/api/admin/variant-copy/route");
  const res = await GET(new NextRequest(`http://localhost/api/admin/variant-copy?product_id=${productId}`));
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  return (await res.json()).variants;
}

async function putCopy(body: Record<string, unknown>) {
  const { PUT } = await import("@/app/api/admin/variant-copy/route");
  return PUT(new NextRequest("http://localhost/api/admin/variant-copy", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function storefrontVariant(slug: string) {
  const { GET } = await import("@/app/api/catalog/route");
  const res = await GET(new Request(`http://localhost/api/catalog?slug=${slug}`));
  return (await res.json()).product.variants[0];
}

const adminColumns = (id: number) =>
  fixture.sql.prepare("SELECT admin_terms, admin_activation, admin_copy_fingerprint FROM product_variants WHERE id=?").get(id) as Record<string, unknown>;

describe("GET /api/admin/variant-copy", () => {
  it("varian WR terkurasi: status versi Axvara, editor terisi salinan yang tampil + teks asli WR", async () => {
    const [entry] = await getCopy(1);
    expect(entry).toMatchObject({ variantId: 1, wrManaged: true, status: "axvara", adminStale: false, needsReview: false, hasOverride: false });
    expect(entry.autoTerms.startsWith("Detail paket:\n- Paket Premium Ultra HD 4K")).toBe(true);
    expect(entry.autoActivation.startsWith("Sebelum login:\n1. ")).toBe(true);
    expect(entry.supplierTerms).toBe(legal.terms);
  });

  it("hanya admin", async () => {
    auth.admin = false;
    const { GET } = await import("@/app/api/admin/variant-copy/route");
    expect((await GET(new NextRequest("http://localhost/api/admin/variant-copy?product_id=1"))).status).toBe(401);
    expect((await putCopy({ variant_id: 1, terms: "x", activation: "" })).status).toBe(401);
  });
});

describe("PUT /api/admin/variant-copy → storefront", () => {
  it("suntingan tampil di /api/catalog dan dicap sidik jari teks WR saat itu", async () => {
    const [before] = await getCopy(1);
    const res = await putCopy({ variant_id: 1, terms: `${before.autoTerms}\n- Dilarang berbagi akun ke grup`, activation: before.autoActivation });
    expect(res.status).toBe(200);
    const { variant } = await res.json();
    expect(variant).toMatchObject({ status: "admin", hasOverride: true, adminStale: false, needsReview: false });
    expect(adminColumns(1).admin_copy_fingerprint).toBe(supplierFingerprint(legal.terms, legal.deliveryTerms));

    const shown = await storefrontVariant("netflix-premium");
    expect(shown.copy.source).toBe("admin");
    expect(shown.copy.sections.find((s: { kind: string }) => s.kind === "garansi").items).toContain("Dilarang berbagi akun ke grup");
    expect(shown).not.toHaveProperty("admin_terms");
    expect(shown.terms).toBeNull();
  });

  it("teks yang sama dengan salinan otomatis tidak disimpan; teks kosong mengembalikan ke otomatis", async () => {
    const [before] = await getCopy(1);
    const same = await (await putCopy({ variant_id: 1, terms: `${before.autoTerms}\n`, activation: before.autoActivation.replace(/\n/g, "\r\n") })).json();
    expect(same.variant).toMatchObject({ status: "axvara", hasOverride: false });
    expect(adminColumns(1)).toEqual({ admin_terms: null, admin_activation: null, admin_copy_fingerprint: null });

    await putCopy({ variant_id: 1, terms: "Aturan pakai:\n- Dilarang berbagi akun", activation: "" });
    expect(adminColumns(1).admin_terms).toBe("Aturan pakai:\n- Dilarang berbagi akun");
    const cleared = await (await putCopy({ variant_id: 1, terms: " ", activation: "" })).json();
    expect(cleared.variant).toMatchObject({ status: "axvara", hasOverride: false });
    expect(adminColumns(1).admin_terms).toBeNull();
  });

  it("varian non-WR: S&K khusus varian (mis. Canva Head) tampil di storefront", async () => {
    const [entry] = await getCopy(2);
    expect(entry).toMatchObject({ wrManaged: false, status: "none", autoTerms: "", needsReview: false });
    const res = await putCopy({ variant_id: 2, terms: "- Berupa akun Head (email dan password)", activation: "1. Login di canva.com" });
    expect((await res.json()).variant.status).toBe("admin");
    expect(adminColumns(2).admin_copy_fingerprint).toBe("");
    const shown = await storefrontVariant("canva-premium");
    expect(shown.copy).toMatchObject({ source: "admin", activation: [{ title: null, steps: ["Login di canva.com"] }] });
  });

  it("validasi: panjang maksimal dan varian tidak dikenal", async () => {
    expect((await putCopy({ variant_id: 1, terms: "x".repeat(4001), activation: "" })).status).toBe(400);
    expect((await putCopy({ variant_id: 999, terms: "x", activation: "" })).status).toBe(404);
  });
});

describe("WR mengubah teks setelah admin menyunting", () => {
  const changedTerms = `${legal.terms}\nDilarang login di Smart TV`;

  it("suntingan dijeda: storefront menampilkan aturan baru WR, panel & daftar produk menandai perlu ditinjau", async () => {
    await putCopy({ variant_id: 1, terms: "Aturan pakai:\n- Dilarang berbagi akun", activation: "1. Login di aplikasi" });
    fixture.sql.prepare("UPDATE wr_variants SET wr_terms=? WHERE wr_variant_id='var-legal'").run(changedTerms);

    const shown = await storefrontVariant("netflix-premium");
    expect(shown.copy.source).toBe("pemasok");
    expect(shown.copy.sections.flatMap((s: { items: string[] }) => s.items)).toContain("Dilarang login di Smart TV");
    expect(JSON.stringify(shown.copy)).not.toContain("Dilarang berbagi akun");

    const [entry] = await getCopy(1);
    expect(entry).toMatchObject({ status: "pemasok", adminStale: true, needsReview: true, hasOverride: true, adminTerms: "Aturan pakai:\n- Dilarang berbagi akun" });
    expect(entry.supplierTerms).toContain("Dilarang login di Smart TV");

    const { GET } = await import("@/app/api/products/route");
    const list = await (await GET(new NextRequest("http://localhost/api/products"))).json();
    const row = list.products.find((p: { slug: string }) => p.slug === "netflix-premium");
    expect(row.copyReview).toBe(1);
    expect(list.products.find((p: { slug: string }) => p.slug === "canva-premium").copyReview).toBe(0);
  });

  it("simpan form produk (foto/badge) TIDAK menandai suntingan sebagai sudah ditinjau", async () => {
    await putCopy({ variant_id: 1, terms: "Aturan pakai:\n- Dilarang berbagi akun", activation: "" });
    const stamped = adminColumns(1);
    fixture.sql.prepare("UPDATE wr_variants SET wr_terms=? WHERE wr_variant_id='var-legal'").run(changedTerms);

    const { PUT } = await import("@/app/api/products/[id]/route");
    const res = await PUT(new NextRequest("http://localhost/api/products/1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ badge: "Terlaris", variants: [{ id: 1, sku: "WR-NF-LEGAL", label: "Premium Legal", price: 55000, stock: 3, is_active: 1, sort_order: 0 }] }),
    }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
    expect(adminColumns(1)).toEqual(stamped);
    expect((await getCopy(1))[0].adminStale).toBe(true);
  });

  it("simpan ulang dari panel (setelah meninjau) memakai suntingan lagi", async () => {
    await putCopy({ variant_id: 1, terms: "Aturan pakai:\n- Dilarang berbagi akun", activation: "" });
    fixture.sql.prepare("UPDATE wr_variants SET wr_terms=? WHERE wr_variant_id='var-legal'").run(changedTerms);
    const res = await putCopy({ variant_id: 1, terms: "Aturan pakai:\n- Dilarang berbagi akun\n- Dilarang login di Smart TV", activation: "" });
    expect((await res.json()).variant).toMatchObject({ status: "admin", adminStale: false, needsReview: false });
    expect((await storefrontVariant("netflix-premium")).copy.source).toBe("admin");
  });
});

describe("sync WR tidak pernah menyentuh kolom admin", () => {
  it("sweep penuh dengan harga & teks WR berubah: kolom admin utuh, wr_terms ikut berubah", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
    const f2 = fixture;
    f2.sql.exec("DELETE FROM wr_variants; DELETE FROM wr_products; DELETE FROM product_variants; DELETE FROM products;");
    const product = (terms: string, price: number) => ({
      id: "wr-zoom", name: "Zoom Premium", category: "Productivity", description: "Zoom",
      variants: [{ id: "wr-zoom-14", name: "Pro 14D", price, duration: "14 Hari", type: "Private", warranty: "12 Hari", stock: 9, terms, delivery_terms: null }],
    });
    const db = createDatabaseAccess(f2.db);
    expect((await syncProducts(db, async () => [product("Garansi 12 hari", 20000)])).errors).toEqual([]);
    const variant = f2.sql.prepare("SELECT id FROM product_variants WHERE wr_variant_id='wr-zoom-14'").get() as { id: number };
    f2.sql.prepare("UPDATE product_variants SET admin_terms='Garansi:\n- Garansi 12 hari', admin_activation='1. Login', admin_copy_fingerprint='k1' WHERE id=?").run(variant.id);

    await syncProducts(db, async () => [product("Garansi 12 hari\nDilarang login di TV", 25000)]);
    expect(adminColumns(variant.id)).toEqual({ admin_terms: "Garansi:\n- Garansi 12 hari", admin_activation: "1. Login", admin_copy_fingerprint: "k1" });
    const wr = f2.sql.prepare("SELECT wr_terms, wr_price FROM wr_variants WHERE wr_variant_id='wr-zoom-14'").get() as { wr_terms: string; wr_price: number };
    expect(wr.wr_terms).toContain("Dilarang login di TV");
    expect(Number(wr.wr_price)).toBe(25000);
    expect(fs.readFileSync("src/lib/warung-rebahan/sync.ts", "utf8")).not.toMatch(/admin_terms|admin_activation|admin_copy_fingerprint/);
  });
});

describe("migrasi 0041 + 0042", () => {
  const m41 = fs.readFileSync("drizzle/migrations/0041_variant_admin_copy.sql", "utf8");
  const m42 = fs.readFileSync("drizzle/migrations/0042_canva_invite_terms.sql", "utf8");
  const m40 = fs.readFileSync("drizzle/migrations/0040_axvara_product_copy.sql", "utf8");

  it("0041 menambah tiga kolom milik admin pada DB produksi lama (tanpa kolom)", () => {
    fixture.sql.exec("ALTER TABLE product_variants DROP COLUMN admin_terms; ALTER TABLE product_variants DROP COLUMN admin_activation; ALTER TABLE product_variants DROP COLUMN admin_copy_fingerprint;");
    fixture.sql.exec(m41);
    const cols = (fixture.sql.prepare("PRAGMA table_info(product_variants)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["admin_terms", "admin_activation", "admin_copy_fingerprint"]));
    expect(adminColumns(1)).toEqual({ admin_terms: null, admin_activation: null, admin_copy_fingerprint: null });
  });

  it("0042: Canva non-WR mendapat S&K undangan email, hanya bila deskripsi masih hasil 0040; idempoten", () => {
    const old = snapshot.descriptions.find((d) => d.slug === "canva-premium")!;
    fixture.sql.prepare("UPDATE products SET description=? WHERE id=2").run(old.description);
    fixture.sql.exec(m40);
    fixture.sql.exec(m42);
    const after = (fixture.sql.prepare("SELECT description FROM products WHERE id=2").get() as { description: string }).description;
    const parsed = parseProductDescription(after);
    expect(parsed.terms).toEqual(["Undangan Canva dikirim lewat email", "Pastikan email yang kamu isi saat checkout aktif"]);
    expect(parsed.activation).toEqual(["Buka email undangan dari Canva, lalu terima undangannya"]);
    expect(parsed.blocks[0]).toMatchObject({ type: "p" });
    expect(after).not.toMatch(/!|\p{Extended_Pictographic}/u);

    fixture.sql.exec(m42);
    expect((fixture.sql.prepare("SELECT description FROM products WHERE id=2").get() as { description: string }).description).toBe(after);

    fixture.sql.prepare("UPDATE products SET description='Disunting admin' WHERE id=2").run();
    fixture.sql.exec(m42);
    expect((fixture.sql.prepare("SELECT description FROM products WHERE id=2").get() as { description: string }).description).toBe("Disunting admin");
  });
});
