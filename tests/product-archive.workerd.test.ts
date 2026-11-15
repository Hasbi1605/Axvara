import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

it('0126 preserves existing products and native D1 rejects archived activation atomically',async()=>{
  const fixture=createD1Fixture();
  const runtime=new Miniflare({modules:true,compatibilityDate:'2026-08-06',script:'export default {fetch(){return new Response("fixture")}}',d1Databases:['DB']});
  try{
    const db=await runtime.getD1Database('DB');
    const tables=fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('categories','products','product_variants','operation_guards')").all() as {sql:string}[];
    await db.batch(tables.map(t=>db.prepare(t.sql.replace('  archived_at TEXT,',''))));
    await db.prepare("INSERT INTO products(id,name,slug,price,is_active) VALUES(1,'Keep','keep',1000,1)").run();
    const migration=readFileSync('drizzle/migrations/0126_product_archive.sql','utf8');
    // D1 exec splits on newlines: execute complete trigger bodies via prepare instead.
    const chunks=migration.split(/(?=CREATE TRIGGER)/);
    const ddl=chunks.shift()!.replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean);
    await db.batch([...ddl,...chunks].map(s=>db.prepare(s)));
    expect(await db.prepare('SELECT is_active,archived_at FROM products WHERE id=1').first()).toEqual({is_active:1,archived_at:null});
    await db.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,is_active) VALUES(1,1,'KEEP','Keep',1000,1)").run();
    await db.batch([db.prepare("UPDATE products SET archived_at=datetime('now'),is_active=0 WHERE id=1"),db.prepare('UPDATE product_variants SET is_active=0 WHERE product_id=1')]);
    await expect(db.batch([db.prepare("UPDATE product_variants SET price=2000 WHERE id=1"),db.prepare('UPDATE products SET is_active=1 WHERE id=1')])).rejects.toThrow('product_archived');
    expect(await db.prepare('SELECT price,is_active FROM product_variants WHERE id=1').first()).toEqual({price:1000,is_active:0});
    await expect(db.prepare('UPDATE product_variants SET is_active=1 WHERE id=1').run()).rejects.toThrow('product_archived');
    await db.batch([db.prepare("UPDATE products SET archived_at=NULL,is_active=0 WHERE id=1"),db.prepare('DELETE FROM product_variants WHERE product_id=1'),db.prepare('DELETE FROM products WHERE id=1')]);
    expect(await db.prepare('SELECT COUNT(*) n FROM products').first()).toEqual({n:0});
  }finally{fixture.close();await runtime.dispose();}
},30000);
