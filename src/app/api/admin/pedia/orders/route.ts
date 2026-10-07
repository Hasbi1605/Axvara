// GET /api/admin/pedia/orders — Antrean Pedia (§10 Pesanan, PD-42):
// needs_check di atas; filter status; detail item (target, qty,
// start_count, remains, charge).
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = request.nextUrl.searchParams;
  const status = q.get("status")?.slice(0, 30) ?? "";
  const db = createDatabaseAccess();
  const where = status ? `WHERE i.status=?` : "";
  const params: unknown[] = status ? [status] : [];
  const rows = await db.queryAll(
    `SELECT i.*, p.name AS product_name, p.slug AS product_slug,
            o.customer_wa, o.customer_email, o.payment_status, o.paid_at
       FROM pedia_order_items i
       JOIN pedia_products p ON p.id=i.product_id
       LEFT JOIN orders o ON o.code=i.order_code
      ${where}
      ORDER BY CASE i.status WHEN 'needs_check' THEN 0 WHEN 'queued' THEN 1
               WHEN 'submitting' THEN 2 ELSE 3 END, i.created_at DESC
      LIMIT 100`,
    ...params,
  ).catch(() => []);
  return NextResponse.json({ ok: true, rows });
}
