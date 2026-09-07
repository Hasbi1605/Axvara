import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminPasswordProofChallenge, createAdminToken, cookieForIdle, cookieForToken, createIdleToken, getAdminCredentials, getAdminPasswordProofConfig, isSecureForRequest, verifyAdminPasswordProof, verifyPassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email().max(120),
  password: z.string().min(6).max(72).optional(),
  password_proof: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  challenge: z.string().min(20).max(2000).optional(),
}).refine((value) => Boolean(value.password) || Boolean(value.password_proof && value.challenge), {
  message: "Email atau password tidak valid.",
});

// Rate-limit terpusat (issue #14): 5/mnt/IP via lib anti-spoof (sebelumnya
// salinan lokal memakai x-real-ip saja). WAF Free menambah 1 rule global.

export async function GET() {
  try {
    const cred = getAdminCredentials();
    const config = getAdminPasswordProofConfig(cred.sha256);
    if (!config) return NextResponse.json({ mode: "password" }, { headers: { "Cache-Control": "no-store" } });
    const challenge = await createAdminPasswordProofChallenge(cred.email);
    return NextResponse.json({ mode: "pbkdf2-proof", ...config, challenge }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Layanan login sedang tidak siap. Coba lagi sebentar." }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!checkRateLimit(req, "auth:login")) {
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

  const { email, password, password_proof, challenge } = parsed.data;
  let cred: ReturnType<typeof getAdminCredentials>;
  try {
    cred = getAdminCredentials();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Konfigurasi auth belum siap" }, { status: 500 });
  }

  if (email.toLowerCase() !== cred.email.toLowerCase()) {
    // constant-time-ish delay
    await new Promise((r) => setTimeout(r, 280));
    return NextResponse.json({ error: "Email atau password salah." }, { status: 401 });
  }

  let ok = false;
  try {
    ok = password_proof && challenge
      ? await verifyAdminPasswordProof(cred.email, cred.sha256, challenge, password_proof)
      : await verifyPassword(password!, cred.sha256);
  } catch {
    // A malformed secret must not turn the login endpoint into an opaque
    // platform-level 500 response. Keep the configuration detail private.
    return NextResponse.json({ error: "Layanan login sedang tidak siap. Coba lagi sebentar." }, { status: 503 });
  }
  if (!ok) {
    return NextResponse.json({ error: "Email atau password salah." }, { status: 401 });
  }

  let session: Awaited<ReturnType<typeof createAdminToken>>;
  try {
    session = await createAdminToken(cred.email);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal buat sesi" }, { status: 500 });
  }
  const isHttps = isSecureForRequest(req);
  const res = NextResponse.json({ ok: true, email: cred.email });
  // Absolute 8h token + sliding 2h idle JWT terikat sid yang sama.
  // Idle lama format acak tidak lagi diterbitkan — hanya JWT HS256.
  const idleToken = await createIdleToken(session.sid);
  res.headers.set("Set-Cookie", cookieForToken(session.token, isHttps));
  res.headers.append("Set-Cookie", cookieForIdle(idleToken, isHttps));
  return res;
}
