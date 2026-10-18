import { fetchKlikQrisImage } from "@/lib/payments/klikqris";
import { NextRequest, NextResponse } from "next/server";
import { queryFirst } from "@/lib/db";
import { renderQrisPng } from "@/lib/payments/qris-png";
import { isValidOrderCode } from "@/lib/security";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const orderCode = String(code || "").toUpperCase();
  if (!isValidOrderCode(orderCode) && !/^AXP-\d{8}-[A-Z0-9]{8}$/.test(orderCode)) return new NextResponse("Not found", { status: 404 });

  const transaction = await queryFirst(
    `SELECT qris_payload, provider, provider_qris_url, status, expires_at
     FROM payment_transactions
     WHERE order_code=? AND provider IN ('dana','gopay','klikqris')`,
    orderCode,
  );
  if (!transaction || (!transaction.qris_payload && transaction.provider !== "klikqris")) return new NextResponse("Not found", { status: 404 });
  if (String(transaction.status) !== "paid" && Date.parse(String(transaction.expires_at)) <= Date.now()) {
    return new NextResponse("QRIS expired", { status: 410 });
  }

  let png: Uint8Array;
  try { png = transaction.provider === "klikqris" ? await fetchKlikQrisImage(transaction.provider_qris_url) : renderQrisPng(String(transaction.qris_payload)); }
  catch { return new NextResponse("QRIS image unavailable", { status: 502, headers: { "Cache-Control": "no-store" } }); }
  const body = new Uint8Array(png).buffer as ArrayBuffer;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `inline; filename="AXVARA-${orderCode}-QRIS.png"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
