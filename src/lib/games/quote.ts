// src/lib/games/quote.ts — Quote Games bertanda tangan (pola quote Pedia).
// Isi: SKU, customer_no, harga, kontak checkout, locale, dan metode yang
// ditawarkan (B1 hanya QRIS). Kontak ikut ditandatangani karena POST order
// hanya menerima `quote_token`. Berlaku 30 menit.
import * as jose from "jose";

export type GamesQuotePayload = {
  purpose: "games_quote";
  product_id: number;
  buyer_sku_code: string;
  slug: string;
  customer_no: string;
  customer_wa: string;
  customer_email: string;
  customer_nickname: string | null;
  unit_price: number;
  total: number;
  methods: ["qris"];
  locale: "id" | "en";
  jti: string;
};

function secretKey() {
  if (!process.env.ADMIN_JWT_SECRET && process.env.NODE_ENV === "production") throw new Error("games_quote_secret_missing");
  const secret = process.env.ADMIN_JWT_SECRET || "dev-only-games-quote-secret";
  return new TextEncoder().encode(secret);
}

async function encryptionKey(): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", secretKey()));
}

const WA_PATTERN = /^(\+62|62|0)8\d{8,13}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createGamesQuoteToken(
  input: Omit<GamesQuotePayload, "purpose" | "jti">,
): Promise<{ token: string; quoteId: string; expiresAt: number }> {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const quoteId = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 30 * 60;
  const token = await new jose.EncryptJWT({ ...input, purpose: "games_quote" })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setJti(quoteId)
    .encrypt(await encryptionKey());
  return { token, quoteId, expiresAt };
}

/** Verifikasi quote Games. null = tidak valid / kedaluwarsa / bentuk aneh. */
export async function verifyGamesQuoteToken(token: string): Promise<GamesQuotePayload | null> {
  try {
    const segments = token.split(".");
    if (segments.length !== 5 || segments.some((s) => jose.base64url.encode(jose.base64url.decode(s)) !== s)) return null;
    const { payload } = await jose.jwtDecrypt(token, await encryptionKey(), {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    if (payload.purpose !== "games_quote" || !payload.jti) return null;
    const p = payload as unknown as Record<string, unknown>;
    const productId = Number(p.product_id);
    const unitPrice = Number(p.unit_price);
    const total = Number(p.total);
    if (!Number.isSafeInteger(productId) || productId <= 0) return null;
    if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0) return null;
    if (!Number.isSafeInteger(total) || total <= 0 || total !== unitPrice) return null;
    if (typeof p.buyer_sku_code !== "string" || !/^[A-Za-z0-9]{1,32}$/.test(p.buyer_sku_code)) return null;
    if (typeof p.slug !== "string" || !/^[a-z0-9-]{1,40}$/.test(p.slug)) return null;
    if (typeof p.customer_no !== "string" || !/^\d{1,32}$/.test(p.customer_no)) return null;
    if (typeof p.customer_wa !== "string" || !WA_PATTERN.test(p.customer_wa)) return null;
    if (typeof p.customer_email !== "string" || p.customer_email.length > 160 || !EMAIL_PATTERN.test(p.customer_email)) return null;
    if (p.customer_nickname !== null && (typeof p.customer_nickname !== "string" || p.customer_nickname.length > 64)) return null;
    if (!Array.isArray(p.methods) || p.methods.length !== 1 || p.methods[0] !== "qris") return null;
    if (p.locale !== undefined && !["id", "en"].includes(String(p.locale))) return null;
    return {
      purpose: "games_quote",
      product_id: productId,
      buyer_sku_code: p.buyer_sku_code,
      slug: p.slug,
      customer_no: p.customer_no,
      customer_wa: p.customer_wa,
      customer_email: p.customer_email,
      customer_nickname: p.customer_nickname,
      unit_price: unitPrice,
      total,
      methods: ["qris"],
      locale: (p.locale as "id" | "en" | undefined) ?? "id",
      jti: String(payload.jti),
    };
  } catch {
    return null;
  }
}
