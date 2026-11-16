import { NextRequest } from "next/server";
import { financeRequest, financeId, updateExpense, deleteExpense, expenseUpdateSchema } from "@/lib/finance/expenses";
export const runtime = "edge";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export const PATCH = (req: NextRequest, ctx: Context) => financeRequest(req, async body => updateExpense(await financeId(ctx.params),expenseUpdateSchema.parse(body)));
export const DELETE = (req: NextRequest, ctx: Context) => financeRequest(req, async () => deleteExpense(await financeId(ctx.params)));
