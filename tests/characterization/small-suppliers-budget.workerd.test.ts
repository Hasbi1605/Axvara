import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const SCHEMA = [
  `CREATE TABLE products (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, price INTEGER DEFAULT 0, stock INTEGER DEFAULT 0,
     source TEXT NOT NULL DEFAULT 'manual', is_active INTEGER NOT NULL DEFAULT 1, archived_at TEXT,
     aivault_family TEXT, tunvn_family TEXT, storebat_family TEXT, mirai_family TEXT,
     wr_product_id TEXT, sk_product_id TEXT, wr_auto_managed INTEGER NOT NULL DEFAULT 0, sk_auto_managed INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE product_variants (id INTEGER PRIMARY KEY, product_id INTEGER, sku TEXT, label TEXT, price INTEGER DEFAULT 0,
     stock INTEGER DEFAULT 0, fulfillment_mode TEXT NOT NULL DEFAULT 'manual', is_active INTEGER NOT NULL DEFAULT 1,
     aivault_service_id TEXT, wr_variant_id TEXT, sk_variant_id TEXT, tunvn_source_product_id INTEGER,
     tunvn_buff_quantity_b INTEGER, storebat_product_id INTEGER, mirai_package_code TEXT)`,
  `CREATE TABLE aivault_products (service_id TEXT PRIMARY KEY, name TEXT, stock INTEGER DEFAULT 0, unit_price_usd REAL,
     pricing_tiers_json TEXT, custom_pricing INTEGER DEFAULT 0, markup_percent REAL DEFAULT 35, axvara_product_id INTEGER,
     sell_price_idr INTEGER, fx_idr_per_usd REAL, bulk_markup_tiers_json TEXT, synced_at TEXT, updated_at TEXT)`,
  `CREATE TABLE crypto_market_snapshot (id INTEGER PRIMARY KEY, fx_rate_text TEXT)`,
  `CREATE TABLE tunvn_order_links (id INTEGER PRIMARY KEY, order_code TEXT, item_index INTEGER)`,
  `CREATE TABLE storebat_order_links (id INTEGER PRIMARY KEY, order_code TEXT, item_index INTEGER)`,
  `CREATE TABLE mirai_order_links (id INTEGER PRIMARY KEY, order_code TEXT, item_index INTEGER)`,
  `CREATE TABLE orders (id INTEGER PRIMARY KEY, code TEXT UNIQUE, customer_name TEXT, customer_wa TEXT, customer_email TEXT,
     items TEXT, subtotal INTEGER, payment_method TEXT, status TEXT DEFAULT 'pending', payment_status TEXT DEFAULT 'pending',
     sales_channel TEXT NOT NULL DEFAULT 'web', order_kind TEXT DEFAULT 'apps', supplier_purchase_disabled INTEGER NOT NULL DEFAULT 0,
     locale TEXT, variant_snapshot TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT, fulfillment_status TEXT)`,
  `CREATE TABLE aivault_order_links (
     id INTEGER PRIMARY KEY AUTOINCREMENT, order_code TEXT NOT NULL, item_index INTEGER NOT NULL,
     variant_id INTEGER NOT NULL, product_id INTEGER NOT NULL, service_id TEXT NOT NULL,
     quantity INTEGER NOT NULL, cost_usd REAL NOT NULL, fx_idr_per_usd REAL, external_order_id TEXT NOT NULL UNIQUE,
     provider_order_id TEXT, status TEXT NOT NULL DEFAULT 'pending', attempt_count INTEGER NOT NULL DEFAULT 0,
     next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')), lease_owner TEXT, lease_expires_at TEXT, request_sent_at TEXT,
     preflight_attempts INTEGER NOT NULL DEFAULT 0,
     receipt_ciphertext TEXT, receipt_iv TEXT, receipt_http_status INTEGER, receipt_json TEXT, last_error TEXT,
     completed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE(order_code,item_index))`,
  `CREATE TABLE fulfillment_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_code TEXT NOT NULL, item_index INTEGER NOT NULL,
     product_id INTEGER NOT NULL, variant_id INTEGER, qty INTEGER NOT NULL DEFAULT 1,
     fulfillment_mode TEXT NOT NULL DEFAULT 'manual', inventory_id INTEGER, recipient_channel TEXT NOT NULL DEFAULT 'telegram',
     recipient_target TEXT, status TEXT NOT NULL DEFAULT 'queued', attempt_count INTEGER NOT NULL DEFAULT 0,
     next_attempt_at TEXT, locked_until TEXT, delivered_message_id TEXT, last_error TEXT,
     wr_link_id INTEGER, sk_link_id INTEGER, tunvn_link_id INTEGER, aivault_link_id INTEGER,
     storebat_link_id INTEGER, mirai_link_id INTEGER, delivered_ciphertext TEXT, delivered_iv TEXT)`,
  `CREATE TABLE fulfillment_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, order_code TEXT UNIQUE, variant_id INTEGER,
     inventory_id INTEGER, sales_channel TEXT, status TEXT NOT NULL DEFAULT 'queued', attempt_count INTEGER NOT NULL DEFAULT 0,
     next_attempt_at TEXT, locked_until TEXT, telegram_message_id TEXT, last_error TEXT, item_cursor INTEGER,
     created_at TEXT, updated_at TEXT)`,
];

