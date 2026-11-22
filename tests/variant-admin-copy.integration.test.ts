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
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";

const auth = vi.hoisted(() => ({ admin: true as boolean }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => (auth.admin ? { email: "fixture@example.test" } : null)),
}));

const legal = snapshot.pairs.find((p) => p.variants.some((v) => v.startsWith("netflix-premium · Premium Legal")))!;
let fixture: ReturnType<typeof createD1Fixture>;

beforeEach(() => {
  auth.admin = true;
  clearRateLimitBucketsForTest();
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
    `INSERT INTO wr_variants (wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_stock, wr_terms, wr_delivery_terms, axvara_variant_id, axvara_sell_price, wr_delivery_class)
     VALUES ('var-legal', 'prod-nf', 'Premium Legal', 40000, 3, ?, ?, 1, 55000, 'restock')`,
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
    body: JSON.stringify({ supplier_key: body.variant_id === 1 ? supplierFingerprint(legal.terms, legal.deliveryTerms) : "", ...body }),
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
  it("source changes between read and UPDATE fail closed atomically", async () => {
    fixture.control.beforeRun = async (query) => {
      if (!query.includes("UPDATE product_variants SET admin_terms")) return;
      fixture.control.beforeRun = null;
      fixture.sql.prepare("UPDATE wr_variants SET wr_terms=? WHERE wr_variant_id='var-legal'").run("Hanya boleh 2 perangkat");
    };
    const before = adminColumns(1);
    expect((await putCopy({ variant_id: 1, terms: "Draft tersimpan?", activation: "" })).status).toBe(409);
    expect(adminColumns(1)).toEqual(before);
  });

  it("SK: editor, fingerprint, review dan copy pascabayar konsisten dengan storefront", async () => {
    fixture.sql.exec(`INSERT INTO products(id,name,slug,price,stock,source,sk_auto_managed,sk_product_id) VALUES(3,'SK fixture','sk-copy-fixture',5000,5,'manual',1,'900');
      INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,sk_variant_id,sk_auto_managed) VALUES(3,3,'SK-COPY','Sharing',5000,5,1,'901',1);
      INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,sk_description,sk_seller_note,axvara_product_id,axvara_variant_id) VALUES('901','900','SK fixture','Sharing',3000,5,'Hanya bisa 1 perangkat','1. Buka aplikasi',3,3);`);
    const [entry] = await getCopy(3);
    expect(entry).toMatchObject({ supplier: "SK", status: "pemasok", needsReview: true });
    expect(entry.autoTerms).toContain("Hanya bisa 1 perangkat");
    expect(entry.autoActivation).toContain("Buka aplikasi");
    const saved = await putCopy({ variant_id: 3, supplier_key: entry.supplierKey, terms: entry.autoTerms + "\n- Jangan bagikan akun", activation: entry.autoActivation });
    expect(saved.status).toBe(200);
    expect((await storefrontVariant("sk-copy-fixture")).copy.source).toBe("admin");
    const { resolveCredentialTermsForVariants } = await import("@/lib/orders/credential-terms");
    const copies = await resolveCredentialTermsForVariants([3], createDatabaseAccess(fixture.db));
    expect(copies.get(3)?.source).toBe("admin");
    expect(JSON.stringify(copies.get(3))).toContain("Jangan bagikan akun");
    fixture.sql.exec("UPDATE sk_products SET sk_description='Hanya bisa 2 perangkat' WHERE sk_variant_id='901'");
    expect((await getCopy(3))[0]).toMatchObject({ supplier: "SK", adminStale: true, needsReview: true });
    const { GET } = await import("@/app/api/products/route");
    const list = await (await GET(new NextRequest("http://localhost/api/products"))).json();
    expect(list.products.find((p: { slug: string }) => p.slug === "sk-copy-fixture").copyReview).toBe(1);
    expect((await putCopy({ variant_id: 3, supplier_key: entry.supplierKey, terms: "Old draft", activation: "" })).status).toBe(409);
    const fresh = (await getCopy(3))[0];
    expect((await putCopy({ variant_id: 3, supplier_key: fresh.supplierKey, terms: "", activation: "" })).status).toBe(200);
    expect(adminColumns(3).admin_terms).toBeNull();
  });

  it("refuse unreviewed WR changes and missing source proof without altering draft in DB", async () => {
    await putCopy({ variant_id: 1, terms: "Garansi:\n- Garansi 7 hari", activation: "" });
    const before = adminColumns(1);
    fixture.sql.prepare("UPDATE wr_variants SET wr_terms=? WHERE wr_variant_id='var-legal'").run("Garansi 3 hari");
    expect((await putCopy({ variant_id: 1, terms: "Old draft", activation: "" })).status).toBe(409);
    expect((await putCopy({ variant_id: 1, supplier_key: undefined, terms: "Old draft", activation: "" })).status).toBe(400);
    expect(adminColumns(1)).toEqual(before);
  });
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

  it("suntingan stale: storefront tetap menampilkan suntingan admin, panel & daftar produk menandai perlu ditinjau", async () => {
    await putCopy({ variant_id: 1, terms: "Aturan pakai:\n- Dilarang berbagi akun", activation: "1. Login di aplikasi" });
    fixture.sql.prepare("UPDATE wr_variants SET wr_terms=? WHERE wr_variant_id='var-legal'").run(changedTerms);

    const shown = await storefrontVariant("netflix-premium");
    expect(shown.copy.source).toBe("admin");
    expect(JSON.stringify(shown.copy)).toContain("Dilarang berbagi akun");
    expect(shown.copy.sections.flatMap((s: { items: string[] }) => s.items)).not.toContain("Dilarang login di Smart TV");

    const [entry] = await getCopy(1);
    expect(entry).toMatchObject({ status: "admin", adminStale: true, reviewKind: "changed", needsReview: true, hasOverride: true, adminTerms: "Aturan pakai:\n- Dilarang berbagi akun" });
    expect(entry.effectiveTerms).toContain("Dilarang berbagi akun");
    expect(entry.autoTerms).toContain("Dilarang login di Smart TV");
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
    const res = await putCopy({ variant_id: 1, terms: "Aturan pakai:\n- Dilarang berbagi akun\n- Dilarang login di Smart TV", activation: "", supplier_key: supplierFingerprint(changedTerms, legal.deliveryTerms) });
    expect((await res.json()).variant).toMatchObject({ status: "admin", adminStale: false, needsReview: false });
    expect((await storefrontVariant("netflix-premium")).copy.source).toBe("admin");
  });
});

