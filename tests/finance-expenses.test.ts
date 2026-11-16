import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder } from "./helpers/d1-fixture";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { createExpense, deleteExpense, deleteRecurring, listExpenses, materializeRecurring, updateExpense, updateRecurring } from "@/lib/finance/expenses";
import { financeCacheRevision, readPaymentFees, savePaymentFees } from "@/lib/finance/payment-fees";
import { readFinancialReport, readOverviewFinancialReport, readSelectedFinancialReport } from "@/lib/dashboard-report";
import { reportTables } from "@/lib/reports/export";
import { readAdminOverviewSnapshot } from "@/lib/admin-overview-cache";

const auth = vi.hoisted(() => ({ allowed:true }));
vi.mock("@/lib/auth",() => ({ requireAdmin:vi.fn(async () => auth.allowed ? { email:"fixture" } : null) }));
let f: ReturnType<typeof createD1Fixture>;
const now = new Date("2026-11-16T10:00:00Z");
beforeEach(() => { f = createD1Fixture(); auth.allowed = true; });
afterEach(() => { f.close(); vi.unstubAllEnvs(); vi.useRealTimers(); });
const expense = (spent_on = "2026-11-16",amount = 100) => createExpense({ spent_on,amount,category:"hosting" },createDatabaseAccess(f.db),now);
function paid(code: string,date = "2026-11-16T00:00:00Z") {
  insertTestOrder(f.sql,code,{ status:"lunas",channel:"web",items:[{ product_id:1,variant_id:1,name:"Manual",qty:1,price:10000 }] });
  f.sql.prepare("UPDATE orders SET paid_at=? WHERE code=?").run(date,code);
}
function product() {
  f.sql.exec("INSERT INTO products(id,name,slug,price) VALUES(1,'Manual','manual',10000); INSERT INTO product_variants(id,product_id,sku,label,price,manual_cost) VALUES(1,1,'MAN','Manual',10000,4000)");
}

describe("expense lifecycle",() => {
  it("creates an atomic template + expense, edits, filters, and preserves entries when template deleted",async () => {
    product(); paid("ORDER");
    const created = await createExpense({ spent_on:"2026-10-31",category:"refund",amount:700,note:"test",order_code:"ORDER",repeat_monthly:true },createDatabaseAccess(f.db),now);
    expect(created.recurring).toMatchObject({ day_of_month:31,start_month:"2026-10",last_generated_month:"2026-10",active:true });
    expect(created.expense.recurring_id).toBe(created.recurring!.id);
    await updateExpense(created.expense.id,{ amount:800,category:"replace" });
    await updateRecurring(created.recurring!.id,{ amount:900,active:false });
    const list = await listExpenses(new URLSearchParams("month=2026-10&category=replace"));
    expect(list).toMatchObject({ from:"2026-10-01",to:"2026-10-31",total:800,totals:{ replace:800 },recurring:[{ amount:900,active:false }] });
    await deleteRecurring(created.recurring!.id);
    expect((await listExpenses(new URLSearchParams("month=2026-10"))).expenses[0].recurring_id).toBeNull();
    await deleteExpense(created.expense.id);
    expect((await listExpenses(new URLSearchParams("month=2026-10"))).expenses).toEqual([]);
  });
  it("rolls back both writes on an interrupted D1 batch",async () => {
    f.control.fail = q => q.startsWith("INSERT INTO operating_expenses");
    await expect(createExpense({ spent_on:"2026-11-16",category:"hosting",amount:10,repeat_monthly:true },createDatabaseAccess(f.db),now)).rejects.toThrow();
    expect(f.sql.prepare("SELECT COUNT(*) n FROM expense_recurring").get()?.n).toBe(0);
  });
  it("validates calendar dates, future WIB dates, missing orders and ranges",async () => {
    for (const date of ["2026-02-30","2025-12-31","2026-11-17","garbage"]) await expect(expense(date)).rejects.toThrow();
    await expect(createExpense({ spent_on:"2026-11-16",category:"other",amount:1,order_code:"MISSING" },createDatabaseAccess(f.db),now)).rejects.toMatchObject({ code:"order_not_found" });
    await expect(listExpenses(new URLSearchParams("from=2026-01-01&to=2027-01-02"))).rejects.toMatchObject({ code:"invalid_range" });
    await expect(listExpenses(new URLSearchParams("month=2026-13"))).rejects.toThrow();
    await expect(listExpenses(new URLSearchParams("month=2026-11&from=2026-01-01"))).rejects.toThrow();
    await expect(listExpenses(new URLSearchParams("category=unknown"))).rejects.toThrow();
    for (const fn of [updateExpense(999,{amount:1}),deleteExpense(999),updateRecurring(999,{active:false}),deleteRecurring(999)]) await expect(fn).rejects.toMatchObject({ code:"not_found",status:404 });
    expect(() => f.sql.exec("INSERT INTO operating_expenses(spent_on,category,amount) VALUES('2026-02-30','hosting',1)")).toThrow();
    expect(() => f.sql.exec("INSERT INTO operating_expenses(spent_on,category,amount) VALUES('garbage','hosting',1)")).toThrow();
  });
});

