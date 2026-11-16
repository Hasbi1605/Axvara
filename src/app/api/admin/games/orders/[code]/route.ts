import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!await requireAdmin(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  const { code } = await params;
  if (!/^AXG-\d{8}-[A-Z0-9]{8}$/.test(code)) return NextResponse.json({ error: "invalid_code" }, { status: 400, headers });
  try {
    const games = await createDatabaseAccess().queryFirst(
      `SELECT i.order_code, COALESCE(NULLIF(p.sk_product_name,''),p.game_brand) AS game_name,
              p.product_name, i.customer_no, i.customer_nickname AS nickname, i.status, i.sn,
              i.supplier, COALESCE(i.sk_invoice,a.sk_invoice) AS sk_invoice,
              COALESCE(i.supplier_ref,a.ref_id) AS supplier_ref, i.last_error,
              a.price AS cost, i.cost_snapshot, i.max_price
         FROM orders o JOIN games_order_items i ON i.order_code=o.code
         LEFT JOIN games_products p ON p.id=i.product_id
         LEFT JOIN games_dispatch_attempts a ON a.order_code=i.order_code AND a.attempt_no=i.attempt_no
        WHERE o.code=? AND o.order_kind='games'`, code,
    );
    if (!games) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
    return NextResponse.json({ ok: true, games }, { headers });
  } catch {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503, headers });
  }
}
