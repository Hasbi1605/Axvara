// GET /api/admin/sekalipay/sync-log — Riwayat sync SK terakhir.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryAll } from "@/lib/db";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limit = Math.min(20, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 5)));
  const logs = await queryAll(
    `SELECT id, sync_type, status, products_total, products_synced, products_excluded,
       products_new, variants_synced, stock_changes, price_changes, created_at
     FROM sk_sync_log ORDER BY id DESC LIMIT ?`,
    limit,
  ).catch(() => []);
  return NextResponse.json({ logs });
}
