// tests/variant-discount.regression.test.ts — Issue #10: ketepatan diskon varian
//
// Audit 7 Sep 2026: `MIN(price)` dipasangkan dengan `MAX(compare_price)` dari
// varian berbeda → kartu menampilkan diskon fiktif yang tak dimiliki varian
// mana pun (mis. varian A 50rb tanpa diskon + varian B 100rb coret 200rb
// tampil sebagai "50rb coret 200rb = -75%").
//
// Perilaku yang seharusnya: harga, harga coret, dan diskon kartu berasal dari
// pasangan varian yang sama — compare diambil dari varian harga-terendah —
// dan harga coret yang tidak membentuk diskon valid (<= harga tampil) tidak
// dirender sebagai klaim diskon.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: new (location: string) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      get: (...p: unknown[]) => Record<string, unknown> | undefined;
      all: (...p: unknown[]) => Record<string, unknown>[];
    };
  };
};

type Variant = { price: number; compare_price: number | null };

// Cermin logika pemetaan API: pasangan dari varian termurah + gate valid.
function pairedCompare(variants: Variant[]): number | undefined {
  const cheapest = [...variants].sort((a, b) => a.price - b.price || 0)[0];
  const raw = cheapest?.compare_price ?? null;
  return raw != null && raw > cheapest.price ? raw : undefined;
}

function cardDiscount(displayPrice: number, compare: number | undefined): number {
  return compare != null && compare > displayPrice ? Math.round((1 - displayPrice / compare) * 100) : 0;
}

describe("pasangan harga-diskon berasal dari varian yang sama", () => {
  it("query mengambil compare dari varian harga-terendah, bukan MAX lintas varian", () => {
    const api = read("src/app/api/products/route.ts");
    expect(api).not.toContain("MAX(pv.compare_price)");
    expect(api).toContain("ORDER BY pv2.price ASC");
    expect(api).toContain("variant_compare_price");
  });

  it("membuktikan perbaikan pada SQLite: pasangan silang hilang", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE product_variants(id INT, product_id INT, price INT, compare_price INT, is_active INT);`);
    db.exec(`INSERT INTO product_variants VALUES (1, 1, 50000, NULL, 1), (2, 1, 100000, 200000, 1)`);
    const buggy = db.prepare(`SELECT MIN(price) AS min_price, MAX(compare_price) AS max_compare FROM product_variants WHERE product_id=1`).get()!;
    expect(Number(buggy.min_price)).toBe(50_000);
    expect(Number(buggy.max_compare)).toBe(200_000); // pasangan fiktif lama
    const fixed = db.prepare(
      `SELECT compare_price FROM product_variants WHERE product_id=1 AND is_active=1 ORDER BY price ASC, id ASC LIMIT 1`,
    ).get()!;
    expect(fixed.compare_price).toBeNull(); // varian termurah tak punya diskon → tak ada klaim
  });

  it("kasus audit: varian murah tanpa diskon + varian mahal berdiskon → tanpa badge", () => {
    const variants: Variant[] = [
      { price: 50_000, compare_price: null },
      { price: 100_000, compare_price: 200_000 },
    ];
    const compare = pairedCompare(variants);
    expect(compare).toBeUndefined();
    expect(cardDiscount(50_000, compare)).toBe(0);
  });

  it("varian termurah berdiskon → diskon milik pasangan itu sendiri", () => {
    const variants: Variant[] = [
      { price: 50_000, compare_price: 100_000 },
      { price: 100_000, compare_price: 200_000 },
    ];
    const compare = pairedCompare(variants);
    expect(compare).toBe(100_000);
    expect(cardDiscount(50_000, compare)).toBe(50);
  });

  it("tanpa diskon di varian mana pun → tanpa harga coret", () => {
    expect(pairedCompare([{ price: 25_000, compare_price: null }])).toBeUndefined();
  });

  it("harga sama dengan coret (data lama) → tidak dirender sebagai diskon", () => {
    expect(cardDiscount(50_000, 50_000)).toBe(0);
    expect(cardDiscount(50_000, 40_000)).toBe(0);
  });

  it("kartu hanya merender coret/badge bila membentuk diskon valid", () => {
    const card = read("src/components/storefront/ProductCard.tsx");
    expect(card).toContain("showCompare");
    expect(card).toContain("comparePrice > displayPrice");
    expect(card).not.toMatch(/const discount = product\.comparePrice \? Math\.round/);
  });

  it("harga 'mulai dari' tetap MIN(price) dan rentang min–max utuh", () => {
    const api = read("src/app/api/products/route.ts");
    expect(api).toContain("MIN(pv.price) as min_price");
    expect(api).toContain("MAX(pv.price) as max_price");
    expect(api).toContain("Number(r.min_price)");
  });

  it("jalur varian lain tetap per-varian: PDP/modal pakai compare varian terpilih", () => {
    // PDP interaktif kini di product-detail-client.tsx (page.tsx server-only, #11).
    const pdp = read("src/app/produk/[slug]/product-detail-client.tsx");
    const modal = read("src/components/storefront/QuickVariantModal.tsx");
    expect(pdp).toContain("selectedVariant ? selectedVariant.compare_price : product.comparePrice");
    expect(pdp).toContain("v.compare_price && v.compare_price > v.price");
    expect(modal).toContain("selected ? selected.compare_price : product.comparePrice");
    expect(modal).toContain("currentCompare && currentCompare > currentPrice");
  });

  it("stok habis/nonaktif tak ikut pasangan: contoh habis di varian termurah", () => {
    // Varian termurah stok 0 tetap membawa compare-nya sendiri bila valid;
    // yang penting compare tidak diambil dari varian lain.
    const variants: Variant[] = [
      { price: 50_000, compare_price: 80_000 },
      { price: 100_000, compare_price: 200_000 },
    ];
    expect(pairedCompare(variants)).toBe(80_000);
    expect(cardDiscount(50_000, 80_000)).toBe(38);
  });
});
