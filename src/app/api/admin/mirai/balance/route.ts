import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { fetchMiraiBalance } from "@/lib/mirai/client";
import { miraiBalanceVndToUsdt } from "@/lib/mirai/pricing";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const json = (v: unknown, status = 200) =>
  NextResponse.json(v, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) return json({ error: "unauthorized" }, 401);
  try {
    const response = await fetchMiraiBalance();
    if (response.kind !== "ok") {
      return json(
        { error: `balance_${response.kind}` },
        response.kind === "config" ? 503 : 502,
      );
    }
    return json({
      ok: true,
      balance: miraiBalanceVndToUsdt(response.balance_vnd),
      currency: "USDT",
    });
  } catch {
    return json({ error: "balance_unavailable" }, 503);
  }
}
