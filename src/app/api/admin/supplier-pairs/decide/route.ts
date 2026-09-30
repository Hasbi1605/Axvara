// POST /api/admin/supplier-pairs/decide — Hitung ulang semua pemenang
// dari stok+modal live (sama dengan yang cron kerjakan tiap sweep).

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { decideAllWinners } = await import("@/lib/supplier-pairs");
    const result = await decideAllWinners();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "decide_failed" },
      { status: 502 },
    );
  }
}
