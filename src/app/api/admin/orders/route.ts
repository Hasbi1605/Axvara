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
    rows = await queryAll("SELECT * FROM orders WHERE status=? ORDER BY created_at DESC", status);
  } else {
    rows = await queryAll("SELECT * FROM orders ORDER BY created_at DESC");
  }
  const orders = rows.map((r) => ({
    code: r.code,
    customer_name: r.customer_name,
    customer_wa: r.customer_wa,
    customer_email: r.customer_email,
    items: JSON.parse(String(r.items || "[]")),
    subtotal: r.subtotal,
    payment_method: r.payment_method,
    payment_account: r.payment_account,
    proof_url: r.proof_url,
    status: r.status,
    admin_note: r.admin_note,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  return NextResponse.json({ orders });
}
