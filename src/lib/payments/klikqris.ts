// src/lib/payments/klikqris.ts — KlikQRIS adapter: inhouse + mypg + sandbox
// All provider communication is isolated here. No other code calls KlikQRIS URLs directly.
//
// Real API contract from https://klikqris.com/dokumentasi-api:
//
// AUTH: Header x-api-key + id_merchant (NOT in body)
//
// INHOUSE (PG KlikQRIS):
//   Create:  POST /api/qris/create        body: { order_id, id_merchant, amount, keterangan?, callback_url? }
//   Status:  GET  /api/qris/status/{order_id}
//   Callback payload (flat): { order_id, status: "PAID"|"EXPIRED", amount, total_amount, payment_date, signature, ... }
//
// MY PG:
//   Create:  POST /api/qrisv2/create      body: { order_id, id_merchant, amount, keterangan? }
//   Status:  GET  /api/qrisv2/status/{id_merchant}/{order_id}
//   Callback payload (nested): { status: "success", data: { order_id, amount_request, amount_paid, status: "PAID", merchant_id, signature, ... } }
//
// SANDBOX:
//   Create:  POST /api/sandbox/qris/create   (same body/response as inhouse)
//   Status:  GET  /api/sandbox/qris/status/{order_id}
//   Simulate: https://klikqris.com/public/sandbox/simulate

import type {
  PaymentProvider,
  PaymentProviderMode,
  CreateInvoiceRequest,
  CreateInvoiceResponse,
  CheckStatusResponse,
  CallbackPayload,
} from "./types";

const KLIKQRIS_BASE = "https://klikqris.com";
const DEFAULT_TIMEOUT_MS = 15_000;

// Allowed hostnames for QR image URLs
const ALLOWED_QR_HOSTS = new Set([
  "klikqris.com",
  "www.klikqris.com",
]);

function isAllowedQrUrl(url: string): boolean {
  if (!url || url.startsWith("data:")) return false; // data URI handled separately
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_QR_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

interface KlikQRISConfig {
  mode: PaymentProviderMode;
  apiKey: string;
  merchantId: string;
}

function getConfig(): KlikQRISConfig {
  const mode = (process.env.KLIKQRIS_MODE ?? "sandbox") as PaymentProviderMode;
  const apiKey = process.env.KLIKQRIS_API_KEY;
  const merchantId = process.env.KLIKQRIS_MERCHANT_ID;
  if (!apiKey) throw new Error("KLIKQRIS_API_KEY not configured");
  if (!merchantId) throw new Error("KLIKQRIS_MERCHANT_ID not configured");
  return { mode, apiKey, merchantId };
}

/** Auth headers required by KlikQRIS on every request */
function authHeaders(config: KlikQRISConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": config.apiKey,
    "id_merchant": config.merchantId,
  };
}

