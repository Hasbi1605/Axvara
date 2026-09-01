import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, getIdleTokenFromCookieHeader, cookieForIdle, isSecureForRequest } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const payload = await requireAdmin(req);
  if (!payload) return NextResponse.json({ authed: false }, { status: 401 });

  // Idle check: 2 jam tanpa aktivitas -> wajib login ulang
  const idleToken = getIdleTokenFromCookieHeader(req.headers.get("cookie"));
  if (!idleToken) {
    return NextResponse.json({ authed: false, reason: "idle_timeout" }, { status: 401 });
  }

  // Slide idle window on each successful check (user active)
  const isHttps = isSecureForRequest(req);
  const newIdle = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const res = NextResponse.json({ authed: true, email: payload.email, idleRefreshed: true });
  res.headers.set("Set-Cookie", cookieForIdle(newIdle, isHttps));
  return res;
}
