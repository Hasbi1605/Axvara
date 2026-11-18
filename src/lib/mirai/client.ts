/** Server-only MiraiAPI transport. Redirects never receive credentials and keys/codes are never logged. */
export const MIRAI_DEFAULT_BASE_URL = "https://api.miraiapi.com/api/reseller/v1";
export const MIRAI_DEFAULT_TIMEOUT_MS = 15_000;
export const MIRAI_MAX_RETRY_AFTER_SECONDS = 3600;

export const isMiraiEnabled = () => process.env.MIRAI_ENABLED === "true";
export const isMiraiSyncEnabled = () => isMiraiEnabled() && process.env.MIRAI_SYNC_ENABLED === "true";
export const getMiraiApiKey = () => (process.env.MIRAI_API_KEY || "").trim();
export const getMiraiBaseUrl = () => (process.env.MIRAI_BASE_URL || MIRAI_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");

export function isMiraiConfigured(): boolean {
  if (!isMiraiEnabled() || !getMiraiApiKey()) return false;
  try {
    const u = new URL(getMiraiBaseUrl());
    return u.protocol === "https:" && !!u.hostname && !u.username && !u.password && !u.search && !u.hash;
  } catch {
    return false;
  }
}

export const isMiraiDispatchEnabled = () => isMiraiConfigured() && isMiraiSyncEnabled();

export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const numeric = (v: unknown): number | null => {
  if (typeof v !== "number" && !(typeof v === "string" && v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const validMiraiPackageCode = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(v);
export const validMiraiExternalOrderId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);

export function parseRetryAfterSeconds(headerValue: string | null, now = Date.now()): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed) return null;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const sec = Number(trimmed);
    if (!Number.isFinite(sec) || sec <= 0) return null;
    return Math.min(MIRAI_MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(sec)));
  }
  const ts = Date.parse(trimmed);
  if (!Number.isFinite(ts)) return null;
  const diffSec = Math.ceil((ts - now) / 1000);
  if (diffSec <= 0) return null;
  return Math.min(MIRAI_MAX_RETRY_AFTER_SECONDS, diffSec);
}

export type MiraiRawResponse = {
  status: number;
  text: string;
  retryAfterSeconds: number | null;
};

export type MiraiReadResult<T = unknown> =
  | { kind: "ok"; status: number; json: unknown; data: T }
  | { kind: "config"; reason: string }
  | { kind: "ambiguous"; reason: string; retryAfterSeconds?: number | null }
  | { kind: "http_error"; status: number };

export type MiraiBalance = {
  balance_vnd: number;
  tier: string | null;
  discount_bps: number | null;
};

export type MiraiPackage = {
  code: string;
  group: string;
  name: string;
  quota_tokens: number;
  duration_seconds: number;
  reseller_price_vnd: number;
  retail_price_vnd: number | null;
  discount_bps: number;
  min_quantity: number;
  max_quantity: number;
  preset_quantities: number[];
  models: string[];
  unlimited: boolean;
  remaining_today: number;
  custom_quantity: boolean;
};

