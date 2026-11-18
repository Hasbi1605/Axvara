// tests/warung-rebahan/ownership.regression.test.ts — Kepemilikan field produk WR.
//
// Masalah yang dikunci:
//  1. Admin tidak bisa mengubah harga/stok/durasi/garansi varian produk WR
//     (atau deskripsi bawaan WR) karena sync WR menimpanya setiap sweep.
//     Validasi harus di API, karena disable input UI tidak mengikat agent CMS
//     / curl / tab lama.
//  2. Revisi 2026-11-18: `name`, `slug` produk WR dan `label` varian WR/SK
//     milik admin (sync hanya mengisi saat INSERT, dan hanya menimpa `label`
//     bila belum dikustomisasi admin — masih NULL/kosong atau sama dengan
//     nama supplier sebelumnya).
//  3. Deskripsi produk WR ditimpa tiap sync, jadi copywriting admin hilang.
//     Kolom `admin_description_override` (migrasi 0030) memberi admin teks
//     sendiri yang TIDAK PERNAH disentuh sync dan diprioritaskan storefront.
//  4. HARGA CORET (compare_price) adalah PENGECUALIAN: milik admin agar
//     katalog WR bisa pasang diskon/badge seperti produk manual. Sync tidak
//     pernah menulis compare_price, jadi nilai admin aman lintas sweep.
//  5. Modal supplier (`supplier_cost`, `supplier_cost_source`) diekspos di
//     GET /api/products/:id; `manual_cost` masuk diabaikan untuk varian WR/SK.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "../helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { syncJaspayCatalog, syncProducts, upsertWrProduct } from "@/lib/warung-rebahan/sync";
import { WR_OWNERSHIP_MESSAGE } from "@/lib/warung-rebahan/ownership";
import type { WrProduct } from "@/lib/warung-rebahan/client";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));

let fixture: ReturnType<typeof createD1Fixture>;

beforeEach(() => {
  fixture = createD1Fixture();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
  // Produk WR auto-managed dengan satu varian WR.
  fixture.sql.prepare(
    `INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, sort_order,
                           source, wr_product_id, wr_auto_managed)
     VALUES (1, 2, 'CapCut Pro (WR)', 'capcut-pro-wr', 'Deskripsi dari WR', 7500, 10, 1, 0,
             'warung_rebahan', 'prod-capcut', 1)`,
  ).run();
  fixture.sql.prepare(
    `INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, sort_order, wr_variant_id, wr_auto_managed)
     VALUES (1, 1, 'WR-VAR1', 'Pro 7 Hari', 7500, 10, 1, 0, 'var-1', 1)`,
  ).run();
  // Produk manual sebagai kontrol: tidak boleh ikut terkunci.
  fixture.sql.prepare(
    `INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, sort_order)
     VALUES (2, 2, 'Produk Manual', 'produk-manual', 'Punya admin', 5000, -1, 1, 1)`,
  ).run();
  fixture.sql.prepare(
    `INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, sort_order)
     VALUES (2, 2, 'MANUAL-1', 'Paket 1', 5000, -1, 1, 0)`,
  ).run();
});

