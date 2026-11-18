// POST/DELETE /api/orders/[code]/device — 30-day HttpOnly device proof (d1).
// POST needs the checkout proof (c1) and only mints the cookie; credentials still
// require paid + ready. DELETE just clears this browser's cookie.
import { NextRequest, NextResponse } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import { createDeviceCredentialGrant, isBuyerPinOrder, verifyCheckoutCredentialGrant } from "@/lib/order-access";
import { clearDeviceCookie, setDeviceCookie } from "@/lib/order-device-cookie";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const CODE_RE = /^AXV-\d{8}-[A-Z0-9]{8}$/;

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!checkRateLimit(request, "orders:lookup")) return json({ error: "rate_limited" }, 429);
  const { code } = await params;
  if (!CODE_RE.test(code)) return json({ error: "invalid_code" }, 400);
  try {
    const order = await createDatabaseAccess().queryFirst("SELECT code,quote_id,buyer_access_version,buyer_access_format FROM orders WHERE code=?", code);
    const grant = request.headers.get("x-checkout-credential-grant") || "";
    if (!order || !isBuyerPinOrder(order) || !grant || !await verifyCheckoutCredentialGrant(grant, order)) return json({ error: "verification_failed" }, 404);
    const device = await createDeviceCredentialGrant(order);
    if (!device) return json({ error: "verification_failed" }, 404);
    const response = json({ ok: true });
    setDeviceCookie(response, code, device, request);
    return response;
  } catch {
    return json({ error: "verification_unavailable" }, 503);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!checkRateLimit(request, "orders:lookup")) return json({ error: "rate_limited" }, 429);
  const { code } = await params;
  if (!CODE_RE.test(code)) return json({ error: "invalid_code" }, 400);
  const response = json({ ok: true });
  clearDeviceCookie(response, code, request);
  return response;
}
