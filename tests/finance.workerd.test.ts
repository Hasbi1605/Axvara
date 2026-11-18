import { expect,it } from "vitest";
import { Miniflare } from "miniflare";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createBudgetedDatabase,createDatabaseAccess } from "@/lib/db-access";
import { createExpense,materializeRecurring } from "@/lib/finance/expenses";
import { financeCacheRevision } from "@/lib/finance/payment-fees";
import type { D1 } from "@/lib/db";

it("native D1 batches expense/template atomically, runs revision triggers and clamps recurring dates",async()=>{
  const runtime=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:"2026-08-06",d1Databases:["DB"]});
  const fixture=createD1Fixture();
  try {
    const native=await runtime.getD1Database("DB"),db=native as unknown as D1;
    const names="('store_settings','expense_recurring','operating_expenses','orders','expense_insert_revision','expense_update_revision','expense_delete_revision')";
    const schema=fixture.sql.prepare(`SELECT sql FROM sqlite_master WHERE name IN ${names} ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as {sql:string}[];
    await native.batch(schema.map(row=>native.prepare(row.sql)));
    const access=createDatabaseAccess(db),now=new Date("2026-01-31T12:00:00Z");
    const before=await financeCacheRevision(access);
    const expense=await createExpense({spent_on:"2026-01-31",category:"hosting",amount:100,repeat_monthly:true},access,now);
    expect(expense.expense.recurring_id).toBe(expense.recurring!.id);
    expect(await financeCacheRevision(access)).not.toBe(before);
    const budget=createBudgetedDatabase(9,2,db);
    expect(await materializeRecurring(budget.access,new Date("2026-04-30T12:00:00Z"))).toBe(3);
    expect(budget.used).toBe(7);
    expect((await native.prepare("SELECT spent_on FROM operating_expenses ORDER BY spent_on").all()).results).toEqual([{spent_on:"2026-01-31"},{spent_on:"2026-02-28"},{spent_on:"2026-03-31"},{spent_on:"2026-04-30"}]);
    expect(await materializeRecurring(access,new Date("2026-04-30T12:00:00Z"))).toBe(0);
  } finally {fixture.close();await runtime.dispose();}
},15000);

it("native D1 applies Jaspay receipt migration, pins amount and invalidates only on financial changes", async () => {
  const runtime=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:"2026-08-06",d1Databases:["DB"]});
  try {
    const { readFileSync } = await import("node:fs");
    const { persistJaspayProgress } = await import("@/lib/warung-rebahan/progress");
    const db=await runtime.getD1Database("DB");
    await db.exec("CREATE TABLE store_settings(key TEXT PRIMARY KEY,value TEXT);\nCREATE TABLE wr_order_links(id INTEGER PRIMARY KEY,wr_variant_id TEXT,wr_order_id TEXT,quantity INTEGER,status TEXT,jaspay_progress TEXT);\nINSERT INTO wr_order_links VALUES(1,'jaspay:wink:id','JSP-A',2,'processing',NULL);");
    const migration=readFileSync("drizzle/migrations/0136_jaspay_invoice_receipts.sql","utf8").replace(/^--.*$/gm, "");
    const trigger=migration.indexOf("CREATE TRIGGER");
    await db.batch([...migration.slice(0,trigger).split(";").map(s=>s.trim()).filter(Boolean),migration.slice(trigger)].map(s=>db.prepare(s)));
    const access=createDatabaseAccess(db as unknown as D1);
    const link={id:1,wr_variant_id:"jaspay:wink:id",quantity:2};
    const receipt={invoice:"JSP-A",product:"wink",quantity:2,status:"processing" as const,total:11000,refunded:0,accounts:[],success_count:0};
    const before=await financeCacheRevision(access);
    await persistJaspayProgress(link,{...receipt,invoice:"JSP-B"},access);
    await persistJaspayProgress(link,{...receipt,quantity:1},access);
    await persistJaspayProgress(link,{...receipt,total:NaN},access);
    expect(await financeCacheRevision(access)).toBe(before);
    await persistJaspayProgress(link,receipt,access);
    const charged=await financeCacheRevision(access);
    expect(charged).not.toBe(before);
    await db.prepare("UPDATE wr_order_links SET status='completed'").run();
    await persistJaspayProgress(link,{...receipt,total:12000,refunded:1000},access,true);
    await persistJaspayProgress(link,{...receipt,refunded:12000},access,true);
    expect(await financeCacheRevision(access)).toBe(charged);
    await persistJaspayProgress(link,{...receipt,refunded:5000},access,true);
    const refunded=await financeCacheRevision(access);
    expect(refunded).not.toBe(charged);
    await persistJaspayProgress(link,{...receipt,refunded:5000},access,true);
    await persistJaspayProgress(link,receipt,access);
    expect(await financeCacheRevision(access)).toBe(refunded);
    expect(await db.prepare("SELECT status,jaspay_invoice_total,jaspay_refunded_total FROM wr_order_links").first())
      .toEqual({status:"completed",jaspay_invoice_total:11000,jaspay_refunded_total:5000});
  } finally {await runtime.dispose();}
},15000);
