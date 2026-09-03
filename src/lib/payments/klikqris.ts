// src/lib/payments/klikqris.ts — KlikQRIS adapter: sandbox + MY PG modes
// All provider communication is isolated here. No other code calls KlikQRIS URLs directly.

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
  "api.klikqris.com",
]);

function isAllowedQrUrl(url: string): boolean {
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

function getEndpoints(mode: PaymentProviderMode) {
  if (mode === "sandbox") {
    return {
      create: `${KLIKQRIS_BASE}/api/sandbox/qris/create`,
      status: (orderId: string) => `${KLIKQRIS_BASE}/api/sandbox/qris/status/${orderId}`,
    };
  }
  return {
    create: `${KLIKQRIS_BASE}/api/qrisv2/create`,
    status: (orderId: string, merchantId: string) =>
      `${KLIKQRIS_BASE}/api/qrisv2/status/${merchantId}/${orderId}`,
  };
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

// --- Sandbox implementation ---
function createSandboxProvider(config: KlikQRISConfig): PaymentProvider {
  const endpoints = getEndpoints("sandbox");

  return {
    mode: "sandbox",

    async createInvoice(req: CreateInvoiceRequest): Promise<CreateInvoiceResponse> {
      const body = {
        api_key: config.apiKey,
        merchant_id: req.merchantId || config.merchantId,
        order_id: req.orderId,
        amount: req.amount,
      };

      const res = await fetchWithTimeout(endpoints.create, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json() as Record<string, unknown>;
      const data = (json.data ?? json) as Record<string, unknown>;

      const qrisUrl = String(data.qris_url ?? data.qris_image ?? "");
      const totalAmount = Number(data.total_amount ?? data.amount ?? req.amount);
      const signature = String(data.signature ?? data.sign ?? "");
      const expiresAt = String(
        data.expires_at ?? data.expired_at ??
        new Date(Date.now() + 30 * 60 * 1000).toISOString()
      );

      if (!qrisUrl) {
        return {
          success: false,
          providerOrderId: req.orderId,
          merchantId: req.merchantId || config.merchantId,
          requestedAmount: req.amount,
          payableAmount: totalAmount,
          signature,
          qrisUrl: null,
          directUrl: null,
          expiresAt,
        };
      }

      const safeQrisUrl = isAllowedQrUrl(qrisUrl) ? qrisUrl : null;

      return {
        success: true,
        providerOrderId: String(data.order_id ?? req.orderId),
        merchantId: String(data.merchant_id ?? req.merchantId ?? config.merchantId),
        requestedAmount: req.amount,
        payableAmount: totalAmount,
        signature,
        qrisUrl: safeQrisUrl,
        directUrl: String(data.direct_url ?? data.payment_url ?? ""),
        expiresAt,
      };
    },

    async checkStatus(orderId: string): Promise<CheckStatusResponse> {
      const url = (endpoints.status as (id: string) => string)(orderId);
      const res = await fetchWithTimeout(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      const json = await res.json() as Record<string, unknown>;
      const data = (json.data ?? json) as Record<string, unknown>;
      const paymentStatus = String(data.payment_status ?? data.status ?? "").toLowerCase();

      let status: "pending" | "paid" | "expired" | "failed" = "pending";
      if (paymentStatus.includes("paid") || paymentStatus.includes("success")) status = "paid";
      else if (paymentStatus.includes("expired") || paymentStatus.includes("expire")) status = "expired";
      else if (paymentStatus.includes("fail") || paymentStatus.includes("cancel")) status = "failed";

      return {
        success: true,
        providerOrderId: String(data.order_id ?? orderId),
        status,
        amountPaid: data.amount_paid ? Number(data.amount_paid) : undefined,
        paidAt: data.paid_at ? String(data.paid_at) : undefined,
      };
    },

    parseCallback(body: unknown): CallbackPayload | null {
      if (!body || typeof body !== "object") return null;
      const b = body as Record<string, unknown>;

      const orderId = String(b.order_id ?? b.merchant_order_id ?? "");
      const merchantId = String(b.merchant_id ?? "");
      if (!orderId) return null;

      const rawStatus = String(b.payment_status ?? b.status ?? "").toLowerCase();
      let status: "paid" | "expired" | "failed";
      if (rawStatus.includes("paid") || rawStatus.includes("success")) status = "paid";
      else if (rawStatus.includes("expired") || rawStatus.includes("expire")) status = "expired";
      else status = "failed";

      return {
        providerOrderId: orderId,
        merchantId,
        status,
        amountPaid: b.amount_paid ? Number(b.amount_paid) : undefined,
        signature: b.signature ? String(b.signature) : b.sign ? String(b.sign) : undefined,
        paidAt: b.paid_at ? String(b.paid_at) : undefined,
      };
    },
  };
}

// --- MY PG (production) implementation ---
function createMyPgProvider(config: KlikQRISConfig): PaymentProvider {
  const endpoints = getEndpoints("mypg");

  return {
    mode: "mypg",

    async createInvoice(req: CreateInvoiceRequest): Promise<CreateInvoiceResponse> {
      const body = {
        api_key: config.apiKey,
        merchant_id: req.merchantId || config.merchantId,
        order_id: req.orderId,
        amount: req.amount,
      };

      const res = await fetchWithTimeout(endpoints.create, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json() as Record<string, unknown>;
      const data = (json.data ?? json) as Record<string, unknown>;

      const qrisUrl = String(data.qris_url ?? data.qris_image ?? "");
      const totalAmount = Number(data.total_amount ?? data.amount ?? req.amount);
      const signature = String(data.signature ?? data.sign ?? "");
      const expiresAt = String(
        data.expires_at ?? data.expired_at ??
        new Date(Date.now() + 30 * 60 * 1000).toISOString()
      );

      const safeQrisUrl = qrisUrl && isAllowedQrUrl(qrisUrl) ? qrisUrl : null;

      return {
        success: !!safeQrisUrl,
        providerOrderId: String(data.order_id ?? req.orderId),
        merchantId: String(data.merchant_id ?? req.merchantId ?? config.merchantId),
        requestedAmount: req.amount,
        payableAmount: totalAmount,
        signature,
        qrisUrl: safeQrisUrl,
        directUrl: String(data.direct_url ?? data.payment_url ?? ""),
        expiresAt,
      };
    },

    async checkStatus(orderId: string, merchantId?: string): Promise<CheckStatusResponse> {
      const mid = merchantId || config.merchantId;
      const url = (endpoints.status as (orderId: string, merchantId: string) => string)(orderId, mid);
      const res = await fetchWithTimeout(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      const json = await res.json() as Record<string, unknown>;
      const data = (json.data ?? json) as Record<string, unknown>;
      const paymentStatus = String(data.payment_status ?? data.status ?? "").toLowerCase();

      let status: "pending" | "paid" | "expired" | "failed" = "pending";
      if (paymentStatus.includes("paid") || paymentStatus.includes("success")) status = "paid";
      else if (paymentStatus.includes("expired") || paymentStatus.includes("expire")) status = "expired";
      else if (paymentStatus.includes("fail") || paymentStatus.includes("cancel")) status = "failed";

      return {
        success: true,
        providerOrderId: String(data.order_id ?? orderId),
        status,
        amountPaid: data.amount_paid ? Number(data.amount_paid) : undefined,
        paidAt: data.paid_at ? String(data.paid_at) : undefined,
      };
    },

    parseCallback(body: unknown): CallbackPayload | null {
      if (!body || typeof body !== "object") return null;
      const b = body as Record<string, unknown>;

      const orderId = String(b.order_id ?? b.merchant_order_id ?? "");
      const merchantId = String(b.merchant_id ?? "");
      if (!orderId) return null;

      const rawStatus = String(b.payment_status ?? b.status ?? "").toLowerCase();
      let status: "paid" | "expired" | "failed";
      if (rawStatus.includes("paid") || rawStatus.includes("success")) status = "paid";
      else if (rawStatus.includes("expired") || rawStatus.includes("expire")) status = "expired";
      else status = "failed";

      return {
        providerOrderId: orderId,
        merchantId,
        status,
        amountPaid: b.amount_paid ? Number(b.amount_paid) : undefined,
        signature: b.signature ? String(b.signature) : b.sign ? String(b.sign) : undefined,
        paidAt: b.paid_at ? String(b.paid_at) : undefined,
      };
    },
  };
}

// --- Factory ---
export function getPaymentProvider(): PaymentProvider {
  const config = getConfig();
  return config.mode === "sandbox"
    ? createSandboxProvider(config)
    : createMyPgProvider(config);
}

export function getPaymentProviderMode(): PaymentProviderMode {
  return (process.env.KLIKQRIS_MODE ?? "sandbox") as PaymentProviderMode;
}

export function isPaymentEnabled(): boolean {
  return process.env.KLIKQRIS_PAYMENTS_ENABLED === "true";
}
