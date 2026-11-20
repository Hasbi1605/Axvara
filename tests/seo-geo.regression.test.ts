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
    const checkout = await import("@/app/(shop)/checkout/layout");
    const pesanan = await import("@/app/(shop)/pesanan/layout");
    expect(checkout.metadata.robots).toMatchObject({ index: false });
    expect(pesanan.metadata.robots).toMatchObject({ index: false });
  });

  it("layout root: gambar OG ada, tanpa canonical/og:url yang akan diwarisi semua halaman", () => {
    const layout = readFileSync("src/app/(shop)/layout.tsx", "utf8");
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

  it("Organization sameAs memuat 4 sosmed AXVARA + Telegram", async () => {
    const { SITE } = await import("@/lib/site");
    const graph = homeJsonLd([])["@graph"] as Record<string, unknown>[];
    expect(graph[0].sameAs).toEqual([
      SITE.social.instagram,
      SITE.social.threads,
      SITE.social.tiktok,
      SITE.social.facebook,
      `https://t.me/${SITE.adminTelegram}`,
    ]);
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
    expect(bySlug["campur"]).toMatchObject({ stock: 10, price: 5000 });
    // Kontrak 2026-10-01 (REVISI keputusan owner — mengubah revisi 2026-09-30:
    // kartu habis TAMPIL LAGI di daftar untuk trust, di akhir dengan overlay;
    // Telegram + llms.txt tetap hanya yang bisa dibeli).
    expect(products.map((p) => p.slug).sort()).toEqual(["campur", "grosir-saja", "kosong"]);
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

  it("uses canonical visible PDPs for sitemap and only buyable admitted prices for llms.txt", async () => {
    const { JASPAY_LEGACY_PRODUCTS } = await import("@/lib/warung-rebahan/new-sales");
    const insert = fx.sql.prepare("INSERT INTO products(id,name,slug,price,is_active,archived_at,wr_product_id) VALUES(?,?,?,1000,?,?,?)");
    for (const [id, slug] of ["loser", "winner", "null-winner", "missing-winner", "inactive-winner", "archived-winner", "paused", "mixed", "archived", "inactive", "unique-empty", "unique-live", "no-variant"].map((slug, i) => [i + 10, slug] as const)) {
      insert.run(id, slug, slug, id !== 19 ? 1 : 0, null, id === 16 ? JASPAY_LEGACY_PRODUCTS.zoom : id === 17 ? JASPAY_LEGACY_PRODUCTS.scribd : null);
    }
    fx.sql.exec(`INSERT INTO product_groups(id,name,winner_product_id) VALUES (1,'valid',11),(2,'null',NULL),(3,'missing',99),(4,'inactive',19),(5,'archived',18);
      INSERT INTO product_group_members(group_id,product_id) VALUES (1,10),(1,11),(2,12),(3,13),(4,14),(5,15);
      INSERT INTO wr_products(wr_product_id,wr_product_name) VALUES ('wr','WR');
      INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_delivery_class) VALUES ('mbo','wr','MBO',1,'made_by_order');`);
    const variant = fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,wr_variant_id) VALUES(?,?,?,?,?,? ,?,?)");
    for (let id = 10; id <= 21; id++) variant.run(id * 100, id, `s${id}`, "Variant", [16, 17].includes(id) ? 500 : 6000, -1, id >= 20 ? "unique" : "manual", [16, 17].includes(id) ? "mbo" : null);
    variant.run(1701, 17, "mixed-ready", "Ready", 8000, 2, "manual", null);
    // A stale archive row (e.g. imported historical data) must not be listed even if marked active.
    fx.sql.exec("DROP TRIGGER archived_product_activation; UPDATE products SET archived_at='2026-11-21' WHERE id=18");
    fx.sql.exec("INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(21,2100,'fixture','fixture','fixture')");

    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map(entry => entry.url);
    const slugs = urls.filter(url => url.includes("/produk/")).map(url => url.split("/").at(-1)).sort();
    const { GET } = await import("@/app/llms.txt/route");
    const text = await (await GET()).text();
    const aiSlugs = [...text.matchAll(/\/produk\/([a-z-]+)\)/g)].map(match => match[1]).sort();
    expect(slugs).toEqual(["archived-winner", "campur", "grosir-saja", "inactive-winner", "kosong", "missing-winner", "mixed", "null-winner", "unique-empty", "unique-live", "winner"]);
    expect(aiSlugs).toEqual(["archived-winner", "campur", "inactive-winner", "missing-winner", "mixed", "null-winner", "unique-live", "winner"]);
    expect(text).toMatch(/\/produk\/mixed\): mulai Rp\s*8\.000/);

    const { default: pdp } = await import("@/app/(shop)/produk/[slug]/page");
    await expect(pdp({ params: Promise.resolve({ slug: "loser" }) })).rejects.toThrow("NEXT_REDIRECT");
    for (const slug of ["winner", "null-winner", "missing-winner", "inactive-winner", "archived-winner", "mixed"]) {
      await expect(pdp({ params: Promise.resolve({ slug }) })).resolves.toBeTruthy();
    }
  });

  it("keeps static sitemap URLs without resurrecting seed products after D1 failure", async () => {
    vi.stubGlobal("DB", { prepare() { throw new Error("fixture unavailable"); } });
    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map(entry => entry.url);
    expect(urls).toContain("https://axvara.tech/cara-order");
    expect(urls.some(url => url.includes("/produk/"))).toBe(false);
  });

  it("artikel punya judul, canonical, dan gambar preview sendiri", async () => {
    fx.sql.prepare(`INSERT INTO articles(slug,title,excerpt,cover_url,content,status,published_at)
      VALUES('tips-ai','Tips Memilih Tools AI','Panduan singkat memilih tools AI.','/r2/articles/cover.webp','Isi','published','2026-09-20 03:00:00')`).run();
    const { generateMetadata } = await import("@/app/(shop)/artikel/[slug]/page");
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
