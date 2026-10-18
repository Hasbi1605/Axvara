import { NextRequest, NextResponse } from "next/server";
import { queryFirst } from "@/lib/db";
import { constantTimeEqual, isValidOrderCode } from "@/lib/security";
import { klikQrisMoney, reconcileKlikQrisPayment } from "@/lib/payments/klikqris";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json")) return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 16000) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  let body: Record<string, unknown>;
  try { body=JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body || typeof body!=="object" || Array.isArray(body)) return NextResponse.json({ error: "invalid_callback" }, { status: 400 });
  const code=String(body.order_id || "");
  if (code.startsWith("AXVARA-INTEGRATION-")) return NextResponse.json({ ok: true, status: "integration_probe_ignored" });
  if (!isValidOrderCode(code) && !/^AXP-\d{8}-[A-Z0-9]{8}$/.test(code)) return NextResponse.json({ error: "invalid_order" }, { status: 400 });
  const tx=await queryFirst("SELECT provider_signature,requested_amount,payable_amount,merchant_id FROM payment_transactions WHERE provider='klikqris' AND provider_order_id=?", code);
  if (!tx) return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });
  if (!tx.provider_signature) return NextResponse.json({ error: "invoice_initializing" }, { status: 503 });
  if (typeof body.signature!=="string" || !constantTimeEqual(body.signature,String(tx.provider_signature))) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  try {
    if ((body.amount!=null && klikQrisMoney(body.amount)!==Number(tx.requested_amount))
      || (body.total_amount!=null && klikQrisMoney(body.total_amount)!==Number(tx.payable_amount))
      || (body.id_merchant!=null && String(body.id_merchant)!==String(tx.merchant_id))
      || (body.merchant_id!=null && String(body.merchant_id)!==String(tx.merchant_id))) return NextResponse.json({ error: "callback_mismatch" }, { status: 400 });
  } catch { return NextResponse.json({ error: "invalid_amount" }, { status: 400 }); }
  try {
    // Never trust the callback's status alone, including on network failure.
    const status=await reconcileKlikQrisPayment(code);
    if (["PAID", "SUCCESS"].includes(String(body.status).toUpperCase()) && !["paid", "already_paid", "manual_review"].includes(status)) {
      return NextResponse.json({ error: "payment_not_yet_confirmed" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, status });
  } catch { return NextResponse.json({ error: "provider_confirmation_unavailable" }, { status: 503 }); }
}
