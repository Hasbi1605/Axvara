// SEO & GEO (2026-09-24) — temuan audit produksi:
// - JSON-LD produk memakai URL gambar RELATIF dan `brand: AXVARA` (AXVARA
//   penjual pihak ketiga, bukan pemilik merek Canva/Netflix).
// - Artikel tanpa metadata sendiri: semua artikel berjudul beranda.
// - /checkout & /pesanan/[code] terindeks; tidak ada llms.txt (GEO).
// - Kartu web menganggap varian stok 3 / min 50 "tersedia" padahal PDP menolak.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { seoAvailability, seoMinPrice, seoProductJsonLd, type SeoProduct } from "@/lib/product-seo";
import { homeJsonLd } from "@/lib/site-seo";
import type { Product } from "@/lib/products";

const base: SeoProduct = {
  slug: "canva-premium",
  name: "Canva Pro",
  description: "Akses premium.",
  image: "/r2/products/canva.webp",
  images: JSON.stringify(["/r2/products/canva.webp", "https://cdn.example.test/2.webp"]),
  badge: null,
  sold_count: 1,
  variants: [
    { price: 1000, compare_price: null, stock: 3, min_qty: 50 },
    { price: 5000, compare_price: null, stock: 10, min_qty: 1 },
  ],
};

describe("JSON-LD produk", () => {
  it("gambar absolut, AXVARA sebagai penjual (bukan merek)", () => {
    const ld = seoProductJsonLd(base, "https://axvara.tech/produk/canva-premium");
    expect(ld.image).toEqual(["https://axvara.tech/r2/products/canva.webp", "https://cdn.example.test/2.webp"]);
    expect(ld.brand).toBeUndefined();
    expect((ld.offers as Record<string, unknown>).seller).toMatchObject({ "@type": "Organization", name: "AXVARA" });
  });

  it("stok di bawah minimum beli = tidak tersedia; harga dari varian yang bisa dibeli", () => {
    expect(seoMinPrice(base)).toBe(5000);
    expect(seoAvailability({ ...base, variants: [base.variants[0]] })).toBe("OutOfStock");
  });
});

describe("robots.txt", () => {
  it("halaman transaksi ditutup, endpoint baca publik dibuka untuk renderer, crawler AI eksplisit", async () => {
    const { default: robots } = await import("@/app/robots");
    const { rules } = robots() as { rules: { userAgent: string | string[]; allow: string[]; disallow: string[] }[] };
    const star = rules.find((r) => r.userAgent === "*")!;
    expect(star.disallow).toEqual(expect.arrayContaining(["/admin", "/api/", "/checkout", "/pesanan/"]));
    expect(star.allow).toEqual(expect.arrayContaining(["/", "/api/products"]));
    const ai = rules.find((r) => Array.isArray(r.userAgent))!;
    expect(ai.userAgent).toEqual(expect.arrayContaining(["GPTBot", "ClaudeBot", "PerplexityBot"]));
    expect(ai.disallow).toEqual(star.disallow);
  });
});

