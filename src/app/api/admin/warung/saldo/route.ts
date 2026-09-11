// GET /api/admin/warung/saldo — Saldo WR real-time + estimasi kapasitas.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isWrEnabled } from "@/lib/warung-rebahan/client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isWrEnabled()) return NextResponse.json({ error: "warung_rebahan_disabled" }, { status: 503 });
  try {
    const { checkAndLogSaldo, estimateOrderCapacity, getSaldoHistory } = await import(
      "@/lib/warung-rebahan/saldo"
    );
    const [current, capacity, history] = await Promise.all([
      checkAndLogSaldo(),
      estimateOrderCapacity(),
      getSaldoHistory(10),
    ]);
    return NextResponse.json({ ok: true, current, capacity, history });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "saldo_check_failed" },
      { status: 502 },
    );
  }
}
