import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

it("native queue producer + D1 origin: dry-run, lease, rollback with active messages and push fence replay", async () => {
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
      import {routeFulfillment} from './src/lib/payments/order-queue';
      import {POST} from './src/app/api/internal/queue/fulfill/route';
      import {createDatabaseAccess} from './src/lib/db-access';
      import {sendFencedCredential} from './src/lib/fulfillment/delivery/send-fence';
      let sends=0;
      export default {async fetch(req,env,ctx){
        const tasks=[];
        globalThis.DB=env.DB;globalThis[Symbol.for('__cloudflare-request-context__')]={env,ctx:{waitUntil(task){tasks.push(task);ctx.waitUntil(task);}}};
        const db=createDatabaseAccess(env.DB),url=new URL(req.url);
        globalThis.executeFixture=async()=>{const fence=new Date(Date.now()+120000).toISOString();
          await db.execRun("UPDATE fulfillment_items SET locked_until=?,status='sending' WHERE id=1",fence);
          return sendFencedCredential(db,1,fence,'telegram',['fixture credential'],async()=>{sends++;return {ok:true,messageId:'fixture'};});};
        if(url.pathname==='/produce'||url.pathname==='/rollback'){
          if(url.pathname==='/rollback'){const now=Date.now();Date.now=()=>now+31000;}
          await routeFulfillment({kind:'order_paid',orderCode:'AXV-20261118-NATIVE01',orderKind:'apps',source:'native'},globalThis.executeFixture,db);
          await Promise.all(tasks);
          return Response.json({sends});
        }
        if(url.pathname==='/count')return Response.json({sends});
        return POST(req);
      }};` },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    define: { "process.env": JSON.stringify({ CRON_SECRET: "fixture-cron" }) },
    plugins: [{ name: "runtime-boundaries", setup(b) {
      b.onResolve({ filter: /^(next\/server|@cloudflare\/next-on-pages|@\/lib\/payments\/paid-fulfillment)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "next/server" ? "export const NextResponse=Response; export const NextRequest=Request;"
        : args.path === "@cloudflare/next-on-pages" ? "export const getRequestContext=()=>globalThis[Symbol.for('__cloudflare-request-context__')];"
        : "export const fulfillPaidOrder=async()=>globalThis.executeFixture();" }));
    } }],
  });
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"],
    script: compiled.outputFiles[0].text, d1Databases: ["DB"], queueProducers: { ORDER_FULFILLMENT_QUEUE: "axvara-order-fulfillment" } });
  const f = createD1Fixture();
  try {
    const db = await runtime.getD1Database("DB");
    const tables = f.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
    for (const table of tables) await db.prepare(String(table.sql)).run();
    await db.batch([
      db.prepare("INSERT INTO products(id,name,slug,price) VALUES(1,'Fixture','fixture',10000)"),
      db.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status) VALUES('AXV-20261118-NATIVE01','Fixture','6280','[]',10000,'qris','lunas','paid')"),
      db.prepare("INSERT INTO fulfillment_items(id,order_code,item_index,product_id,fulfillment_mode,status,recipient_channel) VALUES(1,'AXV-20261118-NATIVE01',0,1,'shared','queued','telegram')"),
      db.prepare("INSERT INTO store_settings(key,value) VALUES('queue_fulfillment_mode','active')"),
    ]);
    const body = { v: 1, kind: "order_paid", orderCode: "AXV-20261118-NATIVE01", orderKind: "apps", source: "native", attempt: 1, dryRun: true };
    const origin = async (changes = {}) => {
      const response = await runtime.dispatchFetch("https://fixture/api/internal/queue/fulfill", { method: "POST", headers: { authorization: "Bearer fixture-cron" }, body: JSON.stringify({ ...body, ...changes }) });
      expect(response.status).toBe(200); return await response.json() as Record<string, unknown>;
    };
    expect(await origin()).toMatchObject({ settled: true, state: "dry_run_ok" });
    expect(await (await runtime.dispatchFetch("https://fixture/produce")).json()).toEqual({ sends: 0 }); // Native binding accepted; no legacy executor.
    await db.prepare("UPDATE store_settings SET value='off' WHERE key='queue_fulfillment_mode'").run();
    expect(await (await runtime.dispatchFetch("https://fixture/rollback")).json()).toEqual({ sends: 1 });
    const outcomes = await Promise.all([origin({ dryRun: false }), origin({ dryRun: false, kind: "supplier_settled" })]);
    expect(outcomes.every(result => result.settled === true && result.state === "queue_disabled")).toBe(true);
    expect(await (await runtime.dispatchFetch("https://fixture/count")).json()).toEqual({ sends: 1 }); // Old active messages + off fallback cannot resend sent ledger.
    expect(await origin({ orderCode: "AXV-20261118-NOTPAID1" })).toMatchObject({ state: "not_paid", settled: true });
  } finally { f.close(); await runtime.dispose(); }
}, 30_000);
