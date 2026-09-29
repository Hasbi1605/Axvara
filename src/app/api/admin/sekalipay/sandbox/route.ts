// POST /api/admin/sekalipay/sandbox — Uji sandbox order SK tanpa potong saldo.
// Admin-only. Memakai POST /v1/order/sandbox dengan product_id/variant_id SK
// asli (bukan Axvara id). Body: {product_id, variant_id, quantity?, note?}.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isSkEnabled, createSkSandboxOrder } from "@/lib/sekalipay/client";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!checkRateLimit(request, "products:write")) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!isSkEnabled()) return NextResponse.json({ error: "sekalipay_disabled" }, { status: 503 });
  const body = await request.json().catch(() => null);
  const productId = Number(body?.product_id);
  const variantId = Number(body?.variant_id);
  const quantity = Math.max(1, Math.min(10, Math.floor(Number(body?.quantity ?? 1) || 1)));
  if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(variantId) || variantId <= 0) {
    return NextResponse.json({ error: "invalid_product_variant" }, { status: 400 });
  }
  const note = typeof body?.note === "string" && body.note.length <= 50 ? body.note : undefined;
  const refId = `SK-SANDBOX-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 0xffff).toString(16).toUpperCase()}`;
  try {
    const result = await createSkSandboxOrder({
      refId,
      items: [{ product_id: productId, variant_id: variantId, quantity, ...(note ? { note } : {}) }],
    });
    return NextResponse.json({ ok: true, ref_id: refId, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "sandbox_failed" },
      { status: 502 },
    );
  }
}
