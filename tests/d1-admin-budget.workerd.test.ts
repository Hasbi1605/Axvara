import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Miniflare } from "miniflare";
import ts from "typescript";
import { financialReportSql } from "@/lib/dashboard-report";
import { ORDER_FACETS_SQL, orderFacets } from "@/lib/admin-order-facets";
import { OVERVIEW_ATTENTION_SQL, OVERVIEW_JOB_QUEUE_SQL } from "@/lib/admin-overview-queries";
import { reportRuntimeSchema } from "./helpers/report-workerd-schema";

it("measures report, facets, pagination, reservation and active queue costs in D1", async () => {
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2024-11-01", d1Databases: ["DB"], script: 'export default {fetch(){return new Response("ok")}}' });
  try {
    const db = await runtime.getD1Database("DB");
    await db.batch(reportRuntimeSchema.map(sql => db.prepare(sql)));
    await db.batch([
      "ALTER TABLE orders ADD COLUMN created_at TEXT", "ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'paid'", "ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT 'qris'",
      "CREATE INDEX wr_order ON wr_order_links(order_code)", "CREATE INDEX sk_order ON sk_order_links(order_code)",
      "CREATE INDEX costs_order ON order_item_costs(order_code,item_index)", "CREATE INDEX items_order ON fulfillment_items(order_code,item_index)",
      "CREATE INDEX paid_order ON payment_transactions(order_code)", "CREATE INDEX pedia_order ON pedia_order_items(order_code)",
      "CREATE INDEX orders_paid ON orders(status,payment_status)",
      "INSERT INTO product_variants VALUES(1,10000,NULL,NULL),(2,0,'w2',NULL),(3,0,NULL,'s3')",
      `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<400)
        INSERT INTO orders(code,subtotal,order_kind,items,sales_channel,paid_at,updated_at,status,created_at)
        SELECT 'O'||x,50001,'market','[{"product_id":1,"variant_id":1,"name":"Own","qty":1,"price":14000},{"product_id":2,"variant_id":2,"name":"WR","qty":1,"price":16000},{"product_id":3,"variant_id":3,"name":"SK","qty":1,"price":20000}]',
          CASE WHEN x%2=0 THEN 'telegram' ELSE 'web' END,'2026-10-19T07:00:00Z','2026-10-19T07:00:00Z','lunas',datetime('2026-10-19','+'||x||' seconds') FROM n`,
      "INSERT INTO wr_order_links SELECT rowid,code,NULL,'w2',8000,'completed' FROM orders",
      "INSERT INTO sk_order_links SELECT rowid,code,NULL,'s3',12000,'completed' FROM orders",
      "CREATE TABLE fulfillment_inventory(id INTEGER PRIMARY KEY,order_code TEXT,status TEXT)",
      "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<5000) INSERT INTO fulfillment_inventory SELECT x,'I'||x,'delivered' FROM n",
      "INSERT INTO fulfillment_inventory VALUES(5001,'O1','reserved')",
      "CREATE TABLE fulfillment_jobs(order_code TEXT UNIQUE,status TEXT,next_attempt_at TEXT)",
      "CREATE INDEX idx_fulfillment_jobs_status ON fulfillment_jobs(status)",
      "ALTER TABLE fulfillment_items ADD COLUMN status TEXT", "ALTER TABLE fulfillment_items ADD COLUMN next_attempt_at TEXT",
      "CREATE INDEX idx_fulfillment_items_next ON fulfillment_items(status)",
      "INSERT INTO fulfillment_jobs SELECT code,'delivered',NULL FROM orders",
      "INSERT INTO fulfillment_items(order_code,status) SELECT code,'delivered' FROM orders",
    ].map(sql => db.prepare(sql)));
    const sql = financialReportSql(new Date("2026-10-19T15:00:00Z"));
    const before = await db.prepare(sql.replace("bindings AS MATERIALIZED (", "bindings AS (")).all();
    const after = await db.prepare(sql).all();
    expect(after.results).toEqual(before.results);
    expect(after.results.find((row: Record<string, unknown>) => row.kind === "summary" && row.period === "total")).toMatchObject({ orders: 400, revenue: 20000400, cost: 12000000 });
    expect(after.meta.rows_read).toBeLessThan(before.meta.rows_read * 0.97);
    const legacyFacets = await Promise.all([
      "SELECT COALESCE(sales_channel,'web') value,COUNT(*) count FROM orders GROUP BY COALESCE(sales_channel,'web')",
      "SELECT status value,COUNT(*) count FROM orders GROUP BY status",
      "SELECT LOWER(payment_method) value,COUNT(*) count FROM orders GROUP BY LOWER(payment_method)",
    ].map(sql => db.prepare(sql).all()));
    const facets = await db.prepare(ORDER_FACETS_SQL).all();
    expect(orderFacets(facets.results)).toEqual({ counts: { channels: { telegram: 200, web: 200 }, statuses: { lunas: 400 } }, methods: ["qris"] });
    const facetBefore = legacyFacets.reduce((n: number, result: { meta: { rows_read: number } }) => n + result.meta.rows_read, 0);
    expect(facets.meta.rows_read).toBeLessThan(facetBefore / 2);
    const inventorySql = "SELECT id FROM fulfillment_inventory WHERE order_code='O1' AND status='reserved' LIMIT 1";
    const listSql = "SELECT code,created_at FROM orders ORDER BY created_at DESC LIMIT 10";
    const oldInventory = await db.prepare(inventorySql).all(), oldList = await db.prepare(listSql).all();
    const migration = readFileSync("drizzle/migrations/0072_d1_admin_read_budget.sql", "utf8").replace(/^--.*$/gm, "");
    for (const sql of migration.split(";").map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
    const inventory = await db.prepare(inventorySql).all(), list = await db.prepare(listSql).all();
    expect(inventory.results).toEqual(oldInventory.results); expect(inventory.meta.rows_read).toBeLessThan(5);
    expect(list.results).toEqual(oldList.results); expect(list.meta.rows_read).toBeLessThan(25);
    await db.prepare("ANALYZE").run();
    const quiet = await db.prepare(OVERVIEW_JOB_QUEUE_SQL).all();
    expect(quiet.results).toEqual([]); expect(quiet.meta.rows_read).toBeLessThan(10);
    await db.prepare("UPDATE fulfillment_jobs SET status='retry',next_attempt_at='2026-10-19' WHERE order_code='O1'").run();
    await db.prepare("UPDATE fulfillment_items SET status='failed' WHERE order_code='O1'").run();
    const attention = await db.prepare(OVERVIEW_ATTENTION_SQL).all();
    expect(attention.results).toEqual([{ count: 1 }]); expect(attention.meta.rows_read).toBeLessThan(15);
    console.info("[d1-admin-budget]", JSON.stringify({ report: [before.meta.rows_read, after.meta.rows_read], facets: [facetBefore, facets.meta.rows_read], inventory: [oldInventory.meta.rows_read, inventory.meta.rows_read], latestOrders: [oldList.meta.rows_read, list.meta.rows_read], quietQueue: quiet.meta.rows_read, attention: attention.meta.rows_read }));
  } finally { await runtime.dispose(); }
}, 30000);

it("uses the real workerd named Cache API to store sealed financial snapshots", async () => {
  const helper = ts.transpileModule(readFileSync("src/lib/admin-report-cache.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2024-11-01", script: `
    const process={env:{NODE_ENV:"production",ADMIN_JWT_SECRET:"workerd-fixture-secret"}};
    ${helper.replace(/^export /gm, "")}
    let loads=0;
    export default {async fetch(){
      const data=await readPrivateFinancialSnapshot("actual-cache",async()=>({generatedAt:new Date().toISOString(),revenue:12345,loads:++loads}));
      return Response.json(data);
    }}` });
  try {
    const first = await (await runtime.dispatchFetch("https://fixture.test/")).json();
    const second = await (await runtime.dispatchFetch("https://fixture.test/")).json();
    expect(first).toMatchObject({ loads: 1, revenue: 12345 }); expect(second).toEqual(first);
  } finally { await runtime.dispose(); }
}, 15000);
