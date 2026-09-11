// GET /api/admin/warung/orders — Daftar WR order links.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryAll } from "@/lib/db";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const status = request.nextUrl.searchParams.get("status")?.trim() || "all";
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 30)));
  const allowed = ["pending", "ordering", "processing", "completed", "failed", "retry"];
  const where = allowed.includes(status) ? `WHERE l.status=?` : "";
  const params: unknown[] = allowed.includes(status) ? [status, limit] : [limit];
  const rows = await queryAll(
    `SELECT l.*, o.status AS order_status, o.sales_channel
     FROM wr_order_links l
     LEFT JOIN orders o ON o.code=l.order_code
     ${where} ORDER BY l.id DESC LIMIT ?`,
    ...params,
  ).catch(() => []);
  // Jangan kirim ciphertext akun ke client admin list; detail diambil
  // eksplisit per order bila diperlukan.
  const safe = rows.map((r) => ({ ...r, wr_account_details: r.wr_account_details ? "(encrypted)" : null, wr_account_iv: undefined }));
  return NextResponse.json({ orders: safe });
}
