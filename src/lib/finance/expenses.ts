import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { readJsonBody } from "@/lib/http-body";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { todayWibDateString } from "@/lib/revenue";
import { EXPENSE_CATEGORIES, EXPENSE_MAX_AMOUNT, EXPENSE_NOTE_MAX, emptyExpenseTotals, type Expense, type RecurringExpense, type ExpenseListResponse, type ExpenseCreateInput, type ExpenseUpdateInput, type RecurringUpdateInput } from "./types";

export class FinanceError extends Error {
  constructor(public code: string, public status = 400, message = code) { super(message); }
}
/** requireAdmin records the existing sanitized admin mutation audit event. */
export async function financeRequest(req: NextRequest, action: (body: unknown) => Promise<unknown>, status = 200) {
  const headers = { "Cache-Control": "no-store" };
  try {
    if (!(await requireAdmin(req))) throw new FinanceError("unauthorized",401);
    if (!createDatabaseAccess().d1) throw new FinanceError("database_unavailable",503);
    const write = req.method !== "GET";
    if (write && !rateLimit(rateLimitKey(req,"products:write"),30)) return NextResponse.json({ error: "rate_limited",message: "Coba lagi satu menit." },{ status:429,headers:{ ...headers,"Retry-After":"60" } });
    let data: unknown;
    if (["POST","PUT","PATCH"].includes(req.method)) {
      const body = await readJsonBody(req,2048);
      if (!body.ok) return NextResponse.json({ error:"invalid_body",message:"Body JSON tidak valid atau terlalu besar." },{ status:body.response.status,headers });
      data = body.data;
    }
    return NextResponse.json(await action(data),{ status,headers });
  } catch (error) {
    const known = error instanceof FinanceError, validation = error instanceof z.ZodError;
    if (!known && !validation) console.error("[finance] request failed");
    return NextResponse.json({ error: known ? error.code : validation ? "invalid_input" : "failed",message: known ? error.message : validation ? error.issues[0]?.message : "Permintaan gagal." },{ status:known ? error.status : validation ? 400 : 500,headers });
  }
}
export async function financeId(params: Promise<{ id: string }>) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new FinanceError("not_found",404);
  return Number(id);
}
export const validExpenseDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= "2026-01-01" && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) === date;
const fields = {
  spent_on: z.string().refine(validExpenseDate, "Tanggal tidak valid atau sebelum 2026."),
  category: z.enum(EXPENSE_CATEGORIES), amount: z.number().int().positive().max(EXPENSE_MAX_AMOUNT),
  note: z.string().trim().max(EXPENSE_NOTE_MAX).nullable().optional(),
  order_code: z.string().trim().min(1).max(100).nullable().optional(),
};
export const expenseCreateSchema = z.object({ ...fields, repeat_monthly: z.boolean().optional() }).strict();
export const expenseUpdateSchema = z.object(fields).partial().strict().refine(v => Object.keys(v).length > 0, "Minimal satu perubahan.");
export const recurringUpdateSchema = z.object({ category: fields.category, amount: fields.amount, note: fields.note, day_of_month: z.number().int().min(1).max(31), active: z.boolean() }).partial().strict().refine(v => Object.keys(v).length > 0, "Minimal satu perubahan.");
function assertDate(date: string, now = new Date()) {
  if (!validExpenseDate(date) || date > todayWibDateString(now)) throw new FinanceError("invalid_date", 400, "Tanggal pengeluaran tidak valid atau di masa depan (WIB).");
}
async function assertOrder(code: string | null | undefined, db: DatabaseAccess) {
  if (code && !await db.queryFirst("SELECT code FROM orders WHERE code=?", code)) throw new FinanceError("order_not_found");
}
const recurringRow = (row: Record<string, unknown>) => ({ ...row, active: Boolean(row.active) }) as RecurringExpense;
function previousWibMonthString(now = new Date()) {
  const d = new Date(`${todayWibDateString(now).slice(0,7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth()-1);
  return d.toISOString().slice(0,7);
}
export async function listExpenses(params: URLSearchParams, db: DatabaseAccess = createDatabaseAccess(), now = new Date()): Promise<ExpenseListResponse> {
  if (["month","from","to","category"].some(k => params.getAll(k).length > 1)) throw new FinanceError("invalid_range");
  let from: string, to: string;
  if (params.has("month") && (params.has("from") || params.has("to"))) throw new FinanceError("invalid_range");
  if (params.has("from") || params.has("to")) { from = params.get("from") ?? ""; to = params.get("to") ?? ""; }
  else {
    const month = params.get("month") ?? todayWibDateString(now).slice(0,7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new FinanceError("invalid_range");
    from = `${month}-01`;
    const end = new Date(`${from}T00:00:00Z`); end.setUTCMonth(end.getUTCMonth()+1,0); to = end.toISOString().slice(0,10);
  }
  if (!validExpenseDate(from) || !validExpenseDate(to) || from>to || (Date.parse(to)-Date.parse(from))/86400000>=366) throw new FinanceError("invalid_range");
  const category = params.get("category");
  if (category && !EXPENSE_CATEGORIES.includes(category as typeof EXPENSE_CATEGORIES[number])) throw new FinanceError("invalid_category");
  const expenses = await db.queryAll(`SELECT * FROM operating_expenses WHERE spent_on BETWEEN ? AND ?${category ? " AND category=?" : ""} ORDER BY spent_on DESC,id DESC`, from,to,...(category ? [category] : [])) as unknown as Expense[];
  const recurring = (await db.queryAll("SELECT * FROM expense_recurring ORDER BY active DESC,id DESC")).map(recurringRow);
  const totals = emptyExpenseTotals(); for (const row of expenses) totals[row.category] += row.amount;
  return { from,to,expenses,recurring,totals,total: expenses.reduce((s,r)=>s+r.amount,0) };
}
export async function createExpense(input: ExpenseCreateInput, db: DatabaseAccess = createDatabaseAccess(), now = new Date()) {
  const v = expenseCreateSchema.parse(input); assertDate(v.spent_on,now); await assertOrder(v.order_code,db);
  if (!db.d1) throw new FinanceError("database_unavailable",503);
  const args = [v.spent_on,v.category,v.amount,v.note ?? null,v.order_code ?? null];
  let id: number;
  if (v.repeat_monthly) {
    const batch = await db.d1.batch([
      db.d1.prepare("INSERT INTO expense_recurring(category,amount,note,day_of_month,start_month,last_generated_month) VALUES(?,?,?,?,?,?)").bind(v.category,v.amount,v.note ?? null,Number(v.spent_on.slice(8)),v.spent_on.slice(0,7),v.spent_on.slice(0,7)),
      db.d1.prepare("INSERT INTO operating_expenses(spent_on,category,amount,note,order_code,recurring_id,recurring_month) VALUES(?,?,?,?,?,last_insert_rowid(),?)").bind(...args,v.spent_on.slice(0,7)),
    ]); id = Number(batch[1].meta.last_row_id);
  } else {
    const result = await db.execRun("INSERT INTO operating_expenses(spent_on,category,amount,note,order_code) VALUES(?,?,?,?,?)",...args); id = Number(result.lastInsertRowid);
  }
  const expense = await db.queryFirst("SELECT * FROM operating_expenses WHERE id=?",id) as unknown as Expense;
  const recurring = expense.recurring_id ? recurringRow((await db.queryFirst("SELECT * FROM expense_recurring WHERE id=?",expense.recurring_id))!) : null;
  return { expense,recurring };
}
export async function updateExpense(id: number, input: ExpenseUpdateInput, db: DatabaseAccess = createDatabaseAccess(), now = new Date()) {
  const v = expenseUpdateSchema.parse(input); if (v.spent_on) assertDate(v.spent_on,now); await assertOrder(v.order_code,db);
  const entries = Object.entries(v);
  const result = await db.execRun(`UPDATE operating_expenses SET ${entries.map(([k])=>`${k}=?`).join(",")},updated_at=datetime('now') WHERE id=?`,...entries.map(([,v])=>v),id);
  if (!result.changes) throw new FinanceError("not_found",404);
  return { expense: await db.queryFirst("SELECT * FROM operating_expenses WHERE id=?",id) as unknown as Expense };
}
export async function deleteExpense(id: number, db: DatabaseAccess = createDatabaseAccess()) {
  if (!(await db.execRun("DELETE FROM operating_expenses WHERE id=?",id)).changes) throw new FinanceError("not_found",404);
  return { ok: true };
}
export async function updateRecurring(id: number, input: RecurringUpdateInput, db: DatabaseAccess = createDatabaseAccess(), now = new Date()) {
  const v = recurringUpdateSchema.parse(input), entries = Object.entries(v);
  // Owner decision 2026-11-21: cash basis. Resuming (active 0→1) moves the
  // generation cursor to the previous WIB month so paused months are never
  // backfilled; only the resume month onward is booked. Catch-up for templates
  // that stayed active is untouched.
  const resumedCursor = v.active === true ? previousWibMonthString(now) : null;
  const result = await db.execRun(`UPDATE expense_recurring SET ${entries.map(([k])=>`${k}=?`).join(",")},
    last_generated_month=CASE WHEN ? IS NOT NULL AND active=0 AND (last_generated_month IS NULL OR last_generated_month<?) THEN ? ELSE last_generated_month END,
    updated_at=datetime('now') WHERE id=?`,...entries.map(([,v])=>typeof v === "boolean" ? Number(v) : v),resumedCursor,resumedCursor,resumedCursor,id);
  if (!result.changes) throw new FinanceError("not_found",404);
  return { recurring: recurringRow((await db.queryFirst("SELECT * FROM expense_recurring WHERE id=?",id))!) };
}
export async function deleteRecurring(id: number, db: DatabaseAccess = createDatabaseAccess()) {
  if (!(await db.execRun("DELETE FROM expense_recurring WHERE id=?",id)).changes) throw new FinanceError("not_found",404);
  return { ok: true };
}
export async function materializeRecurring(db: DatabaseAccess = createDatabaseAccess(), now = new Date()) {
  if (!db.d1 || !db.canSpend(3)) return 0;
  const today = todayWibDateString(now), current = today.slice(0,7);
  const templates = await db.queryAll(`WITH due AS (
    SELECT *,CASE WHEN last_generated_month IS NULL THEN start_month ELSE strftime('%Y-%m',last_generated_month||'-01','+1 month') END next_month
    FROM expense_recurring WHERE active=1 AND start_month<=?
  ) SELECT * FROM due WHERE next_month<? OR (next_month=? AND
    CAST(substr(?,9,2) AS INTEGER)>=MIN(day_of_month,CAST(strftime('%d',?||'-01','+1 month','-1 day') AS INTEGER)))
    ORDER BY next_month,id LIMIT 3`,current,current,current,today,current);
  let generated = 0, processed = 0;
  for (const t of templates) {
    let month = String(t.start_month);
    if (t.last_generated_month) { const d = new Date(`${t.last_generated_month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth()+1); month = d.toISOString().slice(0,7); }
    while (month <= current && processed < 3 && db.canSpend(2)) {
      const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth()+1,0);
      const spent = `${month}-${String(Math.min(Number(t.day_of_month),d.getUTCDate())).padStart(2,"0")}`;
      if (spent > today) break;
      const result = await db.d1.batch([
        db.d1.prepare("INSERT OR IGNORE INTO operating_expenses(spent_on,category,amount,note,recurring_id,recurring_month) SELECT ?,category,amount,note,id,? FROM expense_recurring WHERE id=? AND active=1").bind(spent,month,t.id),
        db.d1.prepare("UPDATE expense_recurring SET last_generated_month=MAX(COALESCE(last_generated_month,''),?),updated_at=datetime('now') WHERE id=? AND active=1").bind(month,t.id),
      ]);
      // D1 meta.changes includes revision-trigger writes; count expense rows only.
      generated += Number(result[0].meta.changes ?? 0) > 0 ? 1 : 0; processed++;
      d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()+1); month = d.toISOString().slice(0,7);
    }
  }
  return generated;
}
