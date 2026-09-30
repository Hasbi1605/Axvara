// src/lib/sekalipay/client.ts — Low-level HTTP client ke Sekalipay Reseller API.
// Edge-compatible: hanya fetch() + Web Crypto, tanpa Node-only API.
//
// Pola mengikuti src/lib/warung-rebahan/client.ts (proxy + timeout +
// klasifikasi error) dengan 2 perbedaan kontrak upstream:
//  1. Auth SK = header `X-APIKEY` (WR = body api_key). Key SK disuntik
//     server-side oleh proxy Heroku (SK_API_KEY dyno); Pages TIDAK menyimpan
//     key SK sama sekali — sama seperti Pages tidak menyimpan key WR.
//  2. Baca SK = GET dengan query string (WR = POST semua). Tulis = POST JSON.
//     Proxy meneruskan method+query+body apa adanya di bawah prefix /v1/.
//
// Fase 1 hanya memakai: GET /v1/balance, GET /v1/item (full + delta sync),
// GET /v1/item/{id}, POST /v1/order/sandbox. POST /v1/trx (order prod)
// dibuka setelah uji sandbox hijau + whitelist IP + webhook aktif.

export type SkOrderProcess = "auto" | "manual" | "h2h" | "smm" | "vip";

export type SkRequiredField = {
  key: string;
  label: string;
  required?: boolean;
  min?: number;
  max?: number;
};

export type SkValidation = {
  available: boolean;
  endpoint?: string | null;
  requires_zone_id?: boolean;
  fields?: { key: string; label: string; required?: boolean }[];
};

export type SkVariant = {
  id: number;
  sku: string;
  name: string;
  price: number;
  stock: number;
  order_process: SkOrderProcess;
  h2h_provider: string | null;
  provider_meta: Record<string, unknown> | null;
  required_fields: SkRequiredField[] | null;
  validation: SkValidation | null;
  updated_at: string | null;
  // Field live dari API (dipakai sync + panel admin):
  min_order?: number | null;
  status?: string | null;
  description?: string | null;
  product_type?: { id: number; name: string } | null;
};

export type SkProduct = {
  id: number;
  name: string;
  image: string | null;
  variants: SkVariant[];
  [key: string]: unknown;
};

export type SkCategory = {
  id: number;
  name: string;
  icon: string | null;
  products: SkProduct[];
  [key: string]: unknown;
};

export type SkItemsResponse = {
  message: string;
  data: SkCategory[];
  meta: { total_items: number; is_delta: boolean };
  server_time: string;
};

export type SkBalance = {
  balance: number;
  currency?: string;
  [key: string]: unknown;
};

export type SkCreateTrxResult = {
  invoice: string;
  ref_id: string;
  status: string;
  price: number;
  fees: number;
  amount: number;
  contact?: string | null;
  created_at?: string;
  [key: string]: unknown;
};

export type SkTrxDetail = {
  id: number;
  ref_id: string;
  invoice: string;
  payment_method: string;
  status: string;
  price: number;
  fees: number | null;
  amount: number;
  items: {
    variant_id: number;
    variant_name: string;
    product_name: string;
    product_license: string | null;
    seller_note: string | null;
    price: number;
    qty: number;
    note: string | null;
    order_process: SkOrderProcess;
    [key: string]: unknown;
  }[];
  h2h_results: unknown[];
  smm_results: unknown[];
  [key: string]: unknown;
};

/** Event webhook SK (docs /webhook/events). Fase 1 hanya auto → completed/canceled. */
export type SkWebhookEvent = {
  event: "order.paid" | "order.completed" | "order.canceled" | "order.item.sent" | "webhook.test";
  timestamp: string;
  data: {
    invoice: string;
    ref_id: string;
    status?: string;
    transaction_status?: string;
    price?: number;
    fees?: number;
    amount?: number;
    items?: {
      variant_id: number;
      variant_name: string;
      product_name: string;
      seller_note: string | null;
      order_process: SkOrderProcess;
      quantity: number;
      price: number;
      note: string | null;
      status: string;
      licenses?: { product_license: string; note: string | null }[] | null;
      h2h_results?: unknown;
      smm_results?: unknown;
      target?: string | null;
      [key: string]: unknown;
    }[];
    item?: {
      order_item_id: string;
      variant_id: number;
      variant_name: string;
      product_name: string;
      order_process: SkOrderProcess;
      quantity: number;
      price: number;
      note: string | null;
      status: string;
      licenses?: { product_license: string; note: string | null }[] | null;
      sent_at?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
};

export class SkApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string,
    public responseBody?: unknown,
  ) {
    super(message);
    this.name = "SkApiError";
  }
}

