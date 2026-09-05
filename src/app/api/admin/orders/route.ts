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
      `SELECT o.*, COALESCE(pt.payable_amount,o.subtotal) AS payment_amount,
              pp.id AS proof_id, pp.status AS proof_status,
              pp.claimed_method AS proof_claimed_method, pp.r2_key AS proof_r2_key,
              pp.rejection_reason AS proof_rejection_reason
       FROM orders o
       LEFT JOIN payment_transactions pt ON pt.order_code=o.code
       LEFT JOIN payment_proofs pp ON pp.id=(
         SELECT MAX(latest.id) FROM payment_proofs latest WHERE latest.order_code=o.code
       )
       WHERE o.status=? ORDER BY o.created_at DESC`,
      status,
    );
  } else {
    rows = await queryAll(
      `SELECT o.*, COALESCE(pt.payable_amount,o.subtotal) AS payment_amount,
              pp.id AS proof_id, pp.status AS proof_status,
              pp.claimed_method AS proof_claimed_method, pp.r2_key AS proof_r2_key,
              pp.rejection_reason AS proof_rejection_reason
       FROM orders o
       LEFT JOIN payment_transactions pt ON pt.order_code=o.code
       LEFT JOIN payment_proofs pp ON pp.id=(
         SELECT MAX(latest.id) FROM payment_proofs latest WHERE latest.order_code=o.code
       )
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
    proof_url: r.proof_r2_key ? `/r2/${String(r.proof_r2_key)}` : r.proof_url,
    proof_id: r.proof_id,
    proof_status: r.proof_status,
    proof_claimed_method: r.proof_claimed_method,
    proof_rejection_reason: r.proof_rejection_reason,
    status: r.status,
    payment_status: r.payment_status,
    sales_channel: r.sales_channel || "web",
    admin_note: r.admin_note,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  return NextResponse.json({ orders });
}
