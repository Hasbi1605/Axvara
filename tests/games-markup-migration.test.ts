import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const migration = fs.readFileSync("drizzle/migrations/0122_games_markup_meta.sql", "utf8");
const schema = fs.readFileSync("drizzle/schema.sql", "utf8");
const CORE = "drizzle/migrations/0107_games_core.sql";
const ADMIN = "drizzle/migrations/0108_games_admin.sql";
const SK = "drizzle/migrations/0118_games_sekalipay.sql";

const body = (sql: string, name: string) => {
  const m = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\);`));
  if (!m) throw new Error(`${name} missing`);
  return m[1].replace(/\s+/g, " ").trim();
};
const read = (file: string) => fs.readFileSync(file, "utf8");

/** D1 menjalankan satu file migrasi sebagai satu transaksi; node:sqlite tidak. */
function applyMigration(db: InstanceType<typeof DatabaseSync>, sql: string) {
  db.exec("BEGIN");
  try {
    db.exec(sql);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function preMigratedDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec("CREATE TABLE orders(code TEXT PRIMARY KEY, order_kind TEXT NOT NULL DEFAULT 'apps');");
  db.exec("CREATE TABLE store_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')));");
  db.exec(read(CORE));
  db.exec(read(ADMIN));
  db.exec(read(SK));
  return db;
}

describe("0122 games markup + meta migration", () => {
  it("mirrors games_meta and games_variant_markup in drizzle/schema.sql", () => {
    for (const table of ["games_meta", "games_variant_markup"]) {
      expect(body(migration, table)).toBe(body(schema, table));
    }
    // games_products: daftar kategori 8 nilai, tanpa kolom markup (tabel sendiri).
    const products = body(schema, "games_products");
    expect(products).toContain("display_group IN ( 'special','bestseller','promo','first_topup','pass','pack','topup','other')");
    expect(products).not.toContain("markup_percent");
    expect(products).not.toContain("markup_fixed");
  });

  it("adds settings defaults, games_meta and the variant markup table idempotently", () => {
    const db = preMigratedDatabase();
    try {
      // Sebelum migrasi: belum ada tabel baru.
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='games_meta'").get()).toBeUndefined();
      applyMigration(db, migration);
      // Run kedua: struktur & data tetap, tidak ada error.
      applyMigration(db, migration);

      expect(db.prepare("SELECT key,value FROM store_settings WHERE key LIKE 'games_%' ORDER BY key").all())
        .toEqual([
          { key: "games_markup_percent", value: "5" },
          { key: "games_price_rounding", value: "100" },
        ]);
      // Nilai admin tidak ditimpa run berikutnya.
      db.exec("UPDATE store_settings SET value='8' WHERE key='games_markup_percent'");
      applyMigration(db, migration);
      expect(db.prepare("SELECT value FROM store_settings WHERE key='games_markup_percent'").get()).toEqual({ value: "8" });

      // 8 kategori dapat disimpan; nilai asing tetap ditolak CHECK.
      for (const group of ["special", "bestseller", "promo", "first_topup", "pass", "pack", "topup", "other"]) {
        db.exec(`INSERT INTO games_variant_markup(buyer_sku_code,markup_percent,markup_fixed,updated_at)
          VALUES('sk:${group}', 5, 0, '2026-11-14T00:00:00Z')`);
      }
      db.exec("DROP TABLE games_variant_markup");
      applyMigration(db, migration); // membuat ulang tabel yang hilang
      expect(db.prepare("SELECT COUNT(*) n FROM games_variant_markup").get()).toEqual({ n: 0 });
      expect(() => db.exec("INSERT INTO games_variant_markup(buyer_sku_code,markup_percent) VALUES('sk:x',101)")).toThrow(/CHECK/);
    } finally { db.close(); }
  });

  it("recomputes SK sell_price at 5 %/R100 once, leaves Digiflazz rows and reference history intact", () => {
    const db = preMigratedDatabase();
    try {
      db.exec("INSERT INTO games_products(buyer_sku_code,product_name,cost,supplier,supplier_active,enabled,sk_variant_id,sell_price) VALUES('sk:1','ML 5 Diamond',11750,'sekalipay',1,1,1,12102)");
      db.exec("INSERT INTO games_products(buyer_sku_code,product_name,cost,supplier,supplier_active,enabled,sk_variant_id,sell_price) VALUES('sk:2','ML 321115',321115,'sekalipay',1,1,2,330748)");
      db.exec("INSERT INTO games_products(buyer_sku_code,product_name,cost,sell_price,reference_price) VALUES('ml86','legacy',15000,20000,25000)");
      db.exec("INSERT INTO games_products(buyer_sku_code,product_name,cost,supplier,supplier_active,sk_variant_id,sell_price) VALUES('sk:0','cost nol',0,'sekalipay',1,3,0)");
      db.exec("INSERT INTO games_reference_prices(buyer_sku_code,price,source,captured_at,updated_at) VALUES('sk:1',99000,'admin','2026-11-12T00:00:00Z','2026-11-12T00:00:00Z')");
      applyMigration(db, migration);

      expect(db.prepare("SELECT buyer_sku_code,sell_price FROM games_products ORDER BY buyer_sku_code").all())
        .toEqual([
          { buyer_sku_code: "ml86", sell_price: 20000 }, // Digiflazz tidak disentuh
          { buyer_sku_code: "sk:0", sell_price: 0 },
          { buyer_sku_code: "sk:1", sell_price: 12400 },
          { buyer_sku_code: "sk:2", sell_price: 337200 },
        ]);
      // Histori Oura dipertahankan (kolom + tabel), hanya bukan sumber harga lagi.
      expect(db.prepare("SELECT reference_price FROM games_products WHERE buyer_sku_code='ml86'").get()).toEqual({ reference_price: 25000 });
      expect(db.prepare("SELECT price FROM games_reference_prices WHERE buyer_sku_code='sk:1'").get()).toEqual({ price: 99000 });

      // Run kedua tidak menimpa harga/markup yang sudah diatur admin.
      db.exec("INSERT INTO games_variant_markup(buyer_sku_code,markup_percent,markup_fixed,updated_at) VALUES('sk:1',25,250,'2026-11-14T00:00:00Z')");
      db.exec("UPDATE games_products SET sell_price=99999 WHERE buyer_sku_code='sk:1'");
      applyMigration(db, migration);
      expect(db.prepare("SELECT sell_price FROM games_products WHERE buyer_sku_code='sk:1'").get()).toEqual({ sell_price: 99999 });
      expect(db.prepare("SELECT markup_percent,markup_fixed FROM games_variant_markup WHERE buyer_sku_code='sk:1'").get())
        .toEqual({ markup_percent: 25, markup_fixed: 250 });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='_games_0122_probe'").get()).toBeUndefined();
    } finally { db.close(); }
  });

  it("keeps order-item foreign keys valid across the rebuild", () => {
    const db = preMigratedDatabase();
    try {
      db.exec("INSERT INTO games_products(buyer_sku_code,product_name,cost,supplier,supplier_active,enabled,sk_variant_id,sell_price) VALUES('sk:1','ML',11750,'sekalipay',1,1,1,12102)");
      db.exec("INSERT INTO orders(code,order_kind) VALUES('G1','games')");
      db.exec(`INSERT INTO games_order_items(order_code,product_id,buyer_sku_code,customer_no,unit_price,total,cost_snapshot,max_price)
        VALUES('G1',1,'sk:1','123',12400,12400,11750,12400)`);
      applyMigration(db, migration);
      expect(db.prepare("SELECT COUNT(*) n FROM games_order_items gi JOIN games_products gp ON gp.id=gi.product_id").get()).toEqual({ n: 1 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(() => db.exec(`INSERT INTO games_order_items(order_code,product_id,buyer_sku_code,customer_no,unit_price,total,cost_snapshot,max_price)
        VALUES('G2',999,'sk:1','123',12400,12400,11750,12400)`)).toThrow(/FOREIGN KEY/);
      // AUTOINCREMENT tetap berlanjut dari id terbesar.
      db.exec("INSERT INTO games_products(buyer_sku_code,product_name) VALUES('sk:9','next')");
      expect(Number((db.prepare("SELECT id FROM games_products WHERE buyer_sku_code='sk:9'").get() as { id: number }).id)).toBeGreaterThan(1);
    } finally { db.close(); }
  });
});
