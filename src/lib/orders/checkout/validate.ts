// src/lib/orders/checkout/validate.ts — signed checkout input validation
// (3B-6, class E: pure move, no behavior change).
//
// BEFORE: the Zod schema, access-config assert, rail/proof checks, signed
// quote verification, slug->canonical item resolution + aggregate match,
// and the signed Muse buyer-field check lived inline in POST
// src/app/api/orders/route.ts, before the saved-order lookup.
// AFTER: `validateCheckoutInput(data)` owns that block verbatim and returns
// a discriminated outcome; the route keeps maintenance -> rate-limit ->
// `readJsonBody(req)` and its early body return, then the exact same
// `WHERE quote_id=?` reuse lookup and every later stage. Schema preprocess/
// transforms, issue order/messages, sequential awaits, query text/binds/
// count, id-vs-slug mismatch rule, and success fields are unchanged. This
// module statically imports only leaves the route already loaded eagerly
// (zod, buyer-fields, db, security, auth, order-access, crypto-preflight
// ticker mapping) — no new heavy/provider import and no cycle.

import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameBuyerCode, buyerFieldsSchema } from "@/lib/buyer-fields";
import type { AtomicOrderItem } from "@/lib/db/types";
import { queryAll } from "@/lib/db";
import { aggregateQty } from "@/lib/security";
import { verifyCheckoutQuoteToken, type CheckoutQuotePayload } from "@/lib/auth";
import { assertOrderAccessConfigured } from "@/lib/order-access";
import { cryptoTickerOfMethodId } from "@/lib/payments/crypto-preflight";

const schema = z.object({
  // Revamp 2026-09-23 ala Sekalipay: nama dihapus dari form web. Opsional di
  // API (fallback prefix email di handler); kanal TG/WA tetap kirim nama.
  customer_name: z.string().trim().max(80).optional().or(z.literal("")),
  customer_wa: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s|-/g, ""))
    .refine((s) => /^(\+62|62|0)8\d{8,13}$/.test(s), "No WA harus 08... atau +62... (10-15 digit)"),
  // Revamp 2026-09-23: email SELALU wajib (semua produk digital — order
  // tanpa email = macet). Sebelumnya opsional kecuali varian butuh-email.
  customer_email: z.string().trim().email("Tulis email aktif yang benar sebelum bayar.").max(120),
  items: z.array(z.object({
    product_id: z.coerce.number().int().safe().min(1).optional(),
    slug: z.string().trim().min(1).max(100).optional(),
    variant_id: z.coerce.number().int().min(1).optional(),
    // Batas atas web = 100/baris (paritas Telegram) agar varian min-besar
    // (mis. GSuite min 50) tetap bisa dibeli dari web. Minimum per varian
    // ditegakkan ulang dari DB di bawah (JANGAN percaya angka client).
    qty: z.coerce.number().int().min(1).max(100),
    buyer_fields: buyerFieldsSchema.optional(),
  }).refine((item) => item.product_id || item.slug)).min(1).max(20),
  // W3 Web crypto: opaque id nowpayments:<ticker kurasi> ONLY (server-mapped asset/
  // network; client MUST NOT send currency/network/price). Legacy manual
  // bank/ewallet tetap ditolak 503 di bawah, bukan dibangkitkan.
  payment_method: z.string().trim().max(64),
  proof_url: z.string().trim().max(600).nullable().optional().default(null),
  quote_token: z.string().trim().min(20, "Quote checkout wajib disertakan").max(8000),
});

export type ValidatedCheckout = {
  customer_name: string | undefined;
  customer_wa: string;
  customer_email: string;
  items: z.infer<typeof schema>["items"];
  payment_method: string;
  proof_url: string | null;
  quote: CheckoutQuotePayload;
  /**
   * Items for the atomic order create ONLY: the signed quote items, with each
   * Pixel line's buyer_fields replaced by the fingerprint-verified request
   * triple (sealed inside createOrderWithStock). Never pass these to invoices,
   * responses, logs, or analytics — use quote.items there.
   */
  orderItems: AtomicOrderItem[];
  cryptoTicker: string | null;
  isCryptoMethod: boolean;
  isGatewayMethod: boolean;
};

