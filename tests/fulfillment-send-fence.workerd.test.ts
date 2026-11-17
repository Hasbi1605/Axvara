import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

it("native D1: concurrent claims, failed retry, stale takeover, replay and migration idempotency", async () => {
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
      import {sendFencedCredential} from './src/lib/fulfillment/delivery/send-fence';
      import {createDatabaseAccess} from './src/lib/db-access';
      export default {async fetch(req,env){
        const body=await req.json(); const db=createDatabaseAccess(env.DB);
        const fence=new Date(Date.now()+60000).toISOString();
        await db.execRun("UPDATE fulfillment_items SET locked_until=?,status='sending' WHERE id=1",fence);
        let calls=0;
        const run=()=>sendFencedCredential(db,1,fence,body.channel,['fixture-part'],async()=>{
          calls++; return body.mode==='unknown'?{ok:false}:body.mode==='rejected'?{ok:false,definiteFailure:true}:{ok:true,messageId:'native-1'};
        });
        const results=await Promise.allSettled([run(),run()]);
        return Response.json({calls,results:results.map(r=>r.status),row:await db.queryFirst('SELECT * FROM fulfillment_send_claims WHERE item_id=1 AND channel=?',body.channel)});
      }}
    ` },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    define: { "process.env": "{}" },
  });
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"], script: compiled.outputFiles[0].text, d1Databases: ["DB"] });
  try {
    const db = await runtime.getD1Database("DB");
    await db.prepare("CREATE TABLE fulfillment_items(id INTEGER PRIMARY KEY,status TEXT,locked_until TEXT)").run();
    await db.prepare("INSERT INTO fulfillment_items VALUES(1,'sending',NULL)").run();
    const migration = readFileSync("drizzle/migrations/0135_fulfillment_send_claims.sql", "utf8");
    expect(readFileSync("drizzle/schema.sql", "utf8").match(/CREATE TABLE IF NOT EXISTS fulfillment_send_claims \([\s\S]*?\n\);/)?.[0])
      .toBe(migration.slice(migration.indexOf("CREATE TABLE")).trim());
    await db.prepare(migration).run();
    await db.prepare(migration).run();
    const call = async (channel: string, mode = "success") => {
      const result = await runtime.dispatchFetch("https://fixture.test/send", { method: "POST", body: JSON.stringify({ channel, mode }) });
      expect(result.status).toBe(200);
      return await result.json() as { calls: number; row: Record<string, unknown> };
    };
    for (const channel of ["telegram", "whatsapp"]) {
      const first = await call(channel);
      expect(first.calls).toBe(1);
      expect(first.row).toMatchObject({ status: "sent", part_count: 1, attempt_count: 1 });
      expect((await call(channel)).calls).toBe(0);
      await db.prepare("DELETE FROM fulfillment_send_claims").run();
      // A definite rejection releases immediately; run one request so its
      // second executor may legitimately retry the failed first claim.
      const rejected = await call(channel, "rejected");
      expect(rejected.calls).toBeGreaterThanOrEqual(1);
      expect(rejected.row.status).toBe("failed");
      expect((await call(channel)).calls).toBe(1);
      await db.prepare("DELETE FROM fulfillment_send_claims").run();
      const unknown = await call(channel, "unknown");
      expect(unknown.calls).toBe(1);
      expect(unknown.row.status).toBe("sending");
      expect((await call(channel)).calls).toBe(0);
      await db.prepare("UPDATE fulfillment_send_claims SET updated_at=strftime('%Y-%m-%d %H:%M:%f','now','-599 seconds')").run();
      expect((await call(channel)).calls).toBe(0);
      await db.prepare("UPDATE fulfillment_send_claims SET updated_at=datetime('now','-601 seconds')").run();
      expect((await call(channel)).calls).toBe(1);
      await db.prepare("DELETE FROM fulfillment_send_claims").run();
    }
  } finally { await runtime.dispose(); }
}, 30_000);

it("native D1: UPDATE RETURNING claims job/item and snapshots shared push in one statement", async () => {
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
      import {claimJob} from './src/lib/fulfillment/delivery/claim';
      import {processItem} from './src/lib/fulfillment/delivery/send';
      import {encryptSecret,decryptSecret} from './src/lib/fulfillment/crypto';
      import {createBudgetedDatabase} from './src/lib/db-access';
      export default {async fetch(req,env){
        let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({ok:true,result:{message_id:1}})};
        const budget=createBudgetedDatabase(40,2,env.DB),db=budget.access;
        const secret=await encryptSecret('native-only-fixture');
        await db.execRun('UPDATE product_variants SET shared_secret_ciphertext=?,shared_secret_iv=? WHERE id=1',secret.ciphertext,secret.iv);
        const before=budget.used,job=await claimJob(1,db,false),jobUsed=budget.used-before;
        const order=await db.queryFirst('SELECT * FROM orders WHERE code=?','C0-NATIVE');
        const item=await db.queryFirst('SELECT * FROM fulfillment_items WHERE id=1');
        await Promise.all([processItem(order,item,undefined,db,{jobId:1,lease:job.locked_until}),processItem(order,item,undefined,db,{jobId:1,lease:job.locked_until})]);
        const row=await db.queryFirst('SELECT * FROM fulfillment_items WHERE id=1');
        return Response.json({calls,jobUsed,used:budget.used,status:row.status,plaintext:await decryptSecret(row.delivered_ciphertext,row.delivered_iv)});
      }}
    ` },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    define: { "process.env": JSON.stringify({ FULFILLMENT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), TELEGRAM_BOT_TOKEN: "fixture-only" }) },
    plugins: [{ name: "framework-marker", setup(b) {
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "framework" }));
      b.onLoad({ filter: /.*/, namespace: "framework" }, () => ({ contents: "" }));
    } }],
  });
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"], script: compiled.outputFiles[0].text, d1Databases: ["DB"] });
  const fixture = createD1Fixture();
  try {
    const db = await runtime.getD1Database("DB");
    const tables = fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
    for (const table of tables) await db.prepare(String(table.sql)).run();
    await db.batch([
      db.prepare("INSERT INTO products(id,name,slug,price) VALUES(1,'Fixture','fixture',1000)"),
      db.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,fulfillment_mode) VALUES(1,1,'fixture','Fixture',1000,'shared')"),
      db.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,telegram_user_id) VALUES('C0-NATIVE','Fixture','6280','[]',1000,'qris','lunas','paid','telegram','12345')"),
      db.prepare("INSERT INTO fulfillment_jobs(id,order_code,status) VALUES(1,'C0-NATIVE','queued')"),
      db.prepare("INSERT INTO fulfillment_items(id,order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,recipient_target,status) VALUES(1,'C0-NATIVE',0,1,1,1,'shared','telegram','12345','queued')"),
    ]);
    const response = await runtime.dispatchFetch("https://fixture.test/send");
    expect(response.status).toBe(200);
    const result = await response.json() as { used: number };
    expect(result).toMatchObject({ calls: 1, jobUsed: 1, status: "delivered", plaintext: "native-only-fixture" });
    expect(result.used).toBeLessThanOrEqual(38);
  } finally { fixture.close(); await runtime.dispose(); }
}, 30_000);
