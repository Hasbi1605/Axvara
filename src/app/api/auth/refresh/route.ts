import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, cookieForIdle, getIdleTokenFromCookieHeader, isSecureForRequest } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// Sliding idle window: if admin is active, refresh idle cookie (2h). If idle expired (>2h), force re-login.
export async function POST(req: NextRequest) {
  const payload = await requireAdmin(req);
  if (!payload) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cookieHeader = req.headers.get("cookie");
  const idleToken = getIdleTokenFromCookieHeader(cookieHeader);
  // If idle cookie missing/expired -> session idle timeout
  if (!idleToken) {
    return NextResponse.json({ error: "Sesi idle habis (2 jam tanpa aktivitas). Silakan login ulang." }, { status: 401 });
  }

  const isHttps = isSecureForRequest(req);
  const newIdle = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", cookieForIdle(newIdle, isHttps));
  return res;
}

export async function GET(req: NextRequest) {
  return POST(req);
}
