import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createBudgetedDatabase } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { publishAivaultCatalog } from "@/lib/aivault/catalog";
import { loadCurrentFxSnapshot } from "@/lib/payments/market-snapshot";
import { parseRateRational } from "@/lib/payments/fx";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  if (!await requireAdmin(request)) return NextResponse.json({error:"unauthorized"},{status:401});
  const raw=await readJsonBody(request,256);
  if (!raw.ok) return raw.response;
  if (!z.object({}).strict().safeParse(raw.data).success) return NextResponse.json({error:"invalid_body"},{status:400});
  try {
    const db=createBudgetedDatabase(40,0).access;
    const fx=await loadCurrentFxSnapshot(db.d1),rate=fx ? parseRateRational(fx.rateText) : null;
    if (!rate) return NextResponse.json({error:"fx_unavailable"},{status:503});
    const result=await publishAivaultCatalog(db,Number(rate.num)/Number(rate.den),{force:true});
    return NextResponse.json(result,{status:"ok" in result && result.ok ? 200 : 503});
  } catch { return NextResponse.json({error:"publish_failed"},{status:503}); }
}
