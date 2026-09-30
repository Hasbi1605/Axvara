// GET /api/admin/warung/saldo — Saldo WR real-time + estimasi kapasitas.
//
// Kontrak 2026-09-30 (bug "gagal memuat saldo WR" saat search/panel sibuk):
// fetch upstream (proxy Heroku → WR, 2–4 dtk) TIDAK BOLEH menggagalkan
// seluruh respons. Saldo live Best-effort dengan fallback cache D1
// (wr_saldo_log terakhir): panel tetap tampil angka terakhir + flag `stale`
// daripada toast merah. Hanya bila cache pun kosong → 502 jujur.

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
    // Live best-effort: gagal (timeout/proxy tidur) → fallback cache, bukan 502.
    let current: Awaited<ReturnType<typeof checkAndLogSaldo>> | null = null;
    let liveError: string | null = null;
    try {
      current = await checkAndLogSaldo();
    } catch (error) {
      liveError = error instanceof Error ? error.message : "saldo_live_failed";
    }
    const [capacity, history] = await Promise.all([
      estimateOrderCapacity(),
      getSaldoHistory(10),
    ]);
    if (!current) {
      // Fallback cache: saldo terakhir yang tercatat (cron per jam / manual).
      const last = history[0];
      if (last) {
        return NextResponse.json({
          ok: true,
          current: { balance: last.balance, currency: "IDR", isLow: false, threshold: 0 },
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
