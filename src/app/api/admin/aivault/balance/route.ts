import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { fetchAivaultBalance, parseAivaultBalance } from "@/lib/aivault/client";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) return NextResponse.json({error:"unauthorized"},{status:401});
  try {
    const response=await fetchAivaultBalance(), balance=response.kind==="ok" ? parseAivaultBalance(response.json) : null;
    if (!balance) return NextResponse.json({error:`balance_${response.kind}`},{status:response.kind==="config" ? 503 : 502});
    return NextResponse.json({ok:true,...balance},{headers:{"Cache-Control":"private, no-store"}});
  } catch { return NextResponse.json({error:"balance_unavailable"},{status:503}); }
}
