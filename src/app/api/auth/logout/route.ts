import { NextRequest, NextResponse } from "next/server";
import { bumpAuthVersion, expiredCookie, expiredIdleCookie, getTokenFromCookieHeader, isSecureForRequest, verifyAdminToken } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Review R8: logout must revoke server-side. Clearing cookies alone leaves
  // the JWT + idle pair valid until expiry — a replayed cookie jar (stolen
  // laptop, shared machine, backup restore) stays authenticated. Bumping the
  // per-session auth version invalidates this session's tokens on next
  // requireAdmin check, while other concurrent sessions keep working.
  // Stateless (in-process map, no new table/migration): in multi-instance
  // Edge runtimes the cookie clear is the guarantee and password rotation
  // remains the global kill-switch — documented here, not hidden.
  try {
    const raw = getTokenFromCookieHeader(req.headers.get("cookie"));
    const payload = raw ? await verifyAdminToken(raw).catch(() => null) : null;
    if (payload?.sid) await bumpAuthVersion(payload.sid);
  } catch { /* logout stays best-effort: cookies are cleared below regardless */ }
  const isHttps = isSecureForRequest(req);
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", expiredCookie(isHttps));
  res.headers.append("Set-Cookie", expiredCookie(!isHttps));
  res.headers.append("Set-Cookie", expiredIdleCookie(isHttps));
  res.headers.append("Set-Cookie", expiredIdleCookie(!isHttps));
  return res;
}
