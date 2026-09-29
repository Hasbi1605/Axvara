// /api/admin/sekalipay/locks — Stock-lock SK anti-overselling (khas SK).
// GET: daftar lock aktif. POST: {item_id, quantity, lock_duration?} → token.
// DELETE?token=: lepas lock manual.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { isSkEnabled } from "@/lib/sekalipay/client";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const lockSchema = z.object({
  item_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).max(1000),
  lock_duration: z.coerce.number().int().min(60).max(600).optional(),
});

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSkEnabled()) return NextResponse.json({ error: "sekalipay_disabled" }, { status: 503 });
  try {
    const { listSkStockLocks } = await import("@/lib/sekalipay/client");
    const locks = await listSkStockLocks();
    return NextResponse.json({ ok: true, locks });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "locks_failed" },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!checkRateLimit(request, "products:write")) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!isSkEnabled()) return NextResponse.json({ error: "sekalipay_disabled" }, { status: 503 });
  const parsed = lockSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "validation_failed" }, { status: 400 });
  }
  try {
    const { lockSkStock } = await import("@/lib/sekalipay/client");
    const lock = await lockSkStock({
      itemId: parsed.data.item_id,
      quantity: parsed.data.quantity,
      lockDuration: parsed.data.lock_duration,
    });
    return NextResponse.json({ ok: true, lock }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "lock_failed" },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const token = request.nextUrl.searchParams.get("token")?.trim() || "";
  if (!token || token.length > 200) return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  try {
    const { releaseSkStockLock } = await import("@/lib/sekalipay/client");
    const released = await releaseSkStockLock(token);
    if (!released) return NextResponse.json({ error: "release_failed" }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "release_failed" },
      { status: 502 },
    );
  }
}
