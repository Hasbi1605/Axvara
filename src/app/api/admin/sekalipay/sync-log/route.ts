// GET /api/admin/sekalipay/sync-log — Riwayat sync SK terakhir.
// Menyertakan trigger (manual/cron) + error_message seperti panel WR
// (bedakan sync tangan vs cron, dan lihat sebab partial/failed).

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryAll, queryFirst } from "@/lib/db";
import { readDiffStatus } from "@/lib/supplier/diff-status";
import { isSkAutoOrderEnabled, isSkConfigured, isSkSyncEnabled } from "@/lib/sekalipay/client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limit = Math.min(20, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 5)));
  const [logs, diff, countRow] = await Promise.all([
    queryAll(
      `SELECT id, sync_type, status, products_total, products_synced, products_excluded,
         products_new, variants_synced, stock_changes, price_changes,
         error_message, duration_ms, trigger, created_at
       FROM sk_sync_log ORDER BY id DESC LIMIT ?`,
      limit,
    ).catch(() => []),
    readDiffStatus(queryAll, "sk_sync_state"),
    queryFirst(
      `SELECT
         COUNT(*) AS total_variants,
         COALESCE(SUM(CASE WHEN sp.axvara_variant_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS mapped_variants,
         COALESCE(SUM(CASE WHEN sp.is_active=1 AND pv.id IS NOT NULL AND pv.is_active=1 AND p.is_active=1 AND p.archived_at IS NULL THEN 1 ELSE 0 END), 0) AS active_variants,
         COUNT(DISTINCT COALESCE(CAST(COALESCE(pv.product_id, sp.axvara_product_id) AS TEXT), 'sk:' || COALESCE(sp.sk_product_id, sp.sk_variant_id))) AS families
       FROM sk_products sp
       LEFT JOIN product_variants pv ON pv.id=sp.axvara_variant_id
       LEFT JOIN products p ON p.id=pv.product_id
       WHERE sp.sk_category='Aplikasi Premium'`,
    ).catch(() => null),
  ]);
  return NextResponse.json({
    logs,
    diff,
    configured: isSkConfigured(),
    dispatch_enabled: isSkAutoOrderEnabled(),
    sync_enabled: isSkSyncEnabled(),
    counts: {
      active_variants: Number(countRow?.active_variants ?? 0),
      mapped_variants: Number(countRow?.mapped_variants ?? 0),
      total_variants: Number(countRow?.total_variants ?? 0),
      families: Number(countRow?.families ?? 0),
    },
  });
}
