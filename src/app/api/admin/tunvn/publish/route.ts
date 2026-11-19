// POST /api/admin/tunvn/publish — sinkron + terbitkan katalog TUNVN terkurasi.
// Memakai FX snapshot AXVARA saat ini (fail-closed tanpa kurs segar): harga
// ChatGPT markup 35% dan varian Buff Muse markup 40% dihitung ulang.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { isTunvnSyncEnabled } from "@/lib/tunvn/client";
import { publishTunvnCatalog } from "@/lib/tunvn/catalog";
import { loadCurrentFxSnapshot } from "@/lib/payments/market-snapshot";
import { parseRateRational } from "@/lib/payments/fx";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isTunvnSyncEnabled()) return NextResponse.json({ ok: false, error: "not_configured", skipped: "not_configured" }, { status: 503 });
  const fx = await loadCurrentFxSnapshot();
  const rational = fx ? parseRateRational(fx.rateText) : null;
  if (!fx || !rational) return NextResponse.json({ ok: false, error: "fx_unavailable" }, { status: 503 });
  const idrPerUsdt = Number(rational.num) / Number(rational.den);
  if (!Number.isFinite(idrPerUsdt) || idrPerUsdt <= 0) {
    return NextResponse.json({ ok: false, error: "fx_unavailable" }, { status: 503 });
  }
  try {
    const result = await publishTunvnCatalog(createDatabaseAccess(), idrPerUsdt);
    if ("skipped" in result) return NextResponse.json({ ok: false, error: result.skipped, skipped: result.skipped }, { status: 502 });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    return NextResponse.json({ ...result, fx_source: fx.source, fx_effective_at: fx.effectiveAt });
  } catch {
    return NextResponse.json({ ok: false, error: "publish_failed" }, { status: 500 });
  }
}
