import { NextRequest } from "next/server";
import { financeRequest, financeId, updateRecurring, deleteRecurring, recurringUpdateSchema } from "@/lib/finance/expenses";
export const runtime = "edge";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export const PATCH = (req: NextRequest, ctx: Context) => financeRequest(req, async body => updateRecurring(await financeId(ctx.params),recurringUpdateSchema.parse(body)));
export const DELETE = (req: NextRequest, ctx: Context) => financeRequest(req, async () => deleteRecurring(await financeId(ctx.params)));
