// src/lib/pedia/quote.ts — Quote Pedia bertanda tangan (PD-20).
//
// Encrypted quotes keep supplier identity and cost out of public payloads.
// Existing HS256 quotes remain verifiable during their 30-minute lifetime.
// memuat product_id, tier_id, quantity, target_normalized, unit_price,
// total, supplier_service_id, supplier_rate_snapshot. Berlaku 30 menit.
import * as jose from "jose";
import { isPediaProvider, type PediaProvider } from "@/lib/pedia/proxy";

export type PediaQuotePayload = {
  purpose: "pedia_quote";
  product_id: number;
  tier_id: number;
  quantity: number;
  target_raw: string;
  target_normalized: string;
  unit_price: number;
  total: number;
  credit_code_hash: string | null;
  credit_used: number;
  supplier: PediaProvider;
  supplier_service_id: number;
  supplier_rate_snapshot: number;
  refill_days?: number;
  min_profit_rp?: number;
  jti: string;
};

function secretKey() {
  const secret = process.env.ADMIN_JWT_SECRET || "dev-only-pedia-quote-secret";
  return new TextEncoder().encode(secret);
}

async function encryptionKey(): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", secretKey()));
}

/** Terbitkan quote Pedia (30 menit). */
export async function createPediaQuoteToken(
  input: Omit<PediaQuotePayload, "purpose" | "jti">,
): Promise<{ token: string; quoteId: string; expiresAt: number }> {
  if (!isPediaProvider(input.supplier)) throw new Error("invalid_provider");
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const quoteId = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 30 * 60;
  const token = await new jose.EncryptJWT({ ...input, purpose: "pedia_quote" })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setJti(quoteId)
    .encrypt(await encryptionKey());
  return { token, quoteId, expiresAt };
}

/** Verifikasi quote Pedia. null = tidak valid / kedaluwarsa. */
export async function verifyPediaQuoteToken(token: string): Promise<PediaQuotePayload | null> {
  try {
    const segments = token.split(".");
    if (![3, 5].includes(segments.length) || segments.some((s) => jose.base64url.encode(jose.base64url.decode(s)) !== s)) return null;
    const { payload } = segments.length === 5
      ? await jose.jwtDecrypt(token, await encryptionKey(), { keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] })
      : await jose.jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (payload.purpose !== "pedia_quote" || !payload.jti) return null;
    const p = payload as unknown as Record<string, unknown>;
    const supplier = p.supplier ?? "providersmm";
    if (!isPediaProvider(supplier)) return null;
    const num = (v: unknown) => Number(v);
    if (![p.product_id, p.tier_id, p.quantity, p.total].every((v) => Number.isFinite(num(v)))) return null;
    if (![p.product_id, p.tier_id, p.quantity, p.supplier_service_id].every((v) => Number.isSafeInteger(num(v)) && num(v) > 0)) return null;
    if (![p.unit_price, p.total, p.supplier_rate_snapshot].every((v) => Number.isFinite(num(v)) && num(v) > 0)) return null;
    if (typeof p.target_normalized !== "string" || !p.target_normalized) return null;
    // Missing terms are legacy quotes; supplied terms must be valid, not
    // silently replaced with mutable tier values.
    if ([p.refill_days, p.min_profit_rp].some((v) => v !== undefined && (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0))) return null;
    return {
      purpose: "pedia_quote",
      product_id: num(p.product_id), tier_id: num(p.tier_id),
      quantity: num(p.quantity), target_raw: String(p.target_raw ?? ""),
      target_normalized: String(p.target_normalized),
      unit_price: num(p.unit_price), total: num(p.total),
      credit_code_hash: typeof p.credit_code_hash === "string" ? p.credit_code_hash : null,
      credit_used: num(p.credit_used) || 0,
      supplier,
      supplier_service_id: num(p.supplier_service_id),
      supplier_rate_snapshot: num(p.supplier_rate_snapshot),
      refill_days: p.refill_days as number | undefined,
      min_profit_rp: p.min_profit_rp as number | undefined,
      jti: String(payload.jti),
    };
  } catch {
    return null;
  }
}
