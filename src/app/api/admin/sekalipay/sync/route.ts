// POST /api/admin/sekalipay/sync — Force sync produk SK sekarang.
// Rate limit ketat (scope products:write, berbagi dengan sync WR) agar tombol
// admin tidak membanjiri API SK maupun D1.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isSkEnabled } from "@/lib/sekalipay/client";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!checkRateLimit(request, "products:write")) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!isSkEnabled()) return NextResponse.json({ error: "sekalipay_disabled" }, { status: 503 });
  try {
    const { syncSkProducts } = await import("@/lib/sekalipay/sync");
    const result = await syncSkProducts(undefined, undefined, { trigger: "manual" });
    const status = result.errors.length === 0
      ? (result.budgetYielded ? "partial" : "success")
      : result.synced > 0 ? "partial" : "failed";
    return NextResponse.json({ ok: status !== "failed", status, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "sync_failed" },
      { status: 502 },
    );
  }
}
