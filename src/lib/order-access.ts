import { constantTimeEqual } from "@/lib/security";
import { buyerContactMatches } from "@/lib/order-contact";
import { encodeOrderAccessCode, encodeOrderAccessPin, normalizeOrderAccessCode } from "@/lib/order-access-format";

export type BuyerAccessOrder = {
  code?: unknown; quote_id?: unknown; buyer_access_version?: unknown; buyer_access_format?: unknown; customer_wa?: unknown; customer_email?: unknown;
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

async function buyerAccessMac(message: string): Promise<Uint8Array> {
  assertOrderAccessConfigured();
  const secret = process.env.BUYER_ORDER_ACCESS_SECRET?.trim() || "axvara-dev-only-buyer-access-secret";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

export function isBuyerPinOrder(order: BuyerAccessOrder): boolean {
  return requiresOrderAccessCode(order) && order.buyer_access_format === "pin6";
}

function accessIdentity(order: BuyerAccessOrder): { code: string; version: number } | null {
  const version = Number(order.buyer_access_version), code = String(order.code || "");
  if (!/^AX[VP]-\d{8}-[A-Z0-9]{8}$/.test(code) || !Number.isSafeInteger(version) || version < 1) return null;
  if (order.buyer_access_format !== "pin6" && order.buyer_access_format !== "code26") throw new Error("buyer_access_metadata_unavailable");
  return { code, version };
}

export async function deriveOrderAccessCode(order: BuyerAccessOrder): Promise<string> {
  const identity = accessIdentity(order);
  if (!identity) return "";
  const { code, version } = identity;
  if (order.buyer_access_format === "code26") {
    return encodeOrderAccessCode((await buyerAccessMac(`axvara:buyer-order-access-code:v1:${code}:${version}`)).slice(0, 16));
  }
  for (let counter = 0; counter < 32; counter++) {
    const pin = encodeOrderAccessPin(await buyerAccessMac(`axvara:buyer-order-pin:v1:${code}:${version}:${counter}`));
    if (/[0-9]/.test(pin) && /[A-Z]/.test(pin)) return pin;
  }
  throw new Error("buyer_access_unavailable");
}

export async function createBuyerAccessSession(order: BuyerAccessOrder, now = Date.now()): Promise<string | undefined> {
  if (!isBuyerPinOrder(order)) return undefined;
  const identity = accessIdentity(order);
  if (!identity) return undefined;
  const expires = Math.floor(now / 1000) + 86400;
  const mac = await buyerAccessMac(`axvara:buyer-status-session:v1:${identity.code}:${identity.version}:${expires}`);
  const signature = btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `p1.${expires}.${signature}`;
}

export async function verifyBuyerAccessSession(raw: string, order: BuyerAccessOrder, now = Date.now()): Promise<boolean> {
  if (!isBuyerPinOrder(order)) return false;
  const match = /^p1\.(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(raw);
  if (!match) return false;
  const expires = Number(match[1]), seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + 86460) return false;
  const expected = await createBuyerAccessSession(order, (expires - 86400) * 1000);
  return Boolean(expected) && constantTimeEqual(raw, expected!);
}

// Only the signed-quote checkout response mints this proof. Contact lookups
// issue p1 status sessions and must never promote them to credential access.
export async function createCheckoutCredentialGrant(order: BuyerAccessOrder, now = Date.now()): Promise<string | undefined> {
  if (!isBuyerPinOrder(order)) return undefined;
  const identity = accessIdentity(order);
  if (!identity || typeof order.quote_id !== "string" || !order.quote_id.trim()) throw new Error("checkout_access_metadata_unavailable");
  const quoteMac = await buyerAccessMac(`axvara:buyer-quote-binding:v1:${order.quote_id}`);
  const quoteDigest = Array.from(quoteMac, byte => byte.toString(16).padStart(2, "0")).join("");
  const expires = Math.floor(now / 1000) + 86400;
  const mac = await buyerAccessMac(`axvara:buyer-checkout-credentials:v1:${identity.code}:${identity.version}:${quoteDigest}:${expires}`);
  const signature = btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `c1.${expires}.${signature}`;
}

export async function verifyCheckoutCredentialGrant(raw: string, order: BuyerAccessOrder, now = Date.now()): Promise<boolean> {
  if (!isBuyerPinOrder(order) || typeof order.quote_id !== "string" || !order.quote_id.trim()) return false;
  const match = /^c1\.(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(raw);
  if (!match) return false;
  const expires = Number(match[1]), seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + 86460) return false;
  const expected = await createCheckoutCredentialGrant(order, (expires - 86400) * 1000);
  return Boolean(expected) && constantTimeEqual(raw, expected!);
}

// Device proof d1: minted after a verified checkout (c1) or contact+PIN so the
// same browser reopens this order for 30 days. Delivered only as an HttpOnly
// cookie scoped to /api/orders/<code>; bound to the access version, not the quote.
export const DEVICE_COOKIE_NAME = "axv_d1";
export const DEVICE_COOKIE_MAX_AGE = 30 * 86400;
export const deviceCookiePath = (code: string) => `/api/orders/${code}`;

export async function createDeviceCredentialGrant(order: BuyerAccessOrder, now = Date.now()): Promise<string | undefined> {
  if (!isBuyerPinOrder(order)) return undefined;
  const identity = accessIdentity(order);
  if (!identity) return undefined;
  const expires = Math.floor(now / 1000) + DEVICE_COOKIE_MAX_AGE;
  const mac = await buyerAccessMac(`axvara:buyer-device-credentials:v1:${identity.code}:${identity.version}:${expires}`);
  const signature = btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `d1.${expires}.${signature}`;
}

export async function verifyDeviceCredentialGrant(raw: string, order: BuyerAccessOrder, now = Date.now()): Promise<boolean> {
  if (!isBuyerPinOrder(order)) return false;
  const match = /^d1\.(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(raw);
  if (!match) return false;
  const expires = Number(match[1]), seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + DEVICE_COOKIE_MAX_AGE + 60) return false;
  const expected = await createDeviceCredentialGrant(order, (expires - DEVICE_COOKIE_MAX_AGE) * 1000);
  return Boolean(expected) && constantTimeEqual(raw, expected!);
}

export async function buyerOrderAccessMatches(raw: unknown, order: BuyerAccessOrder): Promise<boolean> {
  if (!requiresOrderAccessCode(order)) return buyerContactMatches(raw, order);
  const provided = normalizeOrderAccessCode(raw);
  if (!provided) return false;
  const expected = normalizeOrderAccessCode(await deriveOrderAccessCode(order));
  return Boolean(expected) && constantTimeEqual(provided, expected);
}

export function requestOrderAccessCode(request: Request): string {
  return request.headers.get("x-order-contact") || request.headers.get("x-order-access-code") || "";
}

export function orderAccessDenied(): Response {
  return Response.json({ error: "Pesanan tidak ditemukan atau kode akses/kontak tidak cocok.", reason: "access_required" }, {
    status: 404, headers: { "Cache-Control": "private, no-store", "Vary": "x-order-access-code" },
  });
}

export async function newOrderAccessFailure(request: Request, order: BuyerAccessOrder,
  provided: unknown = requestOrderAccessCode(request), options: {
    allowAdmin?: boolean; allowStatusSession?: boolean; purpose?: "status" | "credentials"; contact?: unknown;
  } = {}): Promise<Response | null> {
  if (!requiresOrderAccessCode(order)) return null;
  try {
    if (!accessIdentity(order)) throw new Error("buyer_access_metadata_unavailable");
    const { requireAdmin } = await import("@/lib/auth");
    if (options.allowAdmin !== false && await requireAdmin(request)) return null;
    if (options.purpose !== "credentials" && options.allowStatusSession
      && await verifyBuyerAccessSession(request.headers.get("x-buyer-access-session") || "", order)) return null;
    const { createDatabaseAccess } = await import("@/lib/db-access");
    const db = createDatabaseAccess();
    if (isBuyerPinOrder(order) && options.purpose === "credentials") {
      if (normalizeOrderAccessCode(provided).length !== 6) return orderAccessDenied();
      const { admitBuyerPin, releaseSuccessfulBuyerPin } = await import("@/lib/orders/pin-attempts");
      const admission = await admitBuyerPin(db, String(order.code), Number(order.buyer_access_version));
      if (!admission.allowed) return Response.json({ error: admission.unavailable
        ? "Verifikasi PIN belum tersedia. Coba lagi sebentar."
        : "Terlalu banyak percobaan PIN. Tunggu hingga 15 menit sebelum mencoba lagi." }, {
        status: admission.unavailable ? 503 : 429,
        headers: { "Cache-Control": "private, no-store", "Retry-After": String(admission.retryAfter) },
      });
      const pinMatches = await buyerOrderAccessMatches(provided, order);
      const contactMatches = buyerContactMatches(options.contact, order);
      if (!pinMatches || !contactMatches) return orderAccessDenied();
      await releaseSuccessfulBuyerPin(db, String(order.code), Number(order.buyer_access_version), admission.window);
      return null;
    }
    if (options.purpose !== "credentials" && buyerContactMatches(provided, order)) return null;
    if (!isBuyerPinOrder(order) && await buyerOrderAccessMatches(provided, order)) return null;
    const { contactAttemptLimited, recordContactFailure } = await import("@/lib/orders/contact-attempts");
    const { clientIp } = await import("@/lib/rateLimit");
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
