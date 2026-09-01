import { NextRequest, NextResponse } from "next/server";
import { expiredCookie, isSecureForRequest } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const isHttps = isSecureForRequest(req);
  const res = NextResponse.json({ ok: true });
  // Expire both variants for compatibility with old cookies
  res.headers.set("Set-Cookie", expiredCookie(isHttps));
  res.headers.append("Set-Cookie", expiredCookie(!isHttps));
  return res;
}
