import { NextRequest, NextResponse } from "next/server";
import { expiredCookie, expiredIdleCookie, isSecureForRequest } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const isHttps = isSecureForRequest(req);
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", expiredCookie(isHttps));
  res.headers.append("Set-Cookie", expiredCookie(!isHttps));
  res.headers.append("Set-Cookie", expiredIdleCookie(isHttps));
  res.headers.append("Set-Cookie", expiredIdleCookie(!isHttps));
  return res;
}
