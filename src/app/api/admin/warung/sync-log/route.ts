// GET /api/admin/warung/sync-log — Riwayat sync WR.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryAll } from "@/lib/db";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limit = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 20)));
  const rows = await queryAll(
    `SELECT * FROM wr_sync_log ORDER BY id DESC LIMIT ?`,
    limit,
  ).catch(() => []);
  return NextResponse.json({ logs: rows });
}
