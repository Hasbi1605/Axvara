import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db";
import { constantTimeEqual, isGopayQrisConfigured } from "@/lib/payments/dana-qris";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Daftar invoice GoPay pending untuk poller server (auth `x-poller-secret`
 * yang SAMA dengan webhook — bukan publik, bukan admin).
 *
 * Poller memakai daftar ini agar tahu nominal mana yang dipantau, lalu
 * mencocokkan mutasi GoBiz dan POST hasilnya ke `/api/webhook/gopay`
 * (yang tetap memverifikasi ulang + guard atomik — endpoint ini hanya
 * optimasi agar poller tidak menebak buta).
 */
export async function GET(request: NextRequest) {
  if (!isGopayQrisConfigured()) return NextResponse.json({ error: "qris_not_configured" }, { status: 503 });
  const expectedSecret = process.env.GOPAY_POLLER_SECRET!;
  const suppliedSecret = request.headers.get("x-poller-secret") || "";
  if (!constantTimeEqual(suppliedSecret, expectedSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rows = await queryAll(
    `SELECT pt.order_code, pt.payable_amount, pt.expires_at,
            COALESCE(pt.invoice_issued_at,pt.created_at) AS issued_at,
            o.expires_at AS order_expires_at
     FROM payment_transactions pt
     JOIN orders o ON o.code=pt.order_code
     WHERE pt.provider='gopay' AND pt.status='pending' AND o.status='pending'
       AND julianday(pt.expires_at)>julianday('now')
       AND julianday(o.expires_at)>julianday('now')
     ORDER BY pt.expires_at ASC LIMIT 50`,
  );
  return NextResponse.json({
    pending: rows.map((r) => ({
      order_code: String(r.order_code),
      payable_amount: Number(r.payable_amount),
      expires_at: String(r.expires_at),
      issued_at: String(r.issued_at ?? ""),
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