export type ValidateOutcome =
  | { kind: "valid"; value: ValidatedCheckout }
  | { kind: "responded"; response: NextResponse };

export async function validateCheckoutInput(data: unknown): Promise<ValidateOutcome> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) return { kind: "responded", response: NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 }) };

  const { customer_name, customer_wa, customer_email, items, payment_method, proof_url, quote_token } = parsed.data;
  try { assertOrderAccessConfigured(); } catch {
    return { kind: "responded", response: NextResponse.json({ error: "Checkout sementara tidak tersedia." }, { status: 503 }) };
  }

  // Proofs are private R2 objects. External URLs would bypass the protected
  // admin viewer and could be used as a tracking pixel.
  // Legacy manual E-Wallet/Bank tetap nonaktif (bukan dibangkitkan untuk
  // gateway): hanya qris + nowpayments:<ticker kurasi> + gateway yang lolos ke validasi token.
  const cryptoTicker = cryptoTickerOfMethodId(payment_method);
  const isCryptoMethod = cryptoTicker !== null;
  if (!isCryptoMethod && payment_method.startsWith("nowpayments:")) {
    // Koin di luar katalog kurasi tidak pernah ditandatangani/dibuat.
    return { kind: "responded", response: NextResponse.json({ error: "Metode pembayaran berubah atau sudah tidak aktif. Muat ulang checkout.", code: "quote_stale" }, { status: 409 }) };
  }
  const isGatewayMethod = /^sekalipay_gateway:[A-Za-z0-9_-]{1,64}$/.test(payment_method) && !/qris/i.test(payment_method);
  if (payment_method !== "qris" && !isCryptoMethod && !isGatewayMethod) {
    return { kind: "responded", response: NextResponse.json({ error: "E-Wallet & Transfer Bank sedang maintenance. Silakan bayar via QRIS." }, { status: 503 }) };
  }
  if (proof_url) {
    return { kind: "responded", response: NextResponse.json({ error: "Upload bukti sedang dinonaktifkan. Silakan bayar via QRIS." }, { status: 503 }) };
  }
  if (proof_url && (!proof_url.startsWith("/r2/bukti/") || proof_url.includes(".."))) {
    return { kind: "responded", response: NextResponse.json({ error: "URL bukti tidak valid" }, { status: 400 }) };
  }

  const quote = await verifyCheckoutQuoteToken(quote_token);
  if (!quote) {
    return { kind: "responded", response: NextResponse.json({ error: "Quote checkout tidak valid atau sudah kedaluwarsa. Muat ulang checkout." }, { status: 409 }) };
  }

  const slugs = [...new Set(items.flatMap((item) => item.slug ? [item.slug] : []))];
  const slugRows = slugs.length ? await queryAll(`SELECT id,slug FROM products WHERE slug IN (${slugs.map(() => "?").join(",")})`, ...slugs) : [];
  const slugIds = new Map(slugRows.map((row) => [String(row.slug), Number(row.id)]));
  const canonicalItems = items.map((item) => ({ ...item, product_id: item.slug ? slugIds.get(item.slug) : item.product_id }));
  if (canonicalItems.some((item, index) => !item.product_id || (items[index].product_id && item.product_id !== items[index].product_id))) return { kind: "responded", response: NextResponse.json({ error: "Isi keranjang berubah." }, { status: 409 }) };
  const requested = aggregateQty(canonicalItems as { product_id: number; variant_id?: number; qty: number }[]);
  const quoted = aggregateQty(quote.items);
  const sameItems = requested.size === quoted.size
    && [...requested.entries()].every(([key, qty]) => quoted.get(key) === qty);
  if (!sameItems) {
    return { kind: "responded", response: NextResponse.json({ error: "Isi keranjang berubah setelah harga dikunci. Muat ulang checkout." }, { status: 409 }) };
  }
  const pixelTriples = new Map<string, { pv_email: string; pv_password: string; pv_totp_secret: string }>();
  try {
    assertSameBuyerCode(items);
    const { computeFingerprint } = await import("@/lib/fulfillment/crypto");
    const { parsePixelverifInput } = await import("@/lib/pixelverif/purchase");
    for (const item of canonicalItems) {
      const signed = quote.items.find(q => q.product_id === item.product_id && q.variant_id === item.variant_id);
      if ((signed?.buyer_fields?.muse_invite_code ?? "") !== (item.buyer_fields?.muse_invite_code ?? "")) throw new Error("changed");
      // Pixel: token holds only a fingerprint. Recompute from the request
      // body triple; any drift (or a missing triple) fails closed.
      const signedFingerprint = signed?.buyer_fields?.pv_fingerprint ?? "";
      if (signedFingerprint) {
        const bodyFingerprint = item.buyer_fields?.pv_email && item.buyer_fields?.pv_password && item.buyer_fields?.pv_totp_secret
          ? await computeFingerprint(`${item.buyer_fields.pv_email.trim().toLowerCase()}\n${item.buyer_fields.pv_password}\n${item.buyer_fields.pv_totp_secret.replace(/[\s-]/g, "").toUpperCase()}`)
          : "";
        if (bodyFingerprint !== signedFingerprint) throw new Error("changed");
        pixelTriples.set(`${item.product_id}:${item.variant_id ?? 0}`, parsePixelverifInput({
          pv_email: item.buyer_fields?.pv_email, pv_password: item.buyer_fields?.pv_password, pv_totp_secret: item.buyer_fields?.pv_totp_secret,
        }));
      } else if (item.buyer_fields?.pv_email || item.buyer_fields?.pv_password || item.buyer_fields?.pv_totp_secret) {
        throw new Error("changed");
      }
    }
  } catch { return { kind: "responded", response: NextResponse.json({ error: "Input pembeli berubah. Muat ulang checkout." }, { status: 409 }) }; }

  let tripleMissing = false;
  const orderItems: AtomicOrderItem[] = quote.items.map((signed) => {
    if (!signed.buyer_fields?.pv_fingerprint) return signed as AtomicOrderItem;
    const triple = pixelTriples.get(`${signed.product_id}:${signed.variant_id ?? 0}`);
    if (!triple) { tripleMissing = true; return signed as AtomicOrderItem; }
    const { pv_fingerprint: _fp, pv_email_masked: _masked, ...rest } = signed.buyer_fields;
    return { ...signed, buyer_fields: { ...rest, ...triple } } as AtomicOrderItem;
  });
  if (tripleMissing) return { kind: "responded", response: NextResponse.json({ error: "Input pembeli berubah. Muat ulang checkout." }, { status: 409 }) };
  if (pixelTriples.size > 1) {
    return { kind: "responded", response: NextResponse.json({ error: "Hanya 1 varian layanan aktivasi Google per pesanan. Pisahkan pesanan jika ingin membeli varian lain." }, { status: 409 }) };
  }
  if (pixelTriples.size) {
    const { isPixelverifEmailBlocked, PIXELVERIF_BLOCKED_EMAIL_MESSAGE } = await import("@/lib/pixelverif/blocklist");
    for (const triple of pixelTriples.values()) {
      if (await isPixelverifEmailBlocked(triple.pv_email, 3)) {
        return { kind: "responded", response: NextResponse.json({ error: PIXELVERIF_BLOCKED_EMAIL_MESSAGE }, { status: 409 }) };
      }
    }
  }

  return {
    kind: "valid",
    value: {
      customer_name, customer_wa, customer_email, items, payment_method, proof_url, quote, orderItems,
      cryptoTicker, isCryptoMethod, isGatewayMethod,
    },
  };
}
