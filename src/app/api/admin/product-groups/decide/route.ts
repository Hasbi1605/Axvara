// POST /api/admin/product-groups/decide — hitung ulang semua grup sekarang.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isD1Mode } from "@/lib/db";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { decideAllGroups } from "@/lib/product-groups";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!rateLimit(rateLimitKey(req, "products:write"), 20)) {
    return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isD1Mode()) return NextResponse.json({ error: "Butuh database D1" }, { status: 503 });
  try {
    return NextResponse.json(await decideAllGroups(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[product-groups] decide failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "decide_failed" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
