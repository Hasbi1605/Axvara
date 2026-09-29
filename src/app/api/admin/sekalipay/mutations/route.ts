// GET /api/admin/sekalipay/mutations — Mutasi saldo SK untuk audit.
// Fitur khas SK (WR tidak punya): credit/debit + before/after per invoice.
// Query: ?page=1&per_page=10&direction=credit|debit&type=topup|payment|refund.

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
  const direction = sp.get("direction")?.trim() || undefined;
  const type = sp.get("type")?.trim() || undefined;
  if (direction && direction !== "credit" && direction !== "debit") {
    return NextResponse.json({ error: "invalid_direction" }, { status: 400 });
  }
  try {
    const { getSkBalanceMutations } = await import("@/lib/sekalipay/saldo");
    const { mutations, meta } = await getSkBalanceMutations({
      page,
      perPage,
      direction: direction as "credit" | "debit" | undefined,
      type,
    });
    return NextResponse.json({ ok: true, mutations, meta });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "mutations_failed" },
      { status: 502 },
    );
  }
}
