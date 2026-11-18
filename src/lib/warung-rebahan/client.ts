// src/lib/warung-rebahan/client.ts — Low-level HTTP client ke Warung Rebahan H2H API.
// Edge-compatible: hanya fetch() + Web Crypto, tanpa Node-only API.
//
// Pola mengikuti src/lib/payments/dana-qris.ts (AbortController + timeout,
// error classification) dan src/lib/telegram/api.ts (wrapper fetch kecil).

import { jaspayAmount } from "./jaspay";

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
  /** api-docs WR: "auto" | "manual" | "mixed" (opsional — respons lama tanpa field). */
  delivery_mode?: string | null;
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
  event: "order.processing" | "order.completed" | "order.account_updated" | "order.refunded" | "order.failed";
  data: {
    order_id: string;
    status: string;
    total_amount: number;
    [key: string]: unknown;
  };
};

/** Jaspay made-by-order (api-docs WR, family /jaspay/*, base /api/v1). */
export type JaspayAccount = Record<string, unknown>;

export type JaspayOrderResult = {
  /** Invoice JSP-... (identitas korelasi; ref_id TIDAK dijamin di /orders). */
  invoice: string;
  status: "processing" | "completed" | "partial" | "failed";
  product: string;
  product_name?: string;
  /** Nama package (BUKAN id). */
  package?: string;
  quantity: number;
  price?: number;
  total?: number;
  refunded?: number;
  progress?: { done?: number; success?: number };
  phase?: "preparing" | "queued" | "running" | null;
  queue_position?: number | null;
  success_count: number;
  accounts: JaspayAccount[];
  created_at?: string;
  finished_at?: string | null;
  balance_after?: number;
  /** True bila upstream mengembalikan duplikat ref (tanpa debit ganda). */
  duplicate?: boolean;
  /** Payload mentah upstream (bukti terenkripsi untuk admin; tidak ditampilkan). */
  raw?: unknown;
};

export type JaspayWebhookEvent = {
  event: "jaspay.completed" | "jaspay.partial" | "jaspay.failed" | "jaspay.refunded";
  data: {
    /** Invoice JSP-... (BUKAN order_id). */
    invoice: string;
    status?: string;
    quantity?: number;
    success_count?: number;
    accounts?: JaspayAccount[];
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

// Timeout per panggilan WR. Diturunkan 30 s → 12 s pada 2026-09-18: satu
// invocation cron bisa merangkai beberapa panggilan (order, /transactions,
// /products, /balance), dan 30 s masing-masing sudah cukup untuk melewati
// plafon waktu invocation (insiden run `canceled` pada 125 s). Referensi
// nyata: sweep katalog penuh 48 produk = ~10 s TOTAL termasuk ~250 statement
// D1 (wr_sync_log.duration_ms 9.587/11.886), jadi 12 s lapang untuk fetch
// tunggal; kegagalan tetap punya retry + backoff.
export const WR_API_TIMEOUT_MS = 12_000;
// Outbound langsung HANYA ke host ini — tidak ada dynamic URL dari user input
// (SSRF-safe). Bila WARUNG_REBAHAN_PROXY_URL diset (Opsi A: proxy Heroku agar
// lolos IP whitelist WR), request pergi ke proxy + host proxy diizinkan.
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

/**
 * Auto-order untuk kelas ANTREAN (made_by_order / kelas belum dikunci).
 * Default AKTIF begitu auto-order menyala (keputusan owner 2026-09-18):
 * menahan kelas ini membuat pesanan diam di 'pending' sampai admin sadar.
 * Set `WARUNG_REBAHAN_AUTO_ORDER_MBO='false'` untuk mengembalikan perilaku
 * lama (hanya restock) tanpa deploy — saklar mundur bila respons upstream
 * ternyata tidak seperti dugaan (kelas ini belum pernah diuji via API).
 */
export function isWrAutoOrderQueuedEnabled(): boolean {
  return (
    isWrAutoOrderEnabled() && process.env.WARUNG_REBAHAN_AUTO_ORDER_MBO !== "false"
  );
}

export function isWrSandbox(): boolean {
  return process.env.WARUNG_REBAHAN_SANDBOX === "true";
}

export function getWrApiKey(): string {
  // Mode proxy (Opsi A): key WR asli dipegang proxy Heroku (WR_API_KEY di
  // dyno), Pages tidak menyimpan/mengirim key asli sama sekali.
  if (getWrProxyUrl()) return "via-proxy";
  const key = process.env.WARUNG_REBAHAN_API_KEY?.trim();
  if (!key) throw new Error("WARUNG_REBAHAN_API_KEY not configured");
  return key;
}

/**
 * Opsi A lawan IP whitelist: alihkan seluruh panggilan WR lewat proxy Heroku
 * (satu dyno = egress IP stabil yang di-whitelist di dashboard WR).
 * Kosong = mode langsung ke warungrebahan.com (butuh IP Pages di-whitelist —
 * tidak realistis, hanya untuk dev/test lokal).
 */
export function getWrProxyUrl(): string {
  return (process.env.WARUNG_REBAHAN_PROXY_URL || "").trim().replace(/\/+$/, "");
}

function getWrProxyToken(): string {
  const token = process.env.WARUNG_REBAHAN_PROXY_TOKEN?.trim();
  if (!token) throw new Error("WARUNG_REBAHAN_PROXY_TOKEN not configured");
  return token;
}

export function getWrBaseUrl(): string {
  return (
    process.env.WARUNG_REBAHAN_BASE_URL?.trim() ||
    "https://warungrebahan.com/api/v1"
  ).replace(/\/+$/, "");
}

function assertAllowedUrl(url: string, endpoint: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WrNetworkError("invalid_wr_url", endpoint);
  }
  // Token proxy tidak boleh lewat plaintext (kecuali localhost untuk dev).
  const host = parsed.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocal) {
    throw new WrNetworkError("wr_insecure_protocol", endpoint);
  }
  if (host === WR_ALLOWED_HOST || host.endsWith(`.${WR_ALLOWED_HOST}`)) return;
  // Mode proxy: host proxy (Heroku) juga diizinkan — nilainya dari env
  // server, bukan dari user input, jadi tetap SSRF-safe.
  const proxyUrl = getWrProxyUrl();
  if (proxyUrl) {
    try {
      const proxyHost = new URL(proxyUrl).hostname.toLowerCase();
      if (host === proxyHost) return;
    } catch {
      throw new WrNetworkError("invalid_wr_proxy_url", endpoint);
    }
  }
  throw new WrNetworkError("wr_host_not_allowed", endpoint);
}

