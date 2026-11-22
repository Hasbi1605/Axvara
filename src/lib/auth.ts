import * as jose from "jose";
import { z } from "zod";
import { checkCloudflareAccess } from "@/lib/cloudflare-access";
import { constantTimeEqual } from "@/lib/security";
import { idrToUsdCents, parseFxTimestamp, parseRateRational, type FxSource } from "@/lib/payments/fx";
import { getCryptoAsset } from "@/lib/payments/crypto-assets";
import { CRYPTO_SURCHARGE_BPS, centsToUsdText, cryptoPricing } from "@/lib/payments/crypto-pricing";

export type CheckoutQuoteItem = {
  buyer_field_key?: "muse_invite_code" | null;
  buyer_fields?: { muse_invite_code?: string; pv_email?: string; pv_password?: string; pv_totp_secret?: string };
  max_qty?: number | null;
  product_id: number;
  variant_id?: number;
  name: string;
  price: number;
  qty: number;
  base_price?: number;
  applied_tier_min_qty?: number;
};

export type CheckoutQuoteUsdSnapshot = {
  cents: string; // USD cents BASE (sebelum biaya layanan crypto) bigint serialized, e.g. "1563"
  rate_num: string;
  rate_den: string;
  rate_text: string;
  source: FxSource;
  effective_at: string;
  idr_subtotal: number;
  pay_currency: string; // ticker kurasi NOWPayments, e.g. "usdtbsc" / "btc"
  network: string; // server mapping dari katalog kurasi, e.g. "bsc"
};

export type CheckoutQuotePaymentMethod = {
  id: string;
  account_number: string;
  // W3 USD+locale contract (Sonnet packet): signed method rows carry kind +
  // optional USD snapshot ONLY for crypto. Client never supplies these —
  // server computes at quote time; verify strips unknown fields.
  kind?: "qris" | "crypto" | "gateway";
  sublabel?: string | null;
  available?: boolean;
  currency?: "IDR" | "USD";
  amount_text?: string;
  pay_currency?: string;
  network?: string;
  usd?: CheckoutQuoteUsdSnapshot;
  // Crypto multi-koin: fee provider ditanggung merchant, kurs mengambang; pembeli
  // menanggung lewat biaya layanan AXVARA (surcharge_bps). amount_text = TOTAL.
  fee_payer?: "merchant";
  fixed_rate?: false;
  base_cents?: number;
  surcharge_cents?: number;
  total_cents?: number;
  surcharge_bps?: number;
  sender_gas_extra?: boolean;
  gateway?: { channel: string; estimated_fee: number; estimated_total: number; idr_subtotal: number };
};

export type CheckoutQuotePayload = {
  quote_id: string;
  items: CheckoutQuoteItem[];
  subtotal: number;
  payment_methods: CheckoutQuotePaymentMethod[];
  locale?: "id" | "en";
};

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

// Fallback JWT khusus development. NILAINYA HARUS DETERMINISTIK.
//
// Sebelumnya nilai ini diacak per module-instance. Setiap isolate/bundle
// (route handler berbeda, worker restart, HMR) karenanya memegang secret
// berbeda, sehingga cookie yang ditandatangani saat login gagal diverifikasi
// oleh /api/auth/me — persis gejala "login berhasil lalu langsung keluar".
// Nilai tetap di bawah tidak menurunkan keamanan produksi: getJwtSecretRaw
// dan requireEnv melempar bila ADMIN_JWT_SECRET kosong di production.
const DEV_JWT_FALLBACK_SECRET = "axvara-dev-only-jwt-secret-do-not-use-in-production";
function getDevSecret(): string {
  return process.env.ADMIN_JWT_SECRET?.trim() || DEV_JWT_FALLBACK_SECRET;
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

/** Format hash tersimpan: legacy satu-putaran SHA-256 (tanpa salt) atau PBKDF2. */
export function isLegacyStoredHash(stored: string): boolean {
  try {
    return parseStoredHash(stored).kind === "sha256";
  } catch {
    return false;
  }
}

// ── Upgrade-on-login (audit AU-B1-1) ──────────────────────────────────────
// Hash legacy tetap diterima agar admin lama tidak terkunci, tetapi pada login
// sukses pertama ia diganti PBKDF2 dan disimpan di D1 `store_settings`. Baris
// override hanya dipercaya bila `source` cocok dengan secret env saat ini,
// sehingga rotasi ADMIN_PASSWORD_SHA256 di Pages langsung berlaku kembali.
const ADMIN_HASH_OVERRIDE_KEY = "admin_password_hash";
const ADMIN_HASH_UPGRADED_AT_KEY = "admin_password_upgraded_at";

type LegacyUpgradeRecord = { source: string; hash: string };

function legacySourceFingerprint(stored: string, upgradedHash: string): Promise<string> | null {
  const secret = process.env.ADMIN_JWT_SECRET?.trim();
  if (!secret) return null;
  // Bind the replacement hash too: a valid tag cannot be copied to a different override.
  return hmacHex(new TextEncoder().encode(secret), `axvara-admin-legacy-source-v2:${normalizeStoredHash(stored)}:${upgradedHash}`);
}

function parseLegacyUpgrade(raw: string | null): LegacyUpgradeRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LegacyUpgradeRecord> | null;
    if (typeof value?.source !== "string" || !/^[a-f0-9]{64}$/.test(value.source) || typeof value.hash !== "string") return null;
    const parsed = parseStoredHash(value.hash);
    if (parsed.kind !== "pbkdf2") return null;
    return { source: value.source, hash: normalizeStoredHash(value.hash) };
  } catch {
    return null;
  }
}