describe("metadata halaman", () => {
  it("checkout & status pesanan noindex", async () => {
    const checkout = await import("@/app/checkout/layout");
    const pesanan = await import("@/app/pesanan/layout");
    expect(checkout.metadata.robots).toMatchObject({ index: false });
    expect(pesanan.metadata.robots).toMatchObject({ index: false });
  });

  it("layout root: gambar OG ada, tanpa canonical/og:url yang akan diwarisi semua halaman", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    const metadataBlock = layout.slice(layout.indexOf("export const metadata"), layout.indexOf("export default"));
    expect(metadataBlock).toContain("OG_IMAGE");
    expect(metadataBlock).not.toContain("canonical");
    expect(metadataBlock).not.toMatch(/\burl:\s*"\/"/);
    const png = readFileSync("public/og/axvara-og.png");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});

describe("JSON-LD beranda", () => {
  it("Organization + WebSite + daftar produk ber-URL absolut, produk habis di belakang", () => {
    const products = [
      { id: "1", slug: "habis", name: "Habis", stock: 0, sortOrder: 0 },
      { id: "2", slug: "ready", name: "Ready", stock: 5, sortOrder: 9 },
    ] as unknown as Product[];
    const graph = homeJsonLd(products)["@graph"] as Record<string, unknown>[];
    expect(graph.map((node) => node["@type"])).toEqual(["Organization", "WebSite", "ItemList"]);
    expect(String(graph[0].logo)).toMatch(/^https:\/\//);
    const items = graph[2].itemListElement as { url: string; name: string }[];
    expect(items.map((item) => item.name)).toEqual(["Ready", "Habis"]);
    expect(items[0].url).toBe("https://axvara.tech/produk/ready");
  });
});

describe("dengan D1", () => {
  let fx: ReturnType<typeof createD1Fixture>;
  beforeEach(() => {
    fx = createD1Fixture();
    vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
    const insert = fx.sql.prepare(`INSERT INTO products(id,name,slug,price,stock,is_active,category_id) VALUES(?,?,?,1000,0,1,1)`);
    insert.run(1, "Grosir Saja", "grosir-saja");
    insert.run(2, "Campur", "campur");
    insert.run(3, "Kosong", "kosong");
    const variant = fx.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,min_qty,fulfillment_mode,is_active) VALUES(?,?,?,?,?,?,?,'manual',1)`);
    variant.run(11, 1, "S11", "Min 50", 1000, 3, 50);
    variant.run(21, 2, "S21", "Min 50", 1000, 3, 50);
    variant.run(22, 2, "S22", "Satuan", 5000, 10, 1);
    variant.run(31, 3, "S31", "Habis", 2000, 0, 1);
  });
  afterEach(() => { fx.close(); vi.unstubAllEnvs(); });

  it("kartu web: varian di bawah minimum tidak dihitung tersedia (sama dengan PDP & Telegram)", async () => {
    const { GET } = await import("@/app/api/products/route");
    const { products } = await (await GET(new NextRequest("http://localhost/api/products?active=1"))).json() as { products: { slug: string; stock: number; price: number }[] };
    const bySlug = Object.fromEntries(products.map((p) => [p.slug, p]));
    expect(bySlug["grosir-saja"].stock).toBe(0);
    expect(bySlug["campur"]).toMatchObject({ stock: 10, price: 5000 });
  });

  it("llms.txt: profil toko + hanya produk yang bisa dibeli, dengan link & harga", async () => {
    const { GET } = await import("@/app/llms.txt/route");
    const response = await GET();
    expect(response.headers.get("content-type")).toContain("text/markdown");
    const text = await response.text();
    expect(text).toMatch(/^# AXVARA/);
    expect(text).toContain("third-party");
    expect(text).toContain("(https://axvara.tech/produk/campur): mulai");
    expect(text).not.toContain("/produk/grosir-saja");
    expect(text).not.toContain("/produk/kosong");
    expect(text).toContain("Produk tersedia saat ini (1)");
  });

  it("artikel punya judul, canonical, dan gambar preview sendiri", async () => {
    fx.sql.prepare(`INSERT INTO articles(slug,title,excerpt,cover_url,content,status,published_at)
      VALUES('tips-ai','Tips Memilih Tools AI','Panduan singkat memilih tools AI.','/r2/articles/cover.webp','Isi','published','2026-09-20 03:00:00')`).run();
    const { generateMetadata } = await import("@/app/artikel/[slug]/page");
    const meta = await generateMetadata({ params: Promise.resolve({ slug: "tips-ai" }) });
    expect(meta.title).toBe("Tips Memilih Tools AI | AXVARA");
    expect(meta.description).toBe("Panduan singkat memilih tools AI.");
    expect(meta.alternates?.canonical).toBe("/artikel/tips-ai");
    const og = meta.openGraph as { images: { url: string }[]; publishedTime?: string; type?: string };
    expect(og.type).toBe("article");
    expect(og.images[0].url).toBe("https://axvara.tech/r2/articles/cover.webp");
    expect(og.publishedTime).toBe("2026-09-20T03:00:00.000Z");
    const missing = await generateMetadata({ params: Promise.resolve({ slug: "tidak-ada" }) });
    expect(missing.robots).toMatchObject({ index: false });
  });
});