function authHeaders(withBody = false, idempotencyKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${getMiraiApiKey()}`,
    accept: "application/json",
    "user-agent": "Axvara/1.0",
  };
  if (withBody) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return headers;
}

export async function miraiRawGet(path: string): Promise<MiraiRawResponse> {
  if (!isMiraiConfigured()) throw new Error("not_configured");
  if (!/^\/(balance|packages|orders\/[A-Za-z0-9_-]{1,200})$/.test(path)) {
    throw new Error("invalid_path");
  }
  const res = await fetch(`${getMiraiBaseUrl()}${path}`, {
    method: "GET",
    headers: authHeaders(false),
    redirect: "manual",
    signal: AbortSignal.timeout(MIRAI_DEFAULT_TIMEOUT_MS),
  });
  return {
    status: res.status,
    text: await res.text(),
    retryAfterSeconds: res.status === 429 ? parseRetryAfterSeconds(res.headers?.get("retry-after") ?? null) : null,
  };
}

async function callMiraiReadRaw(path: string): Promise<MiraiReadResult<unknown>> {
  if (!isMiraiConfigured()) return { kind: "config", reason: "not_configured" };
  try {
    const r = await miraiRawGet(path);
    if (r.status === 401 || r.status === 403 || (r.status >= 300 && r.status < 400)) {
      return { kind: "config", reason: `http_${r.status}` };
    }
    if (r.status === 429) {
      return { kind: "ambiguous", reason: "http_429", retryAfterSeconds: r.retryAfterSeconds };
    }
    if (r.status >= 500) {
      return { kind: "ambiguous", reason: `http_${r.status}` };
    }
    if (r.status < 200 || r.status >= 300) {
      return { kind: "http_error", status: r.status };
    }
    try {
      const json: unknown = JSON.parse(r.text);
      return { kind: "ok", status: r.status, json, data: json };
    } catch {
      return { kind: "ambiguous", reason: "invalid_json" };
    }
  } catch {
    return { kind: "ambiguous", reason: "network_or_timeout" };
  }
}

export function parseMiraiBalance(v: unknown): MiraiBalance | null {
  if (!record(v) || v.success !== true || !record(v.data)) return null;
  const balanceVnd = numeric(v.data.balance_vnd);
  if (balanceVnd === null || balanceVnd < 0) return null;
  let discountBps: number | null = null;
  if (v.data.discount_bps != null) {
    const bps = numeric(v.data.discount_bps);
    if (bps === null || !Number.isSafeInteger(bps) || bps < 0 || bps > 10000) return null;
    discountBps = bps;
  }
  const tier = typeof v.data.tier === "string" && v.data.tier.trim() ? v.data.tier.trim() : null;
  return { balance_vnd: balanceVnd, tier, discount_bps: discountBps };
}

export function parseMiraiPackage(v: unknown): MiraiPackage | null {
  if (!record(v) || !validMiraiPackageCode(v.code)) return null;
  if (typeof v.group !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(v.group.trim())) return null;
  if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 300) return null;
  const quotaTokens = numeric(v.quota_tokens);
  const durationSeconds = numeric(v.duration_seconds);
  const resellerPriceVnd = numeric(v.reseller_price_vnd);
  if (
    quotaTokens === null || !Number.isSafeInteger(quotaTokens) || quotaTokens <= 0 ||
    durationSeconds === null || !Number.isSafeInteger(durationSeconds) || durationSeconds <= 0 ||
    resellerPriceVnd === null || !Number.isSafeInteger(resellerPriceVnd) || resellerPriceVnd <= 0
  ) {
    return null;
  }
  let retailPriceVnd: number | null = null;
  if (v.retail_price_vnd != null) {
    const retail = numeric(v.retail_price_vnd);
    if (retail === null || !Number.isSafeInteger(retail) || retail <= 0) return null;
    retailPriceVnd = retail;
  }
  let discountBps = 0;
  if (v.discount_bps != null) {
    const bps = numeric(v.discount_bps);
    if (bps === null || !Number.isSafeInteger(bps) || bps < 0 || bps > 10000) return null;
    discountBps = bps;
  }
  const minQty = v.min_quantity == null ? 1 : numeric(v.min_quantity);
  const maxQty = v.max_quantity == null ? 10000 : numeric(v.max_quantity);
  if (
    minQty === null || !Number.isSafeInteger(minQty) || minQty < 1 ||
    maxQty === null || !Number.isSafeInteger(maxQty) || maxQty < minQty
  ) {
    return null;
  }
  if (typeof v.unlimited !== "boolean") return null;
  const remainingToday = v.remaining_today == null ? 0 : numeric(v.remaining_today);
  if (remainingToday === null || !Number.isSafeInteger(remainingToday) || remainingToday < 0) return null;

  const presetQuantities: number[] = [];
  if (v.preset_quantities != null) {
    if (!Array.isArray(v.preset_quantities)) return null;
    for (const q of v.preset_quantities) {
      const n = numeric(q);
      if (n === null || !Number.isSafeInteger(n) || n < 1) return null;
      presetQuantities.push(n);
    }
  }
  const models: string[] = [];
  if (v.models != null) {
    if (!Array.isArray(v.models)) return null;
    for (const m of v.models) {
      if (typeof m !== "string" || !m.trim() || m.length > 160) return null;
      models.push(m.trim());
    }
  }
  const customQuantity = v.custom_quantity == null ? true : v.custom_quantity;
  if (typeof customQuantity !== "boolean") return null;

  return {
    code: v.code,
    group: v.group.trim().toLowerCase(),
    name: v.name.trim(),
    quota_tokens: quotaTokens,
    duration_seconds: durationSeconds,
    reseller_price_vnd: resellerPriceVnd,
    retail_price_vnd: retailPriceVnd,
    discount_bps: discountBps,
    min_quantity: minQty,
    max_quantity: maxQty,
    preset_quantities: presetQuantities,
    models,
    unlimited: v.unlimited,
    remaining_today: remainingToday,
    custom_quantity: customQuantity,
  };
}

export function parseMiraiPackages(v: unknown): MiraiPackage[] | null {
  if (!record(v) || v.success !== true || !Array.isArray(v.data)) return null;
  const items = v.data.map(parseMiraiPackage);
  if (items.some((p) => !p)) return null;
  const parsed = items as MiraiPackage[];
  if (new Set(parsed.map((p) => p.code)).size !== parsed.length) return null;
  return parsed;
}

export type MiraiBalanceResult =
  | (MiraiBalance & { kind: "ok"; status: number; json: unknown; data: MiraiBalance })
  | { kind: "config"; reason: string }
  | { kind: "ambiguous"; reason: string; retryAfterSeconds?: number | null }
  | { kind: "http_error"; status: number };

export async function fetchMiraiBalance(): Promise<MiraiBalanceResult> {
  const res = await callMiraiReadRaw("/balance");
  if (res.kind !== "ok") return res;
  const parsed = parseMiraiBalance(res.json);
  if (!parsed) return { kind: "ambiguous", reason: "invalid_balance_shape" };
  return { kind: "ok", status: res.status, json: res.json, data: parsed, ...parsed };
}

export async function fetchMiraiPackages(): Promise<MiraiReadResult<MiraiPackage[]>> {
  const res = await callMiraiReadRaw("/packages");
  if (res.kind !== "ok") return res as MiraiReadResult<MiraiPackage[]>;
  const parsed = parseMiraiPackages(res.json);
  if (!parsed) return { kind: "ambiguous", reason: "invalid_catalog_shape" };
  return { kind: "ok", status: res.status, json: res.json, data: parsed };
}

export type MiraiOrderRequest = {
  external_order_id: string;
  package_code: string;
  quantity: number;
};

/** Send POST /orders returning raw text + status so callers encrypt the body before parsing. */
export async function createMiraiOrder(
  body: MiraiOrderRequest,
  idempotencyKey = body.external_order_id,
): Promise<MiraiRawResponse> {
  if (!isMiraiConfigured()) throw new Error("not_configured");
  if (
    !validMiraiExternalOrderId(body.external_order_id) ||
    !validMiraiExternalOrderId(idempotencyKey) ||
    !validMiraiPackageCode(body.package_code) ||
    !Number.isSafeInteger(body.quantity) ||
    body.quantity < 1 ||
    body.quantity > 10000
  ) {
    throw new Error("invalid_purchase");
  }
  const res = await fetch(`${getMiraiBaseUrl()}/orders`, {
    method: "POST",
    headers: authHeaders(true, idempotencyKey),
    body: JSON.stringify({
      external_order_id: body.external_order_id,
      package_code: body.package_code,
      quantity: body.quantity,
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(MIRAI_DEFAULT_TIMEOUT_MS),
  });
  return {
    status: res.status,
    text: await res.text(),
    retryAfterSeconds: res.status === 429 ? parseRetryAfterSeconds(res.headers?.get("retry-after") ?? null) : null,
  };
}

/** Lookup order by external_order_id returning raw text + status for recovery. */
export async function getMiraiOrder(externalOrderId: string): Promise<MiraiRawResponse> {
  if (!validMiraiExternalOrderId(externalOrderId)) throw new Error("invalid_order_id");
  return miraiRawGet(`/orders/${encodeURIComponent(externalOrderId)}`);
}
