import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const payload = await requireAdmin(req);
  if (!payload) return NextResponse.json({ authed: false }, { status: 401 });
  return NextResponse.json({ authed: true, email: payload.email });
}
