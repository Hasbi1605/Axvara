// GET /api/admin/tunvn/balance — saldo wallet TUNVN live (read-only).
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { fetchTunvnBalance, isTunvnConfigured } from "@/lib/tunvn/client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isTunvnConfigured()) return NextResponse.json({ ok: false, configured: false, error: "not_configured" }, { status: 503 });
  const balance = await fetchTunvnBalance();
  if (balance.kind !== "ok") {
    return NextResponse.json({ ok: false, configured: true, error: `balance_${balance.kind}` }, { status: 502 });
  }
  return NextResponse.json({ ok: true, configured: true, ...balance, balance: balance.balance_usdt, currency: "USDT" });
}
