// POST /api/admin/warung/sync — Force sync produk WR sekarang.
// Rate limit ketat (2/mnt, scope products:write) agar tombol admin tidak
// membanjiri API WR maupun D1.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isWrEnabled } from "@/lib/warung-rebahan/client";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!checkRateLimit(request, "products:write")) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!isWrEnabled()) return NextResponse.json({ error: "warung_rebahan_disabled" }, { status: 503 });
  try {
    const { syncProducts } = await import("@/lib/warung-rebahan/sync");
    const result = await syncProducts();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "sync_failed" },
      { status: 502 },
    );
  }
}
