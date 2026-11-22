import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { fetchPixelverifCredits } from "@/lib/pixelverif/client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const json = (v: unknown, status = 200) =>
  NextResponse.json(v, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) return json({ error: "unauthorized" }, 401);
  try {
    const response = await fetchPixelverifCredits();
    if (response.kind !== "ok") {
      return json(
        { error: `balance_${response.kind}` },
        response.kind === "config" ? 503 : 502,
      );
    }
    return json({
      ok: true,
      balance: response.data.credits_remaining,
      currency: "USD",
      credits_remaining: response.data.credits_remaining,
    });
  } catch {
    return json({ error: "balance_unavailable" }, 503);
  }
}
