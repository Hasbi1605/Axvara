// POST /api/admin/sekalipay/validate — Cek nickname/nama akun SK.
// Fitur khas SK (WR tidak punya): POST /v1/item/validate. Body:
// {item_id, customer_id, zone_id?}. Dipakai sebelum order manual/H2H.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { isSkEnabled } from "@/lib/sekalipay/client";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  item_id: z.coerce.number().int().positive(),
  customer_id: z.string().trim().min(1).max(120),
  zone_id: z.string().trim().max(60).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!checkRateLimit(request, "products:write")) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!isSkEnabled()) return NextResponse.json({ error: "sekalipay_disabled" }, { status: 503 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "validation_failed" }, { status: 400 });
  }
  try {
    const { validateSkAccount } = await import("@/lib/sekalipay/client");
    const result = await validateSkAccount({
      itemId: parsed.data.item_id,
      customerId: parsed.data.customer_id,
      zoneId: parsed.data.zone_id || undefined,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "validate_failed" },
      { status: 502 },
    );
  }
}
