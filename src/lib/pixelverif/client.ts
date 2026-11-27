/** Server-only Pixel Verification transport. X-API-Key header only server-side; never log key/body. */
export const PIXELVERIF_DEFAULT_BASE_URL = "https://api.pixelverification.me";
export const PIXELVERIF_DEFAULT_TIMEOUT_MS = 15_000;
export const PIXELVERIF_MAX_RETRY_AFTER_SECONDS = 3600;

export const isPixelverifEnabled = () => process.env.PIXELVERIF_ENABLED === "true";
export const isPixelverifSyncEnabled = () => isPixelverifEnabled() && process.env.PIXELVERIF_SYNC_ENABLED === "true";
export const getPixelverifApiKey = () => (process.env.PIXELVERIF_API_KEY || "").trim();
export const getPixelverifBaseUrl = () => (process.env.PIXELVERIF_API_BASE_URL || PIXELVERIF_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");

export function isPixelverifConfigured(): boolean {
  if (!isPixelverifEnabled() || !getPixelverifApiKey()) return false;
  try {
    const u = new URL(getPixelverifBaseUrl());
    return u.protocol === "https:" && !!u.hostname && !u.username && !u.password && !u.search && !u.hash;
  } catch {
    return false;
  }
}

export const isPixelverifDispatchEnabled = () => isPixelverifConfigured() && isPixelverifSyncEnabled();

export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const numeric = (v: unknown): number | null => {
  if (typeof v !== "number" && !(typeof v === "string" && v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function parseRetryAfterSeconds(headerValue: string | null, now = Date.now()): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed) return null;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const sec = Number(trimmed);
    if (!Number.isFinite(sec) || sec <= 0) return null;
    return Math.min(PIXELVERIF_MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(sec)));
  }
  const ts = Date.parse(trimmed);
  if (!Number.isFinite(ts)) return null;
  const diffSec = Math.ceil((ts - now) / 1000);
  if (diffSec <= 0) return null;
  return Math.min(PIXELVERIF_MAX_RETRY_AFTER_SECONDS, diffSec);
}

function parseRetryAfterFromBody(v: unknown): number | null {
  if (!record(v)) return null;
  const n = numeric(v.retry_after_seconds ?? v.retryAfterSeconds);
  if (n === null || !Number.isFinite(n) || n <= 0) return null;
  return Math.min(PIXELVERIF_MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(n)));
}

export type PixelverifRawResponse = {
  status: number;
  text: string;
  retryAfterSeconds: number | null;
};

export type PixelverifReadResult<T = unknown> =
  | { kind: "ok"; status: number; json: unknown; data: T }
  | { kind: "config"; reason: string }
  | { kind: "ambiguous"; reason: string; retryAfterSeconds?: number | null }
  | { kind: "http_error"; status: number };

export type PixelverifPricing = {
  version: number;
  updated_at: number;
  default_validity: number;
  allowed_validities: number[];
  pricing: Record<string, Record<string, number>>;
  disabled_plans?: string[];
};

export type PixelverifCredits = {
  credits_remaining: number;
  rate_limit?: unknown;
  total_orders?: number;
  name?: string | null;
};

export type PixelverifOrderResult = {
  order_id: string;
  email: string;
  status: string;
  queue_position?: number | null;
  flow_type: string;
  validity: number;
  credit_cost: number;
  /** Provider sends epoch milliseconds (README); ISO strings tolerated. */
  created_at?: string | number | null;
  started_at?: string | number | null;
  completed_at?: string | number | null;
  result?: { link?: string | null; link_type?: string | null; retries_used?: number | null } | null;
  error?: { code?: string | null; message?: string | null; step?: number | string | null; user_message?: string | null } | null;
  progress?: { current_step?: number | null; total_steps?: number | null; step_label?: string | null; status?: string | null } | null;
  credit_refunded?: boolean | null;
  activation_status?: string | null;
};

function authHeaders(withBody = false, idempotencyKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "x-api-key": getPixelverifApiKey(),
    accept: "application/json",
    "user-agent": "Axvara/1.0",
  };
  if (withBody) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
  return headers;
}

export async function pixelverifRawGet(path: string): Promise<PixelverifRawResponse> {
  if (!isPixelverifConfigured() && !path.startsWith("/api/pricing") && !path.startsWith("/api/health")) {
    throw new Error("not_configured");
  }
  const url = `${getPixelverifBaseUrl()}${path}`;
  const headers: Record<string, string> =
    path.startsWith("/api/pricing") || path.startsWith("/api/health")
      ? { accept: "application/json", "user-agent": "Axvara/1.0" }
      : authHeaders(false);
  const res = await fetch(url, {
    method: "GET",
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(PIXELVERIF_DEFAULT_TIMEOUT_MS),
  });
  let retryAfterSeconds: number | null = null;
  if (res.status === 429) {
    retryAfterSeconds = parseRetryAfterSeconds(res.headers?.get("retry-after") ?? null);
    if (retryAfterSeconds === null) {
      try {
        const bodyText = await res.clone().text();
        const bodyJson: unknown = JSON.parse(bodyText);
        retryAfterSeconds = parseRetryAfterFromBody(bodyJson);
      } catch {
        // ignore
      }
    }
    // need to re-read body after clone
    const text = await res.text();
    return { status: res.status, text, retryAfterSeconds };
  }
  return {
    status: res.status,
    text: await res.text(),
    retryAfterSeconds,
  };
}

