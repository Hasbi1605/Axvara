import { NextRequest, NextResponse } from "next/server";
import { requireAdminDetailed, cookieForIdle, createIdleToken, isSecureForRequest } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const check = await requireAdminDetailed(req);
  if (!check.ok) {
    const status = 401;
    if (check.reason === "idle_timeout") {
      return NextResponse.json({ authed: false, reason: "idle_timeout" }, { status });
    }
    if (check.reason === "revoked") {
      return NextResponse.json({ authed: false, reason: "revoked" }, { status });
    }
    if (check.reason === "session_mismatch") {
      return NextResponse.json({ authed: false, reason: "session_mismatch" }, { status });
    }
    return NextResponse.json({ authed: false }, { status });
  }

  // Slide idle window on each successful check (user active). Idle baru tetap
  // terikat sid yang sama — bukan nilai acak tanpa signature.
  const isHttps = isSecureForRequest(req);
  const freshIdle = await createIdleToken(check.payload.sid);
  const res = NextResponse.json({ authed: true, email: check.payload.email, idleRefreshed: true });
  res.headers.set("Set-Cookie", cookieForIdle(freshIdle, isHttps));
  return res;
}
