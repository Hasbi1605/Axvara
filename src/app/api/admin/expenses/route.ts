import { NextRequest } from "next/server";
import { financeRequest, listExpenses, createExpense, expenseCreateSchema } from "@/lib/finance/expenses";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export const GET = (req: NextRequest) => financeRequest(req, () => listExpenses(req.nextUrl.searchParams));
export const POST = (req: NextRequest) => financeRequest(req, body => createExpense(expenseCreateSchema.parse(body)),201);
