// src/lib/pedia/quote.ts — Quote Pedia bertanda tangan (PD-20).
//
// Pola `api/checkout` existing (JWT HS256, purpose khusus, 30 menit):
// memuat product_id, tier_id, quantity, target_normalized, unit_price,
// total, supplier_service_id, supplier_rate_snapshot. Berlaku 30 menit.
import * as jose from "jose";

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
  supplier: string;
  supplier_service_id: number;
  supplier_rate_snapshot: number;
  jti: string;
};

function secretKey(): Uint8Array {
  const secret = process.env.ADMIN_JWT_SECRET || "dev-only-pedia-quote-secret";
  return new TextEncoder().encode(secret);
}

/** Terbitkan quote Pedia (30 menit). */
export async function createPediaQuoteToken(
  input: Omit<PediaQuotePayload, "purpose" | "jti">,
): Promise<{ token: string; quoteId: string; expiresAt: number }> {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const quoteId = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 30 * 60;
  const token = await new jose.SignJWT({ ...input, purpose: "pedia_quote" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setJti(quoteId)
    .sign(secretKey());
  return { token, quoteId, expiresAt };
}

/** Verifikasi quote Pedia. null = tidak valid / kedaluwarsa. */
export async function verifyPediaQuoteToken(token: string): Promise<PediaQuotePayload | null> {
  try {
    const segments = token.split(".");
    if (segments.length !== 3 || segments.some((s) => jose.base64url.encode(jose.base64url.decode(s)) !== s)) return null;
    const { payload } = await jose.jwtVerify(token, secretKey());
    if (payload.purpose !== "pedia_quote" || !payload.jti) return null;
    const p = payload as unknown as Record<string, unknown>;
    const num = (v: unknown) => Number(v);
    if (![p.product_id, p.tier_id, p.quantity, p.total].every((v) => Number.isFinite(num(v)))) return null;
    if (typeof p.target_normalized !== "string" || !p.target_normalized) return null;
    return {
      purpose: "pedia_quote",
      product_id: num(p.product_id), tier_id: num(p.tier_id),
      quantity: num(p.quantity), target_raw: String(p.target_raw ?? ""),
      target_normalized: String(p.target_normalized),
      unit_price: num(p.unit_price), total: num(p.total),
      credit_code_hash: typeof p.credit_code_hash === "string" ? p.credit_code_hash : null,
      credit_used: num(p.credit_used) || 0,
      supplier: String(p.supplier ?? "providersmm"),
      supplier_service_id: num(p.supplier_service_id),
      supplier_rate_snapshot: num(p.supplier_rate_snapshot),
      jti: String(payload.jti),
    };
  } catch {
    return null;
  }
}
