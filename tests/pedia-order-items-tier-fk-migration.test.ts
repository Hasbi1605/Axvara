import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

// 2026-11-01: 0062 me-rename pedia_tiers ke arsip; SQLite ikut menulis ulang FK
// pedia_order_items.tier_id ke tabel arsip, sehingga checkout tier baru gagal.
const migration = fs.readFileSync("drizzle/migrations/0084_pedia_order_items_tier_fk.sql", "utf8");
const itemSql = (tierId: number, code: string) => `INSERT INTO pedia_order_items(order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,status)
  VALUES('${code}',1,${tierId},'{}','t','t',100,1,1000,'indosmm',9,1,'queued')`;

function brokenDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE orders(code TEXT PRIMARY KEY);
    CREATE TABLE pedia_products(id INTEGER PRIMARY KEY);
    CREATE TABLE pedia_tiers(id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER);
    INSERT INTO orders VALUES('OLD'),('NEW'),('NEW2'); INSERT INTO pedia_products VALUES(1); INSERT INTO pedia_tiers(id,product_id) VALUES(37,1);
    CREATE TABLE pedia_order_items(id INTEGER PRIMARY KEY AUTOINCREMENT, order_code TEXT NOT NULL UNIQUE REFERENCES orders(code), product_id INTEGER NOT NULL REFERENCES pedia_products(id), tier_id INTEGER NOT NULL REFERENCES pedia_tiers(id),
      snapshot_json TEXT NOT NULL, target_raw TEXT NOT NULL, target_normalized TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price REAL NOT NULL, total INTEGER NOT NULL, credit_used INTEGER NOT NULL DEFAULT 0,
      supplier TEXT NOT NULL, supplier_service_id INTEGER NOT NULL, supplier_rate_snapshot REAL NOT NULL, supplier_order_id TEXT, supplier_charge REAL, start_count INTEGER, remains INTEGER,
      status TEXT NOT NULL DEFAULT 'awaiting_payment', submit_attempts INTEGER NOT NULL DEFAULT 0, lease_until TEXT, last_error TEXT, last_polled_at TEXT,
      refund_credit_code TEXT, refill_last_at TEXT, refill_supplier_id TEXT, refill_status TEXT, notified_paid_at TEXT, notified_final_at TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), completed_at TEXT, credit_return_token TEXT);
    CREATE INDEX idx_pedia_items_target ON pedia_order_items(target_normalized, product_id, status);
    ${itemSql(37, "OLD")};
    -- Emulasi 0062: rename tabel tier ke arsip, lalu tabel baru dengan tier tambahan.
    ALTER TABLE pedia_tiers RENAME TO pedia_tiers_archive0062_prev2;
    CREATE TABLE pedia_tiers(id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER);
    INSERT INTO pedia_tiers(id,product_id) VALUES(37,1),(46,1);`);
  return db;
}

describe("0084 pedia_order_items tier FK", () => {
  it("reproduces the archived FK, then lets new tiers be ordered while keeping history and other FKs", () => {
    const db = brokenDb();
    try {
      const fkTable = () => db.prepare("SELECT \"table\" FROM pragma_foreign_key_list('pedia_order_items') WHERE \"from\"='tier_id'").get().table;
      expect(fkTable()).toBe("pedia_tiers_archive0062_prev2");
      expect(() => db.exec(itemSql(46, "NEW"))).toThrow(/FOREIGN KEY/);

      db.exec(migration);
      expect(fkTable()).toBe("pedia_tiers");
      expect(db.prepare("SELECT id, order_code, tier_id, status FROM pedia_order_items").all()).toEqual([{ id: 1, order_code: "OLD", tier_id: 37, status: "queued" }]);
      db.exec(itemSql(46, "NEW"));
      expect(db.prepare("SELECT id FROM pedia_order_items WHERE order_code='NEW'").get().id).toBe(2);
      expect(() => db.exec(itemSql(999, "NEW2"))).toThrow(/FOREIGN KEY/);
      expect(() => db.exec(itemSql(46, "MISSING"))).toThrow(/FOREIGN KEY/);
      expect(() => db.exec(itemSql(46, "NEW").replace("'queued'", "'bogus'").replace("'NEW'", "'NEW2'"))).toThrow(/CHECK/);
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='pedia_order_items' AND sql IS NOT NULL ORDER BY name").all().map((r: { name: string }) => r.name);
      expect(indexes).toEqual(["idx_pedia_items_status", "idx_pedia_items_target"]);
      expect(db.prepare("SELECT COUNT(*) n FROM pragma_foreign_key_check").get().n).toBe(0);
      expect(db.prepare("SELECT COUNT(*) n FROM pedia_tiers_archive0062_prev2").get().n).toBe(1);
    } finally { db.close(); }
  });

  it("matches the bootstrap schema definition", () => {
    const schema = fs.readFileSync("drizzle/schema.sql", "utf8");
    const body = (sql: string, name: string) => sql.slice(sql.indexOf(`${name} (`) + name.length).split(");")[0].replace(/\s+/g, " ").trim();
    expect(body(migration, "pedia_order_items_new0084")).toBe(body(schema, "CREATE TABLE IF NOT EXISTS pedia_order_items"));
  });
});
