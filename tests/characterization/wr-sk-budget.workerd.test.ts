import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { createD1Fixture } from "../helpers/d1-fixture";

it("T1 native D1 matches dispatch, cutoff, final-proof batch and GET-ref deltas", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
    import { processWrPendingOrders } from './src/lib/warung-rebahan/order';
    import { replayWrFinalSettlement } from './src/lib/warung-rebahan/final-settlement';
    import { processSkPendingOrders, recoverStaleSkClaims, settleExhaustedSkRetries } from './src/lib/sekalipay/order';
    import { createBudgetedDatabase, QueryBudgetExceeded } from './src/lib/db-access';
    export default { async fetch(req, env) {
      const { family, action, limit } = await req.json();
      const budget = createBudgetedDatabase(limit, 2, env.DB);
      const calls = [];
      globalThis.fetch = async (url, init) => {
        const path = new URL(url).pathname;
        calls.push((init?.method ?? 'GET')+' '+path);
        if (path.endsWith('/item/1095')) return Response.json({data:{id:1095,price:5000,stock:10,order_process:'auto'}});
        if (path.endsWith('/balance')) return Response.json({data:{balance:100000}});
        if (path === '/emails') return Response.json({id:'fixture-email'});
        if (path.endsWith('/jaspay/order') && action === 'final') return Response.json({success:false,message:'OUT_OF_STOCK'},{status:409});
        if (path.endsWith('/jaspay/order')) return Response.json({success:true,data:{invoice:'NATIVE',status:'processing',product:'PROD',quantity:1}});
        if (path.endsWith('/order')) return Response.json({success:true,data:{order_id:'NATIVE',status:'processing'}});
        if (path.endsWith('/trx')) return action === 'reject'
          ? Response.json({message:'PRODUCT_TEMPORARILY_UNAVAILABLE'},{status:503})
          : Response.json({data:{invoice:'NATIVE',status:'paid'}});
        if (path.includes('/trx/')) return new Response(null,{status:404});
        throw new Error('unexpected fixture HTTP '+path);
      };
      let result;
      try {
        result = action === 'wr-replay' ? await replayWrFinalSettlement(budget.access)
          : action === 'recover' ? await recoverStaleSkClaims(budget.access)
          : action === 'settle' ? await settleExhaustedSkRetries(budget.access)
          : await (family === 'sk' ? processSkPendingOrders : processWrPendingOrders)(budget.access,{skipOrphanProbe:true,limit:1});
      } catch (error) {
        if (!(error instanceof QueryBudgetExceeded)) throw error;
        result = 'budget-exceeded';
      }
      const beforeTail = budget.remaining;
      budget.beginTail();
      return Response.json({ result, used:budget.used, reserve:budget.remaining-beforeTail, calls });
    }};
  ` }, bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
  plugins: [{ name: "framework-marker", setup(b) {
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "framework" }));
    b.onLoad({ filter: /.*/, namespace: "framework" }, () => ({ contents: "" }));
  } }], define: { "process.env": JSON.stringify({
    WARUNG_REBAHAN_ENABLED: "true", WARUNG_REBAHAN_AUTO_ORDER_ENABLED: "true", WARUNG_REBAHAN_API_KEY: "fixture",
    SEKALIPAY_ENABLED: "true", SEKALIPAY_AUTO_ORDER_ENABLED: "true", SEKALIPAY_API_KEY: "fixture", TELEGRAM_BOT_ENABLED: "false",
    RESEND_API_KEY: "fixture", FORWARD_FROM_EMAIL: "sender@fixture.test",
  }) } });
  const fixture = createD1Fixture();
  let runtime: Miniflare | undefined;
  try {
    runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"],
      script: bundle.outputFiles[0].text, d1Databases: ["DB"] });
    const db = await runtime.getD1Database("DB");
    const schema = fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE (type='table' AND name NOT LIKE 'sqlite_%') OR name IN ('idx_wr_final_settle_pending','idx_wr_aggregate_refresh_pending') ORDER BY type DESC").all() as { sql: string }[];
    await db.batch(schema.map(row => db.prepare(row.sql)));
    await db.batch([
      db.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,fulfillment_status) VALUES('native','Buyer','628','[]',10000,'qris','lunas','paid','queued')"),
      db.prepare("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Product','fixture',10000,10)"),
      db.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,wr_variant_id,sk_variant_id) VALUES(1,1,'N','Item',10000,10,'var-1','1095')"),
      db.prepare("INSERT INTO wr_products(wr_product_id,wr_product_name) VALUES('prod','Product')"),
      db.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_max_quantity) VALUES('var-1','prod','Item',5000,5),('jaspay:PROD:PACK','prod','Jaspay',5000,5)"),
      db.prepare("INSERT INTO wr_order_links(id,order_code,wr_variant_id,quantity,wr_cost,status) VALUES(1,'native','var-1',1,5000,'pending')"),
      db.prepare("INSERT INTO sk_order_links(id,order_code,sk_variant_id,quantity,sk_cost,status,idempotency_key,attempt_count) VALUES(1,'native','1095',1,5000,'pending','sk:native:1095:1',2)"),
      db.prepare("INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,sk_link_id) VALUES('native',0,1,1,1,'manual','web','queued',1)"),
      db.prepare("UPDATE sk_order_links SET fulfillment_item_id=1 WHERE id=1"),
    ]);
    const call = async (family: string, action = "dispatch", limit = 100) => {
      const response = await runtime!.dispatchFetch("https://fixture.test/run", { method: "POST", body: JSON.stringify({ family, action, limit }) });
      expect(response.status).toBe(200);
      return response.json();
    };
    const skCalls = ["GET /api/v1/item/1095", "GET /api/v1/balance", "POST /api/v1/trx"];
    expect(await call("premium", "dispatch", 8)).toMatchObject({ result: { processed: 0 }, used: 1, reserve: 2, calls: [] });
    expect(await call("premium", "dispatch", 9)).toMatchObject({ result: { succeeded: 1 }, used: 6, reserve: 2, calls: ["POST /api/v1/order"] });
    await db.prepare("UPDATE wr_order_links SET status='pending',wr_variant_id='jaspay:PROD:PACK',wr_order_id=NULL,request_sent_at=NULL").run();
    expect(await call("jaspay")).toMatchObject({ result: { succeeded: 1 }, used: 10, reserve: 2, calls: ["POST /api/v1/jaspay/order"] });
    expect(await call("sk", "reject", 16)).toEqual({ result: "budget-exceeded", used: 1, reserve: 2, calls: [] });
    expect(await call("sk", "reject", 17)).toMatchObject({ result: { failed: 1 }, used: 9, reserve: 2, calls: skCalls });
    expect(await db.prepare("SELECT status,last_error,request_sent_at FROM sk_order_links").first()).toEqual({ status: "failed",
      last_error: "PRODUCT_TEMPORARILY_UNAVAILABLE:final_rejection", request_sent_at: null });
    expect(await db.prepare("SELECT status FROM fulfillment_items").first()).toEqual({ status: "failed" });
    expect(await call("sk", "settle", 13)).toEqual({ result: 0, used: 1, reserve: 2, calls: [] });
    await db.prepare("UPDATE sk_order_links SET status='submitted', request_sent_at=datetime('now','-10 minutes'), next_attempt_at=datetime('now','-1 minute')").run();
    expect(await call("sk", "recover")).toEqual({ result: 0, used: 5, reserve: 2,
      calls: [`GET /api/v1/trx/${encodeURIComponent("sk:native:1095:1")}`] });
    expect(await db.prepare("SELECT status,request_sent_at FROM sk_order_links").first()).toEqual({ status: "submitted", request_sent_at: expect.any(String) });
    await db.batch([
      db.prepare("UPDATE orders SET fulfillment_status='queued',customer_email='buyer@fixture.test'"),
      db.prepare("UPDATE fulfillment_items SET status='queued',sk_link_id=NULL,wr_link_id=1,last_error=NULL"),
      db.prepare("UPDATE sk_order_links SET fulfillment_item_id=NULL"),
      db.prepare("UPDATE wr_order_links SET status='pending',attempt_count=2,wr_order_id=NULL,request_sent_at=NULL,fulfillment_item_id=1"),
      db.prepare("UPDATE product_variants SET wr_variant_id='jaspay:PROD:PACK'"),
      db.prepare(`CREATE TRIGGER interrupt_ack BEFORE UPDATE OF wr_final_settle_token ON wr_order_links
        WHEN OLD.wr_final_settle_token IS NOT NULL AND NEW.wr_final_settle_token IS NULL
        BEGIN SELECT RAISE(ABORT,'native fixture interruption'); END`),
    ]);
    expect(await call("jaspay", "final", 28)).toMatchObject({ result: { processed: 0, finalDeferred: true }, used: 1, reserve: 2, calls: [] });
    // The real D1 batch rolls the order handoff back when the link ACK fails.
    const interrupted = await runtime.dispatchFetch("https://fixture.test/run", { method: "POST", body: JSON.stringify({ family: "jaspay", action: "final", limit: 29 }) });
    expect(interrupted.status).toBe(500);
    expect(await db.prepare("SELECT status,last_error FROM fulfillment_items").first()).toMatchObject({ status: "failed", last_error: expect.stringMatching(/^wr_final:1:/) });
    expect(await db.prepare("SELECT wr_aggregate_refresh_token FROM orders").first()).toEqual({ wr_aggregate_refresh_token: null });
    expect(await db.prepare("SELECT status,wr_final_settle_token FROM wr_order_links").first()).toMatchObject({ status: "failed", wr_final_settle_token: expect.any(String) });
    await db.prepare("DROP TRIGGER interrupt_ack").run();
    expect(await call("jaspay", "wr-replay", 24)).toMatchObject({ result: { settled: 2 }, used: 15, reserve: 2, calls: ["POST /emails"] });
    expect(await call("jaspay", "wr-replay", 24)).toMatchObject({ result: { settled: 0 }, used: 4, reserve: 2, calls: [] });
    expect(await db.prepare("SELECT fulfillment_status,wr_aggregate_refresh_token FROM orders").first()).toEqual({ fulfillment_status: "failed", wr_aggregate_refresh_token: null });
  } finally {
    try { await runtime?.dispose(); } finally { fixture.close(); }
  }
}, 30_000);
