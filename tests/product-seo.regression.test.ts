// tests/product-seo.regression.test.ts — Issue #11: sitemap & SEO halaman produk
//
// Temuan audit 7 Sep 2026:
// (1) sitemap memakai 24 slug seed statis — produk seed tak-tersedia ikut
//     tercantum, produk D1 baru tak tercantum, sisa nonaktif ikut tercantum;
// (2) PDP "use client" penuh: crawler/preview tanpa JS hanya melihat shell
//     kosong (title generik, tanpa h1/nama/harga, tanpa canonical/OG/JSON-LD);
// (3) slug ngawur tetap HTTP 200 dengan shell kosong (soft-404).
//
// Perilaku yang seharusnya: sitemap dari produk aktif D1 (+varian aktif,
// lastmod updated_at, tanpa fragmen), PDP server-rendered (generateMetadata
// per-produk + canonical + OG/Twitter + JSON-LD Product + h1/harga/deskripsi
// dari D1), slug ngawur → notFound() (404), flow beli tetap via API yang sama.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  seoAvailability,
  seoDescription,
  seoImages,
  seoMaxPrice,
  seoMinPrice,
  seoProductJsonLd,
  type SeoProduct,
} from "@/lib/product-seo";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

const baseProduct: SeoProduct = {
  slug: "chatgpt-plus-1-bulan",
  name: "ChatGPT Plus 1 Bulan",
  description: "Akses GPT-4o penuh, private account, garansi full.",
  image: "https://images.unsplash.com/photo-1?w=600",
  images: JSON.stringify([
    "https://images.unsplash.com/photo-1?w=600",
    "https://images.unsplash.com/photo-2?w=600",
  ]),
  badge: "Terlaris",
  sold_count: 342,
  updated_at: "2026-09-07T00:00:00.000Z",
  variants: [
    { price: 89_000, compare_price: 300_000, stock: 48 },
    { price: 250_000, compare_price: null, stock: -1 },
  ],
};

describe("sitemap memakai produk aktif D1, bukan seed statis", () => {
  it("tidak memakai seed sebagai sumber utama; hanya fallback bila D1 gagal", () => {
    const src = read("src/app/sitemap.ts");
    expect(src).not.toMatch(/^import .*@\/lib\/products/m);
    expect(src).toMatch(/FROM products/i);
    expect(src).toContain("p.is_active=1");
    expect(src).toContain("pv.is_active=1");
    expect(src).toContain("updated_at");
  });

  it("tanpa entri fragmen '#katalog' (bukan URL sitemap yang valid)", () => {
    expect(read("src/app/sitemap.ts")).not.toContain("#katalog");
  });

  it("fallback seed hanya bila D1 gagal (bukan sumber utama)", () => {
    const src = read("src/app/sitemap.ts");
    const d1At = src.indexOf("FROM products");
    const seedAt = src.indexOf("seedProducts");
    expect(d1At).toBeGreaterThan(0);
    expect(seedAt).toBeGreaterThan(d1At);
  });
});

describe("PDP server-rendered dengan metadata per produk", () => {
  it("page.tsx server component: generateMetadata + notFound + JSON-LD + h1 sr-only (tanpa blok visual ganda)", () => {
    const src = read("src/app/produk/[slug]/page.tsx");
    expect(src).not.toContain('"use client"');
    expect(src).toContain("generateMetadata");
    expect(src).toContain("notFound()");
    expect(src).toContain("application/ld+json");
    expect(src).toContain("alternates");
    expect(src).toContain("canonical");
    expect(src).toContain("openGraph");
    expect(src).toMatch(/<h1[^>]*>/);
    expect(src).toContain("ProductDetailClient");
    // Bug PDP ganda: blok visual server (nama + harga + deskripsi + gambar)
    // tampil mentah di atas PDP client sehingga konten terlihat 2x. h1 SEO
    // wajib sr-only; harga/deskripsi/gambar visual hanya milik client.
    expect(src).toContain("sr-only");
    expect(src).not.toMatch(/toLocaleString\("id-ID"\)/);
    expect(src).not.toContain("whitespace-pre-line");
    expect(src).not.toMatch(/<img[^>]*images\[0\]/);
  });

  it("query SEO hanya produk aktif dengan varian aktif; tanpa varian → 404", () => {
    const src = read("src/app/produk/[slug]/page.tsx");
    expect(src).toContain("p.is_active=1");
    expect(src).toContain("pv.is_active=1");
    expect(src).toContain("if (variants.length === 0) return null");
  });

  it("interaktivitas tetap: client memakai endpoint katalog yang sama", () => {
    const client = read("src/app/produk/[slug]/product-detail-client.tsx");
    expect(client).toContain('"use client"');
    expect(client).toContain("/api/products?active=1");
    expect(client).toContain("/api/catalog?slug=");
    expect(client).toContain("/checkout?buy=");
    expect(client).toContain("QuickVariantModal");
  });
});