afterEach(() => {
  fixture.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function putProduct(id: number, body: Record<string, unknown>) {
  const { PUT } = await import("@/app/api/products/[id]/route");
  const request = new NextRequest(`http://localhost/api/products/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return PUT(request, { params: Promise.resolve({ id: String(id) }) });
}

describe("produk WR: field milik sync ditolak di API", () => {
  it("menolak ubah harga varian WR dengan 409 dan TIDAK menulis apa pun", async () => {
    const res = await putProduct(1, {
      name: "CapCut Pro (WR)",
      slug: "capcut-pro-wr",
      variants: [{ id: 1, sku: "WR-VAR1", label: "Pro 7 Hari", price: 99000, stock: 10, is_active: 1, sort_order: 0 }],
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.field).toBe("price");
    const row = fixture.sql.prepare("SELECT price FROM product_variants WHERE id=1").get() as { price: number };
    expect(row.price).toBe(7500);
  });

  it("menolak ubah stok, durasi, garansi varian WR dan deskripsi produk WR", async () => {
    const stok = await putProduct(1, {
      variants: [{ id: 1, sku: "WR-VAR1", label: "Pro 7 Hari", price: 7500, stock: 999, is_active: 1, sort_order: 0 }],
    });
    expect(stok.status).toBe(409);
    const stokBody = await stok.json();
    expect(stokBody.field).toBe("stock");
    expect(stokBody.error).toBe(WR_OWNERSHIP_MESSAGE);
    expect(WR_OWNERSHIP_MESSAGE).toContain("nama, slug, nama varian");
    expect(WR_OWNERSHIP_MESSAGE).not.toContain("Nama, slug, deskripsi");

    const durasi = await putProduct(1, {
      variants: [{ id: 1, sku: "WR-VAR1", label: "Pro 7 Hari", price: 7500, stock: 10, duration_value: 30, duration_unit: "day", is_active: 1, sort_order: 0 }],
    });
    expect(durasi.status).toBe(409);
    expect((await durasi.json()).field).toBe("duration_value");

    const garansi = await putProduct(1, {
      variants: [{ id: 1, sku: "WR-VAR1", label: "Pro 7 Hari", price: 7500, stock: 10, warranty_type: "full", is_active: 1, sort_order: 0 }],
    });
    expect(garansi.status).toBe(409);
    expect((await garansi.json()).field).toBe("warranty_type");

    const desc = await putProduct(1, { description: "Deskripsi tulisan admin" });
    expect(desc.status).toBe(409);
    expect((await desc.json()).field).toBe("description");
  });

  it("MENGIZINKAN ubah nama dan slug produk WR, tetapi menolak slug bentrok (409)", async () => {
    const ok = await putProduct(1, {
      name: "CapCut Pro Resmi",
      slug: "capcut-pro-resmi",
    });
    expect(ok.status).toBe(200);
    const updated = fixture.sql.prepare("SELECT name, slug FROM products WHERE id=1").get() as { name: string; slug: string };
    expect(updated).toEqual({ name: "CapCut Pro Resmi", slug: "capcut-pro-resmi" });

    const collision = await putProduct(1, { slug: "produk-manual" });
    expect(collision.status).toBe(409);
    expect((await collision.json()).error).toBe("slug sudah dipakai");
    const intact = fixture.sql.prepare("SELECT slug FROM products WHERE id=1").get() as { slug: string };
    expect(intact.slug).toBe("capcut-pro-resmi");
  });

  it("MENGIZINKAN ubah label varian WR lewat PUT /api/products/:id dan /api/admin/variants", async () => {
    const res1 = await putProduct(1, {
      variants: [{ id: 1, sku: "WR-VAR1", label: "Label Kustom 1", price: 7500, stock: 10, is_active: 1, sort_order: 0 }],
    });
    expect(res1.status).toBe(200);
    expect((fixture.sql.prepare("SELECT label FROM product_variants WHERE id=1").get() as { label: string }).label).toBe("Label Kustom 1");

    vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
    const { PUT, POST } = await import("@/app/api/admin/variants/route");
    const res2 = await PUT(new NextRequest("http://localhost/api/admin/variants?id=1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: 1, label: "Label Kustom 2" }),
    }));
    expect(res2.status).toBe(200);
    expect((fixture.sql.prepare("SELECT label FROM product_variants WHERE id=1").get() as { label: string }).label).toBe("Label Kustom 2");

    const res3 = await POST(new NextRequest("http://localhost/api/admin/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: 1,
        variants: [{ id: 1, product_id: 1, sku: "WR-VAR1", label: "Label Kustom 3", price: 7500, stock: 10, is_active: 1, sort_order: 0 }],
      }),
    }));
    expect(res3.status).toBe(200);
    expect((fixture.sql.prepare("SELECT label FROM product_variants WHERE id=1").get() as { label: string }).label).toBe("Label Kustom 3");
  });

  it("MENGIZINKAN field milik admin: badge, foto, sort order, aktif/nonaktif", async () => {
    const res = await putProduct(1, {
      badge: "Terlaris",
      sortOrder: 7,
      isActive: true,
      images: ["https://images.unsplash.com/photo-1?w=600"],
    });
    expect(res.status).toBe(200);
    const row = fixture.sql.prepare("SELECT badge, sort_order FROM products WHERE id=1").get() as { badge: string; sort_order: number };
    expect(row.badge).toBe("Terlaris");
    expect(row.sort_order).toBe(7);
  });

  it("mengirim ulang nilai WR yang SAMA bukan pelanggaran (form admin kirim utuh)", async () => {
    const res = await putProduct(1, {
      name: "CapCut Pro (WR)",
      slug: "capcut-pro-wr",
      description: "Deskripsi dari WR",
      badge: "Hemat",
      variants: [{ id: 1, sku: "WR-VAR1", label: "Pro 7 Hari", price: 7500, stock: 10, is_active: 1, sort_order: 0 }],
    });
    expect(res.status).toBe(200);
  });

  it("regresi 7 Nov 2026: deskripsi WR berspasi di ujung + form ter-trim tetap bisa pindah kategori", async () => {
    fixture.sql.prepare("UPDATE products SET description=? WHERE id=1").run("Deskripsi dari WR\n\n");
    const target = fixture.sql.prepare("SELECT id, slug FROM categories WHERE id<>2 ORDER BY id LIMIT 1").get() as { id: number; slug: string };
    const res = await putProduct(1, {
      name: "CapCut Pro (WR)",
      slug: "capcut-pro-wr",
      description: "Deskripsi dari WR",
      categorySlug: target.slug,
      variants: [{ id: 1, sku: "WR-VAR1", label: "Pro 7 Hari", price: 7500, stock: 10, is_active: 1, sort_order: 0 }],
    });
    expect(res.status).toBe(200);
    const row = fixture.sql.prepare("SELECT category_id, description FROM products WHERE id=1").get() as { category_id: number; description: string };
    expect(row.category_id).toBe(target.id);
    // Kolom milik sync tidak ditulis ulang oleh admin.
    expect(row.description).toBe("Deskripsi dari WR\n\n");
  });

  it("produk manual tidak ikut terkunci", async () => {
    const res = await putProduct(2, {
      name: "Produk Manual Baru",
      description: "Deskripsi baru",
      variants: [{ id: 2, sku: "MANUAL-1", label: "Paket Baru", price: 9000, stock: -1, is_active: 1, sort_order: 0 }],
    });
    expect(res.status).toBe(200);
    const row = fixture.sql.prepare("SELECT price, label FROM product_variants WHERE id=2").get() as { price: number; label: string };
    expect(row.price).toBe(9000);
    expect(row.label).toBe("Paket Baru");
  });

  it("MENGIZINKAN harga coret produk WR via PUT /api/products/:id", async () => {
    const res = await putProduct(1, {
      variants: [{ id: 1, sku: "WR-VAR1", label: "Pro 7 Hari", price: 7500, comparePrice: 15000, stock: 10, is_active: 1, sort_order: 0 }],
    });
    expect(res.status).toBe(200);
    const row = fixture.sql.prepare("SELECT compare_price FROM product_variants WHERE id=1").get() as { compare_price: number };
    expect(row.compare_price).toBe(15000);
  });
});

describe("/api/admin/variants bukan pintu belakang", () => {
  // Jalur tulis KEDUA untuk varian. Tanpa guard yang sama, panel varian
  // lama (VariantEditor) tetap bisa mengubah harga/stok varian WR dan
  // perubahannya hilang diam-diam di sweep sync berikutnya.
  // `@/lib/auth` sudah dimock di level modul (requireAdmin selalu lolos),
  // jadi request cukup membawa body — tidak ada token yang diverifikasi.
  function variantsRequest(path: string, init: { method: string; headers: Record<string, string>; body: string }) {
    return new NextRequest(`http://localhost${path}`, init);
  }

  it("PUT menolak ubah harga varian WR (409) dan tidak menulis", async () => {
    vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
    const { PUT } = await import("@/app/api/admin/variants/route");
    const res = await PUT(variantsRequest("/api/admin/variants?id=1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: 1, price: 99000 }),
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).field).toBe("price");
    const row = fixture.sql.prepare("SELECT price FROM product_variants WHERE id=1").get() as { price: number };
    expect(row.price).toBe(7500);
  });

  it("POST batch menolak ubah stok varian WR (409)", async () => {
    vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
    const { POST } = await import("@/app/api/admin/variants/route");
    const res = await POST(variantsRequest("/api/admin/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: 1,
        variants: [{ id: 1, product_id: 1, sku: "WR-VAR1", label: "Pro 7 Hari", price: 7500, stock: 999, is_active: 1, sort_order: 0 }],
      }),
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).field).toBe("stock");
  });

  it("PUT varian manual tetap bisa diubah", async () => {
    vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
    const { PUT } = await import("@/app/api/admin/variants/route");
    const res = await PUT(variantsRequest("/api/admin/variants?id=2", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: 2, price: 8000 }),
    }));
    expect(res.status).toBe(200);
    const row = fixture.sql.prepare("SELECT price FROM product_variants WHERE id=2").get() as { price: number };
    expect(row.price).toBe(8000);
  });

  it("MENGIZINKAN harga coret varian WR (milik admin, sync tak pernah timpa)", async () => {
    vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
    const { PUT } = await import("@/app/api/admin/variants/route");
    const res = await PUT(variantsRequest("/api/admin/variants?id=1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: 1, compare_price: 15000 }),
    }));
    expect(res.status).toBe(200);
    const row = fixture.sql.prepare("SELECT compare_price FROM product_variants WHERE id=1").get() as { compare_price: number };
    expect(row.compare_price).toBe(15000);
  });

  it("POST batch MENGIZINKAN harga coret varian WR", async () => {
    vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
    const { POST } = await import("@/app/api/admin/variants/route");
    const res = await POST(variantsRequest("/api/admin/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: 1,
        variants: [{ id: 1, product_id: 1, sku: "WR-VAR1", label: "Pro 7 Hari", price: 7500, compare_price: 15000, stock: 10, is_active: 1, sort_order: 0 }],
      }),
    }));
    expect(res.status).toBe(200);
    const row = fixture.sql.prepare("SELECT compare_price FROM product_variants WHERE id=1").get() as { compare_price: number };
    expect(row.compare_price).toBe(15000);
  });
});

