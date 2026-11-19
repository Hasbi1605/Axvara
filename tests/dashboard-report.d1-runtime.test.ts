import { expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { reportRuntimeSchema } from "./helpers/report-workerd-schema";
import { financialReportSql, readSelectedFinancialReport } from "@/lib/dashboard-report";
import { createD1Fixture } from "./helpers/d1-fixture";

it("D1 executes overview and historical reports against the full application schema", async () => {
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', compatibilityDate: "2026-08-06", d1Databases: ["DB"] });
  const fixture = createD1Fixture();
  try {
    const db = await runtime.getD1Database("DB");
    const tables = fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { sql: string }[];
    await db.batch(tables.map(row => db.prepare(row.sql)));
    const now = new Date("2026-11-11T00:00:00Z");
    for (const sql of [financialReportSql(now), financialReportSql(now, { date_from: "2026-11-01", date_to: "2026-11-10" })]) {
      // Remote D1 rejects the old repeated CTE expansion; local workerd accepts it.
      for (const cte of ["facts", "scoped"]) expect(sql.match(new RegExp(`\\bFROM ${cte}\\b`, "g"))?.length).toBeLessThanOrEqual(2);
      expect((await db.prepare(sql).all()).results).toEqual([]);
    }
  } finally { fixture.close(); await runtime.dispose(); }
}, 15000);

// node:sqlite accepts larger UNIONs than D1. Execute the actual report in
// workerd too, so Cloudflare's SQL limits are part of regression coverage.
it("D1 executes all six report kinds in one query for empty and mixed carts", async () => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    compatibilityDate: "2024-11-01",
    d1Databases: ["DB"],
  });
  try {
    const db = await runtime.getD1Database("DB");
    await db.batch(reportRuntimeSchema.map(sql => db.prepare(sql)));
    const sql = financialReportSql(new Date("2026-10-15T10:00:00Z"));
    expect((await db.prepare(sql).all()).results).toEqual([]);
    const items = [
      { product_id: 1, variant_id: 1, name: "Own", price: 14000, qty: 1 },
      { product_id: 2, variant_id: 2, name: "WR", price: 16000, qty: 1 },
      { product_id: 3, variant_id: 3, name: "SK", price: 20000, qty: 1 },
    ];
    await db.batch([
      db.prepare("INSERT INTO product_variants(id,manual_cost,wr_variant_id,sk_variant_id) VALUES(1,10000,NULL,NULL),(2,0,'w2',NULL),(3,0,NULL,'s3')"),
      db.prepare("INSERT INTO orders VALUES('MIXED',50001,'market',?,NULL,'web','2026-10-15T07:00:00Z','2026-10-15T07:00:00Z','lunas')").bind(JSON.stringify(items)),
      db.prepare("INSERT INTO wr_order_links(id,order_code,fulfillment_item_id,wr_variant_id,wr_cost,status) VALUES(1,'MIXED',NULL,'w2',8000,'completed')"),
      db.prepare("INSERT INTO sk_order_links VALUES(1,'MIXED',NULL,'s3',12000,'completed')"),
    ]);
    const { results }: { results: Record<string, unknown>[] } = await db.prepare(sql).all();
    expect(new Set(results.map(row => row.kind))).toEqual(new Set(["summary", "supplier", "channel", "top", "daily", "hourly"]));
    for (const period of ["total", "today", "week", "month"]) {
      expect(results.find(row => row.kind === "summary" && row.period === period)).toMatchObject({ orders: 1, revenue: 50001, cost: 30000 });
      const products = results.filter(row => row.kind === "top" && row.period === period);
      expect(products).toHaveLength(3);
      expect(products.reduce((sum, row) => sum + Number(row.cost), 0)).toBe(30000);
      expect(products.reduce((sum, row) => sum + Number(row.revenue), 0)).toBe(50001);
    }
    expect(results.find(row => row.kind === "hourly")).toMatchObject({ label: "14:00", revenue: 50001, cost: 30000 });
    expect(results.find(row => row.kind === "daily")).toMatchObject({ label: "2026-10-15", revenue: 50001, cost: 30000 });
    const selectedSql = financialReportSql(new Date("2026-10-15T10:00:00Z"), { date_from: "2026-10-15", date_to: "2026-10-15" });
    const selected: Record<string, unknown>[] = (await db.prepare(selectedSql).all()).results;
    expect(selected.find(row => row.kind === "summary")).toMatchObject({ period: "selected", orders: 1, revenue: 50001, cost: 30000 });
    const historicalSql = financialReportSql(new Date("2026-10-15T10:00:00Z"), { date_from: "2024-02-01", date_to: "2024-02-29" });
    expect((await db.prepare(historicalSql).all()).results).toEqual([]);
    await db.batch([
      db.prepare("INSERT INTO orders VALUES('GAME',15600,'games','[]',NULL,'web','2026-10-15T07:00:00Z','2026-10-15T07:00:00Z','lunas')"),
      db.prepare("INSERT INTO games_products VALUES(50,'mobile-legends','MOBILE LEGENDS','Mobile Legends','50 Diamond')"),
      db.prepare("INSERT INTO games_order_items VALUES('GAME',50,15600,14826,'success',1,'sekalipay','sk:50')"),
      db.prepare("INSERT INTO games_dispatch_attempts VALUES(1,'GAME',1,'sekalipay','sk:50','success',14825)"),
    ]);
    const gamesRows: Record<string, unknown>[] = (await db.prepare(sql).all()).results;
    expect(gamesRows.find(row => row.kind === "supplier" && row.period === "today" && row.label === "games"))
      .toMatchObject({ orders: 1, revenue: 15600, cost: 14825 });
    expect(gamesRows.find(row => row.kind === "top" && row.period === "today" && row.label === "Mobile Legends — 50 Diamond"))
      .toMatchObject({ qty: 1, revenue: 15600, cost: 14825 });
    expect(gamesRows.find(row => row.kind === "summary" && row.period === "today"))
      .toMatchObject({ orders: 2, revenue: 65601, cost: 44825, estimated: 1 });
    await db.batch([
      db.prepare("INSERT INTO orders VALUES('TUNVN-MAN',15000,'apps',?,NULL,'web','2026-10-15T07:00:00Z','2026-10-15T07:00:00Z','lunas')").bind(JSON.stringify([{ product_id: 1, variant_id: 1, name: "Muse Buff 10B", price: 1500, qty: 10 }])),
      db.prepare("INSERT INTO fulfillment_items(id,order_code,item_index,product_id,variant_id,qty,status) VALUES(99,'TUNVN-MAN',0,1,1,10,'delivered')"),
      db.prepare("INSERT INTO tunvn_order_links(id,order_code,item_index,variant_id,kind,cost_usdt,status,fx_idr_per_usdt) VALUES(39,'TUNVN-MAN',0,1,'buff',0.583,'needs_admin',18258.44)"),
    ]);
    const manualRows: Record<string, unknown>[] = (await db.prepare(sql).all()).results;
    expect(manualRows.find(row => row.kind === "supplier" && row.period === "today" && row.label === "tunvn"))
      .toMatchObject({ orders: 1, revenue: 15000, cost: Math.round(0.583 * 18258.44) });
    expect(manualRows.find(row => row.kind === "summary" && row.period === "today"))
      .toMatchObject({ orders: 3, estimated: 1 });
  } finally {
    await runtime.dispose();
  }
}, 15000);

