import * as jose from "jose";

export type CheckoutQuoteItem = {
  product_id: number;
  name: string;
  price: number;
  qty: number;
};

export type CheckoutQuotePaymentMethod = {
  id: string;
  account_number: string;
};

export type CheckoutQuotePayload = {
  quote_id: string;
  items: CheckoutQuoteItem[];
  subtotal: number;
  payment_methods: CheckoutQuotePaymentMethod[];
};

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

// Development JWT fallback is generated at runtime and never committed.
let _devSecret: string | null = null;
function getDevSecret(): string {
  if (!_devSecret) _devSecret = "dev-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
  return _devSecret;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  if (isDev()) {
    if (name === "ADMIN_JWT_SECRET" || name === "JWT_SECRET") return getDevSecret();
    if (name === "ADMIN_PASSWORD_SHA256" || name === "ADMIN_PASSWORD_HASH_SHA256") return "dev-placeholder";
    if (name === "ADMIN_EMAIL") return "admin@axvara.tech";
  }
  throw new Error(`Missing required env: ${name} (set ADMIN_JWT_SECRET + ADMIN_PASSWORD_SHA256 in production)`);
}

function getJwtSecretRaw(): string {
  const v = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
  if (v && v.trim()) return v.trim();
  if (isDev()) return getDevSecret();
  throw new Error("Missing required env: ADMIN_JWT_SECRET");
}

function secretKey() {
  return new TextEncoder().encode(getJwtSecretRaw());
}

