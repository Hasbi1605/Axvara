import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status")?.trim();
  let rows: Record<string, unknown>[];
  if (status && ["pending", "lunas", "dibatalkan", "kadaluarsa"].includes(status)) {
    rows = await queryAll(
      `SELECT o.*, COALESCE(pt.payable_amount,o.subtotal) AS payment_amount
       FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
       WHERE o.status=? ORDER BY o.created_at DESC`,
      status,
    );
  } else {
    rows = await queryAll(
      `SELECT o.*, COALESCE(pt.payable_amount,o.subtotal) AS payment_amount
       FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
       ORDER BY o.created_at DESC`,
    );
  }
  const orders = rows.map((r) => ({
    code: r.code,
    customer_name: r.customer_name,
    customer_wa: r.customer_wa,
    customer_email: r.customer_email,
    items: JSON.parse(String(r.items || "[]")),
    subtotal: r.subtotal,
    payment_amount: r.payment_amount,
    payment_method: r.payment_method,
    payment_account: r.payment_account,
    proof_url: r.proof_url,
    status: r.status,
    payment_status: r.payment_status,
    sales_channel: r.sales_channel || "web",
    admin_note: r.admin_note,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  return NextResponse.json({ orders });
}