describe("recurring generation",() => {
  it("clamps day31 in February, stays idempotent and never back-generates before start",async () => {
    f.sql.exec("INSERT INTO expense_recurring(category,amount,day_of_month,start_month) VALUES('hosting',100,31,'2026-02')");
    const db = createDatabaseAccess(f.db);
    expect(await materializeRecurring(db,new Date("2026-02-27T16:00:00Z"))).toBe(0);
    expect(await materializeRecurring(db,new Date("2026-02-27T17:00:00Z"))).toBe(1);
    expect(await materializeRecurring(db,new Date("2026-02-28T12:00:00Z"))).toBe(0);
    expect(f.sql.prepare("SELECT spent_on FROM operating_expenses").all()).toEqual([{spent_on:"2026-02-28"}]);
    await updateRecurring(1,{active:false});
    expect(await materializeRecurring(db,new Date("2026-05-31T12:00:00Z"))).toBe(0);
  });
  it("catches up at most3 months per run and respects budget",async () => {
    f.sql.exec("INSERT INTO expense_recurring(category,amount,day_of_month,start_month) VALUES('internet',100,1,'2026-01')");
    const budget = createBudgetedDatabase(9,2,f.db);
    expect(await materializeRecurring(budget.access,now)).toBe(3);
    expect(budget.used).toBe(7);
    expect(f.sql.prepare("SELECT last_generated_month FROM expense_recurring").get()?.last_generated_month).toBe("2026-03");
    expect(await materializeRecurring(budget.access,now)).toBe(0);
    expect(await materializeRecurring(createDatabaseAccess(f.db),now)).toBe(3);
    expect(f.sql.prepare("SELECT COUNT(*) n FROM operating_expenses").get()?.n).toBe(6);
  });
  it("not-yet-due templates cannot starve a due one",async () => {
    f.sql.exec("INSERT INTO expense_recurring(category,amount,day_of_month,start_month) VALUES('hosting',100,31,'2026-11'),('hosting',100,31,'2026-11'),('hosting',100,31,'2026-11'),('hosting',100,16,'2026-11')");
    expect(await materializeRecurring(createDatabaseAccess(f.db),now)).toBe(1);
    expect(f.sql.prepare("SELECT recurring_id FROM operating_expenses").get()?.recurring_id).toBe(4);
  });
});

