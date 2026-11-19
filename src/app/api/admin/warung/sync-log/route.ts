// GET /api/admin/warung/sync-log — Riwayat sync WR.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryAll, queryFirst } from "@/lib/db";
import { readDiffStatus } from "@/lib/supplier/diff-status";
import { isWrAutoOrderEnabled, isWrConfigured, isWrSyncEnabled } from "@/lib/warung-rebahan/client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limit = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 20)));
  let logs = await queryAll(
    `SELECT *, COALESCE(trigger,'manual') AS trigger FROM wr_sync_log
     WHERE sync_type='products' OR sync_type NOT IN ('products','saldo')
     ORDER BY id DESC LIMIT ?`,
    limit,
  ).catch(() => []);
  // Fallback: bila belum ada sync produk sama sekali, kembalikan baris saldo
  // terakhir agar kartu tidak 0/0/0 padahal sync produk pernah jalan.
  if (!logs.length) {
    logs = await queryAll(
      `SELECT *, COALESCE(trigger,'manual') AS trigger FROM wr_sync_log ORDER BY id DESC LIMIT ?`,
      limit,
    ).catch(() => []);
  }
  const [diff, countRow] = await Promise.all([
    readDiffStatus(queryAll, "wr_sync_state"),
    queryFirst(
      `SELECT
         COUNT(*) AS total_variants,
         COALESCE(SUM(CASE WHEN wv.axvara_variant_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS mapped_variants,
         COALESCE(SUM(CASE WHEN wv.is_active=1 AND pv.id IS NOT NULL AND pv.is_active=1 AND p.is_active=1 AND p.archived_at IS NULL THEN 1 ELSE 0 END), 0) AS active_variants,
         COUNT(DISTINCT COALESCE(CAST(COALESCE(pv.product_id, wp.axvara_product_id) AS TEXT), 'wr:' || COALESCE(wv.wr_product_id, wv.wr_variant_id))) AS families
       FROM wr_variants wv
       LEFT JOIN wr_products wp ON wp.wr_product_id=wv.wr_product_id
       LEFT JOIN product_variants pv ON pv.id=wv.axvara_variant_id
       LEFT JOIN products p ON p.id=pv.product_id`,
    ).catch(() => null),
  ]);
  return NextResponse.json({
    logs,
    diff,
    configured: isWrConfigured(),
    dispatch_enabled: isWrAutoOrderEnabled(),
    sync_enabled: isWrSyncEnabled(),
    counts: {
      active_variants: Number(countRow?.active_variants ?? 0),
      mapped_variants: Number(countRow?.mapped_variants ?? 0),
      total_variants: Number(countRow?.total_variants ?? 0),
      families: Number(countRow?.families ?? 0),
    },
  });
}