async function callPixelverifReadRaw(path: string, opts: { auth: boolean }): Promise<PixelverifReadResult<unknown>> {
  if (opts.auth && !isPixelverifConfigured()) return { kind: "config", reason: "not_configured" };
  try {
    const r = await pixelverifRawGet(path);
    if (r.status === 401 || r.status === 403 || (r.status >= 300 && r.status < 400)) {
      return { kind: "config", reason: `http_${r.status}` };
    }
    if (r.status === 429) {
      return { kind: "ambiguous", reason: "http_429", retryAfterSeconds: r.retryAfterSeconds ?? parseRetryAfterFromBody(tryParseJson(r.text)) ?? 60 };
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

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parsePixelverifPricing(v: unknown): PixelverifPricing | null {
  if (!record(v) || v.success !== true) return null;
  const version = numeric(v.version);
  const updated_at = numeric(v.updated_at);
  if (version === null || !Number.isSafeInteger(version) || version < 0) return null;
  if (updated_at === null || !Number.isFinite(updated_at) || updated_at < 0) return null;
  if (!Array.isArray(v.allowed_validities)) return null;
  const allowed_validities = v.allowed_validities.map((x) => numeric(x)).filter((n): n is number => n !== null && Number.isSafeInteger(n) && n > 0);
  if (!record(v.pricing)) return null;
  const pricing: Record<string, Record<string, number>> = {};
  for (const [flow, map] of Object.entries(v.pricing)) {
    if (!record(map)) return null;
    pricing[flow] = {};
    for (const [k, val] of Object.entries(map)) {
      const n = numeric(val);
      if (n === null || !Number.isFinite(n)) return null;
      pricing[flow][k] = n;
    }
  }
  const disabled = v.disabled_plans;
  if (disabled !== undefined && (!Array.isArray(disabled) || disabled.some((plan) => typeof plan !== "string" || !plan.trim()))) return null;
  const disabled_plans = Array.isArray(disabled) ? disabled.map((plan: string) => plan.trim().toLowerCase()) : undefined;
  // An empty allowed_validities array is only valid when upstream explicitly publishes disabled_plans
  // (e.g. v33 when all plans are temporarily disabled) and allowed_validities contains no malformed items.
  if (allowed_validities.length === 0 && (v.allowed_validities.length > 0 || !disabled_plans?.length)) return null;
  return {
    version,
    updated_at,
    default_validity: numeric(v.default_validity) ?? 3,
    allowed_validities,
    pricing,
    ...(disabled_plans ? { disabled_plans } : {}),
  };
}

export function parsePixelverifCredits(v: unknown): PixelverifCredits | null {
  if (!record(v) || v.success !== true) return null;
  const credits_remaining = numeric(v.credits_remaining);
  if (credits_remaining === null || !Number.isFinite(credits_remaining) || credits_remaining < 0) return null;
  return {
    credits_remaining,
    rate_limit: v.rate_limit,
    total_orders: numeric(v.total_orders) ?? undefined,
    name: typeof v.name === "string" ? v.name : null,
  };
}

export function parsePixelverifOrder(v: unknown): PixelverifOrderResult | null {
  if (!record(v) || v.success !== true || !record(v.order)) return null;
  const o = v.order as Record<string, unknown>;
  const order_id = typeof o.order_id === "string" && o.order_id.trim() ? o.order_id.trim() : null;
  const email = typeof o.email === "string" ? o.email.trim() : null;
  const status = typeof o.status === "string" ? o.status.trim() : null;
  const flow_type = typeof o.flow_type === "string" ? o.flow_type.trim() : null;
  const validity = numeric(o.validity);
  const credit_cost = numeric(o.credit_cost);
  if (!order_id || !email || !status || !flow_type || validity === null || credit_cost === null) return null;
  // activation_status may be at order.activation_status or order.result.activation_status.
  // Only the provider's known vocabulary is kept: arbitrary echoed text must
  // never reach buyer delivery, receipts, or admin reveal verbatim.
  const KNOWN_ACTIVATION = new Set(["activated", "already_redeemed", "item_not_available", "failed", "invalid", "error"]);
  let activation_status: string | null = null;
  const rawActivation = typeof o.activation_status === "string" && o.activation_status.trim()
    ? o.activation_status.trim().toLowerCase()
    : record(o.result) && typeof o.result.activation_status === "string" && o.result.activation_status.trim()
      ? String(o.result.activation_status).trim().toLowerCase()
      : null;
  if (rawActivation && KNOWN_ACTIVATION.has(rawActivation)) activation_status = rawActivation;
  return {
    order_id,
    email,
    status,
    queue_position: numeric(o.queue_position) ?? null,
    flow_type,
    validity,
    credit_cost,
    created_at: typeof o.created_at === "string" || (typeof o.created_at === "number" && Number.isFinite(o.created_at)) ? o.created_at : null,
    started_at: typeof o.started_at === "string" || (typeof o.started_at === "number" && Number.isFinite(o.started_at)) ? o.started_at : null,
    completed_at: typeof o.completed_at === "string" || (typeof o.completed_at === "number" && Number.isFinite(o.completed_at)) ? o.completed_at : null,
    result: record(o.result) ? (o.result as PixelverifOrderResult["result"]) : null,
    error: record(o.error) ? (o.error as PixelverifOrderResult["error"]) : null,
    progress: record(o.progress) ? (o.progress as PixelverifOrderResult["progress"]) : null,
    credit_refunded: typeof o.credit_refunded === "boolean" ? o.credit_refunded : null,
    activation_status,
  };
}

export function parsePixelverifOrderByEmail(v: unknown): PixelverifOrderResult | null {
  if (!record(v) || v.success !== true) return null;
  if (v.order === null) return null;
  return parsePixelverifOrder(v);
}

export async function fetchPixelverifPricing(): Promise<PixelverifReadResult<PixelverifPricing>> {
  // public endpoint — never send key, never require config
  try {
    const url = `${getPixelverifBaseUrl()}/api/pricing`;
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": "Axvara/1.0" },
      redirect: "manual",
      signal: AbortSignal.timeout(PIXELVERIF_DEFAULT_TIMEOUT_MS),
    });
    const text = await res.text();
    let retryAfterSeconds: number | null = null;
    if (res.status === 429) {
      retryAfterSeconds = parseRetryAfterSeconds(res.headers?.get("retry-after") ?? null);
      if (retryAfterSeconds === null) retryAfterSeconds = parseRetryAfterFromBody(tryParseJson(text)) ?? 60;
      return { kind: "ambiguous", reason: "http_429", retryAfterSeconds };
    }
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
      return { kind: "config", reason: `http_${res.status}` };
    }
    if (res.status >= 500) return { kind: "ambiguous", reason: `http_${res.status}` };
    if (res.status < 200 || res.status >= 300) return { kind: "http_error", status: res.status };
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { kind: "ambiguous", reason: "invalid_json" };
    }
    const parsed = parsePixelverifPricing(json);
    if (!parsed) return { kind: "ambiguous", reason: "invalid_pricing_shape" };
    return { kind: "ok", status: res.status, json, data: parsed };
  } catch {
    return { kind: "ambiguous", reason: "network_or_timeout" };
  }
}

