import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminCredentials, verifyPassword, createAdminToken, cookieForToken } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email().max(120),
  password: z.string().min(6).max(72),
});

// Simple in-memory rate limit per IP (edge isolate-safe best-effort)
const hits = new Map<string, { c: number; t: number }>();
function rateLimit(ip: string) {
  const now = Date.now();
  const e = hits.get(ip);
  if (!e || now - e.t > 60_000) {
    hits.set(ip, { c: 1, t: now });
    return true;
  }
  e.c++;
  if (e.c > 12) return false;
  return true;
}

function clientIp(req: NextRequest) {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "0.0.0.0"
  );
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!rateLimit(ip)) {
    return NextResponse.json(
      { error: "Terlalu banyak percobaan. Coba lagi 1 menit." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Email atau password tidak valid." }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const cred = getAdminCredentials();

  if (email.toLowerCase() !== cred.email.toLowerCase()) {
    // constant-time-ish delay
    await new Promise((r) => setTimeout(r, 280));
    return NextResponse.json({ error: "Email atau password salah." }, { status: 401 });
  }

  const ok = await verifyPassword(password, cred.sha256);
  if (!ok) {
    return NextResponse.json({ error: "Email atau password salah." }, { status: 401 });
  }

  const token = await createAdminToken(cred.email);
  const isHttps = new URL(req.url).protocol === "https:";
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", cookieForToken(token, isHttps));
  return res;
}