// TUNVN & AIVault store cost_usd(_total) per LINE (unit × qty), never per unit,
// and their kurs is the last catalog snapshot rather than the purchase-time rate.
it("TUNVN and AIVault links/eligibility become their own supplier buckets at the catalog kurs", async () => {
  const fixture = createD1Fixture();
  try {
    fixture.sql.exec(`
      INSERT INTO products(id,name,slug,price,stock) VALUES
        (1,'Manual','manual',20000,10),(2,'TUNVN','tunvn',112400,10),(3,'AIVault','aivault',16500,10);
      INSERT INTO product_variants(id,product_id,sku,label,price,stock,manual_cost,tunvn_source_product_id)
        VALUES(1,1,'MAN','Manual',20000,10,10000,NULL),
              (2,2,'TUNVN-86','ChatGPT',112400,10,0,86),
              (3,3,'AV-service_gemini_plus_6m','Gemini',16500,10,0,NULL);
      INSERT INTO tunvn_products(supplier_product_id,name,price_usdt,fx_idr_per_usdt) VALUES(86,'ChatGPT',4.6,18086);
      INSERT INTO aivault_products(service_id,name,unit_price_usd,pricing_tiers_json,fx_idr_per_usd)
        VALUES('service_gemini_plus_6m','Gemini',0.5,'[]',16500);
      INSERT INTO crypto_market_snapshot(id,fx_rate_text) VALUES(1,'16000.00');
    `);
    const insert = fixture.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,paid_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`);
    const tunvnElig = { version: 1, kind: "account", source_product_id: 86, source_variant_id: 2, cost_usdt: 4.6, quantity: 1 };
    insert.run("TUNVN-LINK", "X", "6280", JSON.stringify([{ product_id: 2, variant_id: 2, name: "ChatGPT", price: 112400, qty: 1, tunvn_eligibility: tunvnElig }]), 112400, "qris", "lunas", "paid", "web", "2026-11-10T05:00:00Z");
    insert.run("TUNVN-ELIG", "X", "6280", JSON.stringify([{ product_id: 2, variant_id: 2, name: "ChatGPT", price: 112400, qty: 1, tunvn_eligibility: tunvnElig }]), 112400, "qris", "lunas", "paid", "web", "2026-11-10T06:00:00Z");
    insert.run("AIV-LINK", "X", "6280", JSON.stringify([{ product_id: 3, variant_id: 3, name: "Gemini", price: 16500, qty: 1, aivault_eligibility: { version: 1, service_id: "service_gemini_plus_6m", source_variant_id: 3, cost_usd: 0.5, quantity: 1 } }]), 16500, "qris", "lunas", "paid", "web", "2026-11-10T07:00:00Z");
    insert.run("MAN", "X", "6280", JSON.stringify([{ product_id: 1, variant_id: 1, name: "Manual", price: 20000, qty: 1 }]), 20000, "qris", "lunas", "paid", "web", "2026-11-10T08:00:00Z");
    fixture.sql.exec(`
      INSERT INTO tunvn_order_links(order_code,item_index,variant_id,product_id,kind,source_product_id,quantity,cost_usdt,status)
        VALUES('TUNVN-LINK',0,2,2,'account',86,1,4.6,'completed');
      INSERT INTO aivault_order_links(order_code,item_index,variant_id,product_id,service_id,quantity,cost_usd,external_order_id,status)
        VALUES('AIV-LINK',0,3,3,'service_gemini_plus_6m',1,0.5,'AIV-LINK-0','completed');
      INSERT INTO order_item_costs(order_code,item_index,source,unit_cost) VALUES('MAN',0,'manual',10000);
    `);
    const report = await readSelectedFinancialReport({ date_from: "2026-11-10", date_to: "2026-11-10" }, new Date("2026-11-11T00:00:00Z"));
    // 4.6 USDT × 18.086 = Rp83.196 per line; eligibility-only rows reuse the same
    // cost but stay estimates because no completed link exists.
    expect(report.suppliers.tunvn).toMatchObject({ orders: 2, revenue: 224800, cost: 166392, profit: 58408 });
    // 0.5 USD × 16.500 = Rp8.250.
    expect(report.suppliers.aivault).toMatchObject({ orders: 1, revenue: 16500, cost: 8250, profit: 8250 });
    expect(report.suppliers.manual).toMatchObject({ orders: 1, revenue: 20000, cost: 10000, profit: 10000 });
    expect(report.estimated_orders).toBe(1);
    expect(report.cost).toBe(166392 + 8250 + 10000);
  } finally {
    fixture.close();
  }
});
