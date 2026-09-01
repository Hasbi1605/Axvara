import * as jose from "jose";

const JWT_SECRET =
  process.env.ADMIN_JWT_SECRET ||
  process.env.JWT_SECRET ||
  "axvara-dev-secret-change-in-production-32chars!";

function secretKey() {
  return new TextEncoder().encode(JWT_SECRET);
}

export function getAdminCredentials() {
  // SHA-256 hex dari "axvara123" — ganti via env di production
  // Hash ini Edge-safe (Web Crypto Subtle), tanpa bcryptjs (edge tidak support setImmediate)
  const fallbackHash = "55d21d420a2aa6d8fba7e1880689630696b56caa9a92f441c2516471df10be34"; // sha256("axvara123")
  const sha = process.env.ADMIN_PASSWORD_SHA256 || process.env.ADMIN_PASSWORD_HASH_SHA256 || fallbackHash;
  // Backward compat: jika ADMIN_PASSWORD_HASH masih bcrypt, tetap terima tapi akan fallback ke compare plain via timingSafe di dev (tidak disarankan)
  const legacyBcrypt = process.env.ADMIN_PASSWORD_HASH;
  return {
    email: process.env.ADMIN_EMAIL || "admin@axvara.id",
    sha256: sha,
    legacyBcrypt: legacyBcrypt && legacyBcrypt.startsWith("$2") ? legacyBcrypt : null,
  };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b=> b.toString(16).padStart(2,"0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i=0;i<a.length;i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifyPassword(plain: string, _hashUnused: string) {
  // Edge-safe: bandingkan SHA-256 dari plain dengan sha256 yang disimpan
  // _hashUnused diabaikan — sumber kebenaran adalah getAdminCredentials().sha256
  const { sha256 } = getAdminCredentials();
  const hex = await sha256Hex(plain);
  return timingSafeEqual(hex, sha256.toLowerCase());
}

// Untuk keperluan login route yang butuh hash param (compat), expose helper:
export async function verifyPasswordWithSha(plain: string, expectedShaHex: string) {
  const hex = await sha256Hex(plain);
  return timingSafeEqual(hex, expectedShaHex.toLowerCase());
}

export async function createAdminToken(email: string) {
  return await new jose.SignJWT({ email, role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secretKey());
}

export async function verifyAdminToken(token: string) {
  try {
    const { payload } = await jose.jwtVerify(token, secretKey());
    if (payload.role !== "admin" || !payload.email) return null;
    return payload as { email: string; role: string; exp: number; iat: number };
  } catch {
    return null;
  }
}

export function getTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)axvara_admin_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function getTokenFromRequest(req: Request): string | null {
  const cookie = req.headers.get("cookie");
  const t = getTokenFromCookieHeader(cookie);
  if (t) return t;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

export async function requireAdmin(req: Request) {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  const payload = await verifyAdminToken(token);
  if (!payload) return null;
  const { email } = getAdminCredentials();
  if (String(payload.email).toLowerCase() !== email.toLowerCase()) return null;
  return payload;
}

export function cookieForToken(token: string, isSecure: boolean) {
  const maxAge = 8 * 60 * 60;
  const parts = [
    `axvara_admin_token=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (isSecure) parts.push("Secure");
  return parts.join("; ");
}

export function expiredCookie(isSecure: boolean) {
  const parts = ["axvara_admin_token=", "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isSecure) parts.push("Secure");
  return parts.join("; ");
}
