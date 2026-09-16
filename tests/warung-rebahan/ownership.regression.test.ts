// tests/warung-rebahan/ownership.regression.test.ts — Kepemilikan field produk WR.
//
// Masalah yang dikunci:
//  1. Admin bisa mengedit harga/stok/label varian produk WR; tersimpan, lalu
//     hilang diam-diam di sweep sync berikutnya. Validasi harus di API,
//     karena disable input UI tidak mengikat agent CMS / curl / tab lama.
//  2. Deskripsi produk WR ditimpa tiap sync, jadi copywriting admin hilang.
//     Kolom `admin_description_override` (migrasi 0030) memberi admin teks
//     sendiri yang TIDAK PERNAH disentuh sync dan diprioritaskan storefront.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "../helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { upsertWrProduct } from "@/lib/warung-rebahan/sync";
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

  it("menolak ubah stok dan label varian WR", async () => {
    const stok = await putProduct(1, {
      variants: [{ id: 1, sku: "WR-VAR1", label: "Pro 7 Hari", price: 7500, stock: 999, is_active: 1, sort_order: 0 }],
    });
    expect(stok.status).toBe(409);
    expect((await stok.json()).field).toBe("stock");

    const label = await putProduct(1, {
      variants: [{ id: 1, sku: "WR-VAR1", label: "Label Karangan Admin", price: 7500, stock: 10, is_active: 1, sort_order: 0 }],
    });
    expect(label.status).toBe(409);
    expect((await label.json()).field).toBe("label");
  });

  it("menolak ubah nama dan deskripsi produk WR", async () => {
    const nama = await putProduct(1, { name: "Nama Baru Admin" });
    expect(nama.status).toBe(409);
    expect((await nama.json()).field).toBe("name");

    const desc = await putProduct(1, { description: "Deskripsi tulisan admin" });
    expect(desc.status).toBe(409);
    expect((await desc.json()).field).toBe("description");
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
      fs.readFileSync("src/app/produk/[slug]/page.tsx", "utf8"),
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
      `INSERT INTO wr_variants (wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_stock, wr_terms, wr_delivery_terms, axvara_variant_id, axvara_sell_price)
       VALUES ('var-1', 'prod-capcut', 'Pro 7 Hari', 5000, 10, '1. Fresh, made by order\n2. Garansi sejak pembelian', 'Klik Verifikasi via kode sandi', 1, 7500)`,
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

  it("PDP merender section Syarat & Ketentuan per varian", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/app/produk/[slug]/product-detail-client.tsx", "utf8"),
    );
    expect(source).toContain("Syarat &");
    expect(source).toContain("termsVariant");
    expect(source).toContain("delivery_terms");
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
