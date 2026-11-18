import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { fetchStorebatBalance, parseStorebatBalance } from "@/lib/storebat/client";
export const runtime = "edge";
export const dynamic = "force-dynamic";
const json=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{"Cache-Control":"private, no-store"}});
export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) return json({error:"unauthorized"},401);
  try {
    const response=await fetchStorebatBalance(), balance=response.kind==="ok" ? parseStorebatBalance(response.json) : null;
    if (!balance) return json({error:response.kind==="ok" ? "balance_shape" : `balance_${response.kind}`},response.kind==="config" ? 503 : 502);
    return json({ok:true,...balance});
  } catch { return json({error:"balance_unavailable"},503); }
}
