import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { createD1Fixture } from "./helpers/d1-fixture";

it("native D1 preserves WR/SK single dispatch across competing workers and blocks remapped manual items", async () => {
  const compiled = await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
    import {processWrPendingOrders} from './src/lib/warung-rebahan/order';
    import {processSkPendingOrders} from './src/lib/sekalipay/order';
    import {createBudgetedDatabase} from './src/lib/db-access';
    export default {async fetch(req,env){
      let purchases=0; const body=await req.json();
      globalThis.fetch=async(url,init)=>{
        const path=new URL(url).pathname;
        if(path.endsWith('/v1/item/1095'))return Response.json({data:{id:1095,price:5000,stock:-1,order_process:'auto'}});
        if(path.endsWith('/v1/balance'))return Response.json({data:{balance:100000}});
        if(path.endsWith('/v1/order')){purchases++;return Response.json({success:true,data:{order_id:'WR-D1',status:'processing'}});}
        if(path.endsWith('/v1/trx') && init.method==='POST'){purchases++;const sent=JSON.parse(init.body);return Response.json({data:{invoice:'SK-D1',ref_id:sent.ref_id,status:'paid'}});}
        if(path.includes('/v1/trx/'))return Response.json({message:'TRX_NOT_FOUND'},{status:404});
        throw new Error('unexpected fixture HTTP '+path);
      };
      const budgets=[];
      const results=await Promise.all(Array.from({length:3},async()=>{
        const b=createBudgetedDatabase(40,2,env.DB);budgets.push(b);
        return body.supplier==='wr'?processWrPendingOrders(b.access,{skipOrphanProbe:true}):processSkPendingOrders(b.access,{skipOrphanProbe:true});
      }));
      return Response.json({purchases,results,used:budgets.map(b=>b.used)});
    }}
  ` }, bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
  plugins: [{ name: "framework-marker", setup(b) {
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "framework" }));
    b.onLoad({ filter: /.*/, namespace: "framework" }, () => ({ contents: "" }));
  } }], define: { "process.env": JSON.stringify({
    WARUNG_REBAHAN_ENABLED: "true", WARUNG_REBAHAN_AUTO_ORDER_ENABLED: "true", WARUNG_REBAHAN_API_KEY: "fixture-key",
    SEKALIPAY_ENABLED: "true", SEKALIPAY_AUTO_ORDER_ENABLED: "true", SEKALIPAY_API_KEY: "fixture-key", TELEGRAM_BOT_ENABLED: "false",
  }) } });
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"], script: compiled.outputFiles[0].text, d1Databases: ["DB"] });
  const fixture = createD1Fixture();
  try {
    const db = await runtime.getD1Database("DB");
    const schema = fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { sql: string }[];
    await db.batch(schema.map(row => db.prepare(row.sql)));
    await db.batch([
      db.prepare("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'WR','wr',10000,10),(2,'SK','sk',10000,10)"),
      db.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,wr_variant_id,sk_variant_id) VALUES(1,1,'WR','WR',10000,10,'var-1',NULL),(2,2,'SK','SK',10000,10,NULL,'1095')"),
    ]);
    const call = async (supplier: string) => {
      const response = await runtime.dispatchFetch("https://fixture.test/dispatch", { method: "POST", body: JSON.stringify({ supplier }) });
      expect(response.status).toBe(200);
      const result = await response.json() as { purchases: number; used: number[] };
      expect(result.used.every(n => n <= 38)).toBe(true);
      return result.purchases;
    };
    for (const supplier of ["wr", "sk"]) {
      const id = supplier === "wr" ? 1 : 2;
      const table = `${supplier}_order_links`;
      const variant = supplier === "wr" ? "var-1" : "1095";
      await db.batch([
        db.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status) VALUES(?,'Buyer','628','[]',10000,'qris','lunas','paid')").bind(supplier),
        db.prepare(`INSERT INTO ${table}(id,order_code,${supplier}_variant_id,quantity,${supplier}_cost,status) VALUES(?,?,?,1,5000,'pending')`).bind(id, supplier, variant),
        db.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,${supplier}_link_id) VALUES(?,0,?,?,1,'manual','web','queued',?)`).bind(supplier, id, id, id),
      ]);
      expect(await call(supplier)).toBe(1);
      expect(await call(supplier)).toBe(0);
      expect(await db.prepare(`SELECT status,attempt_count,request_sent_at FROM ${table}`).first()).toMatchObject({ status: "processing", attempt_count: 1, request_sent_at: expect.any(String) });
      await db.batch([
        db.prepare(`UPDATE ${table} SET status='pending',request_sent_at=NULL,${supplier === "wr" ? "wr_order_id" : "sk_invoice"}=NULL`),
        db.prepare("UPDATE fulfillment_items SET last_error='manual_handover:admin',delivered_message_id='manual' WHERE order_code=?").bind(supplier),
        db.prepare(`UPDATE product_variants SET ${supplier}_variant_id=NULL WHERE id=?`).bind(id),
      ]);
      expect(await call(supplier)).toBe(0);
    }
  } finally { fixture.close(); await runtime.dispose(); }
}, 30000);
