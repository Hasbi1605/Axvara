import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listSekalipayTopupChannels, SupplierTopupError } from "@/lib/supplier/topup";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    const channels = await listSekalipayTopupChannels();
    return json({ ok: true, channels });
  } catch (error) {
    if (error instanceof SupplierTopupError) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: "channels_failed" }, 502);
  }
}