describe("override konsisten di SEMUA kanal (web, Telegram, WhatsApp)", () => {
  // `src/lib/catalog.ts` melayani /api/catalog dan bot Telegram/WhatsApp.
  // Kalau ia membaca `description` mentah, override admin hanya tampil di
  // web sementara bot tetap mengirim teks WR — pembeli melihat dua versi.
  beforeEach(() => {
    vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
    fixture.sql.prepare("UPDATE products SET admin_description_override='Teks AXVARA' WHERE id=1").run();
  });

  it("listActiveProducts memakai override, bukan deskripsi WR", async () => {
    fixture.sql.exec("INSERT INTO wr_products(wr_product_id,wr_product_name) VALUES('prod-capcut','CapCut'); INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_delivery_class) VALUES('var-1','prod-capcut','Pro 7 Hari',5000,'restock')");
    const { listActiveProducts } = await import("@/lib/catalog");
    const rows = await listActiveProducts();
    const wr = rows.find((r) => r.slug === "capcut-pro-wr");
    expect(wr?.description).toBe("Teks AXVARA");
  });

  it("getProductDetail memakai override, bukan deskripsi WR", async () => {
    const { getProductDetail } = await import("@/lib/catalog");
    const detail = await getProductDetail("capcut-pro-wr");
    expect(detail?.description).toBe("Teks AXVARA");
  });

  it("tanpa override, kanal tetap memakai deskripsi WR", async () => {
    fixture.sql.prepare("UPDATE products SET admin_description_override=NULL WHERE id=1").run();
    const { getProductDetail } = await import("@/lib/catalog");
    const detail = await getProductDetail("capcut-pro-wr");
    expect(detail?.description).toBe("Deskripsi dari WR");
  });

  it("PDP (meta SEO / OG / JSON-LD) memakai override yang sama", async () => {
    // Halaman produk dibaca pembeli DAN mesin pencari. Kalau ia memakai teks
    // WR sementara storefront memakai override, hasil pencarian Google
    // menampilkan deskripsi yang berbeda dari halaman yang dibuka.
    const { displayDescription } = await import("@/lib/catalog");
    const row = fixture.sql.prepare(
      "SELECT description, admin_description_override FROM products WHERE id=1",
    ).get() as Record<string, unknown>;
    expect(displayDescription(row)).toBe("Teks AXVARA");

    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/app/(shop)/produk/[slug]/page.tsx", "utf8"),
    );
    expect(source, "PDP harus ikut mengambil kolom override").toContain("admin_description_override");
    expect(source, "PDP harus memakai resolver bersama").toContain("displayDescription(product)");
  });
});

