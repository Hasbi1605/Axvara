import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { createD1Fixture } from "./helpers/d1-fixture";

const migration = fs.readFileSync("drizzle/migrations/0143_supplier_products_category_tail.sql", "utf8");
let f: ReturnType<typeof createD1Fixture>;

function runMigration() {
  f.sql.exec(migration);
}

function seedFixture() {
  f.sql.exec(`
    DELETE FROM categories;
    INSERT INTO categories(id,name,slug,sort_order) VALUES
      (1,'AI & Chatbot','ai-chatbot',1),
      (2,'Streaming','streaming',2),
      (6,'Developer & Tools','developer-tools',5);
    INSERT INTO products(id,category_id,name,slug,price,stock,is_active,sort_order) VALUES
      -- Category 1: positive max = 500, archived higher = 900 (ignored)
      (1,1,'AI Existing 10','ai-10',10000,5,1,10),
      (2,1,'AI Existing 500','ai-500',10000,5,1,500),
      (3,1,'AI Archived 900','ai-arch',10000,0,0,900),
      -- Plain zero/negative/NULL in Category 1 -> should become 510, 520, 540 (with group 10 taking 530)
      (10,1,'AI Zero A','ai-z-a',10000,0,0,0),
      (15,1,'AI Neg B','ai-n-b',10000,0,0,-5),
      (25,1,'AI Null C','ai-null-c',10000,0,0,NULL),
      -- All-zero group (ids 20 and 30 in Category 1) -> one shared tail slot 530 (min id=20 sits between 15 and 25)
      (20,1,'AllZero Group Winner','az-w',10000,5,1,0),
      (30,1,'AllZero Group Loser','az-l',10000,5,1,0),
      -- Mixed group in Category 1: sibling 40 already has 150, sibling 41 has 0 -> 41 takes 150
      (40,1,'Mixed Group Pos','mg-p',10000,5,1,150),
      (41,1,'Mixed Group Zero','mg-z',10000,0,0,0),
      -- Category 6: no non-archived positive rows -> starts at 10, 20
      (50,6,'JetBrains Edu','jetbrains-edu',25000,-1,1,0),
      (51,6,'Dev Zero 2','dev-z2',25000,0,0,0),
      -- Archived zero row: must remain 0
      (60,6,'Dev Archived Zero','dev-arch-z',10000,0,0,0),
      -- Category 2: positive 20 + uncategorized zero
      (70,2,'Stream 20','stream-20',10000,5,1,20),
      (80,NULL,'Uncat Zero','uncat-zero',10000,5,1,0);
    UPDATE products SET archived_at='2026-11-01T00:00:00Z' WHERE id IN (3, 60);
    INSERT INTO product_groups(id,name,winner_product_id) VALUES
      (10,'AllZero Group',20),
      (20,'Mixed Group',40);
    INSERT INTO product_group_members(group_id,product_id,position) VALUES
      (10,20,0),(10,30,1),
      (20,40,0),(20,41,1);
  `);
}

beforeEach(() => {
  f = createD1Fixture();
  seedFixture();
});

afterEach(() => {
  f.close();
});

const expectedSortOrders = [
  { id: 1, sort_order: 10 },
  { id: 2, sort_order: 500 },
  { id: 3, sort_order: 900 },
  { id: 10, sort_order: 510 },
  { id: 15, sort_order: 520 },
  { id: 20, sort_order: 530 },
  { id: 25, sort_order: 540 },
  { id: 30, sort_order: 530 },
  { id: 40, sort_order: 150 },
  { id: 41, sort_order: 150 },
  { id: 50, sort_order: 10 },
  { id: 51, sort_order: 20 },
  { id: 60, sort_order: 0 },
  { id: 70, sort_order: 20 },
  { id: 80, sort_order: 10 },
];

describe("migrasi 0143 — supplier products category tail", () => {
  it("memindahkan produk non-arsip <=0 ke ekor kategori (step 10 urut id), menjaga slot grup, dan membiarkan baris >0/arsip utuh", () => {
    runMigration();

    const rows = f.sql
      .prepare("SELECT id, sort_order FROM products ORDER BY id")
      .all() as { id: number; sort_order: number }[];
    expect(rows).toEqual(expectedSortOrders);
  });

  it("idempoten: eksekusi kedua tidak mengubah sort_order maupun updated_at", () => {
    runMigration();
    f.sql.exec("UPDATE products SET updated_at='2026-01-01T00:00:00Z'");
    const snapshot = f.sql.prepare("SELECT id, sort_order, updated_at FROM products ORDER BY id").all();

    runMigration();
    const after = f.sql.prepare("SELECT id, sort_order, updated_at FROM products ORDER BY id").all();
    expect(after).toEqual(snapshot);
  });

  it("D1/workerd mem-parse, menerapkan, dan mengulang migrasi 0143 dengan bersih", async () => {
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
        f.sql.prepare("SELECT id,category_id,name,slug,price,stock,is_active,sort_order,archived_at FROM products").all().map((p) =>
          db.prepare("INSERT INTO products(id,category_id,name,slug,price,stock,is_active,sort_order,archived_at) VALUES(?,?,?,?,?,?,?,?,?)")
            .bind(p.id, p.category_id, p.name, p.slug, p.price, p.stock, p.is_active, p.sort_order, p.archived_at),
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
      expect(statements.length).toBe(2);
      for (let run = 0; run < 2; run++) {
        await db.batch(statements.map((sql) => db.prepare(sql)));
      }
      const res = await db.prepare("SELECT id, sort_order FROM products ORDER BY id").all();
      expect(res.results).toEqual(expectedSortOrders);
    } finally {
      await runtime.dispose();
    }
  }, 30000);
});
