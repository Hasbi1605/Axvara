import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { reportMonthSelection, resolveReportRange } from "@/lib/revenue";
import { emptySelectedReport, readSelectedFinancialReport } from "@/lib/dashboard-report";

const now = new Date("2026-10-14T17:01:00Z");
let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(() => { fixture = createD1Fixture(); });
afterEach(() => { fixture.close(); vi.useRealTimers(); });

it("validates real paired calendar dates, chronological and at most 366 inclusive days", () => {
  expect(resolveReportRange({ date_from: "2024-01-01", date_to: "2024-12-31" }, now)).toEqual({ from: "2024-01-01", to: "2024-12-31" });
  for (const [from, to] of [["", "2024-02-29"], ["2024-02-29", ""], ["2023-02-29", "2023-03-01"], ["2024-04-31", "2024-05-01"], ["2024-2-01", "2024-02-29"], ["2024-03-01", "2024-02-29"], ["2024-01-01", "2025-01-01"], ["2026-10-15", "2026-10-16"], ["0000-01-01", "0000-01-01"], ["2024-01-01' OR 1=1", "2024-01-02"]])
    expect(() => resolveReportRange({ date_from: from, date_to: to }, now)).toThrow();
  expect(resolveReportRange("today", now)).toEqual({ from: "2026-10-15", to: "2026-10-15" });
  expect(resolveReportRange("week", now)).toEqual({ from: "2026-10-12", to: "2026-10-15" });
});