describe("financial reports",() => {
  it("deducts gateway fees+MDR once, keeps unique bonus inside revenue and exports every expense category",async () => {
    product(); paid("PAID");
    f.sql.exec("INSERT INTO order_item_costs(order_code,item_index,source,unit_cost) VALUES('PAID',0,'manual',4000); INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,gateway_fee,status,paid_at) VALUES('PAID','dana','test','p','m',10000,10023,200,'paid','2026-11-16T00:00:00Z')");
    await savePaymentFees({mdr_bps:{gopay:0,klikqris:0,dana:70}});
    await expense();
    await createExpense({spent_on:"2026-11-16",amount:300,category:"refund"});
    const report = await readSelectedFinancialReport("today",now);
    expect(report).toMatchObject({revenue:10023,cost:4000,profit:6023,payment_fees:270,unique_code_bonus:23,operational_expenses:100,refund_expenses:300,net_profit:5353,estimated_order_codes:[]});
    expect(report.series.find(p=>p.date==="00:00")).toMatchObject({expenses:400,net_profit:-400});
    expect(report.series.find(p=>p.date==="07:00")).toMatchObject({payment_fees:270,net_profit:5753});
    expect(report.series.reduce((sum,p)=>sum+p.net_profit,0)).toBe(report.net_profit);
    const rows = reportTables(report)[0].rows;
    for (const label of ["Biaya pembayaran (Rp)","Refund & replace (Rp)","Operasional (Rp)","Untung bersih (Rp)","Bonus kode unik (info, Rp)"]) expect(rows.some(r=>r[0]===label)).toBe(true);
    expect(rows.filter(r=>String(r[0]).startsWith("Pengeluaran:"))).toHaveLength(8);
  });
  it("uses WIB, Monday-start week, month and custom boundaries even with no revenue",async () => {
    for (const date of ["2026-10-31","2026-11-01","2026-11-15","2026-11-16"]) await expense(date);
    const {reports,daily} = await readFinancialReport(now);
    expect(reports.today.operational_expenses).toBe(100);
    expect(reports.week.operational_expenses).toBe(100);
    expect(reports.month.operational_expenses).toBe(300);
    expect(reports.total.operational_expenses).toBe(400);
    expect(reports.month.net_profit).toBe(-300);
    expect(daily.find(p=>p.date==="2026-11-15")).toMatchObject({expenses:100,net_profit:-100});
    const custom = await readSelectedFinancialReport({date_from:"2026-10-31",date_to:"2026-11-01"},now);
    expect(custom.operational_expenses).toBe(200);
    expect(custom.series.map(p=>p.net_profit)).toEqual([-100,-100]);
  });
  it("returns at most20 unique estimated order codes",async () => {
    product(); for (let i=0;i<25;i++) paid(`EST-${String(i).padStart(2,"0")}`);
    const report = await readSelectedFinancialReport("today",now);
    expect(report.estimated_orders).toBe(25); expect(report.estimated_order_codes).toHaveLength(20);
    expect(new Set(report.estimated_order_codes).size).toBe(20);
  });
  it("invalidates BOTH caches immediately after expense edits, cron inserts, deletes and fee changes",async () => {
    vi.stubEnv("NODE_ENV","production"); vi.useFakeTimers(); vi.setSystemTime(now);
    const load = vi.fn(async () => ({cacheable:true,value:await readOverviewFinancialReport(now)}));
    const read = async () => readAdminOverviewSnapshot(await financeCacheRevision(),load);
    expect((await read()).reports.today.net_profit).toBe(0);
    await read(); expect(load).toHaveBeenCalledTimes(1);
    const created = await expense();
    expect((await read()).reports.today.net_profit).toBe(-100);
    await updateExpense(created.expense.id,{amount:200});
    expect((await read()).reports.today.net_profit).toBe(-200);
    await deleteExpense(created.expense.id);
    expect((await read()).reports.today.net_profit).toBe(0);
    f.sql.exec("INSERT INTO expense_recurring(category,amount,day_of_month,start_month) VALUES('hosting',300,16,'2026-11')");
    await materializeRecurring(createDatabaseAccess(f.db),now);
    expect((await read()).reports.today.net_profit).toBe(-300);
    const revision = await financeCacheRevision();
    await savePaymentFees({mdr_bps:{gopay:70,klikqris:0,dana:0}});
    expect(await financeCacheRevision()).not.toBe(revision);
    await read(); expect(load).toHaveBeenCalledTimes(6);
  });
});