export function getAdminCredentials() {
  const email = requireEnv("ADMIN_EMAIL");
  const sha = process.env.ADMIN_PASSWORD_SHA256 || process.env.ADMIN_PASSWORD_HASH_SHA256;
  if (sha && sha.trim()) {
    const t = normalizeStoredHash(sha);
    // Allow legacy 64 hex sha256 OR new pbkdf2$iter$salt$hex
    if (/^[a-f0-9]{64}$/i.test(t) || t.startsWith("pbkdf2$")) return { email, sha256: t };
    throw new Error("ADMIN_PASSWORD_SHA256 must be 64 hex sha256 or pbkdf2$iter$salt$hex");
  }
  if (isDev()) return { email, sha256: "dev-placeholder" };
  throw new Error("Missing required env: ADMIN_PASSWORD_SHA256");
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function pbkdf2Hex(password: string, salt: string, iter: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: iter, hash: "SHA-256" }, key, 256);
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function normalizeStoredHash(stored: string): string {
  const value = stored.trim();
  // Pages secrets are sometimes pasted with shell/JSON quotes. Accept one
  // matching wrapper so a valid PBKDF2 digest is not treated as a runtime error.
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function parseStoredHash(stored: string): { kind: "pbkdf2"; iter: number; salt: string; hash: string } | { kind: "sha256"; hash: string } {
  stored = normalizeStoredHash(stored);
  // New format: pbkdf2$100000$salt$hex  — recommended
  if (stored.startsWith("pbkdf2$")) {
    const parts = stored.split("$");
    if (parts.length === 4) {
      const iter = parseInt(parts[1], 10);
      if (iter >= 10000 && parts[2] && /^[a-f0-9]{64}$/i.test(parts[3])) return { kind: "pbkdf2", iter, salt: parts[2], hash: parts[3].toLowerCase() };
    }
  }
  // Legacy: raw 64 hex sha256 (1-round, fast — keep for compat but encourage migration)
  if (/^[a-f0-9]{64}$/i.test(stored)) return { kind: "sha256", hash: stored.toLowerCase() };
  throw new Error("Stored hash format invalid");
}

export async function verifyPassword(plain: string, stored: string) {
  // Dev mode: accept "axvara-dev-only" as password
  if (stored === "dev-placeholder" && isDev()) {
    return plain === "axvara-dev-only";
  }
  const parsed = parseStoredHash(stored);
  if (parsed.kind === "pbkdf2") {
    const hex = await pbkdf2Hex(plain, parsed.salt, parsed.iter);
    return timingSafeEqual(hex, parsed.hash);
  }
  const hex = await sha256Hex(plain);
  return timingSafeEqual(hex, parsed.hash);
}

export async function verifyPasswordWithSha(plain: string, expectedShaHex: string) {
  // Backward compat helper — detect pbkdf2 format
  try {
    const parsed = parseStoredHash(expectedShaHex);
    if (parsed.kind === "pbkdf2") {
      const hex = await pbkdf2Hex(plain, parsed.salt, parsed.iter);
      return timingSafeEqual(hex, parsed.hash);
    }
    const hex = await sha256Hex(plain);
    return timingSafeEqual(hex, parsed.hash);
  } catch {
    const hex = await sha256Hex(plain);
    return timingSafeEqual(hex, expectedShaHex.toLowerCase());
  }
}

export async function hashPasswordPbkdf2(password: string, salt: string, iter = 100000): Promise<string> {
  const hex = await pbkdf2Hex(password, salt, iter);
  return `pbkdf2$${iter}$${salt}$${hex}`;
}

export async function createAdminToken(email: string) {
  const now = Math.floor(Date.now() / 1000);
  return await new jose.SignJWT({ email, role: "admin", iat: now })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime("8h")
    .sign(secretKey());
}

export async function createCheckoutQuoteToken(input: Omit<CheckoutQuotePayload, "quote_id">) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const quoteId = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 60 * 60;
  const token = await new jose.SignJWT({
    purpose: "checkout_quote",
    items: input.items,
    subtotal: input.subtotal,
    payment_methods: input.payment_methods,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setJti(quoteId)
    .sign(secretKey());
  return { token, quoteId, expiresAt };
}

export async function verifyCheckoutQuoteToken(token: string): Promise<CheckoutQuotePayload | null> {
  try {
    // Tolak representasi base64url non-kanonis. Tanpa cek ini, perubahan karakter
    // terakhir tertentu dapat mendekode ke byte tanda tangan yang sama.
    const segments = token.split(".");
    if (segments.length !== 3 || segments.some((segment) => jose.base64url.encode(jose.base64url.decode(segment)) !== segment)) return null;
    const { payload } = await jose.jwtVerify(token, secretKey());
    if (payload.purpose !== "checkout_quote" || !payload.jti || !Array.isArray(payload.items) || !Array.isArray(payload.payment_methods)) return null;

    const items = payload.items.filter((item): item is CheckoutQuoteItem => {
      if (!item || typeof item !== "object") return false;
      const value = item as Record<string, unknown>;
      return Number.isInteger(value.product_id)
        && Number(value.product_id) > 0
        && typeof value.name === "string"
        && Number.isInteger(value.price)
        && Number(value.price) >= 0
        && Number.isInteger(value.qty)
        && Number(value.qty) >= 1
        && Number(value.qty) <= 20;
    });
    const paymentMethods = payload.payment_methods.filter((method): method is CheckoutQuotePaymentMethod => {
      if (!method || typeof method !== "object") return false;
      const value = method as Record<string, unknown>;
      return typeof value.id === "string" && typeof value.account_number === "string";
    });
    const subtotal = Number(payload.subtotal);
    if (items.length !== payload.items.length || paymentMethods.length !== payload.payment_methods.length || !Number.isInteger(subtotal) || subtotal < 0) return null;

    return {
      quote_id: payload.jti,
      items,
      subtotal,
      payment_methods: paymentMethods,
    };
  } catch {
    return null;
  }
}

export function getSessionDurations() {
  return { absoluteMax: 8 * 60 * 60, idleMax: 2 * 60 * 60 }; // seconds
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
  // Idle enforcement: 2h tanpa aktivitas wajib login ulang (F-High)
  const idle = getIdleTokenFromCookieHeader(req.headers.get("cookie"));
  if (!idle) return null;
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
  const name = secure ? "__Host-axvara_admin_token" : "axvara_admin_token";
  const parts = [`${name}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function cookieForIdle(token: string, isSecure: boolean) {
  // Idle session marker — separate cookie to track last activity (2h)
  const maxAge = 2 * 60 * 60;
  const secure = isSecure || !isDev();
  const name = secure ? "__Host-axvara_idle" : "axvara_idle";
  const parts = [`${name}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function expiredIdleCookie(isSecure: boolean) {
  const secure = isSecure || !isDev();
  const name = secure ? "__Host-axvara_idle" : "axvara_idle";
  const parts = [`${name}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
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

export function getIdleTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)(?:__Host-)?axvara_idle=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