/** Saldo SK habis — link masuk blocked_balance (pulih otomatis via reconcile). */
export class SkInsufficientBalanceError extends SkApiError {
  constructor(message: string, endpoint: string, responseBody?: unknown) {
    super(message, 402, endpoint, responseBody);
    this.name = "SkInsufficientBalanceError";
  }
}

/** Stok SK habis — varian di-nol-kan, order jangan retry buta. */
export class SkOutOfStockError extends SkApiError {
  constructor(message: string, endpoint: string, responseBody?: unknown) {
    super(message, 409, endpoint, responseBody);
    this.name = "SkOutOfStockError";
  }
}

/** Timeout/network — hasil ambigu, hanya reconcile (jangan beli ulang buta). */
export class SkNetworkError extends Error {
  constructor(message: string, public endpoint: string) {
    super(message);
    this.name = "SkNetworkError";
  }
}

/** Produk ditolak di depan (503 PRODUCT_TEMPORARILY_UNAVAILABLE): saldo TIDAK
 *  terpotong — aman retry/fallback, jangan tandai failed permanen langsung. */
export class SkTemporarilyUnavailableError extends SkApiError {
  constructor(message: string, endpoint: string, responseBody?: unknown) {
    super(message, 503, endpoint, responseBody);
    this.name = "SkTemporarilyUnavailableError";
  }
}

// Timeout per panggilan SK — sama dengan WR (12 dtk): satu invocation cron
// merangkai beberapa panggilan dan plafon platform ~125 dtk.
export const SK_API_TIMEOUT_MS = 12_000;
// Outbound langsung HANYA ke host ini (SSRF-safe). Produksi WAJIB lewat proxy
// Heroku (egress statis yang di-whitelist SK); mode langsung hanya dev lokal.
const SK_ALLOWED_HOST = "sekalipay.com";

export function isSkEnabled(): boolean {
  return process.env.SEKALIPAY_ENABLED === "true";
}

export function isSkSyncEnabled(): boolean {
  return isSkEnabled() && process.env.SEKALIPAY_SYNC_ENABLED !== "false";
}

export function isSkAutoOrderEnabled(): boolean {
  return isSkEnabled() && process.env.SEKALIPAY_AUTO_ORDER_ENABLED === "true";
}

export function isSkSandbox(): boolean {
  return process.env.SEKALIPAY_SANDBOX === "true";
}

/**
 * Mode proxy (produksi): seluruh panggilan SK lewat proxy Heroku yang IP-nya
 * di-whitelist di dashboard SK. Kosong = mode langsung ke sekalipay.com
 * (butuh IP Pages di-whitelist — tidak realistis, hanya dev/test lokal).
 */
export function getSkProxyUrl(): string {
  return (process.env.SEKALIPAY_PROXY_URL || "").trim().replace(/\/+$/, "");
}

function getSkProxyToken(): string {
  const token = process.env.SEKALIPAY_PROXY_TOKEN?.trim();
  if (!token) throw new Error("SEKALIPAY_PROXY_TOKEN not configured");
  return token;
}

export function getSkBaseUrl(): string {
  return (process.env.SEKALIPAY_BASE_URL?.trim() || "https://sekalipay.com/api").replace(/\/+$/, "");
}

function assertAllowedUrl(url: string, endpoint: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SkNetworkError("invalid_sk_url", endpoint);
  }
  const host = parsed.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocal) {
    throw new SkNetworkError("sk_insecure_protocol", endpoint);
  }
  if (host === SK_ALLOWED_HOST || host.endsWith(`.${SK_ALLOWED_HOST}`)) return;
  const proxyUrl = getSkProxyUrl();
  if (proxyUrl) {
    try {
      const proxyHost = new URL(proxyUrl).hostname.toLowerCase();
      if (host === proxyHost) return;
    } catch {
      throw new SkNetworkError("invalid_sk_proxy_url", endpoint);
    }
  }
  throw new SkNetworkError("sk_host_not_allowed", endpoint);
}

