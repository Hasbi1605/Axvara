// tests/supplier-product-insert.test.ts — AU-J2-3: buildSupplierProductInsertSql
// is the catalog write path for StoreBat/Mirai/AIVault syncs. The builder is a
// raw string composer, so a column/select misalignment or an extra `?` would
// silently corrupt the catalog. These tests execute the generated statement on
// the real schema (node:sqlite) rather than only string-matching it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countPlaceholders, createD1Fixture } from "./helpers/d1-fixture";
import { buildSupplierProductInsertSql } from "@/lib/supplier/product-insert";

let fx: ReturnType<typeof createD1Fixture>;

beforeEach(() => {
  fx = createD1Fixture();
  // Category 1 is seeded by drizzle/schema.sql; fixture deletes only products.
  fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,category_id,sort_order) VALUES(99,'Existing','fam-existing',1000,10,1,40)").run();
});
afterEach(() => fx.close());

const run = (sql: string, payload: unknown[]) => {
  expect(countPlaceholders(sql)).toBe(1);
  expect(countPlaceholders(sql)).toBeLessThan(100);
  fx.sql.prepare(sql).run(JSON.stringify(payload));
};

describe("buildSupplierProductInsertSql", () => {
  it("inserts aligned rows, takes MIN price and allocates sort_order +10 per slot", () => {
    const sql = buildSupplierProductInsertSql({
      familyColumn: "storebat_family",
      hasDescriptionEn: true,
      imageExpr: "json_extract(j.value,'$.image')",
      whereFilter: "WHERE json_extract(j.value,'$.present')=1",
      conflictMode: "insert_or_ignore",
    });
    expect(sql).toContain("INSERT OR IGNORE INTO");
    expect(sql).not.toContain("ON CONFLICT");
    expect(sql).toContain("p.storebat_family = c.family_key");
    expect(sql).toContain("storebat_family)");

    run(sql, [
      { key: "fam-a", name: "Fam A", slug: "fam-a", description: "desc a", description_en: "en a", price: 3000, category: 1, image: "/a.png", present: 1 },
      { key: "fam-a", name: "Fam A", slug: "fam-a", description: "desc a", description_en: "en a", price: 2000, category: 1, image: "/a.png", present: 1 },
      { key: "fam-b", name: "Fam B", slug: "fam-b", description: "desc b", description_en: "en b", price: 5000, category: 1, image: "/b.png", present: 1 },
      { key: "fam-c", name: "Fam C", slug: "fam-c", description: "desc c", description_en: "en c", price: 4000, category: 1, image: "/c.png", present: 0 },
      { key: "fam-existing", name: "Dup", slug: "fam-existing", description: "dup", description_en: "dup", price: 9000, category: 1, image: "/d.png", present: 1 },
    ]);

    const rows = fx.sql.prepare("SELECT * FROM products WHERE slug IN ('fam-a','fam-b','fam-c') ORDER BY slug").all() as Record<string, unknown>[];
    expect(rows.map((row) => row.slug)).toEqual(["fam-a", "fam-b"]);
    const [a, b] = rows;
    expect(a.price).toBe(2000);
    expect(a.description).toBe("desc a");
    expect(a.description_en).toBe("en a");
    expect(a.image_url).toBe("/a.png");
    expect(a.storebat_family).toBe("fam-a");
    expect(a.stock).toBe(0);
    expect(a.is_active).toBe(0);
    expect(a.source).toBe("manual");
    expect(a.fulfillment_mode).toBe("manual");
    expect(a.telegram_enabled).toBe(1);
    expect(a.sort_order).toBe(50);
    expect(b.sort_order).toBe(60);
    // Existing product keeps its sort_order and slug.
    const existing = fx.sql.prepare("SELECT sort_order,price FROM products WHERE slug='fam-existing'").get() as Record<string, unknown>;
    expect(existing.sort_order).toBe(40);
    expect(existing.price).toBe(1000);
  });

  it("omits description_en everywhere when hasDescriptionEn is false and still aligns", () => {
    const sql = buildSupplierProductInsertSql({
      familyColumn: "mirai_family",
      hasDescriptionEn: false,
      imageExpr: "'/mirai.png'",
      conflictMode: "on_conflict_do_nothing",
    });
    expect(sql).not.toContain("description_en");
    expect(sql).toContain("\nWHERE 1=1\nON CONFLICT DO NOTHING");
    expect(sql).toContain("p.mirai_family = c.family_key");
    expect(sql).toContain("mirai_family)");

    run(sql, [{ key: "mirai-x", name: "Mirai X", slug: "mirai-x", description: "d", price: 1200, category: 1 }]);
    const row = fx.sql.prepare("SELECT * FROM products WHERE slug='mirai-x'").get() as Record<string, unknown>;
    expect(row.description_en).toBeNull();
    expect(row.mirai_family).toBe("mirai-x");
    expect(row.image_url).toBe("/mirai.png");
  });

  it("supports the aivault family column and ON CONFLICT DO NOTHING execution", () => {
    const sql = buildSupplierProductInsertSql({
      familyColumn: "aivault_family",
      hasDescriptionEn: true,
      imageExpr: "'/aivault.png'",
      conflictMode: "on_conflict_do_nothing",
    });
    expect(sql).toContain("INSERT INTO products");
    expect(sql).toContain("ON CONFLICT DO NOTHING");
    expect(sql).toContain("aivault_family)");
    run(sql, [{ key: "av-1", name: "AV 1", slug: "av-1", description: "d", description_en: "e", price: 700, category: 1 }]);
    const row = fx.sql.prepare("SELECT * FROM products WHERE slug='av-1'").get() as Record<string, unknown>;
    expect(row.aivault_family).toBe("av-1");
    expect(row.description_en).toBe("e");
  });

  it("a literal `?` inside whereFilter stays a SQL literal, not a bind placeholder", () => {
    const sql = buildSupplierProductInsertSql({
      familyColumn: "storebat_family",
      hasDescriptionEn: false,
      imageExpr: "'/x.png'",
      whereFilter: "WHERE json_extract(j.value,'$.name') <> '?'",
      conflictMode: "insert_or_ignore",
    });
    // The only real bind is json_each(?), so callers pass exactly one parameter.
    expect(countPlaceholders(sql)).toBe(1);
    run(sql, [
      { key: "fam-q", name: "?", slug: "fam-q", description: "d", price: 100, category: 1 },
      { key: "fam-r", name: "R", slug: "fam-r", description: "d", price: 200, category: 1 },
    ]);
    const slugs = (fx.sql.prepare("SELECT slug FROM products WHERE slug IN ('fam-q','fam-r') ORDER BY slug").all() as { slug: string }[]).map((row) => row.slug);
    expect(slugs).toEqual(["fam-r"]);
  });
});
