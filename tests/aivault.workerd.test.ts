import {readFileSync} from "node:fs";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {expect,it} from "vitest";
import {createD1Fixture} from "./helpers/d1-fixture";

it("native workerd D1 batches catalog families, fences concurrent dispatch, and replays the same ID",async()=>{
  const compiled=await build({stdin:{resolveDir:process.cwd(),loader:"ts",contents:`
    import {publishAivaultCatalog} from './src/lib/aivault/catalog';
    import {processAivaultOrders} from './src/lib/aivault/orders';
    import {createBudgetedDatabase} from './src/lib/db-access';
    export default {async fetch(req,env){const body=await req.json();let posts=[];
      globalThis.fetch=async(url,init)=>{
        const path=new URL(url).pathname;
        if(path.endsWith('/products')) return Response.json({currency:'USD',products:[{service_id:'service_gemini_plus_6m',name:'Gemini Plus',stock:10,custom_pricing:false,pricing_tiers:[{min:1,max:100,price:0.5}]}]});
        if(path.endsWith('/quote')) return Response.json({service_id:'service_gemini_plus_6m',quantity:1,currency:'USD',stock:10,sufficient_balance:true,pricing:{unit_price:0.5,final_total:0.5}});
        if(init?.method==='POST'){const input=JSON.parse(init.body);posts.push(input.external_order_id);if(body.timeout)throw Error('timeout');return Response.json({success:true,order_id:'API_WORKER',external_order_id:input.external_order_id,service_id:input.service_id,quantity:1,currency:'USD',total_cost:0.5,products:['native-credential']},{status:201});}
        throw Error('unexpected fixture transport');
      };
      const budgets=[];const results=await Promise.all(Array.from({length:body.catalog?1:3},async()=>{const b=createBudgetedDatabase(40,2,env.DB);budgets.push(b);return body.catalog ? publishAivaultCatalog(b.access,20000,{force:true}) : processAivaultOrders(b.access,{orderCode:'NATIVE-AV'});}));
      return Response.json({results,posts,used:budgets.map(b=>b.used)});
    }}
  `},bundle:true,write:false,format:"esm",platform:"neutral",target:"es2022",plugins:[{name:"marker",setup(b){b.onResolve({filter:/^server-only$/},()=>({path:"marker",namespace:"empty"}));b.onLoad({filter:/.*/,namespace:"empty"},()=>({contents:""}));}}],define:{"process.env":JSON.stringify({AIVAULT_ENABLED:"true",AIVAULT_SYNC_ENABLED:"true",AIVAULT_API_KEY:"fixture",AIVAULT_BASE_URL:"https://supplier.test",FULFILLMENT_ENCRYPTION_KEY:Buffer.alloc(32,7).toString("base64")})}});
  const runtime=new Miniflare({modules:true,compatibilityDate:"2026-08-06",compatibilityFlags:["nodejs_compat"],script:compiled.outputFiles[0].text,d1Databases:["DB"]});
  const fixture=createD1Fixture();
  try {
    const db=await runtime.getD1Database("DB");
    const tables=fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('categories','products','product_variants','store_settings','aivault_products')").all() as {sql:string}[];
    await db.batch(tables.map(t=>db.prepare(t.sql)));
    await db.prepare("CREATE TABLE crypto_market_snapshot(id INTEGER PRIMARY KEY,fx_rate_text TEXT)").run();
    await db.prepare("INSERT INTO categories(id,name,slug) VALUES(1,'AI','ai-chatbot')").run();
    const call=async(body:Record<string,unknown>)=>{const response=await runtime.dispatchFetch("https://fixture.test",{method:"POST",body:JSON.stringify(body)});const r=await response.json() as {posts:string[];used:number[];results:unknown[]};expect(r.used.every(n=>n<=38)).toBe(true);return r;};
    expect((await call({catalog:true})).results).toMatchObject([{ok:true}]);
    expect(await db.prepare("SELECT is_active,price,stock FROM product_variants").first()).toMatchObject({is_active:0,price:13500,stock:10});
    // Compact dispatch fixture: actual AIVault migration/table semantics, no buyer/provider services.
    await db.batch([
      db.prepare("CREATE TABLE orders(id INTEGER PRIMARY KEY,code TEXT UNIQUE,items TEXT,status TEXT DEFAULT 'lunas',payment_status TEXT DEFAULT 'paid',sales_channel TEXT DEFAULT 'web',order_kind TEXT DEFAULT 'apps',supplier_purchase_disabled INTEGER DEFAULT 0)"),
      db.prepare("CREATE TABLE fulfillment_items(id INTEGER PRIMARY KEY,order_code TEXT,item_index INTEGER,product_id INTEGER,variant_id INTEGER,qty INTEGER DEFAULT 1,fulfillment_mode TEXT DEFAULT 'manual',status TEXT DEFAULT 'queued',wr_link_id INTEGER,sk_link_id INTEGER,tunvn_link_id INTEGER,inventory_id INTEGER,aivault_link_id INTEGER,delivered_ciphertext TEXT,delivered_iv TEXT,last_error TEXT,locked_until TEXT)"),
      db.prepare("CREATE TABLE fulfillment_jobs(order_code TEXT,status TEXT,attempt_count INTEGER,next_attempt_at TEXT,locked_until TEXT)"),
      db.prepare(String((fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE name='aivault_order_links'").get() as {sql:string}).sql)),
      db.prepare("UPDATE products SET is_active=1"),db.prepare("UPDATE product_variants SET is_active=1"),
    ]);
    const p=await db.prepare("SELECT id FROM products").first() as {id:number},v=await db.prepare("SELECT id FROM product_variants").first() as {id:number};
    const item={product_id:p.id,variant_id:v.id,qty:1,aivault_eligibility:{version:1,service_id:"service_gemini_plus_6m",source_variant_id:v.id,quantity:1,cost_usd:0.5}};
    await db.prepare("INSERT INTO orders(id,code,items) VALUES(1,'NATIVE-AV',?)").bind(JSON.stringify([item])).run();
    await db.prepare("INSERT INTO fulfillment_items(id,order_code,item_index,product_id,variant_id) VALUES(1,'NATIVE-AV',0,?,?)").bind(p.id,v.id).run();
    expect((await call({timeout:true})).posts).toEqual(["NATIVE-AV-0"]);
    expect(await db.prepare("SELECT status,attempt_count FROM aivault_order_links").first()).toMatchObject({status:"pending",attempt_count:1});
    await db.prepare("UPDATE aivault_order_links SET next_attempt_at=datetime('now','-1 minute')").run();
    expect((await call({})).posts).toEqual(["NATIVE-AV-0"]);
    const link=await db.prepare("SELECT status,attempt_count,receipt_ciphertext FROM aivault_order_links").first();expect(link).toMatchObject({status:"completed",attempt_count:2});expect(JSON.stringify(link)).not.toContain("native-credential");
  } finally {fixture.close();await runtime.dispose();}
},30000);

it("0124 applies locally after existing schema without altering products or historical orders",async()=>{
  const {createRequire}=await import("node:module");
  const {DatabaseSync}=createRequire(import.meta.url)("node:sqlite");
  const db=new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync("drizzle/schema.sql","utf8").split("-- AIVault is a separate, opt-in supplier.")[0]);
    db.exec("INSERT INTO products(name,slug,price,is_active) VALUES('Owner copy','owner',100,1)");
    db.exec(readFileSync("drizzle/migrations/0124_aivault_supplier.sql","utf8"));
    expect(db.prepare("SELECT name,is_active,aivault_family FROM products WHERE slug='owner'").get()).toMatchObject({name:"Owner copy",is_active:1,aivault_family:null});
    db.exec("INSERT INTO aivault_products(service_id,name,stock,unit_price_usd,pricing_tiers_json) VALUES('service_gemini_plus_6m','Gemini',5,0.5,'[]'),('service_other','Other',5,1,'[]')");
    db.exec(readFileSync("drizzle/migrations/0131_aivault_bulk_markup.sql","utf8"));
    expect(db.prepare("SELECT bulk_markup_tiers_json FROM aivault_products WHERE service_id='service_gemini_plus_6m'").get()).toEqual({
      bulk_markup_tiers_json:'[{"min_qty":5,"markup_percent":58},{"min_qty":10,"markup_percent":47},{"min_qty":50,"markup_percent":36}]',
    });
    expect(db.prepare("SELECT bulk_markup_tiers_json FROM aivault_products WHERE service_id='service_other'").get()).toEqual({
      bulk_markup_tiers_json:null,
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally{db.close();}
});