describe("S&K varian WR terbaca storefront via JOIN (tanpa migrasi)", () => {
  // `wr_terms`/`wr_delivery_terms` hidup di wr_variants (milik sync).
  // getProductDetail JOIN via wr_variant_id agar PDP menampilkannya tanpa
  // kolom baru / dual-write. Varian manual (tanpa wr_variant_id) → null.
  beforeEach(() => {
    vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
    fixture.sql.prepare(
      `INSERT INTO wr_products (wr_product_id, wr_product_name, axvara_product_id)
       VALUES ('prod-capcut', 'CapCut (WR)', 1)`,
    ).run();
    fixture.sql.prepare(
      `INSERT INTO wr_variants (wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_stock, wr_terms, wr_delivery_terms, axvara_variant_id, axvara_sell_price, wr_delivery_class)
       VALUES ('var-1', 'prod-capcut', 'Pro 7 Hari', 5000, 10, '1. Fresh, made by order\n2. Garansi sejak pembelian', 'Klik Verifikasi via kode sandi', 1, 7500, 'restock')`,
    ).run();
  });

  it("getProductDetail mengembalikan terms + delivery_terms varian WR", async () => {
    const { getProductDetail } = await import("@/lib/catalog");
    const detail = await getProductDetail("capcut-pro-wr");
    expect(detail?.variants[0]?.terms).toContain("Fresh, made by order");
    expect(detail?.variants[0]?.delivery_terms).toContain("Verifikasi via kode sandi");
  });

  it("varian manual tanpa wr_variant_id mendapat terms null", async () => {
    const { getProductDetail } = await import("@/lib/catalog");
    const detail = await getProductDetail("produk-manual");
    expect(detail?.variants[0]?.terms).toBeNull();
    expect(detail?.variants[0]?.delivery_terms).toBeNull();
  });

  it("/api/catalog mengirim salinan siap tampil per varian, bukan teks mentah WR", async () => {
    // Kontrak 2026-09-24: storefront menerima `copy` (versi Axvara bila teks
    // WR sudah dikurasi, selain itu teks WR yang dirapikan). Isi pemasok tetap
    // utuh di fallback — tidak ada aturan yang hilang karena belum dikurasi.
    const { GET } = await import("@/app/api/catalog/route");
    const res = await GET(new Request("http://localhost/api/catalog?slug=capcut-pro-wr"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const variant = body.product.variants[0];
    expect(variant.terms).toBeNull();
    expect(variant.delivery_terms).toBeNull();
    expect(variant.copy.source).toBe("pemasok");
    expect(variant.copy.sections).toEqual([
      { kind: "proses", items: ["Fresh, made by order"] },
      { kind: "garansi", items: ["Garansi sejak pembelian"] },
    ]);
    expect(variant.copy.activation).toEqual([{ title: null, steps: ["Klik Verifikasi via kode sandi"] }]);
  });

  it("varian manual di /api/catalog tidak punya salinan S&K", async () => {
    const { GET } = await import("@/app/api/catalog/route");
    const res = await GET(new Request("http://localhost/api/catalog?slug=produk-manual"));
    const body = await res.json();
    expect(body.product.variants[0].copy).toBeNull();
  });
});

describe("admin_description_override (migrasi 0030)", () => {  it("admin dapat menyimpan override tanpa menyentuh deskripsi WR", async () => {
    const res = await putProduct(1, { adminDescriptionOverride: "Versi copywriting AXVARA" });
    expect(res.status).toBe(200);
    const row = fixture.sql.prepare(
      "SELECT description, admin_description_override FROM products WHERE id=1",
    ).get() as { description: string; admin_description_override: string };
    expect(row.description).toBe("Deskripsi dari WR");
    expect(row.admin_description_override).toBe("Versi copywriting AXVARA");
  });

  it("override string kosong menghapus override (kembali ke deskripsi WR)", async () => {
    await putProduct(1, { adminDescriptionOverride: "Sementara" });
    const res = await putProduct(1, { adminDescriptionOverride: "" });
    expect(res.status).toBe(200);
    const row = fixture.sql.prepare("SELECT admin_description_override FROM products WHERE id=1").get() as { admin_description_override: string | null };
    expect(row.admin_description_override).toBeNull();
  });

  it("sync WR memperbarui description TAPI TIDAK PERNAH menimpa override", async () => {
    fixture.sql.prepare("UPDATE products SET admin_description_override='Punya admin' WHERE id=1").run();
    fixture.sql.prepare(
      "INSERT INTO wr_products(wr_product_id, wr_product_name, axvara_product_id) VALUES('prod-capcut','CapCut Pro',1)",
    ).run();
    const wrProduct: WrProduct = {
      id: "prod-capcut",
      name: "CapCut Pro",
      category: "Productivity",
      description: "Deskripsi WR yang diperbarui upstream",
      variants: [],
    } as unknown as WrProduct;
    await upsertWrProduct(wrProduct, { excluded: false, reason: null }, createDatabaseAccess(fixture.db));
    const row = fixture.sql.prepare(
      "SELECT description, admin_description_override FROM products WHERE id=1",
    ).get() as { description: string; admin_description_override: string };
    expect(row.description).toBe("Deskripsi WR yang diperbarui upstream");
    expect(row.admin_description_override).toBe("Punya admin");
  });

  it("GET produk memisahkan teks WR dan override; storefront memakai override", async () => {
    fixture.sql.prepare("UPDATE products SET admin_description_override='Teks tampil' WHERE id=1").run();
    const { GET } = await import("@/app/api/products/[id]/route");
    const detail = await GET(
      new NextRequest("http://localhost/api/products/1"),
      { params: Promise.resolve({ id: "1" }) },
    );
    const body = await detail.json();
    expect(body.product.description).toBe("Teks tampil");
    expect(body.product.wrDescription).toBe("Deskripsi dari WR");
    expect(body.product.adminDescriptionOverride).toBe("Teks tampil");
    expect(body.product.wrManaged).toBe(true);
  });
});

describe("label varian kustom WR bertahan lintas sync + supplier_cost & manual_cost (2026-11-18)", () => {
  beforeEach(() => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
    vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
  });

  function wrCatalog(v1Name: string, v2Name: string, stock = 10): WrProduct[] {
    return [{
      id: "prod-wr-lbl",
      name: "CapCut WR",
      category: "Design",
      description: "Desc WR",
      variants: [
        { id: "var-wr-custom", name: v1Name, price: 5000, duration: "7 Hari", type: "Private", warranty: "7 Hari", stock, terms: null, delivery_terms: null },
        { id: "var-wr-default", name: v2Name, price: 10000, duration: "30 Hari", type: "Private", warranty: "30 Hari", stock, terms: null, delivery_terms: null },
      ],
    }];
  }

  it("sync WR penuh & diff mempertahankan label kustom admin sementara label default ikut rename supplier", async () => {
    const db = createDatabaseAccess(fixture.db);
    await syncProducts(db, async () => wrCatalog("Pro 7D", "Pro 30D"));
    const pRow = fixture.sql.prepare("SELECT id FROM products WHERE wr_product_id='prod-wr-lbl'").get() as { id: number };
    const vCustom = fixture.sql.prepare("SELECT id, sku FROM product_variants WHERE wr_variant_id='var-wr-custom'").get() as { id: number; sku: string };
    const vDefault = fixture.sql.prepare("SELECT id, sku FROM product_variants WHERE wr_variant_id='var-wr-default'").get() as { id: number; sku: string };

    // Admin mengubah nama & slug produk serta label varian pertama saja (kirim field WR yang sama agar lolos guard).
    const editRes = await putProduct(pRow.id, {
      name: "CapCut Kustom",
      slug: "capcut-kustom",
      variants: [
        {
          id: vCustom.id, sku: vCustom.sku, label: "Paket Hemat 7 Hari", price: 7500, stock: 10,
          duration_value: 7, duration_unit: "day", duration_label: "7 Hari",
          warranty_type: "limited", warranty_value: 7, warranty_unit: "day", warranty_label: "7 Hari",
          is_active: 1, sort_order: 0,
        },
        {
          id: vDefault.id, sku: vDefault.sku, label: "Pro 30D", price: 15000, stock: 10,
          duration_value: 30, duration_unit: "day", duration_label: "30 Hari",
          warranty_type: "limited", warranty_value: 30, warranty_unit: "day", warranty_label: "30 Hari",
          is_active: 1, sort_order: 1,
        },
      ],
    });
    expect(editRes.status).toBe(200);

    // Sync dengan nama supplier sama: label kustom & nama/slug produk tetap utuh, dan tidak menulis ulang product_variants.
    const origPrepare = fixture.db.prepare.bind(fixture.db);
    let pvUpdates = 0;
    (fixture.db as unknown as { prepare: unknown }).prepare = ((query: string) => {
      const stmt = origPrepare(query);
      if (!query.trim().toUpperCase().startsWith("UPDATE PRODUCT_VARIANTS")) return stmt;
      const wrap = (s: typeof stmt): typeof stmt => ({
        ...s,
        bind: (...vals: unknown[]) => wrap(s.bind(...vals)),
        run: async () => {
          const r = await s.run();
          pvUpdates += Number(r?.meta?.changes ?? 0);
          return r;
        },
      });
      return wrap(stmt);
    }) as typeof fixture.db.prepare;

    await syncProducts(createDatabaseAccess(fixture.db), async () => wrCatalog("Pro 7D", "Pro 30D"));
    expect(pvUpdates).toBe(0);
    expect((fixture.sql.prepare("SELECT name, slug FROM products WHERE id=?").get(pRow.id) as { name: string; slug: string })).toEqual({
      name: "CapCut Kustom",
      slug: "capcut-kustom",
    });
    expect((fixture.sql.prepare("SELECT label FROM product_variants WHERE id=?").get(vCustom.id) as { label: string }).label).toBe("Paket Hemat 7 Hari");

    // Supplier me-rename kedua varian via full sweep: kustom tetap, non-kustom ikut nama baru.
    await syncProducts(createDatabaseAccess(fixture.db), async () => wrCatalog("Pro 7D v2", "Pro 30D v2", 12));
    expect((fixture.sql.prepare("SELECT label, stock FROM product_variants WHERE id=?").get(vCustom.id) as { label: string; stock: number })).toEqual({
      label: "Paket Hemat 7 Hari",
      stock: 12,
    });
    expect((fixture.sql.prepare("SELECT label FROM product_variants WHERE id=?").get(vDefault.id) as { label: string }).label).toBe("Pro 30D v2");
    expect((fixture.sql.prepare("SELECT wr_variant_name FROM wr_variants WHERE wr_variant_id='var-wr-custom'").get() as { wr_variant_name: string }).wr_variant_name).toBe("Pro 7D v2");

    // Diff sync (applyOnly) berikutnya saat supplier rename lagi: kustom tetap, non-kustom ikut nama baru.
    await syncProducts(createDatabaseAccess(fixture.db), undefined, {
      applyOnly: { products: wrCatalog("Pro 7D v3", "Pro 30D v3", 15), removedVariantIds: [] },
    });
    expect((fixture.sql.prepare("SELECT label, stock FROM product_variants WHERE id=?").get(vCustom.id) as { label: string; stock: number })).toEqual({
      label: "Paket Hemat 7 Hari",
      stock: 15,
    });
    expect((fixture.sql.prepare("SELECT label FROM product_variants WHERE id=?").get(vDefault.id) as { label: string }).label).toBe("Pro 30D v3");
  });

  it("sync Jaspay mempertahankan label kustom admin dan memperbarui label non-kustom saat supplier rename", async () => {
    const jaspayFeed = (p1Name: string, p2Name: string) => ([{
      id: "jsp-1",
      product: "zoom-jsp",
      name: "Zoom Jaspay",
      description: "Meeting",
      after_note: null,
      available: true,
      max_quantity: 5,
      default_package: "pkg-a",
      packages: [
        { id: "pkg-a", name: p1Name, price: 10000, available: true },
        { id: "pkg-b", name: p2Name, price: 20000, available: true },
      ],
    }]);

    await syncJaspayCatalog(createDatabaseAccess(fixture.db), async () => jaspayFeed("Paket A", "Paket B"));
    const vCustom = fixture.sql.prepare("SELECT id FROM product_variants WHERE wr_variant_id='jaspay:zoom-jsp:pkg-a'").get() as { id: number };
    const vDefault = fixture.sql.prepare("SELECT id FROM product_variants WHERE wr_variant_id='jaspay:zoom-jsp:pkg-b'").get() as { id: number };

    fixture.sql.prepare("UPDATE product_variants SET label='Zoom Kustom' WHERE id=?").run(vCustom.id);

    await syncJaspayCatalog(createDatabaseAccess(fixture.db), async () => jaspayFeed("Paket A Baru", "Paket B Baru"));
    expect((fixture.sql.prepare("SELECT label FROM product_variants WHERE id=?").get(vCustom.id) as { label: string }).label).toBe("Zoom Kustom");
    expect((fixture.sql.prepare("SELECT label FROM product_variants WHERE id=?").get(vDefault.id) as { label: string }).label).toBe("Paket B Baru");
  });

  it("GET /api/products/:id mengekspos supplier_cost & supplier_cost_source dan PUT mengabaikan manual_cost untuk varian WR/SK", async () => {
    // Tambahkan varian SK + data wr_variants & sk_products + manual_cost awal.
    fixture.sql.prepare("INSERT INTO wr_products(wr_product_id, wr_product_name, axvara_product_id) VALUES('prod-capcut', 'CapCut Pro (WR)', 1)").run();
    fixture.sql.prepare("INSERT INTO wr_variants(wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_stock, axvara_variant_id, axvara_sell_price) VALUES('var-1', 'prod-capcut', 'Pro 7 Hari', 5200, 10, 1, 7500)").run();
    fixture.sql.prepare("UPDATE product_variants SET manual_cost=1111 WHERE id=1").run();

    fixture.sql.prepare(
      `INSERT INTO products (id, category_id, name, slug, price, stock, is_active, sort_order, source, sk_product_id, sk_auto_managed)
       VALUES (3, 2, 'Netflix SK', 'netflix-sk', 15000, 5, 1, 2, 'manual', '9', 1)`,
    ).run();
    fixture.sql.prepare(
      `INSERT INTO product_variants (id, product_id, sku, label, price, stock, manual_cost, is_active, sort_order, sk_variant_id, sk_auto_managed)
       VALUES (3, 3, 'SK-101', '1 Bulan', 15000, 5, 2222, 1, 0, '101', 1)`,
    ).run();
    fixture.sql.prepare(
      `INSERT INTO sk_products (sk_variant_id, sk_product_id, sk_product_name, sk_variant_name, sk_price, sk_stock, sk_order_process, axvara_product_id, axvara_variant_id, axvara_sell_price)
       VALUES ('101', '9', 'Netflix', '1 Bulan', 10500, 5, 'auto', 3, 3, 15000)`,
    ).run();

    const { GET } = await import("@/app/api/products/[id]/route");
    const wrRes = await GET(new NextRequest("http://localhost/api/products/1"), { params: Promise.resolve({ id: "1" }) });
    const wrBody = await wrRes.json() as { product: { variants: { supplier_cost: number | null; supplier_cost_source: string | null }[] } };
    expect(wrBody.product.variants[0]).toMatchObject({ supplier_cost: 5200, supplier_cost_source: "WR" });

    const skRes = await GET(new NextRequest("http://localhost/api/products/3"), { params: Promise.resolve({ id: "3" }) });
    const skBody = await skRes.json() as { product: { variants: { supplier_cost: number | null; supplier_cost_source: string | null }[] } };
    expect(skBody.product.variants[0]).toMatchObject({ supplier_cost: 10500, supplier_cost_source: "SK" });

    const manualRes = await GET(new NextRequest("http://localhost/api/products/2"), { params: Promise.resolve({ id: "2" }) });
    const manualBody = await manualRes.json() as { product: { variants: { supplier_cost: number | null; supplier_cost_source: string | null }[] } };
    expect(manualBody.product.variants[0]).toMatchObject({ supplier_cost: null, supplier_cost_source: null });

    // Precedence WR > SK (identik cost-snapshot) + /api/admin/variants konsisten.
    fixture.sql.prepare("UPDATE product_variants SET sk_variant_id='101' WHERE id=1").run();
    const bothRes = await GET(new NextRequest("http://localhost/api/products/1"), { params: Promise.resolve({ id: "1" }) });
    const bothBody = await bothRes.json() as { product: { variants: { supplier_cost: number | null; supplier_cost_source: string | null }[] } };
    expect(bothBody.product.variants[0]).toMatchObject({ supplier_cost: 5200, supplier_cost_source: "WR" });
    fixture.sql.prepare("UPDATE product_variants SET sk_variant_id=NULL WHERE id=1").run();

    const { GET: getVariants } = await import("@/app/api/admin/variants/route");
    const varsRes = await getVariants(new NextRequest("http://localhost/api/admin/variants?product_id=3"));
    const varsBody = await varsRes.json() as { variants: { supplier_cost: number | null; supplier_cost_source: string | null }[] };
    expect(varsBody.variants[0]).toMatchObject({ supplier_cost: 10500, supplier_cost_source: "SK" });

    // PUT /api/products/:id: manual_cost diabaikan untuk WR & SK, tetapi tersimpan untuk manual.
    expect((await putProduct(1, {
      variants: [{ id: 1, sku: "WR-VAR1", label: "Pro 7 Hari", price: 7500, stock: 10, manual_cost: 99999, is_active: 1, sort_order: 0 }],
    })).status).toBe(200);
    expect((fixture.sql.prepare("SELECT manual_cost FROM product_variants WHERE id=1").get() as { manual_cost: number }).manual_cost).toBe(1111);

    expect((await putProduct(3, {
      variants: [{ id: 3, sku: "SK-101", label: "1 Bulan", price: 15000, stock: 5, manual_cost: 88888, is_active: 1, sort_order: 0 }],
    })).status).toBe(200);
    expect((fixture.sql.prepare("SELECT manual_cost FROM product_variants WHERE id=3").get() as { manual_cost: number }).manual_cost).toBe(2222);

    expect((await putProduct(2, {
      variants: [{ id: 2, sku: "MANUAL-1", label: "Paket 1", price: 5000, stock: -1, manual_cost: 3333, is_active: 1, sort_order: 0 }],
    })).status).toBe(200);
    expect((fixture.sql.prepare("SELECT manual_cost FROM product_variants WHERE id=2").get() as { manual_cost: number }).manual_cost).toBe(3333);

    // /api/admin/variants PUT & POST: abaikan manual_cost untuk varian WR/SK tanpa error.
    const { PUT: putVar, POST: postVar } = await import("@/app/api/admin/variants/route");
    const putOnlyCost = await putVar(new NextRequest("http://localhost/api/admin/variants?id=1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manual_cost: 77777 }),
    }));
    expect(putOnlyCost.status).toBe(200);
    expect((fixture.sql.prepare("SELECT manual_cost FROM product_variants WHERE id=1").get() as { manual_cost: number }).manual_cost).toBe(1111);

    const postSkBatch = await postVar(new NextRequest("http://localhost/api/admin/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: 3,
        variants: [{ id: 3, product_id: 3, sku: "SK-101", label: "1 Bulan SK", price: 15000, stock: 5, manual_cost: 77777, is_active: 1, sort_order: 0 }],
      }),
    }));
    expect(postSkBatch.status).toBe(200);
    expect((fixture.sql.prepare("SELECT label, manual_cost FROM product_variants WHERE id=3").get() as { label: string; manual_cost: number })).toEqual({
      label: "1 Bulan SK",
      manual_cost: 2222,
    });
  });
});
