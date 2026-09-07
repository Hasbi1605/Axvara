import { NextRequest, NextResponse } from "next/server";
import { requireAdminDetailed, cookieForIdle, createIdleToken, isSecureForRequest } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// Sliding idle window: hanya sesi yang lolos validasi penuh (JWT + idle JWT
// bertanda tangan + binding sid + auth version) yang mendapat idle baru.
// Idle palsu/kedaluwarsa/sid-asing → 401 dan TIDAK menerbitkan cookie baru.
export async function POST(req: NextRequest) {
  const check = await requireAdminDetailed(req);
  if (!check.ok) {
    if (check.reason === "idle_timeout") {
      return NextResponse.json({ error: "Sesi idle habis (2 jam tanpa aktivitas). Silakan login ulang." }, { status: 401 });
    }
    if (check.reason === "revoked") {
      return NextResponse.json({ error: "Sesi dicabut (kredensial berubah). Silakan login ulang." }, { status: 401 });
    }
    if (check.reason === "session_mismatch") {
      return NextResponse.json({ error: "Sesi tidak cocok. Silakan login ulang." }, { status: 401 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isHttps = isSecureForRequest(req);
  const freshIdle = await createIdleToken(check.payload.sid);
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", cookieForIdle(freshIdle, isHttps));
  return res;
}

export async function GET(req: NextRequest) {
  return POST(req);
}
