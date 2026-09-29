// GET /api/admin/sekalipay/saldo — Saldo SK real-time + estimasi kapasitas.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isSkEnabled } from "@/lib/sekalipay/client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSkEnabled()) return NextResponse.json({ error: "sekalipay_disabled" }, { status: 503 });
  try {
    const { checkAndLogSkSaldo, estimateSkOrderCapacity, getSkSaldoHistory } = await import(
      "@/lib/sekalipay/saldo"
    );
    const [current, capacity, history] = await Promise.all([
      checkAndLogSkSaldo(),
      estimateSkOrderCapacity(),
      getSkSaldoHistory(10),
    ]);
    return NextResponse.json({ ok: true, current, capacity, history });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "saldo_check_failed" },
      { status: 502 },
    );
  }
}