function getEndpoints(mode: PaymentProviderMode) {
  switch (mode) {
    case "sandbox":
      return {
        create: `${KLIKQRIS_BASE}/api/sandbox/qris/create`,
        status: (orderId: string) => `${KLIKQRIS_BASE}/api/sandbox/qris/status/${encodeURIComponent(orderId)}`,
      };
    case "mypg":
      return {
        create: `${KLIKQRIS_BASE}/api/qrisv2/create`,
        status: (orderId: string, merchantId: string) =>
          `${KLIKQRIS_BASE}/api/qrisv2/status/${encodeURIComponent(merchantId)}/${encodeURIComponent(orderId)}`,
      };
    case "inhouse":
    default:
      return {
        create: `${KLIKQRIS_BASE}/api/qris/create`,
        status: (orderId: string) => `${KLIKQRIS_BASE}/api/qris/status/${encodeURIComponent(orderId)}`,
      };
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse the create response — works for inhouse, sandbox, and mypg.
 * Real response shape from docs:
 * {
 *   "status": true,
 *   "message": "Transaction Created Successfully",
 *   "data": {
 *     "order_id": "INV-123",
 *     "amount": "1000.00",
 *     "total_amount": "1016.00",   ← ALWAYS show THIS to buyer
 *     "status": "PENDING",
 *     "qris_url": "https://klikqris.com/storage/qris_api/qris_INV-123.png",
 *     "qris_image": "data:image/png;base64,...",   ← fallback
 *     "expired_at": "2026-09-04 00:54:51",
 *     "expired_menit": "60",
 *     "signature": "ohRISdH4ABDvOl...",
 *     "direct_url": "https://klikqris.com/payqris/MERCHANT_ID/INV-123",
 *     ...
 *   }
 * }
 */
function parseCreateResponse(json: Record<string, unknown>, req: CreateInvoiceRequest, config: KlikQRISConfig): CreateInvoiceResponse {
  const data = (json.data ?? json) as Record<string, unknown>;

  const providerOrderId = String(data.order_id ?? req.orderId);
  const merchantId = String(data.merchant_id ?? data.id_merchant ?? config.merchantId);
  const requestedAmount = Math.round(Number(data.amount ?? req.amount));
  const payableAmount = Math.round(Number(data.total_amount ?? data.amount ?? req.amount));
  const signature = String(data.signature ?? "");
  const expiresAt = String(data.expired_at ?? data.expires_at ?? "");
  const expiresMinutes = Number(data.expired_menit ?? 60);

  // QR: prefer qris_url (HTTPS link), fallback to qris_image (data URI)
  const rawQrisUrl = String(data.qris_url ?? "");
  const rawQrisImage = String(data.qris_image ?? "");

  const qrisUrl = isAllowedQrUrl(rawQrisUrl) ? rawQrisUrl : null;
  const qrisImage = rawQrisImage.startsWith("data:image/") ? rawQrisImage : null;

  const directUrl = String(data.direct_url ?? "");

  const success = (json.status === true || json.status === "true") && !!(qrisUrl || qrisImage);

  return {
    success,
    providerOrderId,
    merchantId,
    requestedAmount,
    payableAmount,
    signature,
    qrisUrl,
    qrisImage,
    directUrl: directUrl || null,
    expiresAt,
    expiresMinutes,
  };
}

/**
 * Parse status response — works for all modes.
 * Inhouse/sandbox status values: "SUCCESS", "PENDING", "EXPIRED"
 * MY PG status values: same
 */
function parseStatusResponse(json: Record<string, unknown>, orderId: string): CheckStatusResponse {
  const data = (json.data ?? json) as Record<string, unknown>;
  const rawStatus = String(data.status ?? "").toUpperCase();

  let status: "pending" | "paid" | "expired" | "failed" = "pending";
  if (rawStatus === "SUCCESS" || rawStatus === "PAID") status = "paid";
  else if (rawStatus === "EXPIRED") status = "expired";
  else if (rawStatus === "FAILED" || rawStatus === "CANCELLED") status = "failed";

  return {
    success: json.status === true || json.status === "true",
    providerOrderId: String(data.order_id ?? orderId),
    status,
    amountPaid: data.total_amount ? Math.round(Number(data.total_amount)) : undefined,
    paidAt: data.paid_at ? String(data.paid_at) : undefined,
  };
}

// ============================================================
// INHOUSE provider (PG KlikQRIS) — also used for Sandbox
// ============================================================
function createInhouseProvider(config: KlikQRISConfig, mode: "inhouse" | "sandbox"): PaymentProvider {
  const endpoints = getEndpoints(mode);

  return {
    mode,

    async createInvoice(req: CreateInvoiceRequest): Promise<CreateInvoiceResponse> {
      const body: Record<string, unknown> = {
        order_id: req.orderId,
        id_merchant: req.merchantId || config.merchantId,
        amount: req.amount,
      };
      if (req.keterangan) body.keterangan = req.keterangan;
      if (req.callbackUrl) body.callback_url = req.callbackUrl;

      const res = await fetchWithTimeout(endpoints.create, {
        method: "POST",
        headers: authHeaders(config),
        body: JSON.stringify(body),
      });

      const json = await res.json() as Record<string, unknown>;
      return parseCreateResponse(json, req, config);
    },

    async checkStatus(orderId: string): Promise<CheckStatusResponse> {
      const url = (endpoints.status as (id: string) => string)(orderId);
      const res = await fetchWithTimeout(url, {
        method: "GET",
        headers: authHeaders(config),
      });
      const json = await res.json() as Record<string, unknown>;
      return parseStatusResponse(json, orderId);
    },

    // Inhouse callback is FLAT:
    // { order_id, status: "PAID"|"EXPIRED", amount, total_amount, payment_date, signature, direct_url, ... }
    parseCallback(body: unknown): CallbackPayload | null {
      if (!body || typeof body !== "object") return null;
      const b = body as Record<string, unknown>;

      const orderId = String(b.order_id ?? "");
      if (!orderId) return null;

      const rawStatus = String(b.status ?? "").toUpperCase();
      let status: "paid" | "expired" | "failed";
      if (rawStatus === "PAID" || rawStatus === "SUCCESS") status = "paid";
      else if (rawStatus === "EXPIRED") status = "expired";
      else status = "failed";

      return {
        providerOrderId: orderId,
        merchantId: String(b.merchant_id ?? b.id_merchant ?? config.merchantId),
        status,
        amountPaid: b.total_amount ? Math.round(Number(b.total_amount)) : undefined,
        totalAmount: b.total_amount ? Math.round(Number(b.total_amount)) : undefined,
        signature: b.signature ? String(b.signature) : undefined,
        paidAt: b.payment_date ? String(b.payment_date) : undefined,
      };
    },
  };
}

// ============================================================
// MY PG provider
// ============================================================
function createMyPgProvider(config: KlikQRISConfig): PaymentProvider {
  const endpoints = getEndpoints("mypg");

  return {
    mode: "mypg",

    async createInvoice(req: CreateInvoiceRequest): Promise<CreateInvoiceResponse> {
      const body: Record<string, unknown> = {
        order_id: req.orderId,
        id_merchant: req.merchantId || config.merchantId,
        amount: req.amount,
      };
      if (req.keterangan) body.keterangan = req.keterangan;

      const res = await fetchWithTimeout(endpoints.create, {
        method: "POST",
        headers: authHeaders(config),
        body: JSON.stringify(body),
      });

      const json = await res.json() as Record<string, unknown>;
      return parseCreateResponse(json, req, config);
    },

    async checkStatus(orderId: string, merchantId?: string): Promise<CheckStatusResponse> {
      const mid = merchantId || config.merchantId;
      const url = (endpoints.status as (orderId: string, merchantId: string) => string)(orderId, mid);
      const res = await fetchWithTimeout(url, {
        method: "GET",
        headers: authHeaders(config),
      });
      const json = await res.json() as Record<string, unknown>;
      return parseStatusResponse(json, orderId);
    },

    // MY PG callback is NESTED:
    // { status: "success", message: "...", data: { order_id, amount_request, amount_paid, status: "PAID", merchant_id, via, signature } }
    parseCallback(body: unknown): CallbackPayload | null {
      if (!body || typeof body !== "object") return null;
      const b = body as Record<string, unknown>;

      // MY PG wraps in { status, data }
      const data = (b.data && typeof b.data === "object" ? b.data : b) as Record<string, unknown>;

      const orderId = String(data.order_id ?? "");
      if (!orderId) return null;

      const rawStatus = String(data.status ?? "").toUpperCase();
      let status: "paid" | "expired" | "failed";
      if (rawStatus === "PAID" || rawStatus === "SUCCESS") status = "paid";
      else if (rawStatus === "EXPIRED") status = "expired";
      else status = "failed";

      return {
        providerOrderId: orderId,
        merchantId: String(data.merchant_id ?? config.merchantId),
        status,
        amountPaid: data.amount_paid ? Math.round(Number(data.amount_paid)) : undefined,
        totalAmount: data.amount_paid ? Math.round(Number(data.amount_paid)) : undefined,
        signature: data.signature ? String(data.signature) : undefined,
        paidAt: data.payment_date ? String(data.payment_date) : undefined,
      };
    },
  };
}

// ============================================================
// Factory
// ============================================================
export function getPaymentProvider(): PaymentProvider {
  const config = getConfig();
  switch (config.mode) {
    case "sandbox":
      return createInhouseProvider(config, "sandbox");
    case "mypg":
      return createMyPgProvider(config);
    case "inhouse":
    default:
      return createInhouseProvider(config, "inhouse");
  }
}

export function getPaymentProviderMode(): PaymentProviderMode {
  return (process.env.KLIKQRIS_MODE ?? "sandbox") as PaymentProviderMode;
}

export function isPaymentEnabled(): boolean {
  return process.env.KLIKQRIS_PAYMENTS_ENABLED === "true";
}
