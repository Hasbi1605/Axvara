import { NextRequest, NextResponse } from "next/server";
import { expiredCookie } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const isHttps = new URL(req.url).protocol === "https:";
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", expiredCookie(isHttps));
  return res;
}
