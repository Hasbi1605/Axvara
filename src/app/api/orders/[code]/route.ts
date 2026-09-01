import { NextRequest, NextResponse } from "next/server";
import { queryFirst } from "@/lib/db";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!code || !/^AXV-\d{8}-[A-Z0-9]{4}$/.test(code)) return NextResponse.json({ error: "Kode tidak valid" }, { status: 400 });
  const row = (await queryFirst("SELECT * FROM orders WHERE code=?", code)) as Record<string, unknown> | undefined;
  if (!row) return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });
  return NextResponse.json({
    order: {
      code: row.code,
      customer_name: row.customer_name,
      customer_wa: row.customer_wa,
      customer_email: row.customer_email,
      items: JSON.parse(String(row.items || "[]")),
      subtotal: row.subtotal,
      payment_method: row.payment_method,
      payment_account: row.payment_account,
      proof_url: row.proof_url,
      status: row.status,
      created_at: row.created_at,
    },
  });
}
