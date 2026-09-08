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
  //
  // Sumber kebenaran adalah tabel D1 `admin_session_revocations` (tahan
  // restart + lintas instance). Gagal tulis revokasi = logout GAGAL (500,
  // bukan ok:true palsu) — cookie tetap dihapus agar perangkat ini keluar,
  // namun API jujur bahwa token lama sesi ini belum tentu gugur di semua
  // instance sehingga admin dapat mengulang logout / rotasi password.
  let revoked = false;
  let revocationStoreDown = false;
  try {
    const raw = getTokenFromCookieHeader(req.headers.get("cookie"));
    const payload = raw ? await verifyAdminToken(raw).catch(() => null) : null;
    if (payload?.sid) {
      await bumpAuthVersion(payload.sid);
      revoked = true;
    }
  } catch {
    revocationStoreDown = true;
  }
  const isHttps = isSecureForRequest(req);
  const res = revocationStoreDown
    ? NextResponse.json(
        { ok: false, error: "session_revocation_store_unavailable", revoked: false },
        { status: 500 },
      )
    : NextResponse.json({ ok: true, revoked });
  res.headers.set("Set-Cookie", expiredCookie(isHttps));
  res.headers.append("Set-Cookie", expiredCookie(!isHttps));
  res.headers.append("Set-Cookie", expiredIdleCookie(isHttps));
  res.headers.append("Set-Cookie", expiredIdleCookie(!isHttps));
  return res;
}
