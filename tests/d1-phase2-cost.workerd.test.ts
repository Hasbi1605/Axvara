import { readFileSync } from "node:fs";
import { expect,it } from "vitest";
import { Miniflare } from "miniflare";
import { notLoserProductSql,decideDirtyWinners } from "@/lib/supplier-pairs";
import { purchasableStockSql } from "@/lib/catalog-availability";
import { OVERVIEW_ATTENTION_SQL } from "@/lib/admin-overview-queries";
import { createDatabaseAccess } from "@/lib/db-access";
import type { D1 } from "@/lib/db";

it("D1 measures fewer reads for catalog, unique inventory and active-first attention; migration triggers run on workerd",async()=>{
  const runtime=new Miniflare({modules:true,compatibilityDate:"2024-11-01",d1Databases:["DB"],script:'export default {fetch(){return new Response("ok")}}'});
  try {
    const db=await runtime.getD1Database("DB");
    await db.batch([
      "CREATE TABLE products(id INTEGER PRIMARY KEY)",
      "CREATE TABLE product_variants(id INTEGER PRIMARY KEY,product_id INTEGER,stock INTEGER,price INTEGER,is_active INTEGER,fulfillment_mode TEXT,min_qty INTEGER,wr_variant_id TEXT,sk_variant_id TEXT)",
      "CREATE TABLE fulfillment_inventory(id INTEGER PRIMARY KEY,product_id INTEGER,variant_id INTEGER,status TEXT)",
      "CREATE INDEX old_inventory_index ON fulfillment_inventory(product_id,status)",
      "CREATE TABLE orders(code TEXT PRIMARY KEY,status TEXT,payment_status TEXT,sales_channel TEXT,telegram_user_id TEXT)",
      "CREATE TABLE fulfillment_jobs(order_code TEXT UNIQUE,status TEXT)",
      "CREATE INDEX jobs_status ON fulfillment_jobs(status)",
      "CREATE TABLE fulfillment_items(order_code TEXT,status TEXT)",
      "CREATE INDEX items_status ON fulfillment_items(status)",
      "CREATE INDEX items_order ON fulfillment_items(order_code,status)",
      "CREATE TABLE supplier_pairs(id INTEGER PRIMARY KEY,wr_product_id INTEGER NOT NULL,sk_product_id INTEGER NOT NULL,winner TEXT,prefer TEXT DEFAULT 'auto',prefer_margin INTEGER DEFAULT 2000,reason TEXT,decided_at TEXT,updated_at TEXT)",
      "CREATE INDEX pairs_wr ON supplier_pairs(wr_product_id)",
      "CREATE INDEX pairs_sk ON supplier_pairs(sk_product_id)",
      "CREATE TABLE wr_variants(wr_variant_id TEXT,wr_price INTEGER,wr_stock INTEGER)",
      "CREATE TABLE sk_products(sk_variant_id TEXT,sk_price INTEGER,sk_stock INTEGER)",
    ].map(sql=>db.prepare(sql)));
    const numbers=(max:number)=>`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<${max})`;
    await db.batch([
      db.prepare(`${numbers(1000)} INSERT INTO products SELECT x FROM n`),
      db.prepare(`${numbers(40)} INSERT INTO supplier_pairs(id,wr_product_id,sk_product_id,winner) SELECT x,x*2-1,x*2,'WR' FROM n`),
      db.prepare(`${numbers(50)} INSERT INTO product_variants(id,product_id,stock,price,is_active,fulfillment_mode,min_qty) SELECT x,1,1,1000,1,'unique',1 FROM n`),
      db.prepare(`${numbers(5000)} INSERT INTO fulfillment_inventory SELECT x,1,(x%50)+1,'available' FROM n`),
      db.prepare(`${numbers(5000)} INSERT INTO orders SELECT 'O'||x,'lunas','paid','telegram','buyer' FROM n`),
      db.prepare("INSERT INTO fulfillment_jobs SELECT code,'delivered' FROM orders"),
      db.prepare("INSERT INTO fulfillment_items SELECT code,'delivered' FROM orders"),
      db.prepare("UPDATE fulfillment_jobs SET status='retry' WHERE order_code='O1'"),
      db.prepare("UPDATE fulfillment_items SET status='failed' WHERE order_code='O1'"),
    ]);
    const oldCatalog=await db.prepare(`SELECT p.id FROM products p WHERE NOT EXISTS(SELECT 1 FROM supplier_pairs pair WHERE p.id=CASE WHEN pair.winner IS NULL OR pair.winner='WR' THEN pair.sk_product_id ELSE pair.wr_product_id END) ORDER BY p.id`).all();
    const oldInventory=await db.prepare(`SELECT pv.id FROM product_variants pv WHERE (SELECT COUNT(*) FROM fulfillment_inventory fi WHERE fi.product_id=pv.product_id AND fi.variant_id=pv.id AND fi.status='available')>0 ORDER BY pv.id`).all();
    const oldAttention=await db.prepare(`SELECT COUNT(DISTINCT o.code) AS count FROM orders o WHERE o.status='lunas' AND o.payment_status='paid' AND (EXISTS(SELECT 1 FROM fulfillment_jobs fj WHERE fj.order_code=o.code AND fj.status IN ('manual_required','retry','failed')) OR EXISTS(SELECT 1 FROM fulfillment_items fi WHERE fi.order_code=o.code AND fi.status IN ('manual_required','retry','failed')))` ).all();

    const migration=readFileSync("drizzle/migrations/0068_d1_read_budget_phase2.sql","utf8");
    const triggers=migration.match(/CREATE TRIGGER[\s\S]*?\nEND;/g)??[];
    const ordinary=migration.replace(/CREATE TRIGGER[\s\S]*?\nEND;/g,"").replace(/^--.*$/gm,"").split(";").map(s=>s.trim()).filter(Boolean);
    // Each entire trigger is one statement, matching remote migration behavior.
    for (const sql of [...ordinary,...triggers]) await db.prepare(sql).run();
    const catalog=await db.prepare(`SELECT p.id FROM products p WHERE ${notLoserProductSql("p")} ORDER BY p.id`).all();
    const inventory=await db.prepare(`SELECT pv.id FROM product_variants pv WHERE ${purchasableStockSql("pv")} ORDER BY pv.id`).all();
    const attention=await db.prepare(OVERVIEW_ATTENTION_SQL).all();
    expect(catalog.results).toEqual(oldCatalog.results); expect(catalog.meta.rows_read).toBeLessThan(oldCatalog.meta.rows_read/4);
    expect(inventory.results).toEqual(oldInventory.results); expect(inventory.meta.rows_read).toBeLessThan(500);
    expect(inventory.meta.rows_read).toBeLessThan(oldInventory.meta.rows_read/20);
    expect(attention.results).toEqual(oldAttention.results); expect(attention.results[0]).toEqual({count:1});
    expect(attention.meta.rows_read).toBeLessThan(30);
    const recipientPlan=await db.prepare(`EXPLAIN QUERY PLAN SELECT code FROM orders
      WHERE sales_channel='telegram' AND telegram_user_id=? AND status='lunas' AND payment_status='paid'`).bind("buyer").all();
    expect(JSON.stringify(recipientPlan.results)).toContain("idx_orders_telegram_buyer_status");
    await db.prepare("UPDATE supplier_pair_dirty SET pending=0").run();
    const base=createDatabaseAccess(db as unknown as D1);
    let dirtyReads=0;
    const measured={...base,queryAll:async(q:string,...params:unknown[])=>{
      const result=await db.prepare(q).bind(...params).all(); dirtyReads+=result.meta.rows_read; return result.results;
    }};
    expect(await decideDirtyWinners(measured)).toEqual({decided:0,changed:0});
    expect(dirtyReads).toBeLessThan(10);
    await db.prepare("UPDATE product_variants SET stock=2 WHERE id=1").run();
    expect((await decideDirtyWinners(base)).decided).toBe(1);
    expect((await db.prepare("SELECT * FROM supplier_pair_dirty WHERE pending=1").all()).results).toEqual([]);
    console.info("[d1-phase2-cost]",JSON.stringify({catalog:[oldCatalog.meta.rows_read,catalog.meta.rows_read],inventory:[oldInventory.meta.rows_read,inventory.meta.rows_read],attention:[oldAttention.meta.rows_read,attention.meta.rows_read],cleanPairTick:dirtyReads}));
  } finally {await runtime.dispose();}
},30000);
