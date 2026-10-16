import { afterEach, expect, it, vi } from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import { PEDIA_CATALOG_BOUNDS_SQL } from "@/lib/pedia/catalog-queries";
import { createD1Fixture } from "./helpers/d1-fixture";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("D1 catalog reads scale with curated services, including colliding provider IDs, rather than the mirror", async () => {
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', compatibilityDate: "2024-11-01", d1Databases: ["DB"] });
  try {
    const db = await runtime.getD1Database("DB");
    await db.batch([
      db.prepare("CREATE TABLE pedia_products(id INTEGER PRIMARY KEY,is_active INTEGER)"),
      db.prepare("CREATE TABLE pedia_tiers(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER,supplier TEXT,supplier_service_id INTEGER)"),
      db.prepare("CREATE INDEX active_tiers ON pedia_tiers(is_active,product_id)"),
      db.prepare("CREATE TABLE pedia_supplier_services(supplier TEXT,service_id INTEGER,min_qty INTEGER,max_qty INTEGER,rate_idr_per_1k INTEGER,present INTEGER,type TEXT,PRIMARY KEY(supplier,service_id))"),
      db.prepare("INSERT INTO pedia_products VALUES(1,1),(2,0)"),
      db.prepare("INSERT INTO pedia_tiers VALUES(1,1,1,'providersmm',1),(2,1,1,'indosmm',1),(3,2,1,'providersmm',2),(4,1,0,'providersmm',3),(5,1,1,'providersmm',4)"),
      db.prepare("INSERT INTO pedia_supplier_services VALUES('providersmm',1,10,100,1000,1,'Default'),('indosmm',1,20,200,2000,1,'Default'),('providersmm',2,10,100,1000,1,'Default'),('providersmm',3,10,100,1000,1,'Default'),('providersmm',4,10,100,1000,0,'Default')"),
    ]);
    const before = await db.prepare(PEDIA_CATALOG_BOUNDS_SQL).all();
    // Thousands of unrelated live supplier services must not inflate catalog reads.
    await db.prepare("WITH RECURSIVE n(x) AS (VALUES(100) UNION ALL SELECT x+1 FROM n WHERE x<5099) INSERT INTO pedia_supplier_services SELECT 'indosmm',x,1,100000,1000,1,'Default' FROM n").run();
    const after = await db.prepare(PEDIA_CATALOG_BOUNDS_SQL).all();
    expect(after.results).toEqual(before.results);
    expect(after.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ supplier: "providersmm", service_id: 1, min_qty: 10 }),
      expect.objectContaining({ supplier: "indosmm", service_id: 1, min_qty: 20 }),
    ]));
    expect(after.results).toHaveLength(2);
    expect(after.meta.rows_read).toBeLessThan(40);
    expect(after.meta.rows_read).toBeLessThanOrEqual(before.meta.rows_read + 2);
  } finally { await runtime.dispose(); }
}, 20000);

it("0067 repairs the live Pedia index even when the old index belongs to an archive, without dropping data", () => {
  const fixture = createD1Fixture();
  try {
    fixture.sql.exec("DROP INDEX idx_pedia_tiers_active_product_v2; DROP INDEX idx_pedia_tiers_product_active; CREATE TABLE pedia_tiers_archive0062(product_id INTEGER,is_active INTEGER,is_recommended INTEGER,sort_order INTEGER); CREATE INDEX idx_pedia_tiers_product_active ON pedia_tiers_archive0062(product_id,is_active,is_recommended,sort_order)");
    const migration = readFileSync("drizzle/migrations/0067_d1_read_budget_indexes.sql", "utf8");
    fixture.sql.exec(migration);
    fixture.sql.exec(migration);
    expect(fixture.sql.prepare("SELECT tbl_name FROM sqlite_master WHERE name='idx_pedia_tiers_active_product_v2'").get()?.tbl_name).toBe("pedia_tiers");
    expect(fixture.sql.prepare("SELECT tbl_name FROM sqlite_master WHERE name='idx_pedia_tiers_product_active'").get()?.tbl_name).toBe("pedia_tiers_archive0062");
    expect(fixture.sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { fixture.close(); }
});

it("D1 recovery still finds an unlinked paid order without scanning thousands of old paid orders", async () => {
  const source = readFileSync("src/lib/warung-rebahan/order.ts", "utf8");
  const sql = source.match(/`(SELECT o\.code, o\.items FROM orders o[\s\S]*?)`,/)?.[1];
  const index = readFileSync("drizzle/migrations/0067_d1_read_budget_indexes.sql", "utf8")
    .match(/CREATE INDEX IF NOT EXISTS idx_orders_paid_recovery[\s\S]*?;/)?.[0];
  expect(sql).toBeTruthy(); expect(index).toBeTruthy();
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', compatibilityDate: "2024-11-01", d1Databases: ["DB"] });
  try {
    const db = await runtime.getD1Database("DB");
    await db.batch([
      db.prepare("CREATE TABLE orders(id INTEGER PRIMARY KEY,code TEXT,items TEXT,status TEXT,payment_status TEXT,paid_at TEXT,created_at TEXT)"),
      db.prepare("CREATE INDEX idx_orders_status ON orders(status,payment_status)"),
      db.prepare(index!),
      db.prepare("CREATE TABLE product_variants(id INTEGER PRIMARY KEY,wr_variant_id TEXT)"),
      db.prepare("INSERT INTO product_variants VALUES(1,'wr-a')"),
      db.prepare("CREATE TABLE wr_order_links(order_code TEXT,wr_variant_id TEXT)"),
      db.prepare("CREATE INDEX link_order ON wr_order_links(order_code)"),
      db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<5000)
        INSERT INTO orders SELECT x,'OLD'||x,'[{"variant_id":1}]','lunas','paid',datetime('now','-90 days'),datetime('now','-90 days') FROM n`),
      db.prepare(`INSERT INTO orders VALUES(5001,'LINKED','[{"variant_id":1}]','lunas','paid',datetime('now','-1 hour'),datetime('now','-1 hour')),
        (5002,'ORPHAN','[{"variant_id":1}]','lunas','paid',datetime('now','-1 hour'),datetime('now','-1 hour'))`),
      db.prepare("INSERT INTO wr_order_links VALUES('LINKED','wr-a')"),
    ]);
    const result = await db.prepare(sql!).bind(4).all();
    expect(result.results).toEqual([expect.objectContaining({ code: "ORPHAN" })]);
    expect(result.meta.rows_read).toBeLessThan(60);
    const plan = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(4).all();
    expect(plan.results.some((row: Record<string, unknown>) => String(row.detail).includes("idx_orders_paid_recovery"))).toBe(true);
  } finally { await runtime.dispose(); }
}, 20000);
