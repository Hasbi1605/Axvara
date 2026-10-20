import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import manifest from "@/lib/pedia/curation-20261020.json";
import original from "@/lib/pedia/curation-20261015.json";
import { createD1Fixture } from "./helpers/d1-fixture";
import { computePediaPrice } from "@/lib/pedia/pricing";
import { detectPediaLink, pediaTargetMatches } from "@/lib/pedia/link";
import { pediaTargetExample } from "@/lib/pedia/platforms";
const migration=fs.readFileSync("drizzle/migrations/0073_pedia_indosmm_only_catalog.sql","utf8");
const mappings=[...new Map([...manifest.products,...manifest.replacements].flatMap(p=>p.services.map(s=>[`${s.supplier}:${s.service_id}`,s] as const))).values()];
const mirror=(s: typeof mappings[number])=>`INSERT INTO pedia_supplier_services(supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,api_refill,present) VALUES('${s.supplier}',${s.service_id},'upstream private','Category','Default',${s.evidence.rate_idr_per_1k_at_review},1,100000000,${s.evidence.api_refill?1:0},1)`;
function statements(sql:string){
 const list:string[]=[];let text="",quoted=false,comment=false;
 for(let i=0;i<sql.length;i++){const c=sql[i];if(comment){if(c==='\n'){comment=false;text+='\n';}continue;}if(!quoted&&c==='-'&&sql[i+1]==='-'){comment=true;i++;continue;}text+=c;if(c==="'"){if(quoted&&sql[i+1]==="'"){text+=sql[++i];continue;}quoted=!quoted;}if(!quoted&&c===';'){list.push(text);text="";}}
 if(text.trim())list.push(text);return list;
}
describe("Pedia IndoSMM-only catalog release",()=>{
 it("adds distinct needs with checked targets and honest refill capability",()=>{
  const slugs=new Set(original.products.map(p=>p.slug));
  expect(manifest.products.length).toBe(53);
  for(const p of manifest.products){
   expect(slugs.has(p.slug),p.slug).toBe(false);slugs.add(p.slug);
   const parsed=detectPediaLink(pediaTargetExample(p.platform,p.target_kind),p.platform);
   expect(parsed?.platform,p.slug).toBe(p.platform);
   expect(parsed&&pediaTargetMatches(p.target_kind,parsed.targetKind),p.slug).toBe(true);
   expect(p.services.filter(s=>s.is_recommended)).toHaveLength(1);
   for(const s of p.services){
    expect(s.evidence.description_url).toMatch(/^https:\/\/(providersmm|indosmm)\.id\//);
    expect(s.evidence.paid_test).toBe("not_run");
    if(s.refill_days>0)expect(s.evidence.api_refill).toBe(true);
    else expect(s.terms).toContain("Tanpa refill dari AXVARA");
    expect(p.packages.some(q=>q>=s.min_qty_override&&q<=s.max_qty_override&&q%s.quantity_step===0)).toBe(true);
   }
  }
  expect(slugs.size).toBe(original.products.length+manifest.products.length);
 });
 it("preserves owner drafts, historical mappings and snapshots, and prices new rows from live mirrors",()=>{
  const f=createD1Fixture();try{
   for(const s of mappings)f.sql.exec(mirror(s));
   f.sql.exec("INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,is_active) VALUES(90,'owner-product','instagram','followers','profile','Owner product',1),(91,'followers-roblox','roblox','followers','profile','Owner draft',0)");
   f.sql.exec("INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,is_active,public_name,package_prices_json) VALUES(90,90,'standar','providersmm',6209,'G3',20,1000,7,1,'Old copy','{\"100\":2000}')");
   f.sql.exec("INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,order_kind) VALUES('AXP-LEGACY','','6281234567890','owner@example.test','[]',10000,'qris','lunas','pedia')");
   f.sql.exec("INSERT INTO pedia_order_items(order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,status,supplier_order_id) VALUES('AXP-LEGACY',90,90,'{\"supplier\":\"providersmm\",\"refill_days\":30}','old','old',100,100,10000,'providersmm',6209,1000,'needs_check','UPSTREAM-OLD')");
   const oldOrder=f.sql.prepare("SELECT * FROM pedia_order_items WHERE order_code='AXP-LEGACY'").get();
   const before=f.sql.prepare("SELECT * FROM pedia_tiers WHERE id=90").get();
   f.sql.exec(migration);
   expect(f.sql.prepare("SELECT * FROM pedia_tiers WHERE id=90").get()).toEqual({...before as Record<string,unknown>,is_active:0,auto_disabled_reason:"legacy_supplier_indosmm_only",updated_at:expect.any(String)});
   expect(f.sql.prepare("SELECT name,is_active FROM pedia_products WHERE id=91").get()).toEqual({name:"Owner draft",is_active:0});
   expect(f.sql.prepare("SELECT COUNT(*) AS n FROM pedia_tiers WHERE product_id=91").get()?.n).toBe(0);
   const active=f.sql.prepare("SELECT t.*,s.rate_idr_per_1k FROM pedia_tiers t JOIN pedia_supplier_services s ON s.supplier=t.supplier AND s.service_id=t.supplier_service_id WHERE t.id<>90").all();
   expect(active.length).toBeGreaterThan(50);
   for(const t of active)for(const [q,price]of Object.entries(JSON.parse(String(t.package_prices_json))))expect(price).toBe(computePediaPrice({supplierRatePer1k:Number(t.rate_idr_per_1k),quantity:Number(q),markupPct:Number(t.markup_pct),minProfitRp:Number(t.min_profit_rp)}));
   expect(f.sql.prepare("SELECT * FROM pedia_order_items WHERE order_code='AXP-LEGACY'").get()).toEqual(oldOrder);
   const count=f.sql.prepare("SELECT COUNT(*) AS n FROM pedia_tiers").get()?.n;
   f.sql.exec(migration);expect(f.sql.prepare("SELECT COUNT(*) AS n FROM pedia_tiers").get()?.n).toBe(count);
   expect(f.sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
   expect(migration).not.toMatch(/UPDATE\s+(pedia_order_items|orders)|DELETE FROM/i);
  }finally{f.close();}
 });
 it("fails closed for missing, non-Default and out-of-bounds mirrors and keeps owner drafts",()=>{
  const f=createD1Fixture();try{
   for(const s of mappings)f.sql.exec(mirror(s));
   f.sql.exec("UPDATE pedia_supplier_services SET present=0 WHERE service_id IN (9527,8820); UPDATE pedia_supplier_services SET type='Custom Comments' WHERE service_id=7026; UPDATE pedia_supplier_services SET min_qty=99999999 WHERE service_id=9413");
   f.sql.exec(migration);
   const hidden=f.sql.prepare("SELECT slug FROM pedia_products WHERE is_active=0 ORDER BY slug").all().map(r=>r.slug);
   expect(hidden).toEqual(expect.arrayContaining(["followers-roblox","members-whatsapp","followers-lazada"]));
   expect(f.sql.prepare("SELECT COUNT(*) AS n FROM pedia_tiers WHERE supplier='providersmm' AND is_active=1").get()?.n).toBe(0);
  }finally{f.close();}
 });
 it("adds replacement tiers without repricing existing IndoSMM drafts or changing historical order snapshots",()=>{
  const f=createD1Fixture();try{
   for(const s of mappings)f.sql.exec(mirror(s));
   const product=manifest.replacements[0],upstream=product.services[0];
   f.sql.exec(`INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,packages_json,is_active) VALUES(90,'${product.slug}','${product.platform}','${product.metric}','${product.target_kind}','Owner copy','[100,1000]',0)`);
   f.sql.exec(`INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,is_active,public_name,package_prices_json) VALUES(90,90,'standar','indosmm',${upstream.service_id},'G3',77,2000,0,0,'Owner draft','{"100":9000}')`);
   const before=f.sql.prepare("SELECT * FROM pedia_tiers WHERE id=90").get();
   f.sql.exec(migration);
   expect(f.sql.prepare("SELECT * FROM pedia_tiers WHERE id=90").get()).toEqual(before);
   expect(f.sql.prepare("SELECT name,is_active FROM pedia_products WHERE id=90").get()).toEqual({name:"Owner copy",is_active:0});
  }finally{f.close();}
 });
 it.each(["INSERT OR IGNORE INTO pedia_products(","INSERT OR IGNORE INTO pedia_tiers(","UPDATE pedia_tiers SET is_active=1"])("recovers after interruption following %s without publishing unpriced rows",marker=>{
  const f=createD1Fixture();try{
   for(const s of mappings)f.sql.exec(mirror(s));
   const chunks=statements(migration),end=chunks.findIndex(s=>s.includes(marker));
   expect(end).toBeGreaterThan(0);
   for(const chunk of chunks.slice(0,end+1))f.sql.exec(chunk);
   expect(f.sql.prepare("SELECT COUNT(*) AS n FROM pedia_tiers WHERE is_active=1 AND package_prices_json='{}'").get()?.n).toBe(0);
   f.sql.exec(migration);
   expect(f.sql.prepare("SELECT COUNT(*) AS n FROM pedia_products WHERE is_active=1").get()?.n).toBe(60);
   expect(f.sql.prepare("SELECT COUNT(*) AS n FROM pedia_tiers WHERE is_active=1 AND package_prices_json='{}'").get()?.n).toBe(0);
  }finally{f.close();}
 });
 it("executes the migration under workerd/D1 with bounded statements",async()=>{
  const m=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:"2024-11-01",d1Databases:["DB"]});try{
   const db=await m.getD1Database("DB"),schema=fs.readFileSync("drizzle/schema.sql","utf8");
   await db.prepare("CREATE TABLE orders(code TEXT PRIMARY KEY)").run();
   for(const table of ["pedia_supplier_services","pedia_products","pedia_tiers","pedia_order_items"]){const sql=schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`))?.[0];expect(sql).toBeTruthy();await db.prepare(sql!).run();}
   for(const s of mappings)await db.prepare(mirror(s)).run();
   for(const sql of statements(migration)){expect(Buffer.byteLength(sql)).toBeLessThan(90000);await db.prepare(sql).run();}
   expect((await db.prepare("SELECT COUNT(*) AS n FROM pedia_products WHERE is_active=1").first<{n:number}>())?.n).toBe(60);
  }finally{await m.dispose();}
 },60000);
});
