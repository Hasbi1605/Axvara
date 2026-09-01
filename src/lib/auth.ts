import * as jose from "jose";

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

// DEV fallback — only used when NODE_ENV !== production
const DEV_FALLBACK_SECRET = "axvara-dev-secret-change-in-production-32chars!";
const DEV_FALLBACK_SHA256 = "3e3812f3daeb315a0ac17a094bffce7d67ff7c391f5e852cc9373d33ac38adbc"; // sha256("#Kecitran123") — DEV ONLY

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  if (isDev()) {
    if (name === "ADMIN_JWT_SECRET" || name === "JWT_SECRET") return DEV_FALLBACK_SECRET;
    if (name === "ADMIN_PASSWORD_SHA256" || name === "ADMIN_PASSWORD_HASH_SHA256") return DEV_FALLBACK_SHA256;
    if (name === "ADMIN_EMAIL") return "admin@axvara.id";
  }
  throw new Error(`Missing required env: ${name} (set ADMIN_JWT_SECRET + ADMIN_PASSWORD_SHA256 in production)`);
}

function getJwtSecretRaw(): string {
  // Prefer ADMIN_JWT_SECRET, fallback to JWT_SECRET (compat)
  const v = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
  if (v && v.trim()) return v.trim();
  if (isDev()) return DEV_FALLBACK_SECRET;
  throw new Error("Missing required env: ADMIN_JWT_SECRET");
}

function secretKey() {
  return new TextEncoder().encode(getJwtSecretRaw());
}

export function getAdminCredentials() {
  const email = requireEnv("ADMIN_EMAIL");
  const sha = process.env.ADMIN_PASSWORD_SHA256 || process.env.ADMIN_PASSWORD_HASH_SHA256;
  if (sha && sha.trim()) {
    if (!/^[a-f0-9]{64}$/i.test(sha.trim())) throw new Error("ADMIN_PASSWORD_SHA256 must be 64 hex chars (sha256)");
    return { email, sha256: sha.trim().toLowerCase() };
  }
  if (isDev()) return { email, sha256: DEV_FALLBACK_SHA256 };
  throw new Error("Missing required env: ADMIN_PASSWORD_SHA256");
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifyPassword(plain: string, _hashUnused: string) {
  const { sha256 } = getAdminCredentials();
  const hex = await sha256Hex(plain);
  return timingSafeEqual(hex, sha256.toLowerCase());
}

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
  const m = cookieHeader.match(/(?:^|;\s*)(?:__Host-)?axvara_admin_token=([^;]+)/);
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
  let payload: { email: string; role: string } | null = null;
  try {
    payload = (await verifyAdminToken(token)) as { email: string; role: string } | null;
  } catch {
    return null;
  }
  if (!payload) return null;
  let email = "";
  try {
    email = getAdminCredentials().email;
  } catch {
    return null;
  }
  if (String(payload.email).toLowerCase() !== email.toLowerCase()) return null;
  return payload;
}

// ---- Secure cookie helpers ----
function isHttpsRequest(req: Request): boolean {
  const urlProto = (() => {
    try {
      return new URL(req.url).protocol === "https:";
    } catch {
      return false;
    }
  })();
  const xfp = req.headers.get("x-forwarded-proto");
  const cfVisitor = req.headers.get("cf-visitor");
  const cfVisitorHttps = cfVisitor ? cfVisitor.includes("https") : false;
  // In production, always Secure regardless of internal http
  if (!isDev()) return true;
  return urlProto || xfp === "https" || cfVisitorHttps;
}

export function isSecureForRequest(req: Request): boolean {
  return isHttpsRequest(req);
}

export function cookieForToken(token: string, isSecure: boolean) {
  const maxAge = 8 * 60 * 60;
  const secure = isSecure || !isDev();
  // __Host- prefix requires Secure, Path=/, no Domain — enforced in prod
  const name = secure ? "__Host-axvara_admin_token" : "axvara_admin_token";
  const parts = [`${name}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function expiredCookie(isSecure: boolean) {
  const secure = isSecure || !isDev();
  const name = secure ? "__Host-axvara_admin_token" : "axvara_admin_token";
  const parts = [`${name}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