it("0130 backfills only paid manual missing costs and freezes FX without changing stored snapshots on replay",() => {
  product();
  f.sql.exec("INSERT INTO products(id,name,slug,price) VALUES(2,'T','t',100), (3,'A','a',100); INSERT INTO product_variants(id,product_id,sku,label,price) VALUES(2,2,'TUNVN-86','T',100),(3,3,'AV-s','A',100); INSERT INTO tunvn_products(supplier_product_id,name,fx_idr_per_usdt) VALUES(86,'T',18000); INSERT INTO aivault_products(service_id,name,unit_price_usd,pricing_tiers_json,fx_idr_per_usd) VALUES('s','A',1,'[]',17000); INSERT INTO crypto_market_snapshot(id,fx_rate_text) VALUES(1,'16000');");
  paid("OLD"); paid("SNAP");
  for (const [id,kind] of ["wr","sk","tunvn","aivault"].entries()) {
    const variant = id+4;
    f.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,manual_cost,wr_variant_id,sk_variant_id,aivault_service_id) VALUES(?,1,?,'Skip',100,?,?,?,?)").run(variant,kind==="tunvn" ? "TUNVN-42" : `SKIP-${kind}`,4000,kind==="wr" ? "w" : null,kind==="sk" ? "s" : null,kind==="aivault" ? "s" : null);
    insertTestOrder(f.sql,`SKIP-${kind}`,{status:"lunas",items:[{product_id:1,variant_id:variant,qty:1,price:100}]});
  }
  paid("PEDIA"); f.sql.exec("UPDATE orders SET order_kind='pedia' WHERE code='PEDIA'");
  insertTestOrder(f.sql,"PENDING");
  paid("T"); paid("A");
  f.sql.exec("INSERT INTO order_item_costs(order_code,item_index,source,unit_cost) VALUES('SNAP',0,'manual',123); INSERT INTO tunvn_order_links(order_code,item_index,variant_id,product_id,kind,source_product_id,quantity,cost_usdt) VALUES('T',0,2,2,'account',86,1,2); INSERT INTO aivault_order_links(order_code,item_index,variant_id,product_id,service_id,quantity,cost_usd,external_order_id) VALUES('A',0,3,3,'s',1,1,'A-0'); ALTER TABLE tunvn_order_links DROP COLUMN fx_idr_per_usdt; ALTER TABLE aivault_order_links DROP COLUMN fx_idr_per_usd;");
  const migration = readFileSync("drizzle/migrations/0130_finance_expenses.sql","utf8");
  f.sql.exec(migration);
  expect(f.sql.prepare("SELECT unit_cost FROM order_item_costs WHERE order_code='OLD'").get()?.unit_cost).toBe(4000);
  expect(f.sql.prepare("SELECT unit_cost FROM order_item_costs WHERE order_code='SNAP'").get()?.unit_cost).toBe(123);
  expect(f.sql.prepare("SELECT * FROM order_item_costs WHERE order_code='PENDING'").get()).toBeUndefined();
  expect(f.sql.prepare("SELECT * FROM order_item_costs WHERE order_code LIKE 'SKIP-%' OR order_code='PEDIA'").all()).toEqual([]);
  expect(f.sql.prepare("SELECT fx_idr_per_usdt fx FROM tunvn_order_links").get()?.fx).toBe(18000);
  expect(f.sql.prepare("SELECT fx_idr_per_usd fx FROM aivault_order_links").get()?.fx).toBe(17000);
  f.sql.exec("UPDATE product_variants SET manual_cost=9000; UPDATE tunvn_products SET fx_idr_per_usdt=19000; UPDATE aivault_products SET fx_idr_per_usd=20000");
  f.sql.exec(migration.split("-- BACKFILLS")[1]);
  expect(f.sql.prepare("SELECT unit_cost FROM order_item_costs WHERE order_code='OLD'").get()?.unit_cost).toBe(4000);
  expect(f.sql.prepare("SELECT fx_idr_per_usdt fx FROM tunvn_order_links").get()?.fx).toBe(18000);
  expect(f.sql.prepare("SELECT fx_idr_per_usd fx FROM aivault_order_links").get()?.fx).toBe(17000);
  expect(f.sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});