export function classifyWrError(
  message: string,
  status: number,
  endpoint: string,
  body?: unknown,
): WrApiError {
  if (status >= 500) return new WrApiError(message, status, endpoint, body);
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
  const proxyUrl = getWrProxyUrl();
  // Mode proxy: POST https://<proxy>/wr/<endpoint> + x-proxy-token; api_key
  // disuntik proxy dari env dyno. Mode langsung: POST ke WR + api_key body.
  const baseUrl = proxyUrl || getWrBaseUrl();
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = proxyUrl ? `${baseUrl}/wr${path}` : `${baseUrl}${path}`;
  assertAllowedUrl(url, endpoint);
  const apiKey = getWrApiKey();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (proxyUrl) headers["x-proxy-token"] = getWrProxyToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WR_API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(proxyUrl ? payload : { api_key: apiKey, ...payload }),
      signal: controller.signal,
    });
    const json = (await res
      .json()
      .catch(() => null)) as WrApiResponse<T> | null;
    // A 2xx purchase may already have charged the supplier. An unreadable
    // receipt is not a rejection: preserve the dispatcher's sent fence.
    if (res.ok && (!json || typeof json.success !== "boolean")) {
      throw new WrNetworkError("wr_network_response_unreadable", endpoint);
    }
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

/** Potongan katalog dari proxy VPS (2026-10-04, `POST /wr/products-slice`). */
export type WrProductsSlice = {
  products: WrProduct[];
  total: number;
  firstId: string;
  offset: number;
  /** Hanya pada potongan terakhir: seluruh id varian upstream saat ini. */
  allVariantIds: string[] | null;
};

/**
 * Ambil satu potongan katalog WR yang SUDAH diurutkan proxy (id string
 * localeCompare — sama dengan `syncProducts`). Hanya tersedia mode proxy;
 * mode langsung / proxy lama (404) → null agar pemanggil kembali ke
 * `fetchProducts()` penuh. Tujuan: cron Free plan (~10 ms CPU) tidak mem-parse
 * seluruh katalog di setiap potongan.
 */
export async function fetchProductsSlice(offset: number, limit: number): Promise<WrProductsSlice | null> {
  if (!getWrProxyUrl()) return null;
  try {
    const res = await wrFetch<WrProduct[]>("/products-slice", { offset, limit });
    const meta = ((res as unknown as { meta?: Record<string, unknown> }).meta ?? {}) as Record<string, unknown>;
    if (!Array.isArray(res.data) || typeof meta.total !== "number") return null;
    return {
      products: res.data,
      total: meta.total,
      firstId: String(meta.first_id ?? ""),
      offset: Number(meta.offset ?? offset),
      allVariantIds: Array.isArray(meta.all_variant_ids) ? meta.all_variant_ids.map(String) : null,
    };
  } catch (error) {
    if (error instanceof WrApiError && (error.status === 404 || error.status === 405)) return null;
    throw error;
  }
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
  if (!res.data || typeof res.data.order_id !== "string" || !res.data.order_id.trim()) {
    throw new WrNetworkError("wr_network_response_unreadable", "/order");
  }
  return res.data;
}

