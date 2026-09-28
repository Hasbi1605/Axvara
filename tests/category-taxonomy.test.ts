// tests/category-taxonomy.test.ts — Taksonomi 6 kategori (migrasi 0046,
// issue 3-in-1 bagian C).
//
// Dikunci:
//  - Migrasi 0046 di atas DB legacy (4 kategori lama + 24 produk seed lama)
//    menghasilkan 6 kategori, tiap kategori ≥1 produk, tanpa orphan.
//  - Slug lama (?cat= bookmark) dipetakan ke slug baru, tidak 404/kosong.
//  - Nama "Bundle Kucing" hilang, slug "bundle-hemat" dipertahankan.
//  - Guard DELETE 409: kategori berisi tidak bisa dihapus; kategori kosong bisa.
//  - Fallback statis src/lib/products.ts: tiap slug baru ≥1 produk.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import {
  categories as fallbackCategories,
  products as fallbackProducts,
  resolveCategorySlug,
} from "@/lib/products";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: new (location: string) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      run: (...p: unknown[]) => unknown;
      get: (...p: unknown[]) => Record<string, unknown> | undefined;
      all: (...p: unknown[]) => Record<string, unknown>[];
    };
    close: () => void;
  };
};

const NEW_SLUGS = [
  "ai-chatbot",
  "streaming-hiburan",
  "produktivitas-office",
  "desain-video",
  "developer-tools",
  "bundle-hemat",
];

/**
 * DB legacy: schema.sql penuh (semua kolom/tabel terbaru) lalu DITURUNKAN
 * ke taksonomi lama — 4 kategori lama + 24 produk seed dengan category_id
 * lama. Ini mensimulasikan prod pra-0046 tanpa menduplikasi definisi tabel.
 */
function createLegacyDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(read("drizzle/schema.sql"));
  // category_id seed baru → id lama (peta balik tabel mapping issue).
  // Produk dipindah DULU agar DELETE kategori 5/6 tidak kena FK.
  const legacyCatById: Record<number, number> = {
    1: 2, 2: 2, 3: 1, 4: 2, 5: 3, 6: 3, 7: 2, 8: 4, 9: 1, 10: 3,
    11: 3, 12: 4, 13: 2, 14: 2, 15: 2, 16: 2, 17: 3, 18: 3, 19: 3,
    20: 1, 21: 4, 22: 4, 23: 2, 24: 3,
  };
  const upd = "UPDATE products SET category_id=? WHERE id=?";
  for (const [id, cat] of Object.entries(legacyCatById)) {
    db.prepare(upd).run(cat, Number(id));
  }
  db.exec(`DELETE FROM categories WHERE id IN (5,6);
    UPDATE categories SET name='AI Gateway', slug='ai-gateway',
      icon='lightning-bolt', sort_order=1 WHERE id=1;
    UPDATE categories SET name='Akun Premium', slug='akun-premium',
      icon='crown', sort_order=2 WHERE id=2;
    UPDATE categories SET name='Tools Pro', slug='tools-pro',
      icon='shield', sort_order=3 WHERE id=3;
    UPDATE categories SET name='Bundle Kucing', slug='bundle-hemat',
      icon='packaging', sort_order=4 WHERE id=4;`);
  return db;
}

describe("migrasi 0046 di atas DB legacy", () => {
  it("menghasilkan 6 kategori, tiap kategori ≥1 produk, tanpa orphan", () => {
    const db = createLegacyDatabase();
    try {
      const before = db.prepare("SELECT COUNT(*) n FROM products").get() as { n: number };
      expect(before.n).toBe(24);
      db.exec(read("drizzle/migrations/0046_category_taxonomy.sql"));
      const cats = db.prepare("SELECT id,name,slug,sort_order FROM categories ORDER BY sort_order").all();
      expect(cats.map((c) => String(c.slug))).toEqual(NEW_SLUGS);
      // Nama lama hilang, slug bundle-hemat dipertahankan.
      expect(cats.map((c) => String(c.name))).not.toContain("Bundle Kucing");
      expect(cats.map((c) => String(c.name))).toContain("Bundle Hemat");
      expect(cats.map((c) => String(c.slug))).not.toContain("bundle-kucing");
      const counts = db.prepare(
        `SELECT c.slug, COUNT(p.id) n FROM categories c
         LEFT JOIN products p ON p.category_id=c.id GROUP BY c.id ORDER BY c.sort_order`,
      ).all();
      for (const row of counts) {
        expect(Number(row.n), `kategori ${row.slug} kosong`).toBeGreaterThanOrEqual(1);
      }
      expect(counts.reduce((s, r) => s + Number(r.n), 0)).toBe(24);
      const orphan = db.prepare(
        "SELECT slug FROM products WHERE category_id NOT IN (SELECT id FROM categories)",
      ).all();
      expect(orphan).toEqual([]);
      // Distribusi sesuai tabel mapping issue: 8/4/3/4/2/3.
      const bySlug = Object.fromEntries(counts.map((r) => [String(r.slug), Number(r.n)]));
      expect(bySlug).toEqual({
        "ai-chatbot": 8, "streaming-hiburan": 4, "produktivitas-office": 3,
        "desain-video": 4, "developer-tools": 2, "bundle-hemat": 3,
      });
      // Rerun idempoten.
      db.exec(read("drizzle/migrations/0046_category_taxonomy.sql"));
      const cats2 = db.prepare("SELECT slug FROM categories ORDER BY sort_order").all();
      expect(cats2.map((c) => String(c.slug))).toEqual(NEW_SLUGS);
    } finally {
      db.close();
    }
  });
});

