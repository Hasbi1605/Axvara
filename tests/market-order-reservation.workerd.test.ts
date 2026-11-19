import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

it("creates a Market web order within the native D1 expression depth limit", async () => {
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
      import { createOrderWithStock } from './src/lib/db/orders-create';
      export default { async fetch(request, env) {
        globalThis.DB = env.DB;
        try {
          await createOrderWithStock(await request.json());
          return new Response(null, { status: 201 });
        } catch (error) {
          return new Response(String(error), { status: 500 });
        }
      } };
    ` },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
  });
  const runtime = new Miniflare({
    modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"],
    script: compiled.outputFiles[0].text, d1Databases: ["DB"],
  });
  const fixture = createD1Fixture();
  try {
    const db = await runtime.getD1Database("DB");
    const tables = ["categories", "products", "product_variants", "orders", "operation_guards",
      "wr_variants", "tunvn_products", "aivault_products", "fulfillment_inventory", "store_settings"];
    const ddls = fixture.sql.prepare(`SELECT sql FROM sqlite_master WHERE type='table'
      AND name IN (${tables.map(() => "?").join(",")})`).all(...tables) as { sql: string }[];
    expect(ddls).toHaveLength(tables.length);
    await db.batch([
      ...ddls.map(({ sql }) => db.prepare(sql)),
      db.prepare("INSERT INTO products(id, name, slug, price) VALUES (1, 'Fixture', 'fixture', 10000)"),
      db.prepare("INSERT INTO product_variants(id, product_id, sku, label, price, stock) VALUES (1, 1, 'SKU', 'Fixture', 10000, 3)"),
    ]);

    const response = await runtime.dispatchFetch("https://fixture.test/order", {
      method: "POST",
      body: JSON.stringify({
        code: "AXV-20261119-00000001", quoteId: "fixture-quote", customerName: "Fixture",
        customerWa: "081234567890", customerEmail: "buyer@example.test",
        items: [{ product_id: 1, variant_id: 1, qty: 2, price: 10000 }], subtotal: 20000,
        paymentMethod: "qris", paymentAccount: "DANA", proofUrl: null,
      }),
    });
    expect(response.status, await response.text()).toBe(201);
    expect(await db.prepare("SELECT quote_id, status FROM orders").first())
      .toEqual({ quote_id: "fixture-quote", status: "pending" });
    expect(await db.prepare("SELECT stock FROM product_variants WHERE id=1").first()).toEqual({ stock: 1 });
  } finally {
    fixture.close();
    await runtime.dispose();
  }
}, 30_000);
