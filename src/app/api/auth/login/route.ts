import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminPasswordProofChallenge, createAdminToken, cookieForIdle, cookieForToken, createIdleToken, getAdminCredentials, getAdminPasswordProofConfig, isSecureForRequest, verifyAdminPasswordProof, verifyPassword } from "@/lib/auth";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { readJsonBody } from "@/lib/http-body";
import { createDatabaseAccess } from "@/lib/db-access";
import { admitLogin, loginClientHash, resetLogin } from "@/lib/login-guard";
import { recordSecurityEvent } from "@/lib/security-events";

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

// Cheap per-isolate burst limit, followed by atomic D1 admission per client.

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

  const body = await readJsonBody(req, 8_000);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Email atau password tidak valid." }, { status: 400 });
  }

  const { email, password, password_proof, challenge } = parsed.data;
  const db = createDatabaseAccess();
  let clientHash: string;
  try { clientHash = await loginClientHash(clientIp(req)); }
  catch { return NextResponse.json({ error: "Layanan login sedang tidak siap. Coba lagi sebentar." }, { status: 503 }); }
  const admission = await admitLogin(db, clientHash);
  if (!admission.allowed) {
    if (!admission.unavailable) console.info("[security]", JSON.stringify({ event: "login_limited", subject_hash: clientHash, route: "/api/auth/login", method: "POST" }));
    return NextResponse.json({ error: admission.unavailable ? "Layanan login sedang tidak siap. Coba lagi sebentar." : "Terlalu banyak percobaan login. Tunggu hingga 15 menit." },
      { status: admission.unavailable ? 503 : 429, headers: { "Retry-After": String(admission.retryAfter) } });
  }
  const audit = (event: "login_failed" | "login_succeeded") => recordSecurityEvent(event, clientHash, "/api/auth/login", "POST", db);
  let cred: ReturnType<typeof getAdminCredentials>;
  try {
    cred = getAdminCredentials();
  } catch {
    return NextResponse.json({ error: "Layanan login sedang tidak siap. Coba lagi sebentar." }, { status: 503 });
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
  if (!ok || email.toLowerCase() !== cred.email.toLowerCase()) {
    await audit("login_failed");
    return NextResponse.json({ error: "Email atau password salah." }, { status: 401 });
  }

  let session: Awaited<ReturnType<typeof createAdminToken>>;
  try {
    session = await createAdminToken(cred.email);
  } catch {
    return NextResponse.json({ error: "Layanan login sedang tidak siap. Coba lagi sebentar." }, { status: 503 });
  }
  const isHttps = isSecureForRequest(req);
  const res = NextResponse.json({ ok: true, email: cred.email });
  // Absolute 8h token + sliding 2h idle JWT terikat sid yang sama.
  // Idle lama format acak tidak lagi diterbitkan — hanya JWT HS256.
  const idleToken = await createIdleToken(session.sid);
  try { await resetLogin(db, clientHash, admission.window); }
  catch { return NextResponse.json({ error: "Layanan login sedang tidak siap. Coba lagi sebentar." }, { status: 503 }); }
  await audit("login_succeeded");
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("Set-Cookie", cookieForToken(session.token, isHttps));
  res.headers.append("Set-Cookie", cookieForIdle(idleToken, isHttps));
  return res;
}
