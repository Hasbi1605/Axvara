import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { syncProducts, syncJaspayCatalog } from "@/lib/warung-rebahan/sync";
import type { WrProduct } from "@/lib/warung-rebahan/client";
import { syncSkProducts } from "@/lib/sekalipay/sync";
import { publishTunvnCatalog } from "@/lib/tunvn/catalog";
import { publishAivaultCatalog } from "@/lib/aivault/catalog";
import { PATCH as tunvnSwitch } from "@/app/api/admin/tunvn/products/[id]/route";
import { PATCH as avSwitch } from "@/app/api/admin/aivault/products/[id]/route";
import { NextRequest } from "next/server";
vi.mock("@/lib/auth",()=>({requireAdmin:vi.fn(async()=>({sid:"fixture"}))}));
let f:ReturnType<typeof createD1Fixture>;
beforeEach(()=>{f=createD1Fixture();for(const supplier of ['WARUNG_REBAHAN','SEKALIPAY','TUNVN','AIVAULT']) {vi.stubEnv(`${supplier}_ENABLED`,'true');vi.stubEnv(`${supplier}_SYNC_ENABLED`,'true');vi.stubEnv(`${supplier}_API_KEY`,'fixture');}vi.stubEnv('TUNVN_BASE_URL','https://tunvn.test');vi.stubEnv('AIVAULT_BASE_URL','https://av.test');});
afterEach(()=>{f.close();vi.unstubAllEnvs();vi.unstubAllGlobals();});
const db=()=>createDatabaseAccess(f.db);
function archiveAll(){f.sql.exec("UPDATE products SET archived_at='2026-11-15',is_active=0; UPDATE product_variants SET is_active=0");}
function graph(){return {p:f.sql.prepare('SELECT * FROM products ORDER BY id').all(),v:f.sql.prepare('SELECT * FROM product_variants ORDER BY id').all()};}
const wr=(extra=false):WrProduct[]=>[{id:'archive-wr',name:'Archive WR',category:'Productivity',description:'desc',variants:[{id:'archive-wrv',name:'One',price:1000,stock:3,duration:'30 Hari',type:'Private',warranty:'7 Hari',terms:null,delivery_terms:null},...(extra?[{id:'archive-new',name:'New',price:2000,stock:10,duration:'30 Hari',type:'Private',warranty:'7 Hari',terms:null,delivery_terms:null}]:[])]}];
it('WR retains the archived identity, skips price/stock/new variants, and does not recreate after losing the registry link',async()=>{
  expect((await syncProducts(db(),async()=>wr())).errors).toEqual([]);archiveAll();const before=graph();
  f.sql.exec('UPDATE wr_products SET axvara_product_id=NULL');
  expect((await syncProducts(db(),async()=>wr(true))).errors).toEqual([]);expect(graph()).toEqual(before);
});
const sk=(extra=false)=>({server_time:'2026-11-15',data:[{id:1,name:'Aplikasi Premium',icon:null,products:[{id:99999,name:'Archive SK',image:null,variants:[{id:99991,sku:'SK1',name:'One',price:1000,stock:3,order_process:'auto' as const,h2h_provider:null,provider_meta:null,required_fields:null,validation:null,updated_at:null},...(extra?[{id:99992,sku:'SK2',name:'Two',price:2000,stock:10,order_process:'auto' as const,h2h_provider:null,provider_meta:null,required_fields:null,validation:null,updated_at:null}]:[])]}]}]});
it('SK keeps archived rows while a new variant arrives and a registry link is missing',async()=>{
  expect((await syncSkProducts(db(),async()=>sk())).errors).toEqual([]);archiveAll();const before=graph();
  f.sql.exec('UPDATE sk_products SET axvara_product_id=NULL');
  expect((await syncSkProducts(db(),async()=>sk(true))).errors).toEqual([]);expect(graph()).toEqual(before);
});
it('TUNVN accounts and Buff stay archived after publishing; panel activation returns 409',async()=>{
  f.sql.exec("INSERT INTO products(name,slug,price,is_active) VALUES('Muse','muse-ai-1-miliar-token',1000,1)");
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(String(url).endsWith('/buff/check')?{success:true,gross_cost_vnd:390,sell_price_vnd:390,sell_price_usdt:0.0588,fundable:true,orders_breakdown:[{invite_code:'AXVARA',quantity_b:1,valid:true}]}:{success:true,products:[{id:86,name:'ChatGPT Business',price_vnd:119000,price_usdt:4.6,stock:22,description:'d'}]})));
  expect(await publishTunvnCatalog(db(),20000,{force:true})).toMatchObject({ok:true});archiveAll();const before=graph();
  expect(await publishTunvnCatalog(db(),25000,{force:true})).toMatchObject({ok:true});expect(graph()).toEqual(before);
  const r=await tunvnSwitch(new NextRequest('http://localhost/api/admin/tunvn/products/86',{method:'PATCH',body:JSON.stringify({axvara_is_active:true,publish_requested:true})}),{params:Promise.resolve({id:'86'})});expect(r.status).toBe(409);expect((await r.json()).error).toBe('Pulihkan dari Arsip dulu');
});
it('AIVault keeps archived family even if its slug changes; panel activation returns 409',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({currency:'USD',products:[{service_id:'service_gemini_plus_6m',name:'Gemini Plus',stock:5,custom_pricing:false,pricing_tiers:[{min:1,max:100,price:0.5}]}]})));
  expect(await publishAivaultCatalog(db(),20000,{force:true})).toMatchObject({ok:true});archiveAll();f.sql.exec("UPDATE products SET slug='admin-changed-slug'");const before=graph();
  expect(await publishAivaultCatalog(db(),25000,{force:true})).toMatchObject({ok:true});expect(graph()).toEqual(before);
  const r=await avSwitch(new NextRequest('http://localhost/api/admin/aivault/products/service_gemini_plus_6m',{method:'PATCH',body:JSON.stringify({is_active:true})}),{params:Promise.resolve({id:'service_gemini_plus_6m'})});expect(r.status).toBe(409);expect((await r.json()).error).toBe('Pulihkan dari Arsip dulu');
});
it('Jaspay attaches to an archived legacy identity instead of publishing a replacement',async()=>{
  f.sql.exec("INSERT INTO products(name,slug,price,source,wr_product_id,is_active,archived_at) VALUES('Legacy Zoom','zoom-legacy',1000,'warung_rebahan','38eda557-044d-11f1-bf18-bc241112a182',0,'2026-11-15')");
  const result=await syncJaspayCatalog(db(),async()=>[{product:'zoom',name:'Zoom',description:'d',available:true,max_quantity:100,packages:[{id:1,name:'One',price:1000,available:true}]}]);
  expect(result.errors).toEqual([]);expect(f.sql.prepare('SELECT COUNT(*) n FROM products').get()?.n).toBe(1);expect(f.sql.prepare('SELECT COUNT(*) n FROM product_variants').get()?.n).toBe(0);
});
