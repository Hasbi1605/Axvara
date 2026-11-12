// src/lib/pedia/quote.ts — Quote Pedia bertanda tangan (PD-20).
//
// Encrypted quotes keep supplier identity and cost out of public payloads.
// Existing HS256 quotes remain verifiable during their 30-minute lifetime.
// memuat product_id, tier_id, quantity, target_normalized, unit_price,
// total, supplier_service_id, supplier_rate_snapshot. Berlaku 30 menit.
import { checkCustomComments } from "@/lib/pedia/custom-comments";
import * as jose from "jose";
import { isPediaProvider, type PediaProvider } from "@/lib/pedia/proxy";
import { isCanonicalMethodOption, type CheckoutQuotePaymentMethod } from "@/lib/auth";
import { readPediaServiceCopy, type PediaServiceCopy } from "./service-copy";

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
  /** PSMM-P5: snapshot kepemilikan katalog saat quote agar order baru tidak
   *  bisa memakai baris kurasi walau tier_id dipalsukan. */
  managed?: "curated" | "auto";
  /** PSMM-ACCEPTANCE-CLOSE 1: versi snapshot syarat resmi yang ditandatangani
   *  saat quote; order baru memverifikasinya terhadap snapshot aktif. */
  terms_version?: string;
  refill_days?: number;
  supplier_target?: string;
  refill_anchor?: "created" | "completed";
  min_profit_rp?: number;
  service_copy?: PediaServiceCopy;
  /** 2026-11-01: komentar custom (satu per baris), jumlah = quantity. */
  custom_comments?: string[];
  /**
   * 2026-11-07 (fase B): metode pembayaran yang ditandatangani, bentuk sama
   * dengan token checkout Market. Opsional supaya quote lama (QRIS-only) tetap
   * sah selama masa hidupnya. Create WAJIB memilih salah satu dari daftar ini.
   */
  payment_methods?: CheckoutQuotePaymentMethod[];
  locale?: "id" | "en";
  jti: string;
};

function secretKey() {
  if (!process.env.ADMIN_JWT_SECRET && process.env.NODE_ENV === "production") throw new Error("pedia_quote_secret_missing");
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
    if (p.supplier_target !== undefined && (typeof p.supplier_target !== "string" || !p.supplier_target || p.supplier_target.length > 600)) return null;
    if (p.refill_anchor !== undefined && !["created", "completed"].includes(String(p.refill_anchor))) return null;
    const serviceCopy = p.service_copy === undefined ? undefined : readPediaServiceCopy(p.service_copy);
    if (serviceCopy === null) return null;
    if (p.custom_comments !== undefined) {
      if (!Array.isArray(p.custom_comments) || !p.custom_comments.every((c) => typeof c === "string")) return null;
      if (!checkCustomComments((p.custom_comments as string[]).join("\n"), num(p.quantity)).ok) return null;
    }
    // Fase B: metode pembayaran ditandatangani memakai validator kanonis Market
    // (gateway net+fee=total, crypto snapshot base/surcharge/total + aset/jaringan).
    // Tanpa field ini quote lama tetap QRIS-only.
    let paymentMethods: CheckoutQuotePaymentMethod[] | undefined;
    if (p.payment_methods !== undefined) {
      if (!Array.isArray(p.payment_methods) || p.payment_methods.length < 1 || p.payment_methods.length > 40) return null;
      if (!p.payment_methods.every((method) => isCanonicalMethodOption(method, num(p.total)))) return null;
      paymentMethods = p.payment_methods as CheckoutQuotePaymentMethod[];
    }
    if (p.locale !== undefined && !["id", "en"].includes(String(p.locale))) return null;
    // Versi syarat (bila ada) harus string non-kosong; quote lama tanpa field
    // ini tetap terverifikasi sebagai token (legacy), gate order yang memutuskan.
    if (p.terms_version !== undefined && (typeof p.terms_version !== "string" || !p.terms_version || p.terms_version.length > 64)) return null;
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
      managed: p.managed === "auto" ? "auto" : undefined,
      terms_version: typeof p.terms_version === "string" ? p.terms_version : undefined,
      refill_days: p.refill_days as number | undefined,
      supplier_target: p.supplier_target as string | undefined,
      refill_anchor: p.refill_anchor as "created" | "completed" | undefined,
      min_profit_rp: p.min_profit_rp as number | undefined,
      service_copy: serviceCopy,
      ...(p.custom_comments !== undefined ? { custom_comments: p.custom_comments as string[] } : {}),
      ...(paymentMethods ? { payment_methods: paymentMethods } : {}),
      ...(p.locale !== undefined ? { locale: p.locale as "id" | "en" } : {}),
      jti: String(payload.jti),
    };
  } catch {
    return null;
  }
}
