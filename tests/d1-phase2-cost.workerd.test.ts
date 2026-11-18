import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { notLoserProductSql, decideDirtyGroups } from "@/lib/product-groups";
import { createDatabaseAccess } from "@/lib/db-access";
import type { D1 } from "@/lib/db";

it("D1 runs group loser filter and product_group dirty triggers on workerd", async () => {
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2024-11-01", d1Databases: ["DB"], script: 'export default {fetch(){return new Response("ok")}}' });
  try {
    const db = await runtime.getD1Database("DB");
    await db.batch([
      "CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,slug TEXT,image_url TEXT,source TEXT DEFAULT 'manual',is_active INTEGER DEFAULT 1,archived_at TEXT,wr_product_id TEXT,sk_product_id TEXT,tunvn_family TEXT,aivault_family TEXT,storebat_family TEXT,mirai_family TEXT)",
      "CREATE TABLE product_variants(id INTEGER PRIMARY KEY,product_id INTEGER,sku TEXT,stock INTEGER,price INTEGER,is_active INTEGER,fulfillment_mode TEXT DEFAULT 'manual',min_qty INTEGER DEFAULT 1,duration_value INTEGER,duration_unit TEXT,manual_cost INTEGER DEFAULT 0,wr_variant_id TEXT,sk_variant_id TEXT,tunvn_source_product_id INTEGER,tunvn_buff_quantity_b INTEGER,tunvn_cost_usdt REAL,tunvn_fx_idr_per_usdt REAL,aivault_service_id TEXT,storebat_product_id INTEGER,storebat_cost_usd REAL,storebat_fx_idr_per_usd REAL,mirai_package_code TEXT,mirai_cost_usdt REAL,mirai_fx_idr_per_usdt REAL)",
      "CREATE TABLE fulfillment_inventory(product_id INTEGER,variant_id INTEGER,status TEXT)",
      "CREATE TABLE wr_variants(wr_variant_id TEXT,wr_price INTEGER,wr_stock INTEGER,wr_delivery_class TEXT DEFAULT 'restock',is_active INTEGER NOT NULL DEFAULT 1)",
      "CREATE TABLE sk_products(sk_variant_id TEXT,sk_price INTEGER,sk_stock INTEGER,is_active INTEGER NOT NULL DEFAULT 1)",
      "CREATE TABLE tunvn_products(supplier_product_id INTEGER,price_usdt REAL,fx_idr_per_usdt REAL)",
      "CREATE TABLE aivault_products(service_id TEXT,unit_price_usd REAL,fx_idr_per_usd REAL)",
      "CREATE TABLE crypto_market_snapshot(id INTEGER PRIMARY KEY,fx_rate_text TEXT)",
      "CREATE TABLE product_groups(id INTEGER PRIMARY KEY,name TEXT,prefer_product_id INTEGER,prefer_margin INTEGER DEFAULT 2000,winner_product_id INTEGER,reason TEXT,decided_at TEXT,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')))",
      "CREATE TABLE product_group_members(group_id INTEGER,product_id INTEGER UNIQUE,position INTEGER DEFAULT 0,created_at TEXT DEFAULT (datetime('now')),PRIMARY KEY(group_id,product_id))",
      "CREATE TABLE product_group_dirty(group_id INTEGER PRIMARY KEY,version TEXT,pending INTEGER DEFAULT 1)",
    ].map(sql => db.prepare(sql)));
    const numbers = (max: number) => `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<${max})`;
    await db.batch([
      db.prepare(`${numbers(1000)} INSERT INTO products(id,name,slug) SELECT x,'P'||x,'p'||x FROM n`),
      db.prepare(`${numbers(80)} INSERT INTO product_variants(id,product_id,stock,price,is_active,manual_cost) SELECT x,x,1,1000,1,500 FROM n`),
      db.prepare(`${numbers(40)} INSERT INTO product_groups(id,name,winner_product_id) SELECT x,'G'||x,x*2-1 FROM n`),
      db.prepare(`${numbers(80)} INSERT INTO product_group_members(group_id,product_id,position) SELECT ((x+1)/2),x,(x-1)%2 FROM n`),
    ]);
    const oldCatalog = await db.prepare(`SELECT p.id FROM products p WHERE p.id NOT IN (
      SELECT gm.product_id FROM product_group_members gm JOIN product_groups g ON g.id=gm.group_id
      WHERE g.winner_product_id IS NOT NULL AND gm.product_id<>g.winner_product_id) ORDER BY p.id`).all();
    const catalog = await db.prepare(`SELECT p.id FROM products p WHERE ${notLoserProductSql("p")} ORDER BY p.id`).all();
    expect(catalog.results).toEqual(oldCatalog.results);

    const migration = readFileSync("drizzle/migrations/0129_product_groups.sql", "utf8");
    const triggers = migration.match(/CREATE TRIGGER[\s\S]*?\nEND;/g) ?? [];
    expect(triggers.length).toBeGreaterThan(10);
    for (const sql of triggers) await db.prepare(sql).run();

    await db.prepare("UPDATE product_group_dirty SET pending=0").run();
    const base = createDatabaseAccess(db as unknown as D1);
    expect(await decideDirtyGroups(base)).toEqual({ decided: 0, changed: 0 });
    await db.prepare("UPDATE product_variants SET stock=2 WHERE id=1").run();
    expect((await db.prepare("SELECT COUNT(*) AS n FROM product_group_dirty WHERE pending=1").first())?.n).toBe(1);
    expect((await decideDirtyGroups(base)).decided).toBe(1);
    expect((await db.prepare("SELECT * FROM product_group_dirty WHERE pending=1").all()).results).toEqual([]);
  } finally { await runtime.dispose(); }
}, 30000);