export async function fetchTransactions(): Promise<WrTransaction[]> {
  const res = await wrFetch<WrTransaction[]>("/transactions");
  return Array.isArray(res.data) ? res.data : [];
}

// ── Jaspay transport (WR3): family /jaspay/* di base /api/v1 yang sama.
// wrFetch menggabung path nested apa adanya (`/wr/jaspay/...` via proxy,
// `/api/v1/jaspay/...` langsung) — tanpa endpoint baru di luar allowlist.

function assertJaspayInvoice(value: unknown): string {
  const invoice = String(value ?? "").trim().slice(0, 120);
  if (!invoice) throw new WrNetworkError("wr_network_response_unreadable", "/jaspay/order");
  return invoice;
}

/** Katalog mentah Jaspay (validasi + normalisasi di jaspay.ts/sync). */
export async function fetchJaspayProducts(): Promise<unknown[]> {
  const res = await wrFetch<unknown[]>("/jaspay/products");
  if (!Array.isArray(res.data)) throw new WrNetworkError("jaspay_catalog_malformed", "/jaspay/products");
  return res.data;
}

export async function createJaspayOrder(params: {
  product: string;
  package?: string;
  quantity: number;
  ref_id: string;
}): Promise<JaspayOrderResult> {
  const qty = Math.max(1, Math.floor(Number(params.quantity || 1)));
  const res = await wrFetch<JaspayOrderResult>("/jaspay/order", {
    product: params.product,
    ...(params.package ? { package: params.package } : {}),
    quantity: qty,
    ref_id: params.ref_id,
  });
  const data = res.data as unknown as Record<string, unknown>;
  if (!data || typeof data !== "object") {
    throw new WrNetworkError("wr_network_response_unreadable", "/jaspay/order");
  }
  const invoice = assertJaspayInvoice(data.invoice);
  const accounts = Array.isArray(data.accounts) ? (data.accounts as JaspayAccount[]) : [];
  return {
    raw: data,
    invoice,
    status: data.status as JaspayOrderResult["status"],
    product: String(data.product ?? params.product),
    product_name: data.product_name == null ? undefined : String(data.product_name),
    package: data.package == null ? undefined : String(data.package),
    quantity: Number(data.quantity ?? qty) || qty,
    price: data.price == null ? undefined : Number(data.price),
    total: jaspayAmount(data.total),
    refunded: jaspayAmount(data.refunded),
    progress: (data.progress ?? undefined) as JaspayOrderResult["progress"],
    phase: data.phase as JaspayOrderResult["phase"],
    queue_position: data.queue_position as number | null | undefined,
    success_count: Number(data.success_count ?? (data.progress as { success?: unknown } | undefined)?.success ?? 0) || 0,
    accounts,
    created_at: data.created_at == null ? undefined : String(data.created_at),
    finished_at: data.finished_at == null ? undefined : String(data.finished_at),
    balance_after: data.balance_after == null ? undefined : Number(data.balance_after),
    duplicate: (data.duplicate as boolean | undefined) === true ? true : undefined,
  };
}

/** Status satu invoice JSP yang SUDAH dikenal (bukan scan latest-50). */
export async function fetchJaspayStatus(invoice: string): Promise<JaspayOrderResult> {
  const res = await wrFetch<JaspayOrderResult>("/jaspay/status", { invoice });
  const data = res.data as unknown as Record<string, unknown>;
  if (!data || typeof data !== "object") {
    throw new WrNetworkError("wr_network_response_unreadable", "/jaspay/status");
  }
  const known = assertJaspayInvoice(data.invoice);
  const accounts = Array.isArray(data.accounts) ? (data.accounts as JaspayAccount[]) : [];
  return {
    raw: data,
    invoice: known,
    status: data.status as JaspayOrderResult["status"],
    product: String(data.product ?? ""),
    product_name: data.product_name == null ? undefined : String(data.product_name),
    package: data.package == null ? undefined : String(data.package),
    quantity: Number(data.quantity ?? 0) || 0,
    price: data.price == null ? undefined : Number(data.price),
    total: jaspayAmount(data.total),
    refunded: jaspayAmount(data.refunded),
    progress: (data.progress ?? undefined) as JaspayOrderResult["progress"],
    phase: data.phase as JaspayOrderResult["phase"],
    queue_position: data.queue_position as number | null | undefined,
    success_count: Number(data.success_count ?? (data.progress as { success?: unknown } | undefined)?.success ?? 0) || 0,
    accounts,
    created_at: data.created_at == null ? undefined : String(data.created_at),
    finished_at: data.finished_at == null ? undefined : String(data.finished_at),
    balance_after: data.balance_after == null ? undefined : Number(data.balance_after),
  };
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
