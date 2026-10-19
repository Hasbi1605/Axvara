import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import manifest from "@/lib/pedia/curation-20261019.json";
import original from "@/lib/pedia/curation-20261015.json";
import { createD1Fixture } from "./helpers/d1-fixture";
import { computePediaPrice } from "@/lib/pedia/pricing";
import { detectPediaLink, pediaTargetMatches } from "@/lib/pedia/link";
import { pediaTargetExample } from "@/lib/pedia/platforms";
const migration=fs.readFileSync("drizzle/migrations/0070_pedia_catalog_breadth.sql","utf8");
const mappings=[...new Map(manifest.products.flatMap(p=>p.services.map(s=>[`${s.supplier}:${s.service_id}`,s] as const))).values()];
const mirror=(s: typeof mappings[number])=>`INSERT INTO pedia_supplier_services(supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,api_refill,present) VALUES('${s.supplier}',${s.service_id},'upstream private','Category','Default',${s.evidence.rate_idr_per_1k_at_review},1,100000000,${s.evidence.api_refill?1:0},1)`;
function statements(sql:string){
 const list:string[]=[];let text="",quoted=false,comment=false;
 for(let i=0;i<sql.length;i++){const c=sql[i];if(comment){if(c==='\n'){comment=false;text+='\n';}continue;}if(!quoted&&c==='-'&&sql[i+1]==='-'){comment=true;i++;continue;}text+=c;if(c==="'"){if(quoted&&sql[i+1]==="'"){text+=sql[++i];continue;}quoted=!quoted;}if(!quoted&&c===';'){list.push(text);text="";}}
 if(text.trim())list.push(text);return list;
}
describe("Pedia additive breadth release",()=>{
 it("adds distinct needs with checked targets and honest refill capability",()=>{
  const slugs=new Set(original.products.map(p=>p.slug));
  expect(manifest.products.length).toBe(17);
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
  expect(slugs.size).toBe(55);
 });
 it("preserves owner drafts, historical mappings and snapshots, and prices new rows from live mirrors",()=>{
  const f=createD1Fixture();try{
   for(const s of mappings)f.sql.exec(mirror(s));
   f.sql.exec("INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,is_active) VALUES(90,'owner-product','instagram','followers','profile','Owner product',1),(91,'repost-instagram','instagram','reposts','post','Owner draft',0)");
   f.sql.exec("INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,is_active,public_name,package_prices_json) VALUES(90,90,'standar','indosmm',6209,'G3',20,1000,7,1,'Old copy','{\"100\":2000}')");
   const before=f.sql.prepare("SELECT * FROM pedia_tiers WHERE id=90").get();
   f.sql.exec(migration);
   expect(f.sql.prepare("SELECT * FROM pedia_tiers WHERE id=90").get()).toEqual(before);
   expect(f.sql.prepare("SELECT name,is_active FROM pedia_products WHERE id=91").get()).toEqual({name:"Owner draft",is_active:0});
   expect(f.sql.prepare("SELECT COUNT(*) AS n FROM pedia_tiers WHERE product_id=91").get()?.n).toBe(0);
   const active=f.sql.prepare("SELECT t.*,s.rate_idr_per_1k FROM pedia_tiers t JOIN pedia_supplier_services s ON s.supplier=t.supplier AND s.service_id=t.supplier_service_id WHERE t.id<>90").all();
   expect(active.length).toBe(21);
   for(const t of active)for(const [q,price]of Object.entries(JSON.parse(String(t.package_prices_json))))expect(price).toBe(computePediaPrice({supplierRatePer1k:Number(t.rate_idr_per_1k),quantity:Number(q),markupPct:Number(t.markup_pct),minProfitRp:Number(t.min_profit_rp)}));
   const count=f.sql.prepare("SELECT COUNT(*) AS n FROM pedia_tiers").get()?.n;
   f.sql.exec(migration);expect(f.sql.prepare("SELECT COUNT(*) AS n FROM pedia_tiers").get()?.n).toBe(count);
   expect(f.sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
   expect(migration).not.toMatch(/UPDATE\s+(pedia_order_items|orders)|DELETE FROM/i);
  }finally{f.close();}
 });
 it("does not publish missing, non-Default, out-of-bounds or unsupported refill mirrors",()=>{
  const f=createD1Fixture();try{
   for(const s of mappings)f.sql.exec(mirror(s));
   f.sql.exec("UPDATE pedia_supplier_services SET present=0 WHERE supplier='indosmm' AND service_id=9295; UPDATE pedia_supplier_services SET type='Custom Comments' WHERE supplier='indosmm' AND service_id=9296; UPDATE pedia_supplier_services SET min_qty=99999999 WHERE supplier='providersmm' AND service_id=974; UPDATE pedia_supplier_services SET api_refill=0 WHERE supplier='providersmm' AND service_id IN (749,751,753)");
   f.sql.exec(migration);
   expect(f.sql.prepare("SELECT slug FROM pedia_products WHERE is_active=0 ORDER BY slug").all()).toEqual([{slug:"repost-tiktok"},{slug:"views-story-instagram"}]);
   expect(f.sql.prepare("SELECT COUNT(*) AS n FROM pedia_tiers WHERE refill_days>0 AND supplier_service_id IN (749,751,753)").get()?.n).toBe(0);
  }finally{f.close();}
 });
 it("executes the migration under workerd/D1 with bounded statements",async()=>{
  const m=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:"2024-11-01",d1Databases:["DB"]});try{
   const db=await m.getD1Database("DB"),schema=fs.readFileSync("drizzle/schema.sql","utf8");
   await db.prepare("CREATE TABLE orders(code TEXT PRIMARY KEY)").run();
   for(const table of ["pedia_supplier_services","pedia_products","pedia_tiers","pedia_order_items"]){const sql=schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`))?.[0];expect(sql).toBeTruthy();await db.prepare(sql!).run();}
   for(const s of mappings)await db.prepare(mirror(s)).run();
   for(const sql of statements(migration)){expect(Buffer.byteLength(sql)).toBeLessThan(90000);await db.prepare(sql).run();}
   expect((await db.prepare("SELECT COUNT(*) AS n FROM pedia_products WHERE is_active=1").first<{n:number}>())?.n).toBe(17);
  }finally{await m.dispose();}
 },60000);
});
