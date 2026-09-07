import { NextRequest, NextResponse } from "next/server";
import { queryFirst } from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!checkRateLimit(req, "orders:lookup")) return NextResponse.json({ error: "Terlalu sering, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  const { code } = await params;
  if (!code || !/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) return NextResponse.json({ error: "Kode tidak valid" }, { status: 400 });
  const row = (await queryFirst(
    `SELECT o.*, pt.payable_amount, pt.unique_code, pt.qris_url AS dynamic_qris_url,
            pt.expires_at AS payment_expires_at, pt.status AS transaction_status
     FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
     WHERE o.code=?`,
    code,
  )) as Record<string, unknown> | undefined;
  if (!row) return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });
  const waFull = String(row.customer_wa ?? "");
  const waMasked = waFull.length >= 7 ? waFull.slice(0, 5) + "****" + waFull.slice(-4) : waFull ? waFull.slice(0, 3) + "****" : "";
  const emailFull = String(row.customer_email ?? "");
  const emailMasked = emailFull.includes("@") ? emailFull.replace(/(^.).+(@.*)/, (_, a, b) => `${a}***${b}`) : emailFull ? "***" : null;
  return NextResponse.json({
    order: {
      code: row.code,
      customer_name: row.customer_name,
      customer_wa: waMasked,
      customer_email: emailMasked,
      items: JSON.parse(String(row.items || "[]")),
      subtotal: row.subtotal,
      payment_method: row.payment_method,
      payment_account: row.payment_account,
      proof_url: row.proof_url,
      status: row.status,
      created_at: row.created_at,
      qris: row.dynamic_qris_url ? {
        payable_amount: row.payable_amount,
        unique_code: row.unique_code,
        image_url: row.dynamic_qris_url,
        expires_at: row.payment_expires_at,
        status: row.transaction_status,
      } : null,
    },
  });
}
