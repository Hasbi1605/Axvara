import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { calculateCrc16 } from "@/lib/payments/dana-qris";

it("quotes, atomically claims/reuses QRIS, authorizes status and expires Games in workerd D1", async () => {
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
      import {POST as quote} from './src/app/api/games/quote/route';
      import {POST as order} from './src/app/api/games/orders/route';
      import {GET as status} from './src/app/api/games/orders/[code]/route';
      import {expireGamesCheckouts} from './src/lib/games/expire';
      import {createDatabaseAccess} from './src/lib/db-access';
      export default {async fetch(req,env){
        globalThis.DB=env.DB;
        const url=new URL(req.url);
        if(url.pathname==='/quote') return quote(req);
        if(url.pathname==='/order') return order(req);
        if(url.pathname==='/expire') return Response.json({expired:await expireGamesCheckouts(createDatabaseAccess())});
        return status(req,{params:Promise.resolve({code:url.searchParams.get('code')})});
      }};` },
    bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
    plugins: [{ name: "framework-adapter", setup(b) {
      b.onResolve({ filter: /^server-only$|^next\/server$/ }, args => ({ path: args.path, namespace: "framework" }));
      // Pages supplies Next's adapter; bare workerd only needs the HTTP primitives used here.
      b.onLoad({ filter: /.*/, namespace: "framework" }, args => ({ contents: args.path === "server-only" ? "" : "export const NextResponse=Response; export const NextRequest=Request;" }));
    } }],
  });
  const qr = "00020101021153033605802ID6304";
  const runtime = new Miniflare({
    modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"],
    script: compiled.outputFiles[0].text, d1Databases: ["DB"],
    bindings: { NODE_ENV: "test", ADMIN_JWT_SECRET: "workerd-games-fixture", DIGIFLAZZ_USERNAME: "fixture", DIGIFLAZZ_API_KEY: "fixture",
      DIGIFLAZZ_TESTING: "false", QRIS_ACTIVE_PROVIDER: "dana", DANA_QRIS_ENABLED: "true", DANA_STATIC_QRIS: qr + calculateCrc16(qr),
      DANA_WEBHOOK_SECRET: "fixture", NEXT_PUBLIC_PAYMENTS_MAINTENANCE: "false" },
    outboundService: () => { throw new Error("External requests forbidden"); },
  });
  try {
    const db = await runtime.getD1Database("DB");
    const schema = readFileSync("drizzle/schema.sql", "utf8");
    // Real table DDL, not a hand-copied schema; migration/trigger tests live elsewhere.
    for (const table of ["categories", "products", "product_variants", "orders", "operation_guards", "checkout_attempts", "checkout_claims",
      "games_products", "games_order_items", "payment_transactions", "payment_invoice_history", "fulfillment_inventory"]) {
      const ddl = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`))?.[0];
      expect(ddl, table).toBeTruthy();
      await db.prepare(ddl!).run();
    }
    await db.prepare("CREATE UNIQUE INDEX orders_quote_id ON orders(quote_id)").run();
    await db.prepare("INSERT INTO games_products(buyer_sku_code,game_brand,product_name,cost,sell_price,seller_active,enabled) VALUES('ml86','MOBILE LEGENDS','86 Diamonds',10000,11000,1,1)").run();
    const post = (path: string, body: unknown) => runtime.dispatchFetch(`https://fixture.test/${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const q = await post("quote", { slug: "mobile-legends", buyer_sku_code: "ml86", fields: { userId: "12345678", zoneId: "2001" }, whatsapp: "081234567890", email: "buyer@example.com" });
    expect(q.status).toBe(200);
    const { quote_token } = await q.json() as { quote_token: string };
    const created = await post("order", { quote_token });
    expect(created.status).toBe(201);
    const first = await created.json() as { code: string; qris: { payable_amount: number } };
    expect(first.code).toMatch(/^AXG-\d{8}-[A-Z0-9]{8}$/);
    expect(first.qris.payable_amount).toBeGreaterThan(11000);
    expect((await post("order", { quote_token })).status).toBe(200);
    expect(await db.prepare("SELECT quantity,max_price,status FROM games_order_items").first())
      .toMatchObject({ quantity: 1, max_price: 10500, status: "awaiting_payment" });
    const status = await runtime.dispatchFetch(`https://fixture.test/status?code=${first.code}`, { headers: { "x-order-contact": "buyer@example.com" } });
    expect(status.status).toBe(200);
    expect((await status.json() as { order: { games_status: string } }).order.games_status).toBe("awaiting_payment");
    await db.prepare("UPDATE orders SET expires_at=datetime('now','-1 minute')").run();
    expect(await (await runtime.dispatchFetch("https://fixture.test/expire")).json()).toEqual({ expired: 1 });
    expect(await db.prepare("SELECT status FROM games_order_items").first()).toEqual({ status: "expired" });
  } finally { await runtime.dispose(); }
}, 30_000);