export function classifySkError(
  message: string,
  status: number,
  endpoint: string,
  body?: unknown,
): SkApiError {
  const lowered = String(message || "");
  if (lowered === "BALANCE_IS_INSUFFICIENT" || /saldo|balance|insufficient/i.test(lowered)) {
    return new SkInsufficientBalanceError(message, endpoint, body);
  }
  if (lowered === "OUT_OF_STOCK" || /(^|[^a-z])(stok|stock)([^a-z]|$)/i.test(lowered)) {
    return new SkOutOfStockError(message, endpoint, body);
  }
  if (lowered === "PRODUCT_TEMPORARILY_UNAVAILABLE" || status === 503) {
    return new SkTemporarilyUnavailableError(message, endpoint, body);
  }
  return new SkApiError(message, status, endpoint, body);
}

type SkRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Query string untuk GET (diteruskan ke proxy). */
  query?: Record<string, string | number>;
  body?: Record<string, unknown>;
};

/**
 * Satu pintu HTTP ke SK. Mode proxy: {GET,POST,PUT} https://<proxy>/sk/<path>
 * + x-proxy-token (API key disuntik proxy dari env dyno). Mode langsung:
 * ke sekalipay.com + header X-APIKEY dari SEKALIPAY_API_KEY (dev lokal saja).
 */
