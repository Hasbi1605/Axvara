// tests/games-markup.workerd.test.ts — bukti runtime D1 nyata (workerd/
// Miniflare) untuk packet G-BE: migrasi 0122 (rebuild + FK), recompute harga
// markup satu statement, dan overlay games_meta di katalog publik.
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";

/** D1 menjalankan satu file migrasi sebagai satu transaksi. */
type Prepared = { bind: (...values: unknown[]) => Prepared };
function migrationBatch(db: { prepare: (sql: string) => Prepared }, file: string): Prepared[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => db.prepare(statement));
}

it("migrates, reprices and serves the catalog contract in real workerd D1", async () => {
  const compiled = await build({
    stdin: {
      resolveDir: process.cwd(), loader: "ts", contents: `
        import {recomputeGamesSkPrices, readGamesPricingSettings, writeVariantMarkup} from './src/lib/games/markup';
        import {getGamesCatalog, getGamesDetail} from './src/lib/games/catalog';
        import {createDatabaseAccess} from './src/lib/db-access';
        export default {async fetch(req,env){
          globalThis.DB=env.DB;
          const db=createDatabaseAccess();
          const url=new URL(req.url);
          if(url.pathname==='/recompute') return Response.json(await recomputeGamesSkPrices(db,{all:true}));
          if(url.pathname==='/settings') return Response.json(await readGamesPricingSettings(db));
          if(url.pathname==='/markup') { await writeVariantMarkup(db,['sk:1'],{percent:12,fixed:250}); return Response.json({ok:true}); }
          if(url.pathname==='/catalog') return Response.json(await getGamesCatalog());
          if(url.pathname==='/detail') return Response.json(await getGamesDetail('mobile-legends'));
          return new Response('nope',{status:404});
        }};`,
    },
    bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
    plugins: [{
      name: "framework-adapter",
      setup(b) {
        b.onResolve({ filter: /^server-only$|^next\/server$/ }, (args) => ({ path: args.path, namespace: "framework" }));
        b.onLoad({ filter: /.*/, namespace: "framework" }, (args) => ({
          contents: args.path === "server-only" ? "" : "export const NextResponse=Response; export const NextRequest=Request;",
        }));
      },
    }],
  });
  const runtime = new Miniflare({
    modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"],
    script: compiled.outputFiles[0].text, d1Databases: ["DB"],
    bindings: { NODE_ENV: "test", ADMIN_JWT_SECRET: "workerd-markup-fixture" },
  });
  try {
    const db = await runtime.getD1Database("DB");
    const contract = JSON.stringify({
      version: 1,
      fields: [{ key: "note", label: "User ID :", required: true, input: "text", min: 1, max: 50 }],
      requires_zone_id: false, validation_available: true, open_denom: false, supported: true, reason: null,
    });
    await db.batch([
      db.prepare("CREATE TABLE orders(code TEXT PRIMARY KEY, order_kind TEXT NOT NULL DEFAULT 'apps')"),
      db.prepare("CREATE TABLE store_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))"),
      ...migrationBatch(db, "drizzle/migrations/0107_games_core.sql"),
      ...migrationBatch(db, "drizzle/migrations/0108_games_admin.sql"),
      ...migrationBatch(db, "drizzle/migrations/0118_games_sekalipay.sql"),
      db.prepare("INSERT INTO orders(code,order_kind) VALUES('G1','games')"),
      db.prepare(`INSERT INTO games_products(buyer_sku_code,product_name,cost,sell_price,supplier,supplier_active,enabled,sk_variant_id,sk_product_id,sk_product_name,game_slug,required_fields_json,min_order,stock,product_type_name)
        VALUES('sk:1','5 Diamond',11750,12102,'sekalipay',1,1,1,33,'Mobile Legends','mobile-legends',?,1,100,'Indonesia')`).bind(contract),
      db.prepare("INSERT INTO games_order_items(order_code,product_id,buyer_sku_code,customer_no,unit_price,total,cost_snapshot,max_price) VALUES('G1',1,'sk:1','12345',12400,12400,11750,12400)"),
    ]);

    // Migrasi 0122 di D1 nyata: rebuild tabel sambil menjaga FK baris pesanan.
    await db.batch(migrationBatch(db, "drizzle/migrations/0122_games_markup_meta.sql"));
    const item = await db.prepare("SELECT COUNT(*) AS n FROM games_order_items gi JOIN games_products gp ON gp.id=gi.product_id").first();
    expect(item).toEqual({ n: 1 });
    expect(await db.prepare("PRAGMA foreign_key_check").all()).toEqual({ results: [], success: true, meta: expect.anything() });
    // Harga dihitung ulang 5 %/R100 saat migrasi (11750 → 12400).
    expect(await db.prepare("SELECT sell_price FROM games_products WHERE buyer_sku_code='sk:1'").first()).toEqual({ sell_price: 12400 });
    // Migrasi kedua aman (idempoten) dan tidak menimpa harga.
    await db.batch(migrationBatch(db, "drizzle/migrations/0122_games_markup_meta.sql"));
    expect(await db.prepare("SELECT sell_price FROM games_products WHERE buyer_sku_code='sk:1'").first()).toEqual({ sell_price: 12400 });

    expect(await (await runtime.dispatchFetch("https://fixture.test/settings")).json())
      .toEqual({ markup_percent: 5, rounding: 100 });

    // Overlay games_meta + kategori/region di detail.
    await db.prepare("INSERT INTO games_meta(slug,display_name,publisher,description,id_guide,featured_rank,hidden) VALUES('mobile-legends','MLBB','Moonton','Top up ML.','Salin User ID.',2,0)").run();
    const catalog = await (await runtime.dispatchFetch("https://fixture.test/catalog")).json() as Record<string, unknown>[];
    expect(catalog[0]).toMatchObject({
      slug: "mobile-legends", name: "MLBB", publisher: "Moonton", min_price: 12400,
      sellable_count: 1, sku_count: 1, featured_rank: 2,
    });
    const detail = await (await runtime.dispatchFetch("https://fixture.test/detail")).json() as {
      game: Record<string, unknown>; products: Record<string, unknown>[];
    };
    expect(detail.game).toMatchObject({ description: "Top up ML.", id_guide: "Salin User ID." });
    expect(detail.products[0]).toMatchObject({
      name: "5 Diamond", type_label: "Indonesia", region_code: "ID", category: "topup", validation_available: true,
    });
    expect((detail.products[0].fields as { label: string }[])[0].label).toBe("User ID");

    // Markup varian 12 % + Rp250 lalu recompute satu statement.
    await runtime.dispatchFetch("https://fixture.test/markup");
    expect(await (await runtime.dispatchFetch("https://fixture.test/recompute")).json()).toEqual({ updated: 1 });
    // ceil(11750 × 1,12 / 100) × 100 + 250 = 13200 + 250.
    expect(await db.prepare("SELECT sell_price FROM games_products WHERE buyer_sku_code='sk:1'").first()).toEqual({ sell_price: 13450 });

    // Game tersembunyi hilang dari list & detail.
    await db.prepare("UPDATE games_meta SET hidden=1 WHERE slug='mobile-legends'").run();
    expect(await (await runtime.dispatchFetch("https://fixture.test/catalog")).json()).toEqual([]);
    expect(await (await runtime.dispatchFetch("https://fixture.test/detail")).json()).toEqual(null);
  } finally { await runtime.dispose(); }
}, 60_000);