describe("finance API",() => {
  let ip = 0;
  const request = (path: string,method = "GET",body?: unknown) => new NextRequest(`https://fixture.test/api/admin/${path}`,{method,headers:{"cf-connecting-ip":`192.0.2.${++ip}`,"Content-Type":"application/json"},...(body === undefined ? {} : {body:JSON.stringify(body)})});
  it("requires admin and returns no-store JSON errors",async () => {
    const route = await import("@/app/api/admin/expenses/route"); auth.allowed = false;
    const response = await route.GET(request("expenses"));
    expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({error:"unauthorized",message:expect.any(String)});
  });
  it.each([{amount:0},{amount:1e9+1},{spent_on:"2099-01-01"},{spent_on:"2026-02-30"},{category:"bad"},{extra:1},{note:"x".repeat(201)}])("rejects invalid/strict expense body %j",async patch => {
    const {POST} = await import("@/app/api/admin/expenses/route");
    const response = await POST(request("expenses","POST",{spent_on:"2026-01-01",category:"hosting",amount:1,...patch}));
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({error:expect.any(String),message:expect.any(String)});
  });
  it("supports mutations, order_not_found,404 and recurring routes",async () => {
    const collection = await import("@/app/api/admin/expenses/route");
    const single = await import("@/app/api/admin/expenses/[id]/route");
    const template = await import("@/app/api/admin/expenses/recurring/[id]/route");
    const ctx = (id:string) => ({params:Promise.resolve({id})});
    let response = await collection.POST(request("expenses","POST",{spent_on:"2026-01-01",category:"hosting",amount:1,order_code:"MISSING"}));
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({error:"order_not_found"});
    response = await collection.POST(request("expenses","POST",{spent_on:"2026-01-01",category:"hosting",amount:1,repeat_monthly:true}));
    expect(response.status).toBe(201);
    expect((await single.PATCH(request("expenses/1","PATCH",{}),ctx("1"))).status).toBe(400);
    expect((await single.PATCH(request("expenses/1","PATCH",{amount:2}),ctx("1"))).status).toBe(200);
    expect((await template.PATCH(request("expenses/recurring/1","PATCH",{active:false}),ctx("1"))).status).toBe(200);
    expect((await template.DELETE(request("expenses/recurring/1","DELETE"),ctx("1"))).status).toBe(200);
    expect((await single.DELETE(request("expenses/1","DELETE"),ctx("1"))).status).toBe(200);
    expect((await single.DELETE(request("expenses/999","DELETE"),ctx("999"))).status).toBe(404);
    expect((await single.DELETE(request("expenses/no","DELETE"),ctx("no"))).status).toBe(404);
  });
  it("validates MDR integers/bounds/providers and stores defaults",async () => {
    const {GET,PUT} = await import("@/app/api/admin/payment-fees/route");
    expect(await (await GET(request("payment-fees"))).json()).toEqual({mdr_bps:{gopay:0,klikqris:0,dana:0}});
    for (const value of [-1,1001,0.1,"70"]) expect((await PUT(request("payment-fees","PUT",{mdr_bps:{gopay:value,klikqris:0,dana:0}}))).status).toBe(400);
    expect((await PUT(request("payment-fees","PUT",{mdr_bps:{gopay:0,klikqris:70,dana:70}}))).status).toBe(200);
    expect(await readPaymentFees()).toEqual({mdr_bps:{gopay:0,klikqris:70,dana:70}});
  });
});