export async function skFetch<T>(path: string, options: SkRequestOptions = {}): Promise<T> {
  const method = options.method ?? (options.body ? "POST" : "GET");
  const cleanPath = path.replace(/^\/+/, "");
  const endpoint = `${method} ${cleanPath}`;
  const proxyUrl = getSkProxyUrl();
  let url: string;
  if (proxyUrl) {
    url = `${proxyUrl}/sk/${cleanPath}`;
  } else {
    const apiKey = process.env.SEKALIPAY_API_KEY?.trim();
    if (!apiKey) throw new Error("SEKALIPAY_API_KEY not configured");
    url = `${getSkBaseUrl()}/${cleanPath}`;
    void apiKey;
  }
  if (options.query && Object.keys(options.query).length > 0) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(options.query).map(([k, v]) => [k, String(v)])),
    ).toString();
    url += (url.includes("?") ? "&" : "?") + qs;
  }
  assertAllowedUrl(url, endpoint);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (proxyUrl) {
    headers["x-proxy-token"] = getSkProxyToken();
  } else {
    headers["X-APIKEY"] = process.env.SEKALIPAY_API_KEY?.trim() || "";
  }
  let bodyText: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    bodyText = JSON.stringify(options.body);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SK_API_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, headers, body: bodyText, signal: controller.signal });
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok || json == null || typeof json !== "object") {
      const message =
        (json != null && typeof json === "object" && typeof (json as { message?: unknown }).message === "string"
          ? String((json as { message: string }).message)
          : `SK request failed (${res.status})`) || `SK request failed (${res.status})`;
      throw classifySkError(message, res.status, endpoint, json ?? undefined);
    }
    return json as T;
  } catch (error) {
    if (error instanceof SkApiError) throw error;
    if (error instanceof SkNetworkError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new SkNetworkError("sk_request_timeout", endpoint);
    }
    throw new SkNetworkError(error instanceof Error ? error.message : "sk_request_failed", endpoint);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSkBalance(): Promise<SkBalance> {
  const res = await skFetch<{ message?: string; data?: SkBalance; balance?: number }>("v1/balance");
  // Normalisasi: dukung {data:{balance}} maupun {balance} langsung.
  if (res && typeof res === "object") {
    if (res.data && typeof res.data.balance === "number") return res.data;
    if (typeof res.balance === "number") return { balance: res.balance };
  }
  return res as SkBalance;
}

export async function fetchSkItems(params?: {
  perPage?: number | "all";
  page?: number;
  updatedSince?: string;
  category?: string;
  search?: string;
}): Promise<SkItemsResponse> {
  const query: Record<string, string | number> = {};
  if (params?.perPage !== undefined) query.per_page = params.perPage;
  if (params?.page !== undefined) query.page = params.page;
  if (params?.updatedSince) query.updated_since = params.updatedSince;
  if (params?.category) query.category = params.category;
  if (params?.search) query.search = params.search;
  return skFetch<SkItemsResponse>("v1/item", { query });
}

/**
 * Scope hemat sync fase 1 (2026-09-30): HANYA kategori Aplikasi Premium.
 * Terbukti live: `category=Aplikasi Premium` → 99 varian / 93KB / ~3,6 dtk
 * vs full 6095 varian / 4,3MB / 11–29 dtk (sering gagal: 6x sk_request_timeout
 * 09:05–10:00 + 1x Heroku Application Error). Tanpa scope = timeout BERULANG
 * walau delta dipakai (delta all-kategori masih 2681 varian / 1,8MB / 9–29 dtk).
 * Scope bisa dilebarkan saat fase 2 (h2h/manual) — cukup ubah konstanta ini.
 */
export const SK_SYNC_CATEGORY = "Aplikasi Premium";

export async function createSkTransaction(params: {
  refId: string;
  carts: { item_id: number; quantity: number; note?: string }[];
}): Promise<SkCreateTrxResult> {
  const res = await skFetch<{ message: string; data: SkCreateTrxResult }>("v1/trx", {
    method: "POST",
    body: { ref_id: params.refId, carts: params.carts },
  });
  return res.data;
}

export async function fetchSkTransaction(refIdOrInvoice: string): Promise<SkTrxDetail> {
  const res = await skFetch<{ message: string; data: SkTrxDetail }>(
    `v1/trx/${encodeURIComponent(refIdOrInvoice)}`,
  );
  return res.data;
}

export async function createSkSandboxOrder(params: {
  refId: string;
  items: { product_id: number; variant_id: number; quantity: number; note?: string }[];
}): Promise<Record<string, unknown>> {
  return skFetch<Record<string, unknown>>("v1/order/sandbox", {
    method: "POST",
    body: { ref_id: params.refId, items: params.items },
  });
}

// ── Fitur khas SK yang tidak dimiliki WR (fase panel setara WR) ──

/** Detail satu varian: GET /v1/item/{id} (order_process + capability). */
export type SkItemDetail = {
  id: number;
  name: string;
  price: number;
  stock: number;
  order_process: SkOrderProcess;
  h2h_provider: string | null;
  provider_meta: Record<string, unknown> | null;
  required_fields: SkRequiredField[] | null;
  validation: SkValidation | null;
  description?: string | null;
  [key: string]: unknown;
};

export async function fetchSkItemDetail(variantId: number): Promise<SkItemDetail> {
  const res = await skFetch<{ message: string; data: SkItemDetail }>(
    `v1/item/${encodeURIComponent(String(variantId))}`,
  );
  return res.data;
}

/** Validasi akun (cek nickname/nama): POST /v1/item/validate. */
export type SkValidationResult = {
  display_name: string;
  account_name: string;
  region: string | null;
  cached: boolean;
  [key: string]: unknown;
};

export async function validateSkAccount(params: {
  itemId: number;
  customerId: string;
  zoneId?: string;
}): Promise<SkValidationResult> {
  const res = await skFetch<{ message: string; data: SkValidationResult }>("v1/item/validate", {
    method: "POST",
    body: {
      item_id: params.itemId,
      customer_id: params.customerId,
      ...(params.zoneId ? { zone_id: params.zoneId } : {}),
    },
  });
  return res.data;
}

/** Daftar layanan yang punya validasi aktif: GET /v1/validation/services. */
export type SkValidationService = {
  product_id: number;
  product_name: string;
  validation: SkValidation;
  variants: { item_id: number; name: string; sku: string; price: number; status: string }[];
};

export async function fetchSkValidationServices(search?: string): Promise<{
  data: SkValidationService[];
  meta: { total_products: number; total_items: number };
}> {
  return skFetch("v1/validation/services", {
    query: search ? { search } : {},
  });
}

/** Kunci stok 10 mnt anti-overselling: POST /v1/item/lock. */
export type SkStockLock = {
  lock_token: string;
  item_id: number;
  quantity: number;
  locked_at: string;
  expires_at: string;
};

export async function lockSkStock(params: {
  itemId: number;
  quantity: number;
  lockDuration?: number;
}): Promise<SkStockLock> {
  const res = await skFetch<{ success: boolean; data: SkStockLock }>("v1/item/lock", {
    method: "POST",
    body: {
      item_id: params.itemId,
      quantity: params.quantity,
      ...(params.lockDuration ? { lock_duration: params.lockDuration } : {}),
    },
  });
  return res.data;
}

/** Daftar lock aktif: GET /v1/item/lock. */
export async function listSkStockLocks(): Promise<SkStockLock[]> {
  const res = await skFetch<{ message: string; data?: SkStockLock[] | { locks: SkStockLock[] } | null }>(
    "v1/item/lock",
  ).catch((error) => {
    // Endpoint lock-list mengembalikan ITEM_NOT_FOUND saat tidak ada lock
    // aktif (bukan error) — normalisasi ke [] agar panel tetap tenang.
    if (error instanceof SkApiError && /ITEM_NOT_FOUND/i.test(error.message)) {
      return { message: "ITEM_NOT_FOUND", data: [] as SkStockLock[] };
    }
    throw error;
  });
  const data = res.data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray((data as { locks?: unknown }).locks)) {
    return (data as { locks: SkStockLock[] }).locks;
  }
  return [];
}

