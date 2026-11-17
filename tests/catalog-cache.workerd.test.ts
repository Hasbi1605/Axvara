import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

it("revisioned catalog cache works on native Cloudflare Cache API + D1 including end-to-end stock sync invalidation", async () => {
  const compiled = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "ts",
      contents: `
        import { cachePublicCatalog, bumpCatalogRevision, getCatalogRevision } from "./src/lib/catalog-cache";
        import { createDatabaseAccess } from "./src/lib/db-access";
        import { syncSkProducts } from "./src/lib/sekalipay/sync";
        export default {
          async fetch(request, env) {
            if (!globalThis.__countedDb) {
              const origPrepare = env.DB.prepare.bind(env.DB);
              const originals = new WeakMap();
              globalThis.__countedDb = {
                prepare: (sql) => {
                  const wrap = (stmt) => {
                    const wrapped = {
                      bind: (...p) => wrap(stmt.bind(...p)),
                      first: async (...a) => { globalThis.__sqlReads++; return stmt.first(...a); },
                      all: async (...a) => { globalThis.__sqlReads++; return stmt.all(...a); },
                      run: async (...a) => { globalThis.__sqlReads++; return stmt.run(...a); },
                    };
                    originals.set(wrapped, stmt);
                    return wrapped;
                  };
                  return wrap(origPrepare(sql));
                },
                batch: (stmts) => {
                  globalThis.__sqlReads += stmts.length;
                  return env.DB.batch(stmts.map((s) => originals.get(s) ?? s));
                },
              };
            }
            globalThis.DB = globalThis.__countedDb;
            const url = new URL(request.url);
            if (url.pathname === "/basic") {
              globalThis.__basicLoads = (globalThis.__basicLoads ?? 0) + 1;
              return cachePublicCatalog(
                "workerd-real-cache",
                300,
                async () => Response.json(
                  { loads: globalThis.__basicLoads },
                  { headers: { "Cache-Control": "public, max-age=15, s-maxage=30" } },
                ),
              );
            }
            if (url.pathname === "/catalog") {
              globalThis.__sqlReads = 0;
              const res = await cachePublicCatalog(
                "products:v=true&q=&cat=&slug=",
                300,
                async () => {
                  const row = await globalThis.__countedDb.prepare("SELECT stock, price FROM product_variants WHERE id=1").first();
                  return Response.json(
                    { stock: Number(row?.stock ?? 0), price: Number(row?.price ?? 0) },
                    { headers: { "Cache-Control": "public, max-age=15, s-maxage=30" } },
                  );
                },
                "market",
              );
              const body = await res.json();
              return Response.json(
                { ...body, sqlReads: globalThis.__sqlReads, rev: await getCatalogRevision("market", globalThis.__countedDb) },
                {
                  headers: {
                    "X-Axvara-Cache": res.headers.get("X-Axvara-Cache") ?? "",
                    "Cache-Control": res.headers.get("Cache-Control") ?? "",
                  },
                },
              );
            }
            if (url.pathname === "/sync") {
              globalThis.__sqlReads = 0;
              const payload = await request.json();
              const db = createDatabaseAccess(globalThis.__countedDb);
              const result = await syncSkProducts(db, undefined, {
                trigger: "cron",
                applyOnly: { rows: payload.rows, removedVariantIds: [] },
              });
              return Response.json({ ok: true, stockChanges: result.stockChanges, rev: await getCatalogRevision("market", globalThis.__countedDb) });
            }
            if (url.pathname === "/bump") {
              const rev = await bumpCatalogRevision("market", globalThis.__countedDb);
              return Response.json({ rev });
            }
            return new Response("not_found", { status: 404 });
          },
        };`,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    define: {
      "process.env.SEKALIPAY_ENABLED": JSON.stringify("true"),
      "process.env.SEKALIPAY_DEFAULT_MARKUP_PERCENT": JSON.stringify("50"),
      "process.env.SEKALIPAY_DEFAULT_MARKUP_FIXED": JSON.stringify("0"),
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
    const ddl = fixture.sql
      .prepare("SELECT sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL")
      .all() as { sql: string }[];
    for (const row of ddl) {
      await db.prepare(row.sql).run();
    }
    await db.prepare("INSERT INTO categories(id,name,slug) VALUES(1,'AI','ai-chatbot')").run();
    await db.prepare(
      "INSERT INTO products(id,category_id,name,slug,price,stock,is_active,sk_product_id,sk_auto_managed) VALUES(1,1,'Claude Pro','claude-pro',15000,10,1,'skp-1',1)",
    ).run();
    await db.prepare(
      "INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,sort_order,sk_variant_id,sk_auto_managed) VALUES(1,1,'SK-skv-1','1 Bulan',15000,10,'manual',1,0,'skv-1',1)",
    ).run();
    await db.prepare(
      "INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_category,sk_variant_name,sk_price,sk_stock,sk_status,axvara_product_id,axvara_variant_id,markup_percent,markup_fixed,axvara_sell_price) VALUES('skv-1','skp-1','Claude Pro','Premium','1 Bulan',10000,10,'available',1,1,50,0,15000)",
    ).run();

    // 1. Basic Cache API HIT/MISS & preserved Cache-Control without internal headers
    const basic1 = await runtime.dispatchFetch("https://axvara.tech/basic");
    expect(basic1.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect(await basic1.json()).toEqual({ loads: 1 });
    const basic2 = await runtime.dispatchFetch("https://axvara.tech/basic");
    expect(basic2.headers.get("X-Axvara-Cache")).toBe("HIT");
    expect(basic2.headers.get("Cache-Control")).toBe("public, max-age=15, s-maxage=30");
    expect(await basic2.json()).toEqual({ loads: 1 });
    expect(basic2.headers.has("X-Axvara-Cache-Stored-At")).toBe(false);
    expect(basic2.headers.has("X-Axvara-Origin-Cache-Control")).toBe(false);

    // 2. End-to-end: /catalog MISS -> HIT (0 D1 reads) -> SK sync changes stock -> MISS with new stock
    const cat1 = await runtime.dispatchFetch("https://axvara.tech/catalog");
    expect(cat1.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect(await cat1.json()).toMatchObject({ stock: 10, price: 15000, rev: "0" });

    const cat2 = await runtime.dispatchFetch("https://axvara.tech/catalog");
    expect(cat2.headers.get("X-Axvara-Cache")).toBe("HIT");
    expect(await cat2.json()).toMatchObject({ stock: 10, price: 15000, sqlReads: 0, rev: "0" });

    // No-op sync: stock unchanged (10) -> revision remains "0", cache still HIT
    const noopSync = await runtime.dispatchFetch("https://axvara.tech/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: [{
          productId: "skp-1",
          productName: "Claude Pro",
          categoryName: "Premium",
          variant: { id: "skv-1", name: "1 Bulan", price: 10000, stock: 10, status: "available", order_process: "auto" },
        }],
      }),
    });
    expect(await noopSync.json()).toMatchObject({ ok: true, stockChanges: 0, rev: "0" });
    const catStillHit = await runtime.dispatchFetch("https://axvara.tech/catalog");
    expect(catStillHit.headers.get("X-Axvara-Cache")).toBe("HIT");

    // Stock drops to 3 via SK sync -> revision bumps -> next /catalog immediately MISSes with stock=3
    const stockSync = await runtime.dispatchFetch("https://axvara.tech/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: [{
          productId: "skp-1",
          productName: "Claude Pro",
          categoryName: "Premium",
          variant: { id: "skv-1", name: "1 Bulan", price: 10000, stock: 3, status: "available", order_process: "auto" },
        }],
      }),
    });
    const syncJson = await stockSync.json() as { stockChanges: number; rev: string };
    expect(syncJson.stockChanges).toBe(1);
    expect(syncJson.rev).not.toBe("0");

    const catAfterSync = await runtime.dispatchFetch("https://axvara.tech/catalog");
    expect(catAfterSync.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect(await catAfterSync.json()).toMatchObject({ stock: 3, price: 15000, rev: syncJson.rev });

    const catAfterSyncHit = await runtime.dispatchFetch("https://axvara.tech/catalog");
    expect(catAfterSyncHit.headers.get("X-Axvara-Cache")).toBe("HIT");
    expect(await catAfterSyncHit.json()).toMatchObject({ stock: 3, sqlReads: 0 });
  } finally {
    await runtime.dispose();
    fixture.close();
  }
}, 25000);
