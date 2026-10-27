import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { deriveOrderAccessCode } from "@/lib/order-access";
import { checkoutPinEmailStatement, scheduleCheckoutPinEmail } from "@/lib/orders/access-email";
import { recordSecurityEvent, securitySubject } from "@/lib/security-events";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const { code } = await params;
  if (!/^AX[VP]-\d{8}-[A-Z0-9]{8}$/.test(code)) return NextResponse.json({ error: "Kode pesanan tidak valid." }, { status: 400, headers });
  const body = await readJsonBody(request, 1_000);
  if (!body.ok) return body.response;
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400, headers });
  const rotate = (body.data as { rotate?: unknown }).rotate;
  if (rotate !== undefined && typeof rotate !== "boolean") return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400, headers });
  const db = createDatabaseAccess();
  const order = await db.queryFirst("SELECT code,buyer_access_version,buyer_access_format FROM orders WHERE code=?", code);
  if (!order) return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404, headers });
  if (Number(order.buyer_access_version) < 1) return NextResponse.json({ error: "Pesanan lama ini tetap memakai kontak checkout." }, { status: 409, headers });
  // Validate the key before changing the generation or revoking capabilities.
  const targetVersion = Number(order.buyer_access_version) + (rotate ? 1 : 0);
  const accessCode = await deriveOrderAccessCode({ code, buyer_access_version: targetVersion, buyer_access_format: order.buyer_access_format });
  if (!accessCode) return NextResponse.json({ error: "Kode akses belum tersedia." }, { status: 503, headers });
  if (rotate) {
    if (!db.d1) return NextResponse.json({ error: "Penyimpanan tidak tersedia." }, { status: 503, headers });
    const guard = `buyer-access:${crypto.randomUUID()}`;
    try {
      await db.d1.batch([
        db.d1.prepare(`INSERT INTO operation_guards(operation_id,valid) SELECT ?,CASE WHEN EXISTS(
          SELECT 1 FROM orders WHERE code=? AND buyer_access_version=?) THEN 1 ELSE 0 END`)
          .bind(guard, code, Number(order.buyer_access_version)),
        db.d1.prepare("UPDATE orders SET buyer_access_version=buyer_access_version+1 WHERE code=? AND buyer_access_version=?").bind(code, Number(order.buyer_access_version)),
        db.d1.prepare("UPDATE wr_credential_tokens SET revoked=1 WHERE order_code=? AND revoked=0").bind(code),
        checkoutPinEmailStatement(db.d1, code),
        db.d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guard),
      ]);
    } catch {
      return NextResponse.json({ error: "Pesanan berubah atau penyimpanan belum tersedia. Muat ulang sebelum mencoba lagi." }, { status: 409, headers });
    }
    await scheduleCheckoutPinEmail(code);
  }
  await recordSecurityEvent(rotate ? "buyer_access_rotated" : "buyer_access_revealed", await securitySubject("buyer-access-admin", admin.sid), "/api/admin/orders/:code/access-code", "POST", db);
  return NextResponse.json({ code, buyer_access_code: accessCode, rotated: Boolean(rotate) }, { headers });
}