it("historical leap month and current partial month share the range contract", () => {
  expect(reportMonthSelection("2024-02", now)).toEqual({ date_from: "2024-02-01", date_to: "2024-02-29" });
  expect(reportMonthSelection("2026-10", now)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-15" });
  for (const month of ["2026-11", "2024-13", "2024-2", "0000-01"]) expect(() => reportMonthSelection(month, now)).toThrow();
});

it("empty historical range emits every zero day, including leap day, with metadata", async () => {
  const report = await readSelectedFinancialReport({ date_from: "2024-02-01", date_to: "2024-02-29" }, now);
  expect(report).toMatchObject({ from: "2024-02-01", to: "2024-02-29", timezone: "Asia/Jakarta", generated_at: now.toISOString(), orders: 0, revenue: 0, cost: 0, profit: 0, top_products: [] });
  expect(report.series).toHaveLength(29);
  expect(report.series[28]).toEqual({ date: "2024-02-29", orders: 0, revenue: 0, cost: 0, profit: 0 });
  expect(emptySelectedReport("today", now).series).toHaveLength(1);
});

it("historical report uses inclusive WIB payment boundaries and preserves cash/cost snapshots", async () => {
  fixture.sql.exec(`INSERT INTO products(id,name,slug,price,stock) VALUES(1,'History','history',10000,10);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,manual_cost) VALUES(1,1,'H','History',10000,10,99999);`);
  for (const [code, paidAt, amount] of [["BEFORE", "2024-02-28T16:59:59Z", 10000], ["START", "2024-02-28T17:00:00Z", 7000], ["END", "2024-02-29T16:59:59Z", 8000], ["AFTER", "2024-02-29T17:00:00Z", 10000]]) {
    fixture.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,paid_at,updated_at)
      VALUES(?,'X','6280','[{"product_id":1,"variant_id":1,"name":"History","qty":1,"price":10000}]',10000,'qris','lunas','paid','telegram',?,'2026-10-15T05:00:00Z')`).run(code, paidAt);
    fixture.sql.prepare("INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,paid_at,status) VALUES(?,'dana','test',?,'fixture',10000,?,?,'paid')").run(code, code, amount, paidAt);
    fixture.sql.prepare("INSERT INTO order_item_costs(order_code,item_index,source,unit_cost) VALUES(?,0,'manual',4000)").run(code);
  }
  const report = await readSelectedFinancialReport({ date_from: "2024-02-29", date_to: "2024-02-29" }, now);
  expect(report).toMatchObject({ orders: 2, revenue: 15000, cost: 8000, profit: 7000, estimated_orders: 0 });
  expect(report.series).toEqual([{ date: "2024-02-29", orders: 2, revenue: 15000, cost: 8000, profit: 7000 }]);
  expect(report.suppliers.manual).toMatchObject({ revenue: 15000, cost: 8000 });
  expect(report.channels.telegram).toMatchObject({ revenue: 15000, profit: 7000 });
  expect(report.top_products[0]).toMatchObject({ name: "History", qty: 2, revenue: 15000, cost: 8000 });
});

it("Pedia cash, partial-credit and full-credit orders use one sale basis with separate settlement totals", async () => {
  fixture.sql.exec(`INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,packages_json,step) VALUES(1,'ig','instagram','followers','profile','IG','[1000]',1);
    INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp) VALUES(1,1,'test','indosmm',1,'G1',20,1000);`);
  for (const [code, credit, merchant] of [["CASH", 0, 10000], ["PARTIAL", 5000, 5023], ["FULL", 10000, 0]] as const) {
    fixture.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,order_kind,paid_at)
      VALUES(?,'X','6280','[{"name":"IG"}]',10000,'qris','lunas','paid','pedia','2024-02-29T07:00:00Z')`).run(code);
    fixture.sql.prepare(`INSERT INTO pedia_order_items(order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,credit_used,supplier,supplier_service_id,supplier_rate_snapshot,supplier_charge,status)
      VALUES(?,1,1,'{}','x','x',1000,10,10000,?,'indosmm',1,4000,4000,'completed')`).run(code, credit);
    if (merchant) fixture.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,paid_at,status)
      VALUES(?,'gopay','test',?,'fixture',?,?, '2024-02-29T07:00:00Z','paid')`).run(code, code, 10000 - credit, merchant);
  }
  const report = await readSelectedFinancialReport({ date_from: "2024-02-29", date_to: "2024-02-29" }, now);
  expect(report).toMatchObject({ orders: 3, revenue: 30023, merchant_paid: 15023, credit_used: 15000, cost: 12000, profit: 18023 });
  expect(report.series[0]).toMatchObject({ revenue: 30023, cost: 12000 });
  expect(report.suppliers.pedia).toMatchObject({ revenue: 30023, cost: 12000 });
  expect(report.top_products[0]).toMatchObject({ revenue: 30023, cost: 12000 });
});

it("overview validates parameters before querying and retains legacy reports alongside selected metadata", async () => {
  process.env.ADMIN_EMAIL = "admin@axvara.tech";
  process.env.ADMIN_JWT_SECRET = "historical-secret-0123456789";
  process.env.ADMIN_PASSWORD_SHA256 = "a".repeat(64);
  vi.useFakeTimers(); vi.setSystemTime(now);
  const { createAdminToken, createIdleToken } = await import("@/lib/auth");
  const { token, sid } = await createAdminToken("admin@axvara.tech");
  const idle = await createIdleToken(sid);
  const { GET } = await import("@/app/api/admin/overview/route");
  const get = (query: string) => GET(new NextRequest(`http://localhost/api/admin/overview?${query}`, { headers: { cookie: `axvara_admin_token=${token}; axvara_idle=${idle}` } }));
  for (const query of ["date_from=2024-02-01", "date_to=2024-02-29", "date_from=2023-02-29&date_to=2023-03-01", "period=nope", "period=week&date_from=2024-02-01&date_to=2024-02-29", "date_from=2024-02-01&date_from=2024-02-02&date_to=2024-02-29", "date_from=2026-10-16&date_to=2026-10-16", "date_from=2024-03-01&date_to=2024-02-29"])
    expect((await get(query)).status).toBe(400);
  const response = await get("date_from=2024-02-01&date_to=2024-02-29");
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(Object.keys(body.period_reports)).toEqual(["today", "week", "month"]);
  expect(body.selected_report).toMatchObject({ from: "2024-02-01", to: "2024-02-29", timezone: "Asia/Jakarta", generated_at: now.toISOString(), revenue: 0 });
  expect(body.selected_report.series).toHaveLength(29);
});
