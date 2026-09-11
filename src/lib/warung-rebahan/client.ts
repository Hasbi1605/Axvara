// src/lib/warung-rebahan/client.ts — Low-level HTTP client ke Warung Rebahan H2H API.
// Edge-compatible: hanya fetch() + Web Crypto, tanpa Node-only API.
//
// Pola mengikuti src/lib/payments/dana-qris.ts (AbortController + timeout,
// error classification) dan src/lib/telegram/api.ts (wrapper fetch kecil).

export type WrProduct = {
  id: string;
  name: string;
  category: string;
  description: string;
  variants: WrVariant[];
};

export type WrVariant = {
  id: string;
  name: string;
  price: number;
  duration: string;
  type: string;
  warranty: string;
  stock: number;
  terms: string | null;
  delivery_terms: string | null;
};

export type WrBalance = {
  balance: number;
  currency: string;
};

export type WrOrderResult = {
  order_id: string;
  status: string;
  payment_status: string;
  total_amount: number;
  current_balance: number;
};

export type WrTransaction = {
  order_id: string;
  total_amount: number;
  status: string;
  payment_status: string;
  products: unknown[];
  account_details: unknown[];
  created_at: string;
};

export type WrWebhookEvent = {
  event: "order.processing" | "order.completed" | "order.failed";
  data: {
    order_id: string;
    status: string;
    total_amount: number;
    [key: string]: unknown;
  };
};

export type WrApiResponse<T> = {
  success: boolean;
  message: string;
  data: T;
};

export class WrApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string,
    public responseBody?: unknown,
  ) {
    super(message);
    this.name = "WrApiError";
  }
}

export class WrInsufficientBalanceError extends WrApiError {
  constructor(message: string, endpoint: string, responseBody?: unknown) {
    super(message, 402, endpoint, responseBody);
    this.name = "WrInsufficientBalanceError";
  }
}

export class WrOutOfStockError extends WrApiError {
  constructor(message: string, endpoint: string, responseBody?: unknown) {
    super(message, 409, endpoint, responseBody);
    this.name = "WrOutOfStockError";
  }
}

export class WrNetworkError extends Error {
  constructor(message: string, public endpoint: string) {
    super(message);
    this.name = "WrNetworkError";
  }
}

export const WR_API_TIMEOUT_MS = 30_000;
// Outbound HANYA ke host ini — tidak ada dynamic URL dari user input (SSRF-safe).
const WR_ALLOWED_HOST = "warungrebahan.com";

export function isWrEnabled(): boolean {
  return process.env.WARUNG_REBAHAN_ENABLED === "true";
}

export function isWrSyncEnabled(): boolean {
  return isWrEnabled() && process.env.WARUNG_REBAHAN_SYNC_ENABLED !== "false";
}

export function isWrAutoOrderEnabled(): boolean {
  return (
    isWrEnabled() && process.env.WARUNG_REBAHAN_AUTO_ORDER_ENABLED === "true"
  );
}

export function isWrSandbox(): boolean {
  return process.env.WARUNG_REBAHAN_SANDBOX === "true";
}

export function getWrApiKey(): string {
  const key = process.env.WARUNG_REBAHAN_API_KEY?.trim();
  if (!key) throw new Error("WARUNG_REBAHAN_API_KEY not configured");
  return key;
}

export function getWrBaseUrl(): string {
  return (
    process.env.WARUNG_REBAHAN_BASE_URL?.trim() ||
    "https://warungrebahan.com/api/v1"
  ).replace(/\/+$/, "");
}

function assertAllowedUrl(url: string, endpoint: string): void {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new WrNetworkError("invalid_wr_url", endpoint);
  }
  if (host !== WR_ALLOWED_HOST && !host.endsWith(`.${WR_ALLOWED_HOST}`)) {
    throw new WrNetworkError("wr_host_not_allowed", endpoint);
  }
}

export function classifyWrError(
  message: string,
  status: number,
  endpoint: string,
  body?: unknown,
): WrApiError {
  const lowered = String(message || "").toLowerCase();
  if (
    lowered.includes("saldo") ||
    lowered.includes("balance") ||
    lowered.includes("insufficient")
  ) {
    return new WrInsufficientBalanceError(message, endpoint, body);
  }
  if (
    lowered.includes("stok") ||
    lowered.includes("stock") ||
    lowered.includes("habis") ||
    lowered.includes("kosong")
  ) {
    return new WrOutOfStockError(message, endpoint, body);
  }
  return new WrApiError(message, status, endpoint, body);
}

export async function wrFetch<T>(
  endpoint: string,
  payload: Record<string, unknown> = {},
): Promise<WrApiResponse<T>> {
  const baseUrl = getWrBaseUrl();
  const url = `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  assertAllowedUrl(url, endpoint);
  const apiKey = getWrApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WR_API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, ...payload }),
      signal: controller.signal,
    });
    const json = (await res
      .json()
      .catch(() => null)) as WrApiResponse<T> | null;
    if (!res.ok || !json || json.success !== true) {
      const message =
        (json && typeof json.message === "string" && json.message) ||
        `WR request failed (${res.status})`;
      throw classifyWrError(message, res.status, endpoint, json ?? undefined);
    }
    return json;
  } catch (error) {
    if (error instanceof WrApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new WrNetworkError("wr_request_timeout", endpoint);
    }
    throw new WrNetworkError(
      error instanceof Error ? error.message : "wr_request_failed",
      endpoint,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBalance(): Promise<WrBalance> {
  const res = await wrFetch<WrBalance>("/balance");
  return res.data;
}

export async function fetchProducts(): Promise<WrProduct[]> {
  const res = await wrFetch<WrProduct[]>("/products");
  return Array.isArray(res.data) ? res.data : [];
}

export async function createOrder(params: {
  variant_id: string;
  quantity?: number;
  email_invite?: string;
  voucher_code?: string;
  is_test?: boolean;
}): Promise<WrOrderResult> {
  const res = await wrFetch<WrOrderResult>("/order", {
    variant_id: params.variant_id,
    quantity: params.quantity ?? 1,
    ...(params.email_invite ? { email_invite: params.email_invite } : {}),
    ...(params.voucher_code ? { voucher_code: params.voucher_code } : {}),
    // Sandbox WR: saldo tidak terpotong, respons tetap valid.
    ...(isWrSandbox() || params.is_test ? { is_test: true } : {}),
  });
  return res.data;
}

export async function fetchTransactions(): Promise<WrTransaction[]> {
  const res = await wrFetch<WrTransaction[]>("/transactions");
  return Array.isArray(res.data) ? res.data : [];
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verifikasi HMAC-SHA256 webhook WR. Secret = API key (sesuai dok WR).
 * Constant-time comparison agar tidak bocor via timing (lihat
 * src/lib/security.ts untuk rumah kanonis string-vs-string).
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
): Promise<boolean> {
  try {
    const secret = process.env.WARUNG_REBAHAN_WEBHOOK_SECRET?.trim() || getWrApiKey();
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    const normalized = signature.trim().toLowerCase().replace(/^sha256=/, "");
    if (!/^[a-f0-9]{64}$/.test(normalized)) return false;
    const expected = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(rawBody),
    );
    return toHex(new Uint8Array(expected)) === normalized;
  } catch {
    return false;
  }
}

export function wrWebhookSecretConfigured(): boolean {
  return Boolean(
    process.env.WARUNG_REBAHAN_WEBHOOK_SECRET?.trim() ||
      process.env.WARUNG_REBAHAN_API_KEY?.trim(),
  );
}