it("workerd native D1 pins the AIVault success statement total and blocks a second dispatch", async () => {
  const code = "AXV-WORKER-AV";
  const serviceId = "service_worker";
  const compiled = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "ts",
      contents: `
        import {processAivaultOrders} from './src/lib/aivault/orders';
        import {createBudgetedDatabase} from './src/lib/db-access';
        export default {async fetch(req,env){
          const body=await req.json();
          let purchases=0;
          globalThis.fetch=async(url,init)=>{
            const path=new URL(url).pathname;
            if(path.endsWith('/quote')) return Response.json({service_id:'${serviceId}',quantity:1,currency:'USD',stock:10,sufficient_balance:true,pricing:{unit_price:0.5,final_total:0.5}});
            if(init?.method==='POST' && path.endsWith('/order')){
              purchases++;
              const sent=JSON.parse(init.body);
              return Response.json({success:true,order_id:'AV-WORKER-1',external_order_id:sent.external_order_id,service_id:'${serviceId}',quantity:1,total_cost:0.5,currency:'USD',status:'delivered',products:['worker-credential']},{status:201});
            }
            throw new Error('unexpected fixture HTTP '+path);
          };
          const b=createBudgetedDatabase(40,2,env.DB);
          const processed=await processAivaultOrders(b.access,{orderCode:body.code});
          return Response.json({purchases,processed,used:b.used});
        }}
      `,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    plugins: [
      {
        name: "framework-marker",
        setup(b) {
          b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "framework" }));
          b.onLoad({ filter: /.*/, namespace: "framework" }, () => ({ contents: "" }));
        },
      },
    ],
    define: {
      "process.env": JSON.stringify({
        AIVAULT_ENABLED: "true",
        AIVAULT_SYNC_ENABLED: "true",
        AIVAULT_API_KEY: "fixture-key",
        AIVAULT_BASE_URL: "https://aivault.test",
        TELEGRAM_BOT_ENABLED: "false",
        FULFILLMENT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      }),
    },
  });
  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: "2026-08-06",
    compatibilityFlags: ["nodejs_compat"],
    script: compiled.outputFiles[0].text,
    d1Databases: ["DB"],
  });
  try {
    const db = await runtime.getD1Database("DB");
    await db.batch(SCHEMA.map((statement) => db.prepare(statement)));
    await db.batch([
      db.prepare(
        "INSERT INTO products(id,slug,name,price,stock,source,is_active,aivault_family) VALUES(1,'gemini-workerd','Gemini',13500,10,'manual',1,'gemini-workerd')",
      ),
      db.prepare(
        `INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,aivault_service_id)
         VALUES(1,1,'AV-${serviceId}','6 Bulan',13500,10,'manual',1,'${serviceId}')`,
      ),
      db.prepare(
        `INSERT INTO aivault_products(service_id,name,stock,unit_price_usd,pricing_tiers_json,fx_idr_per_usd)
         VALUES('${serviceId}','Gemini',10,0.5,'[]',20000)`,
      ),
      db.prepare(
        `INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,order_kind,supplier_purchase_disabled)
         VALUES(?,'Buyer','628','[]',13500,'qris','lunas','paid','web','apps',0)`,
      ).bind(code),
    ]);
    const items = JSON.stringify([
      {
        product_id: 1,
        variant_id: 1,
        name: "Gemini",
        price: 13500,
        qty: 1,
        aivault_eligibility: { version: 1, service_id: serviceId, source_variant_id: 1, quantity: 1, cost_usd: 0.5 },
      },
    ]);
    await db.prepare("UPDATE orders SET items=? WHERE code=?").bind(items, code).run();

    const call = async () => {
      const response = await runtime.dispatchFetch("https://fixture.test/dispatch", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      const text = await response.text();
      expect(response.status, text).toBe(200);
      return JSON.parse(text) as { purchases: number; processed: number; used: number };
    };

    const first = await call();
    expect(first.purchases).toBe(1);
    expect(first.processed).toBe(1);
    expect(first.used).toBe(21);
    const link = await db.prepare("SELECT status,attempt_count,provider_order_id FROM aivault_order_links WHERE order_code=?").bind(code).first();
    expect(link).toMatchObject({ status: "completed", attempt_count: 1, provider_order_id: "AV-WORKER-1" });
    const item = await db.prepare("SELECT status,delivered_ciphertext FROM fulfillment_items WHERE order_code=?").bind(code).first();
    expect(item).toMatchObject({ status: "queued" });
    expect(item?.delivered_ciphertext).toBeTruthy();

    const second = await call();
    expect(second.purchases).toBe(0);
    expect(second.processed).toBe(0);
    expect(second.used).toBe(3);
  } finally {
    await runtime.dispose();
  }
}, 30000);
