// tests/pdp-gallery.regression.test.ts — Galeri PDP mengikuti slug yang diklik
//
// Temuan 9 Sep 2026 (lokal): klik katalog apapun (mis. YouTube Premium),
// judul/harga/deskripsi benar (dari `find by slug`), tapi gambar selalu
// milik katalog pertama (ChatGPT Plus, 3 gambar). Dua lapis penyebab:
// (1) client memakai `list[0]` untuk galeri alih-alih find by slug;
// (2) fallback in-memory dev (`src/lib/db.ts`) mengabaikan filter
// `p.slug=?` sehingga `GET /api/products?active=1&slug=x` mengembalikan
// seluruh 24 produk di lokal tanpa D1.
//
// Di prod (D1) filter SQL jalan sehingga bug tidak terlihat — fix ini
// no-op di prod dan hanya menyamakan perilaku lokal dengan prod.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { queryAll } from "@/lib/db";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("galeri PDP memakai produk yang diklik, bukan list[0]", () => {
  it("client mencari produk by slug sebelum membangun galeri", () => {
    const src = read("src/app/produk/[slug]/product-detail-client.tsx");
    expect(src).not.toMatch(/const found = list\[0\];/);
    expect(src).toContain("list.find((p) => p.slug === slug)");
  });

  it("fallback in-memory menghormati filter p.slug=? (urutan cat -> slug -> q)", () => {
    const src = read("src/lib/db/client.ts");
    expect(src).toContain('lower.includes("p.slug=?")');
  });

  it("queryAll products dengan filter slug hanya mengembalikan 1 produk", async () => {
    const rows = await queryAll(
      "SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE 1=1 AND p.is_active=1 AND p.slug=? ORDER BY p.sort_order ASC, p.id ASC",
      "youtube-premium-1-bulan",
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0].slug)).toBe("youtube-premium-1-bulan");
  });

  it("queryAll gabungan cat + slug tetap memfilter dengan benar", async () => {
    const rows = await queryAll(
      "SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE 1=1 AND p.is_active=1 AND c.slug=? AND p.slug=? ORDER BY p.sort_order ASC, p.id ASC",
      "akun-premium",
      "youtube-premium-1-bulan",
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0].slug)).toBe("youtube-premium-1-bulan");
  });
});