/** Lepas lock: DELETE /v1/item/lock/{token} (via method override proxy). */
export async function releaseSkStockLock(lockToken: string): Promise<boolean> {
  try {
    await skFetch(`v1/item/lock/${encodeURIComponent(lockToken)}`, { method: "DELETE" });
    return true;
  } catch {
    return false;
  }
}

/** Histori mutasi saldo untuk audit: GET /v1/balance/mutations. */
export type SkBalanceMutation = {
  invoice: string;
  direction: "credit" | "debit";
  type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  [key: string]: unknown;
};

export async function fetchSkBalanceMutations(params?: {
  page?: number;
  perPage?: number;
  direction?: "credit" | "debit";
  type?: string;
}): Promise<{ data: SkBalanceMutation[]; meta: Record<string, unknown> }> {
  const query: Record<string, string | number> = {};
  if (params?.page) query.page = params.page;
  if (params?.perPage) query.per_page = params.perPage;
  if (params?.direction) query.direction = params.direction;
  if (params?.type) query.type = params.type;
  return skFetch("v1/balance/mutations", { query });
}

/** Daftar transaksi SK: GET /v1/trx (audit/refund manual). */
export type SkTransactionSummary = {
  invoice: string;
  ref_id: string;
  status: string;
  price: number;
  fees: number;
  amount: number;
  activity: string;
  created_at: string;
  updated_at: string;
  expired_at: string | null;
  [key: string]: unknown;
};

export async function fetchSkTransactions(params?: {
  page?: number;
  perPage?: number;
}): Promise<{
  data: { transactions: SkTransactionSummary[]; pagination: Record<string, unknown> };
}> {
  const query: Record<string, string | number> = {};
  if (params?.page) query.page = params.page;
  if (params?.perPage) query.per_page = params.perPage;
  return skFetch("v1/trx", { query });
}

/**
 * Verifikasi signature webhook SK (docs /webhook/security):
 *   signature = SHA256(ref_id + ":" + invoice + ":" + status + ":" + secret)
 * `status` event-dependent: payload.data.status untuk
 * order.paid/completed/canceled, "item.sent" untuk order.item.sent,
 * "test" untuk webhook.test.
 */
export function skStatusForSignature(event: string, dataStatus: string | undefined): string {
  if (event === "order.item.sent") return "item.sent";
  if (event === "webhook.test") return "test";
  return dataStatus ?? "";
}

export async function computeSkSignature(
  refId: string,
  invoice: string,
  statusForSignature: string,
  secret: string,
): Promise<string> {
  const payload = `${refId}:${invoice}:${statusForSignature}:${secret}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifySkWebhookSignature(
  payload: SkWebhookEvent,
  receivedSignature: string,
): Promise<boolean> {
  try {
    const secret = process.env.SEKALIPAY_WEBHOOK_SECRET?.trim();
    if (!secret) return false;
    const refId = String(payload?.data?.ref_id || "");
    const invoice = String(payload?.data?.invoice || "");
    if (!refId || !invoice) return false;
    const statusForSig = skStatusForSignature(String(payload?.event || ""), payload?.data?.status);
    const expected = await computeSkSignature(refId, invoice, statusForSig, secret);
    const norm = receivedSignature.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(norm)) return false;
    // Perbandingan hash heksadesimal — timing-safe implisit via panjang tetap
    // + loop penuh (pola sama dengan verifyCredentialToken di WR deliver).
    if (expected.length !== norm.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ norm.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

export function skWebhookSecretConfigured(): boolean {
  return Boolean(process.env.SEKALIPAY_WEBHOOK_SECRET?.trim());
}
