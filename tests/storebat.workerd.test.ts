import {readFileSync} from "node:fs";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect,it} from "vitest";
import {createD1Fixture} from "./helpers/d1-fixture";

it("native workerd D1 batches catalog families, fences concurrent dispatch, and replays the same ID",async()=>{
  const compiled=await build({stdin:{resolveDir:process.cwd(),loader:"ts",contents:`
    import {publishStorebatCatalog} from './src/lib/storebat/catalog';
    import {processStorebatOrders} from './src/lib/storebat/orders';
    import {createBudgetedDatabase} from './src/lib/db-access';
    export default {async fetch(req,env){const body=await req.json();let posts=[];
      globalThis.fetch=async(url,init)=>{
        const path=new URL(url).pathname;
        if(path.endsWith('/products')) return Response.json({success:true,services:[],products:[{id:121,name:'Gemini Plus',stock:10,delivery_type:'stock',warranty_days:0,pricing_type:'standard',price_tiers:[],price_usd:0.5}]});
        if(path.endsWith('/quote')) return Response.json({success:true,wallet_balance:2,quote:{product_id:121,quantity:1,stock:10,delivery_type:'stock',unit_price:0.5,total:0.5}});
        if(path.endsWith('/lookup')) return Response.json({success:true,results:[{idempotency_key:'NATIVE-SB-0',request_status:'failed_no_charge',order:null}]});
        if(init?.method==='POST'){const input=JSON.parse(init.body);posts.push(input.idempotency_key);if(body.timeout)throw Error('timeout');return Response.json({success:true,order:{id:12,product_id:121,quantity:1,idempotency_key:input.idempotency_key,customer_reference:input.customer_reference,amount_usd:0.5,status:'COMPLETED',delivery_type:'stock',items:[{account_data:'native-credential'}]}},{status:201});}
        throw Error('unexpected fixture transport');
      };
      const budgets=[];const results=await Promise.all(Array.from({length:body.catalog?1:3},async()=>{const b=createBudgetedDatabase(40,2,env.DB);budgets.push(b);return body.catalog ? publishStorebatCatalog(b.access,20000,{force:true}) : processStorebatOrders(b.access,{orderCode:'NATIVE-SB'});}));
      return Response.json({results,posts,used:budgets.map(b=>b.used)});
    }}
  `},bundle:true,write:false,format:"esm",platform:"neutral",target:"es2022",plugins:[{name:"marker",setup(b){b.onResolve({filter:/^server-only$/},()=>({path:"marker",namespace:"empty"}));b.onLoad({filter:/.*/,namespace:"empty"},()=>({contents:""}));}}],define:{"process.env":JSON.stringify({STOREBAT_ENABLED:"true",STOREBAT_SYNC_ENABLED:"true",STOREBAT_API_KEY:"fixture",STOREBAT_BASE_URL:"https://supplier.test",FULFILLMENT_ENCRYPTION_KEY:Buffer.alloc(32,7).toString("base64")})}});
  const runtime=new Miniflare({modules:true,compatibilityDate:"2026-08-06",compatibilityFlags:["nodejs_compat"],script:compiled.outputFiles[0].text,d1Databases:["DB"]});
  const fixture=createD1Fixture();
  try {
    const db=await runtime.getD1Database("DB");
    const tables=fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('categories','products','product_variants','store_settings','storebat_products','storebat_services','operation_guards')").all() as {sql:string}[];
    await db.batch(tables.map(t=>db.prepare(t.sql)));
    await db.prepare("CREATE TABLE crypto_market_snapshot(id INTEGER PRIMARY KEY,fx_rate_text TEXT)").run();
    await db.prepare("INSERT INTO categories(id,name,slug) VALUES(1,'AI','ai-chatbot')").run();
    const call=async(body:Record<string,unknown>)=>{const response=await runtime.dispatchFetch("https://fixture.test",{method:"POST",body:JSON.stringify(body)});const r=await response.json() as {posts:string[];used:number[];results:unknown[]};expect(r.used.every(n=>n<=38)).toBe(true);return r;};
    expect((await call({catalog:true})).results).toMatchObject([{ok:true}]);
    expect(await db.prepare("SELECT is_active,price,stock FROM product_variants").first()).toMatchObject({is_active:0,price:13500,stock:10});
    // Compact dispatch fixture: actual StoreBat migration/table semantics, no buyer/provider services.
    await db.batch([
      db.prepare("CREATE TABLE orders(id INTEGER PRIMARY KEY,code TEXT UNIQUE,items TEXT,status TEXT DEFAULT 'lunas',payment_status TEXT DEFAULT 'paid',sales_channel TEXT DEFAULT 'web',order_kind TEXT DEFAULT 'apps',supplier_purchase_disabled INTEGER DEFAULT 0)"),
      db.prepare("CREATE TABLE fulfillment_items(id INTEGER PRIMARY KEY,order_code TEXT,item_index INTEGER,product_id INTEGER,variant_id INTEGER,qty INTEGER DEFAULT 1,fulfillment_mode TEXT DEFAULT 'manual',status TEXT DEFAULT 'queued',wr_link_id INTEGER,sk_link_id INTEGER,tunvn_link_id INTEGER,inventory_id INTEGER,aivault_link_id INTEGER,storebat_link_id INTEGER,mirai_link_id INTEGER,delivered_ciphertext TEXT,delivered_iv TEXT,last_error TEXT,locked_until TEXT)"),
      db.prepare("CREATE TABLE fulfillment_jobs(order_code TEXT,status TEXT,attempt_count INTEGER,next_attempt_at TEXT,locked_until TEXT)"),
      db.prepare(String((fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE name='storebat_order_links'").get() as {sql:string}).sql)),
      db.prepare("UPDATE products SET is_active=1"),db.prepare("UPDATE product_variants SET is_active=1"),
    ]);
    const p=await db.prepare("SELECT id FROM products").first() as {id:number},v=await db.prepare("SELECT id FROM product_variants").first() as {id:number};
    const item={product_id:p.id,variant_id:v.id,qty:1,storebat_eligibility:{version:1,kind:"product",sku:"SB-121",product_id:121,family:"gemini",source_variant_id:v.id,quantity:1,cost_usd:0.5,fx_idr_per_usd:20000}};
    await db.prepare("INSERT INTO orders(id,code,items) VALUES(1,'NATIVE-SB',?)").bind(JSON.stringify([item])).run();
    await db.prepare("INSERT INTO fulfillment_items(id,order_code,item_index,product_id,variant_id) VALUES(1,'NATIVE-SB',0,?,?)").bind(p.id,v.id).run();
    expect((await call({timeout:true})).posts).toEqual(["NATIVE-SB-0"]);
    expect(await db.prepare("SELECT status,attempt_count FROM storebat_order_links").first()).toMatchObject({status:"processing",attempt_count:1});
    await db.prepare("UPDATE storebat_order_links SET next_attempt_at=datetime('now','-1 minute')").run();
    expect((await call({})).posts).toEqual(["NATIVE-SB-0"]);
    const link=await db.prepare("SELECT status,attempt_count,receipt_ciphertext FROM storebat_order_links").first();expect(link).toMatchObject({status:"completed",attempt_count:2});expect(JSON.stringify(link)).not.toContain("native-credential");
  } finally {fixture.close();await runtime.dispose();}
},30000);

it("0139 applies after the canonical previous schema without enabling existing products",()=>{
  const f=createD1Fixture();
  try {
    const sql=readFileSync("drizzle/schema.sql","utf8");
    const migration=readFileSync("drizzle/migrations/0139_storebat_supplier.sql","utf8");
    const norm=(s:string)=>s.replace(/\s+/g," ").trim();
    expect(norm(sql)).toContain(norm(migration));
    expect(f.sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {f.close();}
});
