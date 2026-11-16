import { NextRequest, NextResponse } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import { deriveOrderAccessCode, isBuyerPinOrder, verifyCheckoutCredentialGrant } from "@/lib/order-access";
import { checkRateLimit } from "@/lib/rateLimit";
import { verifyCredentialToken } from "@/lib/warung-rebahan/deliver";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

// Deliberately separate from masked status/lookup: p1 and contact are NOT proof.
export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!checkRateLimit(request, "orders:lookup")) return json({ error: "rate_limited" }, 429);
  const { code } = await params;
  if (!/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) return json({ error: "invalid_code" }, 400);
  try {
    const db = createDatabaseAccess();
    const order = await db.queryFirst("SELECT code,quote_id,buyer_access_version,buyer_access_format,status,payment_status FROM orders WHERE code=?", code);
    if (!order || !isBuyerPinOrder(order)) return json({ error: "verification_failed" }, 404);
    const grant = request.headers.get("x-checkout-credential-grant") || "";
    const token = request.headers.get("x-credential-token") || "";
    const checkout = Boolean(grant) && await verifyCheckoutCredentialGrant(grant, order);
    if (!checkout && (!token || !await verifyCredentialToken(code, token, db))) return json({ error: "verification_failed" }, 404);
    if (order.status !== "lunas" || order.payment_status !== "paid") return json({ error: "not_paid" }, 403);
    const pin = await deriveOrderAccessCode(order);
    // Rotation/payment changes during HMAC work must not disclose stale access.
    const current = await db.queryFirst("SELECT quote_id,buyer_access_version,buyer_access_format,status,payment_status FROM orders WHERE code=?", code);
    if (!current || current.buyer_access_version !== order.buyer_access_version || current.buyer_access_format !== order.buyer_access_format
      || (checkout && current.quote_id !== order.quote_id) || current.status !== "lunas" || current.payment_status !== "paid"
      || (!checkout && !await verifyCredentialToken(code, token, db))) return json({ error: "verification_failed" }, 409);
    return json({ pin });
  } catch {
    return json({ error: "verification_unavailable" }, 503);
  }
}
