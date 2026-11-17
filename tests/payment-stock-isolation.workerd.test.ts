import { expect, it } from "vitest";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

it("native D1 expiry/stale batches isolate non-Market IDs and preserve apps/legacy restock", async () => {
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
      import {transitionPendingPaymentOrder,incrementSoldCountForOrder} from './src/lib/db/orders-transition';
      export default {async fetch(request,env){
        const db=env.DB, results=[];
        for (const kind of ['apps',null,'pedia','games']) for (const tx of ['pending','initializing']) {
          const code=String(kind)+'-'+tx, items=[{product_id:1,qty:2},{product_id:1,variant_id:1,qty:2}];
          await db.batch([
            db.prepare('UPDATE products SET stock=50,sold_count=0'),
            db.prepare('UPDATE product_variants SET stock=50'),
            db.prepare("INSERT INTO orders(code,items,order_kind,status,payment_status,expires_at) VALUES(?,?,?,'pending','pending',datetime('now','-1 minute'))").bind(code,JSON.stringify(items),kind),
            db.prepare("INSERT INTO payment_transactions(order_code,provider,status,expires_at) VALUES(?,'gopay',?,datetime('now','-1 minute'))").bind(code,tx)
          ]);
          const input={orderCode:code,expectedTransactionStatus:tx,transactionStatus:tx==='pending'?'expired':'failed',orderStatus:tx==='pending'?'kadaluarsa':'dibatalkan',paymentStatus:tx==='pending'?'expired':'failed',items,expiredOnly:tx==='pending'};
          const changed=await transitionPendingPaymentOrder(input,db);
          const duplicate=await transitionPendingPaymentOrder(input,db);
          const beforeSold=await db.prepare('SELECT stock,sold_count FROM products').first();
          await incrementSoldCountForOrder(code,db);
          results.push({kind,tx,changed,duplicate,beforeSold,product:await db.prepare('SELECT stock,sold_count FROM products').first(),variant:await db.prepare('SELECT stock FROM product_variants').first(),order:await db.prepare('SELECT status,payment_status FROM orders WHERE code=?').bind(code).first()});
        }
        return Response.json(results);
      }}
    ` },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    define: { "process.env": "{}" },
    plugins: [{ name: "server-only", setup(b) {
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "" }));
    } }],
  });
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"], script: compiled.outputFiles[0].text, d1Databases: ["DB"] });
  try {
    const db = await runtime.getD1Database("DB");
    const schema = readFileSync("drizzle/schema.sql", "utf8");
    await db.batch([
      db.prepare("CREATE TABLE orders(code TEXT PRIMARY KEY,items TEXT,order_kind TEXT,status TEXT,payment_status TEXT,expires_at TEXT,fulfillment_status TEXT,updated_at TEXT)"),
      db.prepare("CREATE TABLE products(id INTEGER PRIMARY KEY,stock INTEGER,sold_count INTEGER)"),
      db.prepare("CREATE TABLE product_variants(id INTEGER PRIMARY KEY,stock INTEGER,updated_at TEXT)"),
      db.prepare("CREATE TABLE fulfillment_inventory(order_code TEXT,status TEXT,reserved_at TEXT)"),
      db.prepare("CREATE TABLE payment_transactions(order_code TEXT,provider TEXT,status TEXT,expires_at TEXT,last_error TEXT,updated_at TEXT)"),
      db.prepare(schema.match(/CREATE TABLE IF NOT EXISTS operation_guards \([\s\S]+?\n\);/)![0]),
      db.prepare("INSERT INTO products VALUES(1,50,0)"),
      db.prepare("INSERT INTO product_variants(id,stock) VALUES(1,50)"),
    ]);
    const response = await runtime.dispatchFetch("https://fixture.test");
    expect(response.status).toBe(200);
    const rows = await response.json() as { kind: string | null; tx: string }[];
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      const market = row.kind === "apps" || row.kind === null;
      expect(row).toMatchObject({
        changed: true, duplicate: false,
        beforeSold: { stock: market ? 52 : 50, sold_count: 0 },
        product: { stock: market ? 52 : 50, sold_count: market ? 4 : 0 },
        variant: { stock: market ? 52 : 50 },
        order: row.tx === "pending" ? { status: "kadaluarsa", payment_status: "expired" } : { status: "dibatalkan", payment_status: "failed" },
      });
    }
  } finally { await runtime.dispose(); }
}, 30_000);
