import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { refreshSupplierTopup, SupplierTopupError } from "@/lib/supplier/topup";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await requireAdmin(request)) return json({ ok: false, error: "unauthorized" }, 401);
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return json({ ok: false, error: "invalid_id" }, 400);
  try {
    const item = await refreshSupplierTopup(createDatabaseAccess(), id);
    return json({ ok: true, item });
  } catch (error) {
    if (error instanceof SupplierTopupError) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: "refresh_failed" }, 500);
  }
}