describe("Manual product saves preserve copy owned by variant-copy", () => {
  it("saving an existing variant without copy fields preserves ID, EN and fingerprint", async () => {
    fixture.sql.exec(`UPDATE product_variants SET admin_terms='- Aturan',admin_activation='1. Login',
      admin_terms_en='- Rules',admin_activation_en='1. Log in',admin_copy_fingerprint='' WHERE id=2`);
    const columns = "admin_terms,admin_activation,admin_terms_en,admin_activation_en,admin_copy_fingerprint";
    const before = fixture.sql.prepare(`SELECT ${columns} FROM product_variants WHERE id=2`).get();
    const { PUT } = await import("@/app/api/products/[id]/route");
    for (const body of [{ badge: "Baru" }, { variants: [{ id: 2, sku: "CANVA-3", label: "Head 1 Bulan", price: 5000, stock: 10 }] }]) {
      const response = await PUT(new NextRequest("http://localhost/api/products/2", {
        method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" },
      }), { params: Promise.resolve({ id: "2" }) });
      expect(response.status).toBe(200);
      expect(fixture.sql.prepare(`SELECT ${columns} FROM product_variants WHERE id=2`).get()).toEqual(before);
    }
  });

  it("legacy POST still accepts explicit Manual copy; later PUT omission leaves it intact", async () => {
    const { POST } = await import("@/app/api/products/route");
    const created = await POST(new NextRequest("http://localhost/api/products", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        name: "Legacy Manual", slug: "legacy-manual", variants: [{ sku: "LEGACY", label: "Default", price: 10000, admin_terms: "- Legacy rules", admin_activation: "1. Legacy login" }],
      }),
    }));
    expect(created.status).toBe(200);
    const { id } = await created.json();
    const row = fixture.sql.prepare("SELECT id,admin_terms,admin_activation FROM product_variants WHERE product_id=?").get(id);
    expect(row).toMatchObject({ admin_terms: "- Legacy rules", admin_activation: "1. Legacy login" });
    const { PUT } = await import("@/app/api/products/[id]/route");
    const response = await PUT(new NextRequest(`http://localhost/api/products/${id}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ variants: [{ id: row!.id, sku: "LEGACY", label: "Default", price: 11000 }] }),
    }), { params: Promise.resolve({ id: String(id) }) });
    expect(response.status).toBe(200);
    expect(fixture.sql.prepare("SELECT admin_terms,admin_activation FROM product_variants WHERE product_id=?").get(id)).toEqual({ admin_terms: "- Legacy rules", admin_activation: "1. Legacy login" });
  });

  it("legacy PUT with one explicit copy field preserves the omitted ID and EN fields", async () => {
    fixture.sql.exec("UPDATE product_variants SET admin_terms='- Rules',admin_activation='1. Login',admin_terms_en='- English',admin_activation_en='1. English login' WHERE id=2");
    const { PUT } = await import("@/app/api/products/[id]/route");
    const response = await PUT(new NextRequest("http://localhost/api/products/2", {
      method: "PUT", body: JSON.stringify({ variants: [{ id: 2, sku: "CANVA-3", label: "Head", price: 5000, admin_terms: "" }] }),
    }), { params: Promise.resolve({ id: "2" }) });
    expect(response.status).toBe(200);
    expect(fixture.sql.prepare("SELECT admin_terms,admin_activation,admin_terms_en,admin_activation_en FROM product_variants WHERE id=2").get()).toEqual({
      admin_terms: null, admin_activation: "1. Login", admin_terms_en: "- English", admin_activation_en: "1. English login",
    });
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
    // 3D-3: product writes moved to sync/product.ts; admin-owned copy
    // columns must stay out of both files.
    expect(fs.readFileSync("src/lib/warung-rebahan/sync.ts", "utf8") + "\n" + fs.readFileSync("src/lib/warung-rebahan/sync/product.ts", "utf8") + "\n" + fs.readFileSync("src/lib/warung-rebahan/sync/variant.ts", "utf8")).not.toMatch(/admin_terms|admin_activation|admin_copy_fingerprint/);
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

describe("S&K admin versi Inggris (migrasi 0105)", () => {
  const put = (body: Record<string, unknown>) => {
    return import("@/app/api/admin/variant-copy/route").then(({ PUT }) => PUT(new NextRequest("http://localhost/api/admin/variant-copy", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    })));
  };

  it("menyimpan terms_en/activation_en; GET mengembalikannya; EN hanya tampil saat fingerprint valid", async () => {
    const [entry] = await getCopy(1);
    const res = await put({
      variant_id: 1,
      terms: "Detail paket:\n- Custom ID terms",
      activation: "1. Login custom",
      terms_en: "Package details:\n- English custom terms",
      activation_en: "1. Log in with the account we send",
      supplier_key: entry.supplierKey,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { variant: VariantCopyEntry };
    expect(body.variant.adminTermsEn).toContain("English custom terms");
    expect(body.variant.adminActivationEn).toContain("Log in with the account");

    const [saved] = await getCopy(1);
    expect(saved.adminTermsEn).toContain("English custom terms");
    expect(saved.adminActivationEn).toContain("Log in with the account");

    const { resolveVariantCopyDetailed } = await import("@/lib/product-copy/resolve");
    const en = resolveVariantCopyDetailed(legal.terms, legal.deliveryTerms, {
      terms: saved.adminTerms, activation: saved.adminActivation, fingerprint: saved.supplierKey,
      termsEn: saved.adminTermsEn, activationEn: saved.adminActivationEn,
    }, "en").copy!;
    expect(en.sections.flatMap((s) => s.items).join(" ")).toContain("English custom terms");
    const id = resolveVariantCopyDetailed(legal.terms, legal.deliveryTerms, {
      terms: saved.adminTerms, activation: saved.adminActivation, fingerprint: saved.supplierKey,
      termsEn: saved.adminTermsEn, activationEn: saved.adminActivationEn,
    }, "id").copy!;
    expect(id.sections.flatMap((s) => s.items).join(" ")).not.toContain("English custom terms");

    // Fingerprint berubah → admin EN tetap tampil bila diisi (ditandai stale); tanpa admin EN fallback ke auto EN.
    const staleWithEn = resolveVariantCopyDetailed(`${legal.terms}\nPerubahan supplier`, legal.deliveryTerms, {
      terms: saved.adminTerms, activation: saved.adminActivation, fingerprint: saved.supplierKey,
      termsEn: saved.adminTermsEn, activationEn: saved.adminActivationEn,
    }, "en");
    expect(staleWithEn.adminStale).toBe(true);
    expect(staleWithEn.reviewKind).toBe("changed");
    expect(staleWithEn.status).toBe("admin");
    expect(staleWithEn.copy!.sections.flatMap((s) => s.items).join(" ")).toContain("English custom terms");

    const staleWithoutEn = resolveVariantCopyDetailed(`${legal.terms}\nPerubahan supplier`, legal.deliveryTerms, {
      terms: saved.adminTerms, activation: saved.adminActivation, fingerprint: saved.supplierKey,
    }, "en");
    expect(staleWithoutEn.adminStale).toBe(true);
    expect(staleWithoutEn.reviewKind).toBe("changed");
    expect(staleWithoutEn.copy).toEqual(staleWithoutEn.auto);
    expect(staleWithoutEn.copy!.sections.flatMap((s) => s.items).join(" ")).not.toContain("English custom terms");
  });

  // Audit AU-H2-7 (21 Nov 2026): dulu menyimpan EN tanpa menimpa ID menghapus
  // EN diam-diam (clear berdasarkan ID saja) dan resolver memblokir EN di belakang
  // override ID. Kontrak baru: EN disimpan & tampil mandiri; ID tetap otomatis.
  it("EN tanpa ID admin tetap tersimpan dan tampil mandiri", async () => {
    const [entry] = await getCopy(1);
    const res = await put({ variant_id: 1, terms: "", activation: "", terms_en: "Only English", activation_en: "", supplier_key: entry.supplierKey });
    expect(res.status).toBe(200);
    expect((await res.json()).variant).toMatchObject({ adminStale: false, reviewKind: null, needsReview: false });
    expect(adminColumns(1).admin_copy_fingerprint).toBe(entry.supplierKey);
    const [saved] = await getCopy(1);
    expect(saved.hasOverride).toBe(false);
    expect(saved.adminTermsEn).toContain("Only English");
    // ID tetap kembali otomatis, tapi pembeli EN melihat salinan EN admin.
    const { resolveVariantCopyDetailed } = await import("@/lib/product-copy/resolve");
    const en = resolveVariantCopyDetailed(legal.terms, legal.deliveryTerms, {
      terms: saved.adminTerms, activation: saved.adminActivation, fingerprint: saved.supplierKey,
      termsEn: saved.adminTermsEn, activationEn: saved.adminActivationEn,
    }, "en");
    expect(en.status).toBe("admin");
    expect(en).toMatchObject({ adminStale: false, reviewKind: null });
    expect(en.copy!.sections.flatMap((s) => s.items).join(" ")).toContain("Only English");
    // Pembeli ID tetap memakai salinan otomatis (tidak terpengaruh EN-only).
    const idCopy = resolveVariantCopyDetailed(legal.terms, legal.deliveryTerms, {
      terms: saved.adminTerms, activation: saved.adminActivation, fingerprint: saved.supplierKey,
      termsEn: saved.adminTermsEn, activationEn: saved.adminActivationEn,
    }, "id");
    expect(idCopy.status).not.toBe("admin");
  });

  it("EN admin bertahan dari baris katalog sampai copy_en publik, ID tetap di copy", async () => {
    fixture.sql.prepare(
      "UPDATE product_variants SET admin_terms=?, admin_activation=?, admin_terms_en=?, admin_activation_en=?, admin_copy_fingerprint='' WHERE id=2",
    ).run(
      "Detail paket:\n- Salinan Indonesia",
      "1. Login lewat akun Indonesia",
      "Package details:\n- English terms",
      "1. Log in with the English account",
    );

    const shown = await storefrontVariant("canva-premium");
    expect(shown.copy.source).toBe("admin");
    expect(shown.copy.sections.flatMap((section: { items: string[] }) => section.items)).toContain("Salinan Indonesia");
    expect(shown.copy_en.source).toBe("admin");
    expect(JSON.stringify(shown.copy_en)).toContain("English terms");
    expect(JSON.stringify(shown.copy_en)).toContain("Log in with the English account");
    expect(JSON.stringify(shown.copy_en)).not.toContain("Salinan Indonesia");
    expect(shown).not.toHaveProperty("admin_terms_en");
    expect(shown).not.toHaveProperty("admin_activation_en");

    // Varian tanpa EN tetap memakai fallback otomatis (kurasi EN), bukan kolom mentah.
    const wr = await storefrontVariant("netflix-premium");
    expect(wr.copy_en.source).toBe("axvara");
  });
});

describe("tanda tinjau teks supplier (16 November 2026)", () => {
  const rawTerms = "Mendapatkan akun private\nGaransi 5 hari\nDilarang ganti password";
  const rawDelivery = "1. Buka aplikasi\n2. Login";

  function seedRaw() {
    fixture.sql.exec(`
      INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, source, wr_product_id, wr_auto_managed)
        VALUES (4, 2, 'Raw WR', 'raw-wr', 'Raw', 10000, 5, 1, 'warung_rebahan', 'prod-raw', 1);
      INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, sort_order, wr_variant_id, wr_auto_managed)
        VALUES (4, 4, 'WR-RAW', 'Raw', 10000, 5, 1, 0, 'var-raw', 1);
      INSERT INTO wr_products (wr_product_id, wr_product_name, axvara_product_id) VALUES ('prod-raw', 'Raw WR', 4);
    `);
    fixture.sql.prepare(
      `INSERT INTO wr_variants (wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_stock, wr_terms, wr_delivery_terms, axvara_variant_id, axvara_sell_price, wr_delivery_class)
       VALUES ('var-raw', 'prod-raw', 'Raw', 4000, 5, ?, ?, 4, 10000, 'restock')`,
    ).run(rawTerms, rawDelivery);
  }

  async function listRow(slug: string) {
    const { GET } = await import("@/app/api/products/route");
    const list = await (await GET(new NextRequest("http://localhost/api/products"))).json();
    return list.products.find((p: { slug: string }) => p.slug === slug);
  }

  it("counts changed EN-only copy even if the new supplier text is curated", async () => {
    seedRaw();
    // Start from an EN-only save stamped against the previous raw supplier copy.
    fixture.sql.prepare("UPDATE product_variants SET admin_terms_en=?, admin_copy_fingerprint=? WHERE id=4")
      .run("Reviewed English terms", supplierFingerprint(rawTerms, rawDelivery));
    fixture.sql.prepare("UPDATE wr_variants SET wr_terms=?, wr_delivery_terms=? WHERE wr_variant_id='var-raw'")
      .run(legal.terms, legal.deliveryTerms);

    expect(await listRow("raw-wr")).toMatchObject({ copyReview: 1, copyReviewRaw: 0, copyReviewChanged: 1 });
    expect((await getCopy(4))[0]).toMatchObject({ status: "axvara", adminStale: true, reviewKind: "changed" });
    expect((await storefrontVariant("raw-wr")).copy_en.source).toBe("admin");
  });

  it("acknowledge menandai teks supplier oke tanpa mengubah teks admin/storefront", async () => {
    seedRaw();
    const [entry] = await getCopy(4);
    expect(entry).toMatchObject({ status: "pemasok", reviewKind: "raw", reviewed: false, needsReview: true, hasOverride: false });
    expect((await listRow("raw-wr"))).toMatchObject({ copyReview: 1, copyReviewRaw: 1, copyReviewChanged: 0 });

    const before = adminColumns(4);
    const res = await putCopy({ variant_id: 4, supplier_key: entry.supplierKey, action: "acknowledge" });
    expect(res.status).toBe(200);
    const body = await res.json() as { variant: VariantCopyEntry };
    expect(body.variant).toMatchObject({ status: "pemasok", reviewKind: null, reviewed: true, needsReview: false, hasOverride: false });
    expect(adminColumns(4)).toEqual({ ...before, admin_copy_fingerprint: entry.supplierKey });
    expect((await listRow("raw-wr"))).toMatchObject({ copyReview: 0, copyReviewRaw: 0, copyReviewChanged: 0 });

    // Storefront tetap menampilkan teks supplier terrapikan (perilaku tidak berubah).
    const shown = await storefrontVariant("raw-wr");
    expect(shown.copy.source).toBe("pemasok");
    expect(JSON.stringify(shown.copy)).toContain("Garansi 5 hari");
  });

  it("unacknowledge menghapus tanda dan mengembalikan raw", async () => {
    seedRaw();
    const [entry] = await getCopy(4);
    expect((await putCopy({ variant_id: 4, supplier_key: entry.supplierKey, action: "acknowledge" })).status).toBe(200);
    expect(adminColumns(4).admin_copy_fingerprint).toBe(entry.supplierKey);

    const res = await putCopy({ variant_id: 4, supplier_key: entry.supplierKey, action: "unacknowledge" });
    expect(res.status).toBe(200);
    expect((await res.json() as { variant: VariantCopyEntry }).variant).toMatchObject({ reviewKind: "raw", reviewed: false, needsReview: true });
    expect(adminColumns(4).admin_copy_fingerprint).toBeNull();
  });

  it("acknowledge lalu supplier berubah → changed", async () => {
    seedRaw();
    const [entry] = await getCopy(4);
    expect((await putCopy({ variant_id: 4, supplier_key: entry.supplierKey, action: "acknowledge" })).status).toBe(200);
    fixture.sql.prepare("UPDATE wr_variants SET wr_terms=? WHERE wr_variant_id='var-raw'").run(`${rawTerms}\nDilarang login TV`);

    const [after] = await getCopy(4);
    expect(after).toMatchObject({ status: "pemasok", reviewKind: "changed", reviewed: false, needsReview: true });
    expect(await listRow("raw-wr")).toMatchObject({ copyReview: 1, copyReviewRaw: 0, copyReviewChanged: 1 });
  });

  it("menolak supplier_key basi, override ID, dan varian bukan pemasok", async () => {
    seedRaw();
    const [raw] = await getCopy(4);
    expect((await putCopy({ variant_id: 4, supplier_key: "sidik-jari-basi", action: "acknowledge" })).status).toBe(409);

    // Override ID menghalangi acknowledge/unacknowledge.
    expect((await putCopy({ variant_id: 4, supplier_key: raw.supplierKey, terms: "Aturan pakai:\n- Dilarang berbagi", activation: "" })).status).toBe(200);
    const override = await putCopy({ variant_id: 4, supplier_key: raw.supplierKey, action: "acknowledge" });
    expect(override.status).toBe(409);
    expect((await override.json()).error).toBe("has_override");

    // Varian terkurasi (bukan pemasok) tidak bisa ditandai oke.
    const [curated] = await getCopy(1);
    const notPemasok = await putCopy({ variant_id: 1, supplier_key: curated.supplierKey, action: "acknowledge" });
    expect(notPemasok.status).toBe(400);
    expect((await notPemasok.json()).error).toBe("not_pemasok");
  });

  it("CAS acknowledge gagal bila sumber berubah di antara baca dan tulis", async () => {
    seedRaw();
    const [entry] = await getCopy(4);
    fixture.control.beforeRun = async (query) => {
      if (!query.includes("UPDATE product_variants SET admin_copy_fingerprint")) return;
      fixture.control.beforeRun = null;
      fixture.sql.prepare("UPDATE wr_variants SET wr_terms=? WHERE wr_variant_id='var-raw'").run("Perubahan saat menyimpan");
    };
    const res = await putCopy({ variant_id: 4, supplier_key: entry.supplierKey, action: "acknowledge" });
    expect(res.status).toBe(409);
    expect(adminColumns(4).admin_copy_fingerprint).toBeNull();
  });

  it("acknowledge mempertahankan teks EN yang sudah ada", async () => {
    seedRaw();
    fixture.sql.prepare("UPDATE product_variants SET admin_terms_en=?, admin_activation_en=? WHERE id=4")
      .run("Package details:\n- English only", "1. Log in");
    const [entry] = await getCopy(4);
    const res = await putCopy({ variant_id: 4, supplier_key: entry.supplierKey, action: "acknowledge" });
    expect(res.status).toBe(200);
    expect(fixture.sql.prepare("SELECT admin_terms_en, admin_activation_en, admin_copy_fingerprint FROM product_variants WHERE id=4").get())
      .toEqual({ admin_terms_en: "Package details:\n- English only", admin_activation_en: "1. Log in", admin_copy_fingerprint: entry.supplierKey });
  });

  it("action tetap butuh admin", async () => {
    seedRaw();
    auth.admin = false;
    expect((await putCopy({ variant_id: 4, supplier_key: "x", action: "acknowledge" })).status).toBe(401);
  });
});