describe("alias slug lama", () => {
  it("resolveCategorySlug memetakan 3 slug lama ke penerus id yang sama", () => {
    expect(resolveCategorySlug("ai-gateway")).toBe("ai-chatbot");
    expect(resolveCategorySlug("akun-premium")).toBe("streaming-hiburan");
    expect(resolveCategorySlug("tools-pro")).toBe("produktivitas-office");
    // Slug baru + bundle-hemat + netral tidak berubah.
    for (const s of [...NEW_SLUGS, "semua", ""]) {
      expect(resolveCategorySlug(s)).toBe(s);
    }
  });

  it("fallback statis: tiap slug baru punya ≥1 produk, tanpa slug lama tersisa", () => {
    const slugs = new Set(fallbackCategories.map((c) => c.slug));
    for (const s of NEW_SLUGS) expect(slugs, `hilang: ${s}`).toContain(s);
    expect([...slugs]).not.toContain("bundle-kucing");
    const names = fallbackCategories.map((c) => c.name);
    expect(names).not.toContain("Bundle Kucing");
    expect(names).toContain("Bundle Hemat");
    for (const s of NEW_SLUGS) {
      const n = fallbackProducts.filter((p) => p.categorySlug === s).length;
      expect(n, `fallback ${s} kosong`).toBeGreaterThanOrEqual(1);
    }
    const stale = fallbackProducts.filter((p) =>
      ["ai-gateway", "akun-premium", "tools-pro"].includes(p.categorySlug));
    expect(stale.map((p) => p.slug)).toEqual([]);
  });
});

describe("API dengan taksonomi baru (D1 fixture)", () => {
  let fixture: ReturnType<typeof createD1Fixture>;
  beforeEach(() => {
    fixture = createD1Fixture();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
    fixture.sql.exec(`
      INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active)
        VALUES (1, 2, 'Netflix Premium', 'netflix-premium', 'desc', 35000, 30, 1);
      INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, sort_order)
        VALUES (1, 1, 'DEFAULT-1', 'Default', 35000, 30, 1, 0);
    `);
  });
  afterEach(() => { fixture.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("filter ?cat= slug lama tidak 404/kosong — sama dengan slug baru", async () => {
    const { GET } = await import("@/app/api/products/route");
    const get = (cat: string) =>
      GET(new NextRequest(`http://localhost/api/products?active=1&cat=${cat}`) as never);
    const oldBody = await (await get("akun-premium")).json() as { products: { slug: string }[] };
    const newBody = await (await get("streaming-hiburan")).json() as { products: { slug: string }[] };
    expect(oldBody.products.map((p) => p.slug)).toEqual(["netflix-premium"]);
    expect(newBody.products.map((p) => p.slug)).toEqual(["netflix-premium"]);
  });

  it("guard DELETE 409: kategori berisi ditolak, kategori kosong bisa dihapus", async () => {
    const { DELETE } = await import("@/app/api/categories/route");
    const del = (id: string) =>
      DELETE(new NextRequest(`http://localhost/api/categories?id=${id}`, { method: "DELETE" }) as never);
    // id 2 (Streaming & Hiburan) berisi netflix-premium → 409.
    const conflict = await del("2");
    expect(conflict.status).toBe(409);
    // Kategori kosong baru bisa dihapus.
    const { POST } = await import("@/app/api/categories/route");
    const created = await (await POST(new NextRequest("http://localhost/api/categories", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Kategori Kosong" }),
    }) as never)).json() as { id: number };
    const ok = await del(String(created.id));
    expect(ok.status).toBe(200);
  });
});
