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
