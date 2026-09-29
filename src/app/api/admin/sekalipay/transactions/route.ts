// GET /api/admin/sekalipay/transactions — Daftar transaksi SK (audit).
// Fitur khas SK (WR tidak punya list trx): ?page=1&per_page=10.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isSkEnabled } from "@/lib/sekalipay/client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSkEnabled()) return NextResponse.json({ error: "sekalipay_disabled" }, { status: 503 });
  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") || 1));
  const perPage = Math.max(1, Math.min(100, Number(sp.get("per_page") || 10)));
  try {
    const { fetchSkTransactions } = await import("@/lib/sekalipay/client");
    const res = await fetchSkTransactions({ page, perPage });
    return NextResponse.json({ ok: true, ...res.data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "transactions_failed" },
      { status: 502 },
    );
  }
}
