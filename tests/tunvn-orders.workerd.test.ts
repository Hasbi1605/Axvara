import { readFileSync } from "node:fs";
import { expect,it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { createD1Fixture } from "./helpers/d1-fixture";

it("workerd catalog cron uses native D1 upserts/lease under40 statements and never activates products",async()=>{
  const compiled=await build({stdin:{resolveDir:process.cwd(),loader:"ts",contents:`
    import {publishTunvnCatalog} from './src/lib/tunvn/catalog';
    import {createBudgetedDatabase} from './src/lib/db-access';
    export default {async fetch(req,env){
      let reads=0; const body=await req.json();
      globalThis.fetch=async(url,init)=>{
        reads++; const path=new URL(url).pathname;
        if(path==='/api/products')return Response.json({success:true,products:[{id:86,name:'Business',price_vnd:50000,price_usdt:2,stock:7},{id:83,name:'GPay',price_vnd:50000,price_usdt:3,stock:4}]});
        if(path==='/api/buff/check' && JSON.parse(init.body).orders_text==='AXVARA 1')return Response.json({success:true,fundable:body.fundable,gross_cost_vnd:390,sell_price_vnd:390,sell_price_usdt:0.1,orders_breakdown:[{invite_code:'AXVARA',quantity_b:1,valid:true}]});
        throw new Error('unexpected supplier mutation');
      };
      const budgets=[];
      const results=await Promise.all(Array.from({length:3},async()=>{
        const b=createBudgetedDatabase(40,2,env.DB);budgets.push(b);
        return publishTunvnCatalog(b.access,20000,{force:false,now:body.now});
      }));
      return Response.json({reads,results,used:budgets.map(b=>b.used)});
    }}
  `},bundle:true,write:false,format:"esm",platform:"neutral",target:"es2022",define:{"process.env":JSON.stringify({TUNVN_ENABLED:"true",TUNVN_SYNC_ENABLED:"true",TUNVN_API_KEY:"fixture-only",TUNVN_BASE_URL:"https://supplier.test"})}});
  const runtime=new Miniflare({modules:true,compatibilityDate:"2026-08-06",compatibilityFlags:["nodejs_compat"],script:compiled.outputFiles[0].text,d1Databases:["DB"]});
  const fixture=createD1Fixture();
  try {
    const db=await runtime.getD1Database("DB");
    const schema=fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('categories','products','product_variants','store_settings','tunvn_products')").all() as {sql:string}[];
    await db.batch(schema.map(row=>db.prepare(row.sql)));
    await db.batch([
      db.prepare("INSERT INTO categories(id,name,slug) VALUES(1,'AI','ai-chatbot')"),
      db.prepare("INSERT INTO products(id,name,slug,price) VALUES(1,'Muse','muse-ai-1-miliar-token',16000)"),
    ]);
    const call=async(now:number,fundable=true)=>{
      const response=await runtime.dispatchFetch("https://fixture.test/catalog",{method:"POST",body:JSON.stringify({now,fundable})});
      const result=await response.json() as {reads:number;results:Record<string,unknown>[];used:number[]};
      expect(result.used.every(n=>n<=38)).toBe(true); return result;
    };
    const result=await call(1_800_000_000_000);
    expect(result.reads).toBe(2); expect(result.results.filter(row=>row.ok===true)).toHaveLength(1);
    expect(await db.prepare("SELECT price,stock,is_active,tunvn_cost_usdt FROM product_variants WHERE sku='TUNVN-BUFF-1B'").first()).toMatchObject({price:2800,stock:-1,is_active:0,tunvn_cost_usdt:0.1});
    expect(await db.prepare("SELECT price,stock,is_active FROM product_variants WHERE sku='TUNVN-86'").first()).toMatchObject({price:54000,stock:7,is_active:0});
    expect((await call(1_800_000_001_000)).reads).toBe(0);
    expect((await call(1_800_000_180_000,false)).reads).toBe(2);
    expect(await db.prepare("SELECT stock,is_active FROM product_variants WHERE sku='TUNVN-BUFF-1B'").first()).toMatchObject({stock:0,is_active:0});
  } finally {fixture.close();await runtime.dispose();}
},30000);

it("workerd D1 fences competing paid dispatch, retains encrypted receipts, and polls Buff202 without rebuy",async()=>{
  const compiled=await build({stdin:{resolveDir:process.cwd(),loader:"ts",contents:`
    import {processTunvnOrders,retryTunvnOrder} from './src/lib/tunvn/orders';
    import {createBudgetedDatabase} from './src/lib/db-access';
    export default {async fetch(req,env){
      const body=await req.json(); globalThis.DB=env.DB; let purchases=0;
      globalThis.fetch=async(url,init)=>{
        const path=new URL(url).pathname;
        if(path==='/api/products')return Response.json({success:true,products:[{id:86,name:'Account',price_vnd:50000,price_usdt:2,stock:100}]});
        if(path==='/api/balance')return Response.json({success:true,balance_vnd:0,balance_usdt:body.balance ?? 100});
        if(path==='/api/buff/check')return Response.json({success:true,fundable:true,sell_price_usdt:2,orders_breakdown:[{invite_code:'Ab12Cd',quantity_b:1,valid:true}]});
        if(path==='/api/buff/status')return Response.json({success:true,batch_id:'BUFF_WORKER',is_done:true,orders:[{invite_code:'Ab12Cd',quantity_b:1,currency:'usdt',order_code:'TELE_WORKER',status:'done'}]});
        purchases++;
        if(path==='/api/buy')return Response.json({success:true,order:{order_group:'ORD_WORKER',quantity:1,total_items:1,total_price:2,currency:'usdt'},items:['worker-fixture-secret']});
        if(path==='/api/buff/order')return Response.json({batch_id:'BUFF_WORKER'},{status:202});
        throw new Error('unexpected mock transport');
      };
      const budgets=[];
      await Promise.all(Array.from({length:body.competing?3:1},async()=>{
        const b=createBudgetedDatabase(40,2,env.DB);budgets.push(b);
        if(body.retry){const link=await b.access.queryFirst('SELECT id FROM tunvn_order_links WHERE order_code=?',body.code);await retryTunvnOrder(b.access,link.id);}
        else await processTunvnOrders(b.access,{orderCode:body.code});
      }));
      return Response.json({purchases,used:budgets.map(b=>b.used)});
    }}
  `},bundle:true,write:false,format:"esm",platform:"neutral",target:"es2022",plugins:[{name:"framework-marker",setup(b){
    b.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"framework"}));
    b.onLoad({filter:/.*/,namespace:"framework"},()=>({contents:""}));
  }}],define:{"process.env":JSON.stringify({TUNVN_ENABLED:"true",TUNVN_SYNC_ENABLED:"true",TUNVN_API_KEY:"fixture-only",TUNVN_BASE_URL:"https://supplier.test",FULFILLMENT_ENCRYPTION_KEY:Buffer.alloc(32,7).toString("base64")})}});
  const runtime=new Miniflare({modules:true,compatibilityDate:"2026-08-06",compatibilityFlags:["nodejs_compat"],script:compiled.outputFiles[0].text,d1Databases:["DB"]});
  try {
    const db=await runtime.getD1Database("DB");
    const statements=[
      "CREATE TABLE products(id INTEGER PRIMARY KEY,slug TEXT,source TEXT DEFAULT 'manual',is_active INTEGER DEFAULT 1,wr_product_id TEXT,sk_product_id TEXT,wr_auto_managed INTEGER DEFAULT 0,sk_auto_managed INTEGER DEFAULT 0)",
      "CREATE TABLE product_variants(id INTEGER PRIMARY KEY,product_id INTEGER,sku TEXT,fulfillment_mode TEXT DEFAULT 'manual',is_active INTEGER DEFAULT 1,wr_variant_id TEXT,sk_variant_id TEXT,buyer_field_key TEXT,max_qty INTEGER,tunvn_buff_quantity_b INTEGER)",
      "CREATE TABLE orders(id INTEGER PRIMARY KEY,code TEXT UNIQUE,items TEXT,status TEXT DEFAULT 'lunas',payment_status TEXT DEFAULT 'paid',sales_channel TEXT DEFAULT 'web',order_kind TEXT DEFAULT 'apps')",
      "CREATE TABLE fulfillment_items(id INTEGER PRIMARY KEY,order_code TEXT,item_index INTEGER,product_id INTEGER,variant_id INTEGER,qty INTEGER DEFAULT 1,fulfillment_mode TEXT DEFAULT 'manual',wr_link_id INTEGER,sk_link_id INTEGER,inventory_id INTEGER,status TEXT DEFAULT 'queued',delivered_ciphertext TEXT,delivered_iv TEXT,last_error TEXT,locked_until TEXT)",
      "CREATE TABLE fulfillment_jobs(order_code TEXT,status TEXT,attempt_count INTEGER,next_attempt_at TEXT,locked_until TEXT)",
      ...readFileSync("drizzle/migrations/0116_tunvn_order_links.sql","utf8").split(";").map(s=>s.trim()).filter(Boolean),
      "INSERT INTO products(id,slug) VALUES(1,'chatgpt-tunvn'),(2,'muse-ai-1-miliar-token')",
      "INSERT INTO product_variants(id,product_id,sku) VALUES(1,1,'TUNVN-86')",
      "INSERT INTO product_variants(id,product_id,sku,buyer_field_key,max_qty,tunvn_buff_quantity_b) VALUES(2,2,'TUNVN-BUFF-1B','muse_invite_code',30,1)",
    ];
    for(const statement of statements)await db.prepare(statement).run();
    const create=async(kind:"account"|"buff",id:number)=>{
      const line={product_id:id,variant_id:id,qty:1,fulfillment_mode:"manual",...(kind==="buff"?{buyer_field_key:"muse_invite_code",max_qty:30,buyer_fields:{muse_invite_code:"Ab12Cd"}}:{}),tunvn_eligibility:{version:1,kind,source_product_id:kind==="account"?86:null,source_variant_id:id,source_unit_b:kind==="buff"?1:null,quantity:1,cost_usdt:2}};
      const code=`WORKER-${id}`;
      await db.prepare("INSERT INTO orders(id,code,items) VALUES(?,?,?)").bind(id,code,JSON.stringify([line])).run();
      await db.prepare("INSERT INTO fulfillment_items(id,order_code,item_index,product_id,variant_id) VALUES(?,?,0,?,?)").bind(id,code,id,id).run();
      return code;
    };
    const call=async(code:string,competing=false,extra:Record<string,unknown>={})=>{
      const response=await runtime.dispatchFetch("https://fixture.test/dispatch",{method:"POST",body:JSON.stringify({code,competing,...extra})});
      const result=await response.json() as {purchases:number;used:number[]};
      expect(result.used.every(n=>n<=38)).toBe(true);return result;
    };
    const code=await create("account",1);expect((await call(code,true)).purchases).toBe(1);
    const link=await db.prepare("SELECT * FROM tunvn_order_links WHERE order_code=?").bind(code).first();
    expect(link).toMatchObject({status:"completed",attempt_count:1,request_sent_at:expect.any(String),receipt_http_status:200});
    expect(JSON.stringify(link)).not.toContain("worker-fixture-secret");expect((await call(code,true)).purchases).toBe(0);
    const buff=await create("buff",2);expect((await call(buff,false,{balance:0})).purchases).toBe(0);
    expect(await db.prepare("SELECT status,last_error,request_sent_at,attempt_count FROM tunvn_order_links WHERE order_code=?").bind(buff).first()).toMatchObject({status:"needs_admin",last_error:"insufficient_balance",request_sent_at:null,attempt_count:0});
    await db.prepare("UPDATE orders SET supplier_purchase_disabled=1 WHERE code=?").bind(buff).run();
    expect((await call(buff,true,{retry:true})).purchases).toBe(0);
    await db.prepare("UPDATE orders SET supplier_purchase_disabled=0 WHERE code=?").bind(buff).run();
    expect((await call(buff,true,{retry:true})).purchases).toBe(1);
    expect((await call(buff,true,{retry:true})).purchases).toBe(0);
    expect(await db.prepare("SELECT status FROM tunvn_order_links WHERE order_code=?").bind(buff).first()).toMatchObject({status:"processing"});
    await db.prepare("UPDATE tunvn_order_links SET next_attempt_at=datetime('now','-1 minute') WHERE order_code=?").bind(buff).run();
    expect((await call(buff,true)).purchases).toBe(0);
    expect(await db.prepare("SELECT status FROM tunvn_order_links WHERE order_code=?").bind(buff).first()).toMatchObject({status:"completed"});
  } finally {await runtime.dispose();}
},30000);
