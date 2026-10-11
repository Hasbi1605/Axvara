// GET /api/admin/pedia/orders — Antrean Pedia (§10 Pesanan, PD-42):
// needs_check di atas; filter status; detail item (target, qty,
// start_count, remains, charge).
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { isPediaProvider } from "@/lib/pedia/proxy";
import { canResubmit } from "../_shared";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = request.nextUrl.searchParams;
  const status = q.get("status")?.slice(0, 30) ?? "";
  const supplier = q.get("supplier") || "";
  if (supplier && !isPediaProvider(supplier)) return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  const db = createDatabaseAccess();
  try {
  const conditions = [status ? "i.status=?" : "", supplier ? "i.supplier=?" : ""].filter(Boolean);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const params: unknown[] = status ? [status] : [];
  if (supplier) params.push(supplier);
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
  );
  return NextResponse.json({ ok: true, rows: rows.map((row) => ({ ...row, can_resubmit: canResubmit(row) })) });
  } catch { return NextResponse.json({ error: "load_failed" }, { status: 500 }); }
}