export async function fetchPixelverifCredits(): Promise<PixelverifReadResult<PixelverifCredits>> {
  const res = await callPixelverifReadRaw("/api/credits", { auth: true });
  if (res.kind !== "ok") return res as PixelverifReadResult<PixelverifCredits>;
  const parsed = parsePixelverifCredits(res.json);
  if (!parsed) return { kind: "ambiguous", reason: "invalid_credits_shape" };
  return { kind: "ok", status: res.status, json: res.json, data: parsed };
}

export type CreatePixelverifOrderBody = {
  email: string;
  password: string;
  totp_secret: string;
  flow_type: "normal" | "full";
  validity: 3;
};

export async function createPixelverifOrder(
  body: CreatePixelverifOrderBody,
  idempotencyKey: string,
): Promise<PixelverifRawResponse> {
  if (!isPixelverifConfigured()) throw new Error("not_configured");
  if (
    typeof body.email !== "string" || !body.email.trim() ||
    typeof body.password !== "string" || !body.password ||
    typeof body.totp_secret !== "string" || !body.totp_secret.trim() ||
    (body.flow_type !== "normal" && body.flow_type !== "full") ||
    body.validity !== 3 ||
    typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 200
  ) {
    throw new Error("invalid_purchase");
  }
  const res = await fetch(`${getPixelverifBaseUrl()}/api/order`, {
    method: "POST",
    headers: authHeaders(true, idempotencyKey),
    body: JSON.stringify({
      email: body.email,
      password: body.password,
      totp_secret: body.totp_secret,
      flow_type: body.flow_type,
      validity: body.validity,
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(PIXELVERIF_DEFAULT_TIMEOUT_MS),
  });
  const text = await res.text();
  let retryAfterSeconds: number | null = null;
  if (res.status === 429) {
    retryAfterSeconds = parseRetryAfterSeconds(res.headers?.get("retry-after") ?? null);
    if (retryAfterSeconds === null) retryAfterSeconds = parseRetryAfterFromBody(tryParseJson(text)) ?? 60;
  }
  return { status: res.status, text, retryAfterSeconds };
}

export async function getPixelverifOrder(providerOrderId: string): Promise<PixelverifRawResponse> {
  if (typeof providerOrderId !== "string" || !providerOrderId.trim() || providerOrderId.length > 200) {
    throw new Error("invalid_order_id");
  }
  return pixelverifRawGet(`/api/order/${encodeURIComponent(providerOrderId.trim())}`);
}

export async function findPixelverifOrderByEmail(email: string): Promise<PixelverifRawResponse> {
  if (typeof email !== "string" || !email.trim()) throw new Error("invalid_email");
  return pixelverifRawGet(`/api/order-by-email?email=${encodeURIComponent(email.trim())}`);
}
