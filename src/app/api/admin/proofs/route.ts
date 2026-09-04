// src/app/api/admin/proofs/route.ts — List payment proofs for admin review

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryAll } from "@/lib/db";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const proofs = await queryAll(`
      SELECT
        p.id,
        p.order_code,
        p.sales_channel,
        p.conversation_id,
        p.member_id,
        p.claimed_method,
        p.r2_key,
        p.content_type,
        p.byte_size,
        p.sha256,
        p.status,
        p.reviewed_by,
        p.reviewed_at,
        p.rejection_reason,
        p.created_at,
        o.customer_name,
        o.customer_wa,
        o.subtotal,
        o.status as order_status,
        o.payment_status,
        o.items
      FROM payment_proofs p
      LEFT JOIN orders o ON o.code = p.order_code
      ORDER BY p.id DESC
      LIMIT 100
    `);

    return NextResponse.json({ proofs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "query_failed" },
      { status: 500 },
    );
  }
}
