import { constantTimeEqual } from "@/lib/security";
import { buyerContactMatches } from "@/lib/order-contact";
import { encodeOrderAccessCode, normalizeOrderAccessCode } from "@/lib/order-access-format";

export type BuyerAccessOrder = {
  code?: unknown; buyer_access_version?: unknown; customer_wa?: unknown; customer_email?: unknown;
};

export function requiresOrderAccessCode(order: BuyerAccessOrder): boolean {
  // A missing projection/schema must never silently downgrade a new order to contact proof.
  return order.buyer_access_version == null || Number(order.buyer_access_version) !== 0;
}

export function assertOrderAccessConfigured(): void {
  if (process.env.NODE_ENV === "production" && !process.env.BUYER_ORDER_ACCESS_SECRET?.trim()) {
    throw new Error("buyer_access_unavailable");
  }
}

export async function deriveOrderAccessCode(order: BuyerAccessOrder): Promise<string> {
  const version = Number(order.buyer_access_version), code = String(order.code || "");
  if (!/^AX[VP]-\d{8}-[A-Z0-9]{8}$/.test(code) || !Number.isSafeInteger(version) || version < 1) return "";
  assertOrderAccessConfigured();
  const secret = process.env.BUYER_ORDER_ACCESS_SECRET?.trim()
    || (process.env.NODE_ENV !== "production" ? "axvara-dev-only-buyer-access-secret" : "");
  if (!secret) throw new Error("buyer_access_unavailable");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode(`axvara:buyer-order-access-code:v1:${code}:${version}`));
  // Stable across a lost checkout response, without a plaintext secret in orders or outbox payloads.
  return encodeOrderAccessCode(new Uint8Array(signature).slice(0, 16));
}

export async function buyerOrderAccessMatches(raw: unknown, order: BuyerAccessOrder): Promise<boolean> {
  if (!requiresOrderAccessCode(order)) return buyerContactMatches(raw, order);
  const provided = normalizeOrderAccessCode(raw);
  if (!provided) return false;
  const expected = normalizeOrderAccessCode(await deriveOrderAccessCode(order));
  return Boolean(expected) && constantTimeEqual(provided, expected);
}

export function requestOrderAccessCode(request: Request): string {
  return request.headers.get("x-order-access-code") || "";
}

export function orderAccessDenied(): Response {
  return Response.json({ error: "Pesanan tidak ditemukan atau kode akses/kontak tidak cocok.", reason: "access_required" }, {
    status: 404, headers: { "Cache-Control": "private, no-store", "Vary": "x-order-access-code" },
  });
}

export async function newOrderAccessFailure(request: Request, order: BuyerAccessOrder, provided: unknown = requestOrderAccessCode(request)): Promise<Response | null> {
  if (!requiresOrderAccessCode(order)) return null;
  try {
    const { requireAdmin } = await import("@/lib/auth");
    if (await requireAdmin(request)) return null;
    if (await buyerOrderAccessMatches(provided, order)) return null;
    const { createDatabaseAccess } = await import("@/lib/db-access");
    const { contactAttemptLimited, recordContactFailure } = await import("@/lib/orders/contact-attempts");
    const { clientIp } = await import("@/lib/rateLimit");
    const db = createDatabaseAccess();
    if (db.d1 && (await contactAttemptLimited(db, String(order.code), clientIp(request))
      || await recordContactFailure(db, String(order.code), clientIp(request)))) {
      return Response.json({ error: "Terlalu banyak percobaan. Coba lagi setelah 15 menit." }, {
        status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": "900" },
      });
    }
  } catch {
    return Response.json({ error: "Verifikasi pesanan belum tersedia. Coba lagi sebentar." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
  return orderAccessDenied();
}
