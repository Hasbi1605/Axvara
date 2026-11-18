import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

it("native workerd D1 batches catalog families, fences concurrent dispatch, and replays via GET->POST", async () => {
  const compiled = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "ts",
      contents: `
        import { publishMiraiCatalog } from './src/lib/mirai/catalog';
        import { processMiraiOrders } from './src/lib/mirai/orders';
        import { createBudgetedDatabase } from './src/lib/db-access';
        export default {
          async fetch(req, env) {
            const body = await req.json();
            const posts = [];
            const gets = [];
            globalThis.fetch = async (url, init) => {
              const path = new URL(url).pathname;
              if (path.endsWith('/packages')) {
                return Response.json({
                  success: true,
                  data: [{
                    code: 'GPT_10M', group: 'gpt', name: 'GPT 10M tokens · 1D',
                    quota_tokens: 10000000, duration_seconds: 86400,
                    reseller_price_vnd: 6650, retail_price_vnd: 7000, discount_bps: 500,
                    min_quantity: 1, max_quantity: 10000, preset_quantities: [1, 2],
                    models: ['gpt-5.6-luna'], unlimited: true, remaining_today: 0, custom_quantity: true
                  }]
                });
              }
              if (path.endsWith('/balance')) {
                return Response.json({ success: true, data: { balance_vnd: 1000000, tier: 'Silver', discount_bps: 500 } });
              }
              if (init?.method === 'GET' && path.includes('/orders/')) {
                gets.push(path);
                return Response.json({ success: false, message: 'not found' }, { status: 404 });
              }
              if (init?.method === 'POST' && path.endsWith('/orders')) {
                const input = JSON.parse(init.body);
                posts.push(input.external_order_id);
                if (body.timeout) throw Error('timeout');
                return Response.json({
                  success: true,
                  data: {
                    order_code: 'MO-WK-1',
                    external_order_id: input.external_order_id,
                    package_code: input.package_code,
                    quantity: input.quantity,
                    redeem_codes: ['MR-NATIVE-1'],
                    status: 'fulfilled'
                  }
                });
              }
              throw Error('unexpected fixture transport: ' + path);
            };
            const budgets = [];
            const results = await Promise.all(
              Array.from({ length: body.catalog ? 1 : 3 }, async () => {
                const b = createBudgetedDatabase(40, 2, env.DB);
                budgets.push(b);
                return body.catalog
                  ? publishMiraiCatalog(b.access, 16000, { force: true })
                  : processMiraiOrders(b.access, { orderCode: 'NATIVE-MR' });
              })
            );
            return Response.json({ results, posts, gets, used: budgets.map(b => b.used) });
          }
        };
      `,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    plugins: [
      {
        name: "marker",
        setup(b) {
          b.onResolve({ filter: /^server-only$/ }, () => ({ path: "marker", namespace: "empty" }));
          b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "" }));
        },
      },
    ],
    define: {
      "process.env": JSON.stringify({
        MIRAI_ENABLED: "true",
        MIRAI_SYNC_ENABLED: "true",
        MIRAI_API_KEY: "fixture",
        MIRAI_BASE_URL: "https://mirai.test/api/reseller/v1",
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
  const fixture = createD1Fixture();
  try {
    const db = await runtime.getD1Database("DB");
    const tables = fixture.sql
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('categories','products','product_variants','store_settings','mirai_packages')")
      .all() as { sql: string }[];
    await db.batch(tables.map((t) => db.prepare(t.sql)));
    await db.prepare("CREATE TABLE crypto_market_snapshot(id INTEGER PRIMARY KEY, fx_rate_text TEXT)").run();
    await db.prepare("INSERT INTO categories(id,name,slug) VALUES(1,'AI','ai-chatbot')").run();

    const call = async (body: Record<string, unknown>) => {
      const response = await runtime.dispatchFetch("https://fixture.test", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const r = (await response.json()) as { posts: string[]; gets: string[]; used: number[]; results: unknown[] };
      expect(r.used.every((n) => n <= 38)).toBe(true);
      return r;
    };

    expect((await call({ catalog: true })).results).toMatchObject([{ ok: true }]);
    expect(await db.prepare("SELECT is_active,price,stock FROM product_variants").first()).toMatchObject({
      is_active: 0,
      price: 5600,
      stock: -1,
    });

    await db.batch([
      db.prepare(
        "CREATE TABLE orders(id INTEGER PRIMARY KEY,code TEXT UNIQUE,items TEXT,status TEXT DEFAULT 'lunas',payment_status TEXT DEFAULT 'paid',sales_channel TEXT DEFAULT 'web',order_kind TEXT DEFAULT 'apps',supplier_purchase_disabled INTEGER DEFAULT 0)",
      ),
      db.prepare(
        "CREATE TABLE fulfillment_items(id INTEGER PRIMARY KEY,order_code TEXT,item_index INTEGER,product_id INTEGER,variant_id INTEGER,qty INTEGER DEFAULT 1,fulfillment_mode TEXT DEFAULT 'manual',status TEXT DEFAULT 'queued',wr_link_id INTEGER,sk_link_id INTEGER,tunvn_link_id INTEGER,aivault_link_id INTEGER,storebat_link_id INTEGER,inventory_id INTEGER,mirai_link_id INTEGER,delivered_ciphertext TEXT,delivered_iv TEXT,last_error TEXT,locked_until TEXT)",
      ),
      db.prepare(
        "CREATE TABLE fulfillment_jobs(order_code TEXT,status TEXT,attempt_count INTEGER,next_attempt_at TEXT,locked_until TEXT)",
      ),
      db.prepare(
        String(
          (fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE name='mirai_order_links'").get() as { sql: string })
            .sql,
        ),
      ),
      db.prepare("UPDATE products SET is_active=1"),
      db.prepare("UPDATE product_variants SET is_active=1"),
    ]);

    const p = (await db.prepare("SELECT id FROM products").first()) as { id: number };
    const v = (await db.prepare("SELECT id FROM product_variants").first()) as { id: number };
    const orderItem = {
      product_id: p.id,
      variant_id: v.id,
      qty: 1,
      mirai_eligibility: {
        version: 1,
        package_code: "GPT_10M",
        mirai_family: "gpt",
        sku: "MR-GPT_10M",
        source_variant_id: v.id,
        quantity: 1,
        cost_usdt: 0.255769,
      },
    };
    await db.prepare("INSERT INTO orders(id,code,items) VALUES(1,'NATIVE-MR',?)").bind(JSON.stringify([orderItem])).run();
    await db.prepare("INSERT INTO fulfillment_items(id,order_code,item_index,product_id,variant_id) VALUES(1,'NATIVE-MR',0,?,?)").bind(p.id, v.id).run();

    expect((await call({ timeout: true })).posts).toEqual(["NATIVE-MR-0"]);
    expect(await db.prepare("SELECT status,attempt_count FROM mirai_order_links").first()).toMatchObject({
      status: "pending",
      attempt_count: 1,
    });
    await db.prepare("UPDATE mirai_order_links SET next_attempt_at=datetime('now','-1 minute')").run();

    const recovery = await call({});
    expect(recovery.gets).toEqual(["/api/reseller/v1/orders/NATIVE-MR-0"]);
    expect(recovery.posts).toEqual(["NATIVE-MR-0"]);

    const savedLink = await db
      .prepare("SELECT status,attempt_count,receipt_ciphertext,provider_order_code FROM mirai_order_links")
      .first();
    expect(savedLink).toMatchObject({ status: "completed", attempt_count: 2, provider_order_code: "MO-WK-1" });
    expect(JSON.stringify(savedLink)).not.toContain("MR-NATIVE-1");
  } finally {
    fixture.close();
    await runtime.dispose();
  }
}, 30000);

it("0140 applies locally after existing schema without altering products or historical orders", async () => {
  const { createRequire } = await import("node:module");
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
  const db = new DatabaseSync(":memory:");
  try {
    const schemaSql = readFileSync("drizzle/schema.sql", "utf8");
    const migrationSql = readFileSync("drizzle/migrations/0140_mirai_supplier.sql", "utf8");
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    expect(norm(schemaSql)).toContain(norm(migrationSql));
    db.exec(schemaSql.split("-- MiraiAPI is a separate, opt-in supplier.")[0]);
    db.exec("INSERT INTO products(name,slug,price,is_active) VALUES('Owner copy','owner',100,1)");
    db.exec(migrationSql);
    expect(db.prepare("SELECT name,is_active,mirai_family FROM products WHERE slug='owner'").get()).toMatchObject({
      name: "Owner copy",
      is_active: 1,
      mirai_family: null,
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
