// tests/catalog-available-price.regression.test.ts — Harga kartu katalog harus
// milik varian yang BISA DIBELI.
//
// Gejala: kartu menampilkan "Mulai Rp2.000" dari varian termurah yang stoknya
// sudah habis, lalu modal varian hanya menawarkan paket Rp5.000 — pembeli
// merasa harga di katalog bohong. MIN(price) polos tidak memfilter stok.
//
// Kontrak 2026-10-01 (REVISI — mengubah revisi 2026-09-30, keputusan owner):
// kartu habis TAMPIL LAGI di daftar publik (di akhir dengan overlay STOK
// HABIS + foto abu-abu) untuk trust. PDP langsung (?slug=) + search (?q=)
// tetap bisa akses produk habis agar URL lama tidak 404.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";

let fixture: ReturnType<typeof createD1Fixture>;

beforeEach(() => {
  fixture = createD1Fixture();
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
  fixture.sql.prepare(
    `INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, sort_order)
     VALUES (1, 2, 'Canva Premium', 'canva-premium', 'desc', 2000, 5, 1, 0),
            (2, 2, 'Semua Habis', 'semua-habis', 'desc', 3000, 0, 1, 1)`,
  ).run();
  fixture.sql.prepare(
    `INSERT INTO product_variants (id, product_id, sku, label, price, compare_price, stock, is_active, sort_order)
     VALUES (1, 1, 'CANVA-1', 'Murah tapi habis', 2000, 20000, 0, 1, 0),
            (2, 1, 'CANVA-2', 'Tersedia', 5000, 12000, 7, 1, 1),
            (3, 2, 'HABIS-1', 'Habis A', 3000, NULL, 0, 1, 0),
            (4, 2, 'HABIS-2', 'Habis B', 9000, NULL, 0, 1, 1)`,
  ).run();
});

afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function publicCatalog() {
  const { GET } = await import("@/app/api/products/route");
  const res = await GET(new NextRequest("http://localhost/api/products?active=1"));
  const body = await res.json();
  return body.products as Record<string, unknown>[];
}

describe("harga kartu berasal dari varian yang tersedia", () => {
  it("melewati varian termurah yang stoknya habis", async () => {
    const products = await publicCatalog();
    const canva = products.find((p) => p.slug === "canva-premium")!;
    expect(canva.price, "harga kartu harus dari varian yang bisa dibeli").toBe(5000);
    expect(canva.minPrice).toBe(5000);
  });

  it("compare price dipasangkan ke varian tersedia yang sama (diskon tidak fiktif)", async () => {
    const products = await publicCatalog();
    const canva = products.find((p) => p.slug === "canva-premium")!;
    expect(canva.comparePrice).toBe(12000);
  });

  it("produk yang semua variannya habis TAMPIL di daftar (di akhir, bukan hilang)", async () => {
    const products = await publicCatalog();
    expect(products.find((p) => p.slug === "semua-habis")).toBeDefined();
    expect(products.find((p) => p.slug === "canva-premium")).toBeDefined();
  });

  it("produk habis tetap bisa diakses via slug langsung (URL lama tidak 404)", async () => {
    const { GET } = await import("@/app/api/products/route");
    const res = await GET(new NextRequest("http://localhost/api/products?active=1&slug=semua-habis"));
    const body = await res.json();
    const found = (body.products as Record<string, unknown>[]).find((p) => p.slug === "semua-habis");
    expect(found).toBeDefined();
    expect(found!.stock).toBe(0);
  });

  it("produk habis tetap bisa dicari via q (search tidak buta)", async () => {
    const { GET } = await import("@/app/api/products/route");
    const res = await GET(new NextRequest("http://localhost/api/products?active=1&q=habis"));
    const body = await res.json();
    const slugs = (body.products as Record<string, unknown>[]).map((p) => p.slug);
    expect(slugs).toContain("semua-habis");
  });
});
