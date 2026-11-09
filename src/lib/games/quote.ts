// src/lib/games/quote.ts — Quote Games bertanda tangan (pola quote Pedia).
// Isi: SKU, customer_no, harga, locale, dan metode yang ditawarkan.
// Kontak dikumpulkan saat POST order seperti Pedia. Berlaku 30 menit.
import * as jose from "jose";
import { isCanonicalMethodOption, type CheckoutQuotePaymentMethod } from "@/lib/auth";

export type GamesQuotePayload = {
  purpose: "games_quote";
  product_id: number;
  buyer_sku_code: string;
  slug: string;
  customer_no: string;
  customer_nickname: string | null;
  unit_price: number;
  total: number;
  methods: string[];
  payment_methods?: CheckoutQuotePaymentMethod[];
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
    if (p.customer_nickname !== null && (typeof p.customer_nickname !== "string" || p.customer_nickname.length > 64)) return null;
    if (!Array.isArray(p.methods) || !p.methods.length || p.methods.length > 64
      || !p.methods.every((method) => typeof method === "string" && method.length <= 64)) return null;
    // Authenticated legacy/malformed method lists require quote_stale at create,
    // while saved orders can still resume their original invoice.
    const paymentMethods = Array.isArray(p.payment_methods) && p.payment_methods.length > 0 && p.payment_methods.length <= 64
      && p.payment_methods.every((method) => isCanonicalMethodOption(method, total))
      ? p.payment_methods as CheckoutQuotePaymentMethod[] : undefined;
    if (p.locale !== undefined && !["id", "en"].includes(String(p.locale))) return null;
    return {
      purpose: "games_quote",
      product_id: productId,
      buyer_sku_code: p.buyer_sku_code,
      slug: p.slug,
      customer_no: p.customer_no,
      customer_nickname: p.customer_nickname,
      unit_price: unitPrice,
      total,
      methods: p.methods as string[],
      payment_methods: paymentMethods,
      locale: (p.locale as "id" | "en" | undefined) ?? "id",
      jti: String(payload.jti),
    };
  } catch {
    return null;
  }
}
