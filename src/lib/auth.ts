import * as jose from "jose";

export type CheckoutQuoteItem = {
  product_id: number;
  variant_id?: number;
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

export type AdminPasswordProofConfig = {
  algorithm: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
};

function bytesFromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function hmacHex(keyBytes: Uint8Array, message: string): Promise<string> {
  const keyMaterial = new Uint8Array(keyBytes).buffer as ArrayBuffer;
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getAdminPasswordProofConfig(stored: string): AdminPasswordProofConfig | null {
  if (stored === "dev-placeholder" && isDev()) return null;
  const parsed = parseStoredHash(stored);
  if (parsed.kind !== "pbkdf2") return null;
  return { algorithm: "PBKDF2-SHA-256", iterations: parsed.iter, salt: parsed.salt };
}

export async function createAdminPasswordProofChallenge(email: string): Promise<string> {
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  return new jose.SignJWT({ purpose: "admin_password_proof", email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .setJti(Array.from(nonce).map((byte) => byte.toString(16).padStart(2, "0")).join(""))
    .sign(secretKey());
}

export async function verifyAdminPasswordProof(email: string, stored: string, challenge: string, proof: string): Promise<boolean> {
  try {
    const parsed = parseStoredHash(stored);
    if (parsed.kind !== "pbkdf2" || !/^[a-f0-9]{64}$/i.test(proof)) return false;
    const { payload } = await jose.jwtVerify(challenge, secretKey());
    if (payload.purpose !== "admin_password_proof" || String(payload.email).toLowerCase() !== email.toLowerCase()) return false;
    return timingSafeEqual(await hmacHex(bytesFromHex(parsed.hash), challenge), proof.toLowerCase());
  } catch {
    return false;
  }
}

export async function createAdminToken(email: string) {
  const now = Math.floor(Date.now() / 1000);
  const sessionId = randomSessionId();
  const authVersion = await authVersionFor(getStoredHashForVersion());
  const token = await new jose.SignJWT({ email, role: "admin", sid: sessionId, av: authVersion, iat: now })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime("8h")
    .sign(secretKey());
  return { token, sid: sessionId };
}

export type CreateIdleOptions = {
  /** Override waktu terbit (ms) — dipakai test expiry deterministik. */
  issuedAtMs?: number;
};

/**
 * Terbitkan cookie idle bertanda tangan (JWT HS256 2 jam) yang terikat ke
 * satu sesi login via `sid` yang sama dengan admin JWT.
 *
 * Desain ini memperbaiki temuan audit #8: sebelumnya cookie idle hanyalah
 * string acak (`Date.now()+random`) yang hanya dicek keberadaannya, sehingga
 * JWT valid + cookie idle sembarang tetap diterima. Sekarang idle membawa
 * signature server (HS256), expiry 2 jam yang ditegakkan di server, binding
 * `sid`, dan claim `av` (auth version dari hash password) agar rotasi
 * password menggugurkan seluruh sesi lama.
 */
export async function createIdleToken(sid: string, options: CreateIdleOptions = {}): Promise<string> {
  const issuedAtMs = options.issuedAtMs ?? Date.now();
  const issuedAt = Math.floor(issuedAtMs / 1000);
  const authVersion = await authVersionFor(getStoredHashForVersion());
  return await new jose.SignJWT({ purpose: "admin_idle", sid, av: authVersion, iat: issuedAt })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 2 * 60 * 60)
    .setJti(randomSessionId())
    .sign(secretKey());
}

export type AdminIdlePayload = {
  sid: string;
  authVersion: string;
  issuedAt: number;
  expiresAt: number;
};

export async function verifyIdleToken(idle: string): Promise<AdminIdlePayload | null> {
  try {
    const segments = idle.split(".");
    if (segments.length !== 3 || segments.some((segment) => jose.base64url.encode(jose.base64url.decode(segment)) !== segment)) return null;
    const { payload } = await jose.jwtVerify(idle, secretKey());
    if (payload.purpose !== "admin_idle" || typeof payload.sid !== "string" || !payload.sid) return null;
    if (typeof payload.exp !== "number" || typeof payload.iat !== "number") return null;
    return {
      sid: payload.sid,
      authVersion: typeof payload.av === "string" ? payload.av : "",
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
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
        && (value.variant_id === undefined || (Number.isInteger(value.variant_id) && Number(value.variant_id) > 0))
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

function randomSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Auth version = fingerprint hash password admin. Rotasi password di Pages
 * Secrets mengubah nilai ini sehingga seluruh JWT/idle lama (yang membawa
 * `av` lama, atau tidak membawa `av` sama sekali) gugur — perilaku revokasi
 * eksplisit untuk temuan audit #8. Stateless (tanpa tabel sesi) agar tetap
 * Edge-safe di Cloudflare Pages.
 */
async function authVersionFor(storedHash: string): Promise<string> {
  const normalized = normalizeStoredHash(storedHash);
  try {
    return await sha256Hex(`axvara-admin-auth-v1:${normalized}`);
  } catch {
    return `fallback:${normalized.length}:${normalized.slice(0, 12)}`;
  }
}

function getStoredHashForVersion(): string {
  // JANGAN paksa "dev-placeholder" di sini: test (NODE_ENV=test/non-prod
  // dengan ADMIN_PASSWORD_SHA256 eksplisit) maupun produksi harus memakai
  // hash yang sama dengan yang dipakai login, agar `av` di token cocok
  // dengan `av` yang dihitung saat verifikasi.
  try {
    return getAdminCredentials().sha256;
  } catch {
    return "unconfigured";
  }
}

export function getSessionDurations() {
  return { absoluteMax: 8 * 60 * 60, idleMax: 2 * 60 * 60 }; // seconds
}

export type AdminTokenPayload = {
  email: string;
  role: string;
  sid: string;
  authVersion: string;
  exp: number;
  iat: number;
};

export async function verifyAdminToken(token: string): Promise<AdminTokenPayload | null> {
  try {
    const segments = token.split(".");
    if (segments.length !== 3 || segments.some((segment) => jose.base64url.encode(jose.base64url.decode(segment)) !== segment)) return null;
    const { payload } = await jose.jwtVerify(token, secretKey());
    if (payload.role !== "admin" || !payload.email) return null;
    if (typeof payload.sid !== "string" || !payload.sid) return null;
    return {
      email: String(payload.email),
      role: String(payload.role),
      sid: payload.sid,
      authVersion: typeof payload.av === "string" ? payload.av : "",
      exp: Number(payload.exp),
      iat: Number(payload.iat),
    };
  } catch {
    return null;
  }
}

/**
 * Hasil verifikasi terperinci agar UI dapat membedakan sesi habis idle
 * (minta login ulang dengan pesan jelas) dari unauthorized umum.
 */
export type AdminAuthCheck =
  | { ok: true; payload: AdminTokenPayload }
  | { ok: false; reason: "unauthorized" | "idle_timeout" | "session_mismatch" | "revoked" };

export type RequireAdminOptions = {
  /** Override auth version — dipakai test revokasi deterministik. */
  authVersion?: string;
};

async function checkAdminSession(req: Request, overrides: RequireAdminOptions = {}): Promise<AdminAuthCheck> {
  const cookieHeader = req.headers.get("cookie");
  const token = getTokenFromCookieHeader(cookieHeader);
  if (!token) return { ok: false, reason: "unauthorized" };
  let payload: AdminTokenPayload | null = null;
  try {
    payload = await verifyAdminToken(token);
  } catch {
    return { ok: false, reason: "unauthorized" };
  }
  if (!payload) return { ok: false, reason: "unauthorized" };
  // Idle enforcement: cookie idle wajib berupa JWT HS256 server-issued yang
  // masih berlaku (temuan audit #8 — nilai sembarang tidak lagi diterima).
  const idleRaw = getIdleTokenFromCookieHeader(cookieHeader);
  if (!idleRaw) return { ok: false, reason: "idle_timeout" };
  const idle = await verifyIdleToken(idleRaw);
  if (!idle) return { ok: false, reason: "idle_timeout" };
  // Binding sesi: idle harus diterbitkan untuk sid yang sama dengan JWT.
  if (idle.sid !== payload.sid) return { ok: false, reason: "session_mismatch" };
  // Revokasi: token/idle lama (tanpa claim `av`, atau `av` basi setelah
  // rotasi password maupun logout sesi ini) selalu gugur. Tanpa ini,
  // rotate-secret tidak mencabut sesi yang sudah beredar, dan replay cookie
  // lama setelah logout tetap diterima (review R8).
  const expectedVersion = await expectedAuthVersion(payload.sid, overrides);
  let expectedEmail = "";
  try {
    expectedEmail = getAdminCredentials().email;
  } catch {
    return { ok: false, reason: "unauthorized" };
  }
  if (String(payload.email).toLowerCase() !== expectedEmail.toLowerCase()) return { ok: false, reason: "unauthorized" };
  if (!payload.authVersion || payload.authVersion !== expectedVersion || idle.authVersion !== expectedVersion) {
    return { ok: false, reason: "revoked" };
  }
  return { ok: true, payload };
}

/** Logout satu sesi (review R8): naikkan versi sesi agar token/idle lama sesi
 * itu gugur saat verifikasi berikutnya. Sesi lain tidak tersentuh.
 *
 * Sumber kebenaran adalah tabel D1 `admin_session_revocations` (migrasi
 * 0020) — tahan restart dan terbaca lintas instance. Map memori
 * (revokedSessions) hanya cache proses-lokal agar verifikasi tidak
 * menambah query D1 di jalur panas; setiap bump menulis D1 DULU lalu
 * mengisi cache, dan setiap verifikasi memakai versi tertinggi yang
 * diketahui (cache ∪ D1). Tanpa D1 (dev), Map tetap berfungsi.
 * Rotasi password tetap kill-switch global via claim `av`.
 * Gangguan tulis D1 saat logout → logout GAGAL (bukan sukses palsu):
 * bumpAuthVersion melempar agar route menjawab 500, bukan revoked. */
const revokedSessions = new Map<string, number>();

/** Versi sesi saat ini (cache lokal; dipakai test). Diekspor untuk test. */
export function sessionVersionForTest(sid: string): number {
  return revokedSessions.get(sid) ?? 0;
}

/** Bersihkan cache lokal (simulasi restart/instance baru pada test). */
export function clearSessionCacheForTest(): void {
  revokedSessions.clear();
}

/** Kegagalan baca revokasi: bedakan "record tidak ada" dari "store gagal".
 *
 * RR3-04: `.catch(() => null)` di sini MENGUBAH gangguan baca menjadi
 * seolah-olah tidak ada record (versi 0) — sesi yang sudah logout diterima
 * kembali. Sekarang kegagalan dilempar agar pemanggil fail-closed; hanya
 * "baris memang tidak ada" yang menghasilkan 0.
 */
async function readRevokedVersionFromStore(sid: string): Promise<number> {
  const { queryFirst, isD1Mode } = await import("@/lib/db");
  if (!isD1Mode()) return 0;
  const row = await queryFirst(
    `SELECT version FROM admin_session_revocations WHERE sid=?`,
    sid,
  );
  // Tidak ada baris = sesi belum pernah dicabut → versi 0. Kegagalan query
  // (throw) DITERUSKAN — bukan ditelan menjadi 0.
  return Number((row as { version?: unknown } | null)?.version ?? 0);
}

async function sessionBumpFor(sid: string): Promise<number> {
  const local = revokedSessions.get(sid) ?? 0;
  let stored: number;
  try {
    stored = await readRevokedVersionFromStore(sid);
  } catch {
    // Gangguan BACA revokasi saat D1 diwajibkan: JANGAN fallback "anggap
    // valid". Kembalikan -2 sebagai penanda store tak dapat dibaca;
    // expectedAuthVersion memperlakukannya sebagai revoked (fail-closed).
    // Tanpa D1 (dev), readRevokedVersionFromStore mengembalikan 0 dan
    // tidak pernah melempar ke sini.
    return -2;
  }
  return Math.max(local, stored);
}

export async function bumpAuthVersion(sid: string): Promise<void> {
  const { execRun, queryFirst, isD1Mode } = await import("@/lib/db");
  if (isD1Mode()) {
    // Tulis D1 DULU (sumber kebenaran) — gagal tulis = gagal logout.
    const current = await queryFirst(
      `SELECT version FROM admin_session_revocations WHERE sid=?`, sid,
    ).catch(() => null) as { version?: unknown } | null;
    const next = Number(current?.version ?? 0) + 1;
    try {
      await execRun(
        `INSERT INTO admin_session_revocations (sid, version, revoked_at, expires_at)
         VALUES (?, ?, datetime('now'), datetime('now', '+9 hours'))
         ON CONFLICT(sid) DO UPDATE SET version=?, revoked_at=datetime('now'),
           expires_at=datetime('now', '+9 hours')`,
        sid, next, next,
      );
    } catch {
      throw new Error("session_revocation_store_unavailable");
    }
    revokedSessions.set(sid, next);
    return;
  }
  revokedSessions.set(sid, (revokedSessions.get(sid) ?? 0) + 1);
}

/** Expected `av` untuk sesi ini: versi password global + bump logout sesi.
 * Bump dibaca dari cache ∪ store D1 (tahan restart/lintas instance).
 * Store tak terbaca (-2) → kembalikan penanda mustahil-cocok agar sesi
 * DITOLAK (fail-closed), bukan dianggap valid.
 */
async function expectedAuthVersion(sid: string, overrides: RequireAdminOptions): Promise<string> {
  if (overrides.authVersion) return overrides.authVersion;
  const base = await authVersionFor(getAdminCredentials().sha256);
  const bump = await sessionBumpFor(sid);
  if (bump === -2) return `${base}#store-unreadable`;
  return bump === 0 ? base : `${base}#s${bump}`;
}

export async function requireAdminDetailed(req: Request, overrides: RequireAdminOptions = {}): Promise<AdminAuthCheck> {
  return checkAdminSession(req, overrides);
}

export async function requireAdmin(req: Request, overrides: RequireAdminOptions = {}): Promise<AdminTokenPayload | null> {
  const check = await checkAdminSession(req, overrides);
  return check.ok ? check.payload : null;
}

export function getTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)(?:__Host-)?axvara_admin_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function getTokenFromRequest(req: Request): string | null {
  // Admin auth cookie-only: JANGAN fallback ke Authorization Bearer di sini.
  // Jalur integrasi resmi memakai requireAgent (agent Bearer tokens), bukan
  // JWT admin — Bearer admin tanpa cookie idle terikat selalu ditolak.
  return getTokenFromCookieHeader(req.headers.get("cookie"));
}


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