async function readStoreSetting(key: string): Promise<string | null> {
  try {
    const { queryFirst, isD1Mode } = await import("@/lib/db");
    if (!isD1Mode()) return null;
    const row = await queryFirst("SELECT value FROM store_settings WHERE key=?", key);
    return typeof row?.value === "string" ? row.value : null;
  } catch {
    // Gangguan baca tidak boleh mengunci login: jatuh ke hash env.
    return null;
  }
}

async function writeStoreSetting(key: string, value: string): Promise<boolean> {
  const { execRun, isD1Mode } = await import("@/lib/db");
  if (!isD1Mode()) return false;
  const result = await execRun(
    `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
    key, value,
  );
  return Number(result.changes ?? 0) > 0;
}

/** Hash efektif untuk verifikasi login. Bila env masih legacy tetapi sudah
 *  pernah di-upgrade dan secret env belum berubah, pakai PBKDF2 tersimpan. */
export async function resolveAdminStoredHash(envHash?: string): Promise<string> {
  const stored = envHash ?? getAdminCredentials().sha256;
  if (stored === "dev-placeholder" && isDev()) return stored;
  if (!isLegacyStoredHash(stored)) return stored;
  const override = parseLegacyUpgrade(await readStoreSetting(ADMIN_HASH_OVERRIDE_KEY));
  if (override) {
    try {
      const source = await legacySourceFingerprint(stored, override.hash);
      if (source && constantTimeEqual(source, override.source)) return override.hash;
    } catch {
      // An unavailable HMAC must not block verification with the env hash.
    }
  }
  return stored;
}

/** Ganti hash legacy dengan PBKDF2 setelah login sukses. Tidak pernah
 *  menggagalkan login; kegagalan penyimpanan dilaporkan ke log sanitized. */
export async function upgradeAdminPasswordHash(plain: string, verifiedStored: string): Promise<boolean> {
  if (!isLegacyStoredHash(verifiedStored)) return false;
  try {
    const { isD1Mode } = await import("@/lib/db");
    if (!isD1Mode()) return false;
    const hash = await hashPasswordPbkdf2(plain, randomSessionId());
    const source = await legacySourceFingerprint(verifiedStored, hash);
    if (!source) return false;
    if (!(await writeStoreSetting(ADMIN_HASH_OVERRIDE_KEY, JSON.stringify({ source, hash })))) return false;
    await writeStoreSetting(ADMIN_HASH_UPGRADED_AT_KEY, new Date().toISOString());
    console.info("[security]", JSON.stringify({ event: "admin_password_upgraded", route: "/api/auth/login", method: "POST" }));
    return true;
  } catch {
    return false;
  }
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
  const adminSubject = await hmacHex(secretKey(), `admin-challenge:v1:${email.toLowerCase()}`);
  return new jose.SignJWT({ purpose: "admin_password_proof", admin_subject: adminSubject })
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
    const subject = await hmacHex(secretKey(), `admin-challenge:v1:${email.toLowerCase()}`);
    // Previously-issued challenges expire after five minutes.
    const sameAdmin = payload.admin_subject === subject || (payload.admin_subject === undefined && String(payload.email).toLowerCase() === email.toLowerCase());
    if (payload.purpose !== "admin_password_proof" || !sameAdmin) return false;
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

const quoteItemSchema = z.object({
  product_id: z.number().int().safe().positive(), variant_id: z.number().int().safe().positive().optional(),
  name: z.string(), price: z.number().int().safe().nonnegative(), qty: z.number().int().min(1).max(100),
  buyer_field_key: z.literal("muse_invite_code").nullable().optional(),
  buyer_fields: z.object({
    muse_invite_code: z.string().regex(/^[A-Za-z0-9]{6}$/).optional(),
    pv_email: z.string().trim().max(254).optional(),
    pv_password: z.string().max(200).optional(),
    pv_totp_secret: z.string().trim().max(120).optional(),
  }).strict().optional(),
  max_qty: z.number().int().min(1).max(100).nullable().optional(),
  base_price: z.number().int().safe().nonnegative().optional(), applied_tier_min_qty: z.number().int().safe().min(2).optional(),
});
const quoteUsdSchema = z.object({
  cents: z.string().regex(/^[0-9]{1,20}$/), rate_num: z.string().regex(/^[0-9]{1,32}$/),
  rate_den: z.string().regex(/^[0-9]{1,32}$/), rate_text: z.string().max(32), source: z.enum(["operator-fixed", "nowpayments-estimate"]),
  effective_at: z.string(), idr_subtotal: z.number().int().safe().positive(),
  pay_currency: z.string().regex(/^[a-z0-9]{1,32}$/), network: z.string().regex(/^[a-z0-9]{1,32}$/),
});
const centsField = z.number().int().safe().nonnegative();
export const quoteMethodSchema = z.object({
  id: z.string(), account_number: z.string(), kind: z.enum(["qris", "crypto", "gateway"]).optional(),
  sublabel: z.string().nullable().optional(), available: z.boolean().optional(), currency: z.enum(["IDR", "USD"]).optional(),
  amount_text: z.string().optional(), pay_currency: z.string().optional(), network: z.string().optional(), usd: quoteUsdSchema.optional(),
  fee_payer: z.literal("merchant").optional(), fixed_rate: z.literal(false).optional(),
  base_cents: centsField.optional(), surcharge_cents: centsField.optional(), total_cents: centsField.optional(),
  surcharge_bps: z.number().int().safe().nonnegative().optional(), sender_gas_extra: z.boolean().optional(),
  gateway: z.object({ channel: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), estimated_fee: z.number().int().safe().nonnegative(), estimated_total: z.number().int().safe().positive(), idr_subtotal: z.number().int().safe().positive() }).strict().optional(),
});
type QuoteMethod = z.infer<typeof quoteMethodSchema>;
const CRYPTO_ONLY_FIELDS = ["usd", "amount_text", "pay_currency", "network", "fee_payer", "fixed_rate", "base_cents", "surcharge_cents", "total_cents", "surcharge_bps", "sender_gas_extra"] as const;

/**
 * Validator kripto tunggal (token web + payq1 Telegram): ticker WAJIB kurasi dan id = `nowpayments:<ticker>`,
 * jaringan WAJIB sama dengan jaringan kurasi untuk ticker itu, kebijakan provider mengambang + fee merchant,
 * dan angka WAJIB eksak: base = idrToUsdCents(subtotal, kurs bertanda), surcharge = ceil(base x bps / 10000),
 * total = base + surcharge > 0, amount_text = total desimal 2dp. Tanpa float.
 */
function isValidCryptoMethod(method: QuoteMethod, idrSubtotal: number): boolean {
  const usd = method.usd;
  const rate = usd && parseRateRational(usd.rate_text);
  const ticker = method.id.startsWith("nowpayments:") ? method.id.slice("nowpayments:".length) : "";
  const asset = getCryptoAsset(ticker);
  if (!usd || !rate || !asset || asset.ticker !== ticker || method.kind !== "crypto" || method.available === false) return false;
  if (method.currency !== "USD" || method.pay_currency !== ticker || usd.pay_currency !== ticker
    || method.network !== asset.network || usd.network !== asset.network) return false;
  if (method.fee_payer !== "merchant" || method.fixed_rate !== false || method.surcharge_bps !== CRYPTO_SURCHARGE_BPS) return false;
  if (usd.idr_subtotal !== idrSubtotal || parseFxTimestamp(usd.effective_at) === null
    || rate.num !== BigInt(usd.rate_num) || rate.den !== BigInt(usd.rate_den)) return false;
  const base = BigInt(usd.cents);
  if (base <= BigInt(0)) return false;
  const fx = { rateNum: usd.rate_num, rateDen: usd.rate_den, rateText: usd.rate_text, effectiveAt: usd.effective_at, source: usd.source };
  if (idrToUsdCents(idrSubtotal, fx) !== base) return false;
  const pricing = cryptoPricing(base, ticker);
  return method.base_cents !== undefined && BigInt(method.base_cents) === pricing.baseCents
    && method.surcharge_cents !== undefined && BigInt(method.surcharge_cents) === pricing.surchargeCents
    && method.total_cents !== undefined && BigInt(method.total_cents) === pricing.totalCents
    && method.amount_text === centsToUsdText(pricing.totalCents);
}

/** Canonical TG/server method validator (reused by web quote + TG payq1).
 * No independent policy engine: exact gateway net+fee=total + crypto
 * snapshot math/payer/fixed/asset/network per the signed contract. */
export function isCanonicalMethodOption(value: unknown, idrSubtotal: number): boolean {
  const parsed = quoteMethodSchema.safeParse(value);
  if (!parsed.success) return false;
  const method = parsed.data;
  if (method.kind === "gateway" || method.gateway) {
    const gateway = method.gateway;
    if (!gateway || method.kind !== "gateway" || method.id !== `sekalipay_gateway:${gateway.channel}`
      || /qris/i.test(gateway.channel) || method.account_number !== "" || method.currency !== "IDR"
      || CRYPTO_ONLY_FIELDS.some((field) => method[field] !== undefined)
      || gateway.idr_subtotal !== idrSubtotal || gateway.estimated_total !== gateway.idr_subtotal + gateway.estimated_fee) {
      return false;
    }
    return true;
  }
  if (method.kind !== "crypto") {
    // Non-kripto (QRIS dsb.) tidak boleh membawa field kripto/kebijakan provider.
    return !CRYPTO_ONLY_FIELDS.some((field) => method[field] !== undefined);
  }
  return isValidCryptoMethod(method, idrSubtotal);
}
const quoteSchema = z.object({
  items: z.array(quoteItemSchema), subtotal: z.number().int().safe().nonnegative(),
  payment_methods: z.array(quoteMethodSchema), locale: z.enum(["id", "en"]).optional(),
}).superRefine((quote, ctx) => {
  const total = quote.items.reduce((sum, item) => sum + BigInt(item.price) * BigInt(item.qty), BigInt(0));
  if (total !== BigInt(quote.subtotal)) ctx.addIssue({ code: "custom", message: "subtotal mismatch" });
  const quantities = new Map<number, number>();
  for (const item of quote.items) if (item.variant_id) quantities.set(item.variant_id, (quantities.get(item.variant_id) ?? 0) + item.qty);
  const snapshots = new Map<number, string>();
  for (const item of quote.items) {
    if (item.variant_id) {
      const snapshot = JSON.stringify([item.product_id, item.price, item.base_price ?? null, item.applied_tier_min_qty ?? null]);
      if (snapshots.has(item.variant_id) && snapshots.get(item.variant_id) !== snapshot) ctx.addIssue({ code: "custom", message: "inconsistent variant snapshot" });
      snapshots.set(item.variant_id, snapshot);
    }
    if (item.base_price !== undefined || item.applied_tier_min_qty !== undefined) {
      if (!item.variant_id || item.base_price === undefined || item.applied_tier_min_qty === undefined || item.price <= 0 || item.price > item.base_price
        || (quantities.get(item.variant_id) ?? 0) < item.applied_tier_min_qty) ctx.addIssue({ code: "custom", message: "invalid bulk snapshot" });
    }
  }
  for (const method of quote.payment_methods) {
    if (method.kind === "gateway" || method.gateway) {
      const gateway = method.gateway;
      if (!gateway || method.kind !== "gateway" || method.id !== `sekalipay_gateway:${gateway.channel}`
        || /qris/i.test(gateway.channel) || method.account_number !== "" || method.currency !== "IDR"
        || CRYPTO_ONLY_FIELDS.some((field) => method[field] !== undefined)
        || gateway.idr_subtotal !== quote.subtotal || gateway.estimated_total !== gateway.idr_subtotal + gateway.estimated_fee) {
        ctx.addIssue({ code: "custom", message: "invalid gateway snapshot" });
      }
      continue;
    }
    if (method.kind !== "crypto") {
      if (CRYPTO_ONLY_FIELDS.some((field) => method[field] !== undefined)) ctx.addIssue({ code: "custom", message: "invalid crypto snapshot" });
      continue;
    }
    if (!isValidCryptoMethod(method, quote.subtotal)) ctx.addIssue({ code: "custom", message: "invalid crypto snapshot" });
  }
});

/**
 * Payload token ringkas (kompak): semua metode kripto satu quote memakai snapshot USD/kurs,
 * base USD, dan kebijakan yang sama; yang berbeda per koin hanyalah ticker dan TOTAL-nya
 * (biaya layanan = 1% proporsional + biaya tetap per ticker). Satu blok `crypto`
 * menggantikan hingga 28 metode penuh agar JWT tetap jauh di bawah batas `quote_token` (8000).
 * Verifikasi mengembangkan blok kembali ke metode penuh lalu menjalankan `quoteSchema` TANPA diubah.
 */
const compactCryptoItemSchema = z.object({
  ticker: z.string().regex(/^[a-z0-9]{1,32}$/),
  total_cents: centsField,
}).strict();

const compactCryptoSchema = z.object({
  items: z.array(compactCryptoItemSchema).min(1).max(64)
    .refine((list) => new Set(list.map((item) => item.ticker)).size === list.length, "duplicate ticker")
    .refine((list) => list.every((item) => getCryptoAsset(item.ticker)?.ticker === item.ticker), "non-curated ticker"),
  at: z.number().int().safe().nonnegative().max(1024),
  usd: quoteUsdSchema.omit({ pay_currency: true, network: true }).strict(),
  base_cents: centsField,
  surcharge_bps: z.number().int().safe().nonnegative(), sender_gas_extra: z.boolean().optional(),
  account_number: z.string(), fee_payer: z.literal("merchant"), fixed_rate: z.literal(false), currency: z.literal("USD"),
  available: z.literal(true).optional(), network_labels: z.literal(true).optional(),
}).strict();
type CompactCrypto = z.infer<typeof compactCryptoSchema>;

function looksLikeCryptoMethod(method: unknown): boolean {
  if (!method || typeof method !== "object") return false;
  const { kind, id } = method as { kind?: unknown; id?: unknown };
  return kind === "crypto" || (typeof id === "string" && id.startsWith("nowpayments:"));
}

function compactCryptoMethods(methods: QuoteMethod[]): { payment_methods: QuoteMethod[]; crypto?: CompactCrypto } {
  const indexes = methods.flatMap((method, index) => (looksLikeCryptoMethod(method) ? [index] : []));
  if (indexes.length === 0) return { payment_methods: methods };
  const at = indexes[0];
  if (indexes.some((index, position) => index !== at + position)) throw new Error("crypto quote methods must be contiguous");
  const crypto = methods.slice(at, at + indexes.length);
  const shared = (method: QuoteMethod) => {
    const usd = method.usd;
    if (!usd || method.kind !== "crypto" || !method.id.startsWith("nowpayments:")) throw new Error("invalid crypto quote method");
    const ticker = method.id.slice("nowpayments:".length);
    const asset = getCryptoAsset(ticker);
    if (!asset || asset.ticker !== ticker) throw new Error("non-curated crypto ticker");
    const usdShared = { cents: usd.cents, rate_num: usd.rate_num, rate_den: usd.rate_den, rate_text: usd.rate_text, source: usd.source, effective_at: usd.effective_at, idr_subtotal: usd.idr_subtotal };
    return {
      ticker, labelled: method.sublabel === asset.networkLabel,
      block: {
        usd: usdShared, base_cents: method.base_cents, surcharge_bps: method.surcharge_bps, sender_gas_extra: method.sender_gas_extra,
        account_number: method.account_number, fee_payer: method.fee_payer, fixed_rate: method.fixed_rate, currency: method.currency,
        available: method.available,
      },
      total: method.total_cents,
    };
  };
  const items = crypto.map(shared);
  const first = JSON.stringify(items[0].block);
  const labelled = items[0].labelled;
  if (items.some((item) => JSON.stringify(item.block) !== first || item.labelled !== labelled)
    || (!labelled && crypto.some((method) => method.sublabel !== undefined))) {
    throw new Error("crypto quote methods differ beyond ticker");
  }
  const block = compactCryptoSchema.parse({
    ...items[0].block, items: items.map((item) => ({ ticker: item.ticker, total_cents: item.total })),
    at, ...(labelled ? { network_labels: true } : {}),
  });
  return { payment_methods: [...methods.slice(0, at), ...methods.slice(at + indexes.length)], crypto: block };
}

function expandCompactCrypto(rest: unknown[], block: CompactCrypto): unknown[] | null {
  if (block.at > rest.length) return null;
  const expanded = block.items.map((item) => {
    const asset = getCryptoAsset(item.ticker)!;
    const total = BigInt(item.total_cents);
    if (total <= BigInt(0)) return null;
    const surcharge = total - BigInt(block.base_cents);
    return {
      id: `nowpayments:${item.ticker}`, account_number: block.account_number, kind: "crypto" as const,
      ...(block.network_labels ? { sublabel: asset.networkLabel } : {}),
      ...(block.available ? { available: true } : {}), currency: block.currency, amount_text: centsToUsdText(total),
      pay_currency: item.ticker, network: asset.network, usd: { ...block.usd, pay_currency: item.ticker, network: asset.network },
      fee_payer: block.fee_payer, fixed_rate: block.fixed_rate, base_cents: block.base_cents,
      surcharge_cents: Number(surcharge), total_cents: Number(total), surcharge_bps: block.surcharge_bps,
      ...(block.sender_gas_extra !== undefined ? { sender_gas_extra: block.sender_gas_extra } : {}),
    };
  });
  if (expanded.some((method) => method === null)) return null;
  return [...rest.slice(0, block.at), ...expanded, ...rest.slice(block.at)];
}

export async function createCheckoutQuoteToken(input: Omit<CheckoutQuotePayload, "quote_id">) {
  const validated = quoteSchema.parse(input);
  const compact = compactCryptoMethods(validated.payment_methods);
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const quoteId = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 60 * 60;
  const token = await new jose.SignJWT({
    purpose: "checkout_quote",
    ...validated,
    payment_methods: compact.payment_methods,
    ...(compact.crypto ? { crypto: compact.crypto } : {}),
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
    if (payload.admin_payment_test !== undefined) return null;

    let candidate: unknown = payload;
    if (payload.crypto !== undefined) {
      // Bentuk ringkas: dilarang bercampur dengan metode kripto bentuk penuh.
      if (payload.payment_methods.some(looksLikeCryptoMethod)) return null;
      const block = compactCryptoSchema.safeParse(payload.crypto);
      if (!block.success) return null;
      const methods = expandCompactCrypto(payload.payment_methods, block.data);
      if (!methods) return null;
      candidate = { ...payload, payment_methods: methods };
    }
    const parsed = quoteSchema.safeParse(candidate);
    if (!parsed.success) return null;
    return { quote_id: payload.jti, ...parsed.data, locale: parsed.data.locale ?? "id" };
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
  | { ok: false; reason: "unauthorized" | "idle_timeout" | "session_mismatch" | "revoked" | "access_required" | "access_unavailable" };

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
  const access = await checkCloudflareAccess(req);
  if (!access.ok) return access;
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
  if (check.ok) {
    const { adminAuditRoute, securitySubject, recordSecurityEvent } = await import("@/lib/security-events");
    const route = adminAuditRoute(req);
    if (route) {
      try { await recordSecurityEvent("admin_authorized", await securitySubject("admin-session", check.payload.sid), route, req.method); }
      catch { console.info("[security] admin_authorized audit unavailable"); }
    }
  }
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