describe("helper SEO produk", () => {
  it("deskripsi memakai deskripsi nyata, fallback bila kosong, maks 160 char", () => {
    expect(seoDescription(baseProduct)).toBe("Akses GPT-4o penuh, private account, garansi full.");
    expect(seoDescription({ ...baseProduct, description: "   " })).toContain("ChatGPT Plus 1 Bulan");
    const long = seoDescription({ ...baseProduct, description: `${"x".repeat(200)}` });
    expect(long.length).toBeLessThanOrEqual(160);
  });

  it("harga min/max dari varian aktif", () => {
    expect(seoMinPrice(baseProduct)).toBe(89_000);
    expect(seoMaxPrice(baseProduct)).toBe(250_000);
    expect(seoMinPrice({ ...baseProduct, variants: [] })).toBeNull();
  });

  it("ketersediaan: unlimited/positif → InStock, habis/kosong → OutOfStock", () => {
    expect(seoAvailability(baseProduct)).toBe("InStock");
    expect(seoAvailability({ ...baseProduct, variants: [{ price: 1, compare_price: null, stock: -1 }] })).toBe("InStock");
    expect(seoAvailability({ ...baseProduct, variants: [{ price: 1, compare_price: null, stock: 0 }] })).toBe("OutOfStock");
    expect(seoAvailability({ ...baseProduct, variants: [] })).toBe("OutOfStock");
  });

  it("gambar: utama dulu, dedup, tahan images korup", () => {
    expect(seoImages(baseProduct)).toHaveLength(2);
    expect(seoImages({ ...baseProduct, images: "bukan-json" })).toEqual([baseProduct.image]);
    expect(seoImages({ ...baseProduct, image: null, images: null })).toEqual([]);
  });

  it("JSON-LD Product valid: AggregateOffer IDR + availability + canonical", () => {
    const ld = seoProductJsonLd(baseProduct, "https://axvara.tech/produk/chatgpt-plus-1-bulan");
    expect(ld["@type"]).toBe("Product");
    expect(ld["name"]).toBe("ChatGPT Plus 1 Bulan");
    const offers = ld["offers"] as Record<string, unknown>;
    expect(offers["@type"]).toBe("AggregateOffer");
    expect(offers["priceCurrency"]).toBe("IDR");
    expect(offers["lowPrice"]).toBe(89_000);
    expect(offers["url"]).toBe("https://axvara.tech/produk/chatgpt-plus-1-bulan");
    expect(offers["availability"]).toBe("https://schema.org/InStock");
  });

  it("JSON-LD aman diserialisasi tanpa menutup tag script", () => {
    const evil: SeoProduct = { ...baseProduct, description: 'promo </script><script>alert(1)</script>' };
    const safe = JSON.stringify(seoProductJsonLd(evil, "https://axvara.tech/produk/x")).replace(/</g, "\\u003c");
    expect(safe).not.toContain("</script>");
    // Pola yang sama dipakai page.tsx (pola artikel).
    expect(read("src/app/produk/[slug]/page.tsx")).toContain('.replace(/</g, "\\\\u003c")');
  });
});
