// GET /api/admin/sekalipay/saldo — Saldo SK real-time + estimasi kapasitas.
//
// Kontrak 2026-09-30 (bug "gagal memuat saldo SK" saat search/panel sibuk):
// sama dengan WR — live best-effort + fallback cache D1 (sk_saldo_log)
// + flag `stale`, bukan 502 buta.

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
    let current: Awaited<ReturnType<typeof checkAndLogSkSaldo>> | null = null;
    let liveError: string | null = null;
    try {
      current = await checkAndLogSkSaldo();
    } catch (error) {
      liveError = error instanceof Error ? error.message : "saldo_live_failed";
    }
    const [capacity, history] = await Promise.all([
      estimateSkOrderCapacity(),
      getSkSaldoHistory(10),
    ]);
    if (!current) {
      const last = history[0];
      if (last) {
        return NextResponse.json({
          ok: true,
          current: { balance: last.balance, isLow: false, threshold: 0 },
          capacity,
          history,
          stale: true,
          stale_reason: liveError,
        });
      }
      return NextResponse.json({ error: liveError || "saldo_check_failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, current, capacity, history });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "saldo_check_failed" },
      { status: 502 },
    );
  }
}
