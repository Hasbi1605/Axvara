import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { gatewayHmac, signGatewayRequest } from "@/lib/payments/sekalipay-gateway";

it("executes merchant callback, signed GET and atomic paid guard in workerd", async () => {
  const root = process.cwd();
  const compiled = await build({
    stdin: { contents: `import {POST} from './src/app/api/payments/sekalipay-gateway/callback/route'; import {reconcileSekalipayGatewayPayment} from './src/lib/payments/sekalipay-gateway'; import {claimSekalipayGatewayPoll} from './src/lib/payments/payment-view'; import {transitionPendingOrder} from './src/lib/db/orders-transition'; import {createBudgetedDatabase} from './src/lib/db-access'; export default {async fetch(req,env){globalThis.fixtureDb=env.DB;const u=new URL(req.url),c=u.searchParams.get('code');if(u.pathname==='/budget'){const r=await Promise.allSettled(Array.from({length:25},()=>reconcileSekalipayGatewayPayment(c)));return Response.json({success:r.filter(x=>x.status==='fulfilled').length});}if(u.pathname==='/claims'){const r=await Promise.all(Array.from({length:25},()=>claimSekalipayGatewayPoll(c)));return Response.json({success:r.filter(Boolean).length});}if(u.pathname==='/expire'){const b=createBudgetedDatabase(40,0,env.DB);try{await transitionPendingOrder(c,'kadaluarsa','gateway_expired',[{product_id:1,variant_id:1,qty:1}],b.access.d1);return Response.json({used:b.used});}catch{return Response.json({failed:true,used:b.used})}}if(u.pathname==='/late'){const b=createBudgetedDatabase(40,0,env.DB);return Response.json({state:await reconcileSekalipayGatewayPayment(c,b.access),used:b.used});}return POST(req)}}`, resolveDir: root, loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    define: { "process.env": JSON.stringify({ SEKALIPAY_GATEWAY_API_KEY: "fixture-key", SEKALIPAY_GATEWAY_SECRET_KEY: "fixture-secret", SEKALIPAY_GATEWAY_ENABLED: "false" }) },
    plugins: [{ name: "boundaries", setup(builder) {
      builder.onResolve({ filter: /^next\/server$|^@\/lib\/db$|^@\/lib\/site$|^@\/lib\/payments\/dana-history$|^@\/lib\/orders\/cost-snapshot$|^\.\/client$|^\.\/nowpayments$|^\.\/paid-fulfillment$/ }, (args) => {
        if (args.path === "./nowpayments" && !args.importer.endsWith("payment-view.ts")) return null;
        if (args.path === "./client" && !args.importer.endsWith("orders-transition.ts")) return null;
        return { path: args.path, namespace: "fixture" };
      });
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => {
        if (args.path === "next/server") return { contents: `export const NextResponse={json:(data,init)=>Response.json(data,init)};` };
        if (args.path === "./paid-fulfillment") return { contents: `export const schedulePaidFulfillment=async(code,kind)=>{await globalThis.fixtureDb.prepare("INSERT INTO store_settings(key,value) VALUES('scheduled:'||?,?) ON CONFLICT(key) DO UPDATE SET value=value||'+dup'").bind(code,kind).run()};` };
        if (args.path === "./nowpayments") return { contents: `export const claimNowpaymentsPollReconcile=()=>false;export const reconcileNowpaymentsPayment=()=>null;` };
        if (args.path === "@/lib/site") return { contents: `export const SITE={webUrl:'https://axvara.tech'};` };
        if (args.path === "@/lib/payments/dana-history") return { contents: `export const DANA_AMOUNT_REUSED_SQL='0';` };
        if (args.path === "@/lib/orders/cost-snapshot") return { contents: `export const PAID_ORDER_COST_SNAPSHOT_SQL='SELECT ?';` };
        const client = `export const getD1=()=>globalThis.fixtureDb;export const getOrderMem=()=>[];export const getSharedMem=()=>({});export const queryFirst=(sql,...p)=>getD1().prepare(sql).bind(...p).first();export const queryAll=async(sql,...p)=>(await getD1().prepare(sql).bind(...p).all()).results;export const execRun=async(sql,...p)=>({changes:(await getD1().prepare(sql).bind(...p).run()).meta.changes});`;
        return { contents: args.path === "@/lib/db" ? `${client}export {transitionPendingPaymentToPaid} from '${root}/src/lib/db/orders-transition.ts';` : client, resolveDir: root };
      });
    } }],
  });
  const code = "AXV-20261104-WORKER01";
  const paidAt = new Date().toISOString();
  const deadline = new Date(Date.now() + 600000).toISOString();
  let calls = 0, pending = false;
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"], script: compiled.outputFiles[0].text, d1Databases: ["DB"],
    outboundService: async (request: Request) => {
      calls++;
      const ref = request.url.split("/").at(-1)!;
      expect(request.headers.get("x-signature")).toBe(await signGatewayRequest("fixture-secret", "GET", `api/v1/gateway/payment/${ref}`, {}, Number(request.headers.get("x-timestamp"))));
      return Response.json({ status: true, data: { merchant_ref_id: ref, invoice: ref.startsWith("AXG-") ? "SPYgame" : ref === code ? "SPYworker" : "SPYlate", payment_code: "TESTVA", amount: 10000, fee: 4700, total: 14700, status: pending ? "pending" : "paid", paid_at: paidAt } });
    },
  });
  try {
    const db = await runtime.getD1Database("DB");
    await db.batch([
      db.prepare("CREATE TABLE orders(code TEXT PRIMARY KEY,status TEXT,payment_status TEXT,expires_at TEXT,payment_method TEXT,subtotal INTEGER,variant_id INTEGER,sales_channel TEXT,order_kind TEXT,paid_at TEXT,updated_at TEXT,items TEXT,admin_note TEXT,fulfillment_status TEXT)"),
      db.prepare("CREATE TABLE payment_transactions(order_code TEXT PRIMARY KEY,provider TEXT,provider_order_id TEXT,provider_payment_id TEXT,requested_amount INTEGER,payable_amount INTEGER,gateway_fee INTEGER,gateway_estimated_fee INTEGER,gateway_channel TEXT,gateway_is_sandbox INTEGER,gateway_fee_consented_at TEXT,status TEXT,expires_at TEXT,last_error TEXT,last_checked_at TEXT,paid_at TEXT,updated_at TEXT)"),
      db.prepare("CREATE TABLE dana_webhook_events(id INTEGER PRIMARY KEY,event_key TEXT UNIQUE,payload_hash TEXT,amount INTEGER,raw_text TEXT,provider TEXT,status TEXT,order_code TEXT,last_error TEXT,processed_at TEXT,reviewed_by TEXT,review_note TEXT)"),
      db.prepare("CREATE TABLE operation_guards(operation_id TEXT PRIMARY KEY,valid INTEGER CHECK(valid=1))"),
      db.prepare("CREATE TABLE store_settings(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)"),
      db.prepare("CREATE TABLE fulfillment_inventory(order_code TEXT,status TEXT,reserved_at TEXT)"),
      db.prepare("CREATE TABLE product_variants(id INTEGER PRIMARY KEY,stock INTEGER,updated_at TEXT)"),
      db.prepare("INSERT INTO product_variants VALUES(1,0,NULL)"),
      db.prepare("CREATE TABLE fulfillment_jobs(order_code TEXT UNIQUE,variant_id INTEGER,inventory_id INTEGER,sales_channel TEXT,status TEXT,attempt_count INTEGER,next_attempt_at TEXT)"),
      db.prepare("INSERT INTO orders(code,status,payment_status,expires_at,payment_method,subtotal,variant_id,sales_channel,order_kind,items) VALUES(?,'pending','unpaid',?,'sekalipay_gateway:TESTVA',10000,1,'web','apps','[]')").bind(code, deadline),
      db.prepare("INSERT INTO payment_transactions VALUES(?,'sekalipay_gateway',?,'SPYworker',10000,14700,4700,4700,'TESTVA',0,?,'pending',?,NULL,NULL,NULL,NULL)").bind(code, code, paidAt, deadline),
    ]);
    pending = true;
    const budget = await (await runtime.dispatchFetch(`https://axvara.test/budget?code=${code}`)).json() as { success: number };
    expect(budget.success).toBe(20); expect(calls).toBe(20);
    expect((await db.prepare("SELECT COUNT(*) n FROM store_settings WHERE key='sekalipay_gateway_status_budget'").first())?.n).toBe(1);
    await db.prepare("UPDATE payment_transactions SET last_checked_at=NULL WHERE order_code=?").bind(code).run();
    expect(await (await runtime.dispatchFetch(`https://axvara.test/claims?code=${code}`)).json()).toEqual({ success: 1 });
    await db.prepare("DELETE FROM store_settings WHERE key='sekalipay_gateway_status_budget'").run();
    pending = false; calls = 0;
    const raw = JSON.stringify({ merchant_ref_id: code, invoice: "SPYworker", amount: 10000, fee: 4700, total: 14700, status: "paid", paid_at: "2026-11-04 09:00:00" });
    const signature = await gatewayHmac("fixture-secret", raw);
    const request = () => runtime.dispatchFetch("https://axvara.test/callback", { method: "POST", headers: { "content-type": "application/json", "x-signature": signature }, body: raw });
    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(200);
    expect((await db.prepare("SELECT payment_status FROM orders WHERE code=?").bind(code).first())?.payment_status).toBe("paid");
    expect((await db.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").first())?.n).toBe(1);
    expect(calls).toBe(1);
    const late = "AXV-20261104-WORKER02";
    await db.batch([
      db.prepare("INSERT INTO orders(code,status,payment_status,expires_at,payment_method,subtotal,variant_id,sales_channel,order_kind,items) VALUES(?,'pending','unpaid',datetime('now','-1 minute'),'sekalipay_gateway:TESTVA',10000,1,'web','apps','[]')").bind(late),
      db.prepare("INSERT INTO payment_transactions VALUES(?,'sekalipay_gateway',?,'SPYlate',10000,14700,4700,4700,'TESTVA',0,?,'pending',?,NULL,NULL,NULL,NULL)").bind(late, late, paidAt, deadline),
    ]);
    const expired = await (await runtime.dispatchFetch(`https://axvara.test/expire?code=${late}`)).json() as { used: number };
    expect(expired.used).toBeGreaterThan(0); expect(expired.used).toBeLessThanOrEqual(40);
    expect(await (await runtime.dispatchFetch(`https://axvara.test/expire?code=${late}`)).json()).toMatchObject({ failed: true });
    expect((await db.prepare("SELECT stock FROM product_variants WHERE id=1").first())?.stock).toBe(1);
    const checked = await (await runtime.dispatchFetch(`https://axvara.test/late?code=${late}`)).json() as { state: string; used: number };
    expect(checked.state).toBe("manual_review"); expect(checked.used).toBeLessThanOrEqual(40);
    expect((await db.prepare("SELECT status FROM orders WHERE code=?").bind(late).first())?.status).toBe("kadaluarsa");
    expect((await db.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?").bind(late).first())?.n).toBe(0);
    expect((await db.prepare("SELECT stock FROM product_variants WHERE id=1").first())?.stock).toBe(1);
    const budgetPaid = "AXV-20261104-WORKER03";
    await db.batch([
      db.prepare("INSERT INTO orders(code,status,payment_status,expires_at,payment_method,subtotal,variant_id,sales_channel,order_kind,items) VALUES(?,'pending','unpaid',?,'sekalipay_gateway:TESTVA',10000,1,'web','apps','[]')").bind(budgetPaid, deadline),
      db.prepare("INSERT INTO payment_transactions VALUES(?,'sekalipay_gateway',?,'SPYlate',10000,14700,4700,4700,'TESTVA',0,?,'pending',?,NULL,NULL,NULL,NULL)").bind(budgetPaid, budgetPaid, paidAt, deadline),
      db.prepare("DELETE FROM dana_webhook_events WHERE event_key='sekalipaygw:SPYlate:paid'"),
    ]);
    const settled = await (await runtime.dispatchFetch(`https://axvara.test/late?code=${budgetPaid}`)).json() as { state: string; used: number };
    expect(settled.state).toBe("paid"); expect(settled.used).toBeGreaterThanOrEqual(13); expect(settled.used).toBeLessThanOrEqual(40);
    expect((await db.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?").bind(budgetPaid).first())?.n).toBe(1);
    const game = "AXG-20261109-WORKER01";
    await db.batch([
      db.prepare("INSERT INTO orders(code,status,payment_status,expires_at,payment_method,subtotal,sales_channel,order_kind,items) VALUES(?,'pending','unpaid',?,'sekalipay_gateway:TESTVA',10000,'web','games','[]')").bind(game, deadline),
      db.prepare("INSERT INTO payment_transactions VALUES(?,'sekalipay_gateway',?,'SPYgame',10000,14700,4700,4700,'TESTVA',0,?,'pending',?,NULL,NULL,NULL,NULL)").bind(game, game, paidAt, deadline),
    ]);
    const gameRaw = JSON.stringify({ merchant_ref_id: game, invoice: "SPYgame", amount: 10000, fee: 4700, total: 14700, status: "paid", paid_at: "2026-11-09 09:00:00" });
    const gameSig = await gatewayHmac("fixture-secret", gameRaw);
    for (let n = 0; n < 2; n++) {
      expect((await runtime.dispatchFetch("https://axvara.test/callback", { method: "POST", body: gameRaw,
        headers: { "content-type": "application/json", "x-signature": gameSig } })).status).toBe(200);
    }
    expect((await db.prepare("SELECT payment_status FROM orders WHERE code=?").bind(game).first())?.payment_status).toBe("paid");
    // Scheduled exactly once per paid order (winner only), now for every order_kind incl. apps.
    expect((await db.prepare("SELECT value FROM store_settings WHERE key=?").bind(`scheduled:${game}`).first())?.value).toBe("games");
    expect((await db.prepare("SELECT COUNT(*) n FROM store_settings WHERE key LIKE 'scheduled:%' AND value LIKE '%+dup%'").first())?.n).toBe(0);
    expect((await db.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?").bind(game).first())?.n).toBe(0);
  } finally { await runtime.dispose(); }
});
