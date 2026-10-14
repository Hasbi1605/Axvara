import { expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { financialReportSql } from "@/lib/dashboard-report";

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
    const schema = [
      "CREATE TABLE orders(code TEXT PRIMARY KEY,subtotal INTEGER,order_kind TEXT,items TEXT,variant_id INTEGER,sales_channel TEXT,paid_at TEXT,updated_at TEXT,status TEXT)",
      "CREATE TABLE payment_transactions(order_code TEXT,payable_amount INTEGER,paid_at TEXT)",
      "CREATE TABLE payment_proofs(order_code TEXT,reviewed_at TEXT,status TEXT)",
      "CREATE TABLE fulfillment_items(id INTEGER,order_code TEXT,item_index INTEGER,product_id INTEGER,variant_id INTEGER,qty INTEGER,wr_link_id INTEGER,sk_link_id INTEGER)",
      "CREATE TABLE order_item_costs(order_code TEXT,item_index INTEGER,source TEXT,unit_cost INTEGER,supplier_variant_id TEXT)",
      "CREATE TABLE product_variants(id INTEGER,manual_cost INTEGER,wr_variant_id TEXT,sk_variant_id TEXT)",
      "CREATE TABLE wr_variants(wr_variant_id TEXT,axvara_variant_id INTEGER,wr_price INTEGER)",
      "CREATE TABLE sk_products(sk_variant_id TEXT,axvara_variant_id INTEGER,sk_price INTEGER)",
      "CREATE TABLE wr_order_links(id INTEGER,order_code TEXT,fulfillment_item_id INTEGER,wr_variant_id TEXT,wr_cost INTEGER,status TEXT)",
      "CREATE TABLE sk_order_links(id INTEGER,order_code TEXT,fulfillment_item_id INTEGER,sk_variant_id TEXT,sk_cost INTEGER,status TEXT)",
      "CREATE TABLE pedia_order_items(order_code TEXT,credit_used INTEGER,supplier_charge REAL,supplier_rate_snapshot REAL,quantity INTEGER)",
    ];
    await db.batch(schema.map(sql => db.prepare(sql)));
    const sql = financialReportSql(new Date("2026-10-15T10:00:00Z"));
    expect((await db.prepare(sql).all()).results).toEqual([]);
    const items = [
      { product_id: 1, variant_id: 1, name: "Own", price: 14000, qty: 1 },
      { product_id: 2, variant_id: 2, name: "WR", price: 16000, qty: 1 },
      { product_id: 3, variant_id: 3, name: "SK", price: 20000, qty: 1 },
    ];
    await db.batch([
      db.prepare("INSERT INTO product_variants VALUES(1,10000,NULL,NULL),(2,0,'w2',NULL),(3,0,NULL,'s3')"),
      db.prepare("INSERT INTO orders VALUES('MIXED',50001,'market',?,NULL,'web','2026-10-15T07:00:00Z','2026-10-15T07:00:00Z','lunas')").bind(JSON.stringify(items)),
      db.prepare("INSERT INTO wr_order_links VALUES(1,'MIXED',NULL,'w2',8000,'completed')"),
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
  } finally {
    await runtime.dispose();
  }
}, 15000);
