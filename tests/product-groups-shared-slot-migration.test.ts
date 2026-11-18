import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { createD1Fixture } from "./helpers/d1-fixture";

const migration = fs.readFileSync("drizzle/migrations/0138_product_group_shared_slot.sql", "utf8");
let f: ReturnType<typeof createD1Fixture>;

function runMigration() {
  f.sql.exec(migration);
}

function seedMixedGroups() {
  f.sql.exec(`
    DELETE FROM categories;
    INSERT INTO categories(id,name,slug,sort_order) VALUES
      (1,'AI','ai',10),
      (2,'Streaming','streaming',20);
    INSERT INTO products(id,category_id,name,slug,price,stock,is_active,sort_order) VALUES
      -- Grup 1: winner = 2 (cat=2, sort=20); member 1 masih (1, 90) dan member 3 masih (1, 140)
      (1,1,'G1-Loser1','g1-l1',10000,5,1,90),
      (2,2,'G1-Winner','g1-w',10000,5,1,20),
      (3,1,'G1-Loser2','g1-l2',10000,5,1,140),
      -- Grup 2: winner NULL (semua off), position terkecil = 5 (pos=0, cat=1, sort=55), member 4 pos=1 (cat=2, sort=300)
      (4,2,'G2-Pos1','g2-p1',10000,0,0,300),
      (5,1,'G2-Pos0','g2-p0',10000,0,0,55),
      -- Produk solo: tidak boleh tersentuh
      (6,2,'Solo','solo',10000,5,1,77);
    INSERT INTO product_groups(id,name,winner_product_id) VALUES
      (10,'Grup Dengan Winner',2),
      (20,'Grup Tanpa Winner',NULL);
    INSERT INTO product_group_members(group_id,product_id,position) VALUES
      (10,1,0),(10,2,1),(10,3,2),
      (20,4,1),(20,5,0);
  `);
}

beforeEach(() => {
  f = createD1Fixture();
  seedMixedGroups();
});

afterEach(() => {
  f.close();
});

describe("migrasi 0138 — shared category_id + sort_order per product_group", () => {
  it("menyelaraskan category_id dan sort_order semua anggota ke winner (atau MIN(position) bila winner NULL) tanpa menyentuh produk solo", () => {
    runMigration();

    const rows = f.sql
      .prepare("SELECT id, category_id, sort_order FROM products ORDER BY id")
      .all() as { id: number; category_id: number; sort_order: number }[];
    expect(rows).toEqual([
      { id: 1, category_id: 2, sort_order: 20 },
      { id: 2, category_id: 2, sort_order: 20 },
      { id: 3, category_id: 2, sort_order: 20 },
      { id: 4, category_id: 1, sort_order: 55 },
      { id: 5, category_id: 1, sort_order: 55 },
      { id: 6, category_id: 2, sort_order: 77 },
    ]);
  });

  it("idempoten: dijalankan ulang tidak mengubah hasil maupun baris yang sudah selaras", () => {
    runMigration();
    f.sql.exec("UPDATE products SET updated_at='2026-01-01T00:00:00Z'");
    const snapshot = f.sql.prepare("SELECT id, category_id, sort_order, updated_at FROM products ORDER BY id").all();

    runMigration();
    const after = f.sql.prepare("SELECT id, category_id, sort_order, updated_at FROM products ORDER BY id").all();
    expect(after).toEqual(snapshot);
  });

  it("D1/workerd menerapkan dan mengulang migrasi 0138 dengan bersih", async () => {
    const runtime = new Miniflare({
      modules: true,
      compatibilityDate: "2024-11-01",
      d1Databases: ["DB"],
      script: 'export default {fetch(){return new Response("ok")}}',
    });
    try {
      const db = await runtime.getD1Database("DB");
      const tables = ["categories", "products", "product_groups", "product_group_members"];
      await db.batch(
        tables.map((name) =>
          db.prepare(String(f.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name)?.sql)),
        ),
      );
      await db.batch(
        f.sql.prepare("SELECT id,name,slug,sort_order FROM categories").all().map((c) =>
          db.prepare("INSERT INTO categories(id,name,slug,sort_order) VALUES(?,?,?,?)").bind(c.id, c.name, c.slug, c.sort_order),
        ),
      );
      await db.batch(
        f.sql.prepare("SELECT id,category_id,name,slug,price,stock,is_active,sort_order FROM products").all().map((p) =>
          db.prepare("INSERT INTO products(id,category_id,name,slug,price,stock,is_active,sort_order) VALUES(?,?,?,?,?,?,?,?)")
            .bind(p.id, p.category_id, p.name, p.slug, p.price, p.stock, p.is_active, p.sort_order),
        ),
      );
      await db.batch(
        f.sql.prepare("SELECT id,name,winner_product_id FROM product_groups").all().map((g) =>
          db.prepare("INSERT INTO product_groups(id,name,winner_product_id) VALUES(?,?,?)").bind(g.id, g.name, g.winner_product_id),
        ),
      );
      await db.batch(
        f.sql.prepare("SELECT group_id,product_id,position FROM product_group_members").all().map((m) =>
          db.prepare("INSERT INTO product_group_members(group_id,product_id,position) VALUES(?,?,?)").bind(m.group_id, m.product_id, m.position),
        ),
      );

      const statements = migration
        .replace(/^--.*$/gm, "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      for (let run = 0; run < 2; run++) {
        await db.batch(statements.map((sql) => db.prepare(sql)));
      }
      const res = await db.prepare("SELECT id, category_id, sort_order FROM products ORDER BY id").all();
      expect(res.results).toEqual([
        { id: 1, category_id: 2, sort_order: 20 },
        { id: 2, category_id: 2, sort_order: 20 },
        { id: 3, category_id: 2, sort_order: 20 },
        { id: 4, category_id: 1, sort_order: 55 },
        { id: 5, category_id: 1, sort_order: 55 },
        { id: 6, category_id: 2, sort_order: 77 },
      ]);
    } finally {
      await runtime.dispose();
    }
  }, 30000);
});
