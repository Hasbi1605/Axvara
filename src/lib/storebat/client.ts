/** Server-side transport. Never retry or forward credentials across a redirect. */
export const STOREBAT_DEFAULT_BASE_URL = "https://web-production-1c7b1.up.railway.app/api/reseller";
export const STOREBAT_BUFF_ID = 124;
export const isStorebatEnabled = () => process.env.STOREBAT_ENABLED === "true";
export const isStorebatSyncEnabled = () => process.env.STOREBAT_SYNC_ENABLED === "true";
const key = () => (process.env.STOREBAT_API_KEY ?? "").trim();
export const getStorebatBaseUrl = () => (process.env.STOREBAT_BASE_URL ?? STOREBAT_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
export function isStorebatConfigured() {
  if (!key()) return false;
  try {
    const u = new URL(getStorebatBaseUrl());
    return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash;
  } catch { return false; }
}

export const record = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);
export const positiveId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
export const validReference = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(v);
export const validInvite = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9]{6}$/.test(v);
export function money(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value))) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export type StorebatRaw = { status: number; text: string; etag?: string | null; retryAfter?: number };
export async function storebatRequest(path: string, body?: object, etag?: string | null): Promise<StorebatRaw> {
  if (!isStorebatConfigured()) throw new Error("not_configured");
  if (!/^\/(?:me|products|quote|orders(?:\/\d+|\/lookup\?idempotency_key=[A-Za-z0-9_-]{1,120})?|muse-buff(?:\/quote|\/orders(?:\/\d+)?)?)$/.test(path)) throw new Error("invalid_storebat_path");
  const headers: Record<string, string> = { "X-Reseller-Key": key(), Accept: "application/json" };
  if (etag) headers["If-None-Match"] = etag;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(getStorebatBaseUrl() + path, { headers, method: body ? "POST" : "GET", body: body && JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(15_000) });
  const retry = res.headers.get("Retry-After");
  const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry) - Date.now()) / 1000) : 0;
  return { status: res.status, text: await res.text(), etag: res.headers.get("ETag"), retryAfter: Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 0 };
}
export type StorebatResult = { kind: "ok"; json: unknown; etag?: string | null } | { kind: "not_modified" } | { kind: "http_error"; status: number; retryAfter?: number } | { kind: "config" | "ambiguous" };
async function read(path: string, body?: object, etag?: string | null): Promise<StorebatResult> {
  if (!isStorebatConfigured()) return { kind: "config" };
  try {
    const r = await storebatRequest(path, body, etag);
    if (r.status === 304 && etag) return { kind: "not_modified" };
    if (r.status < 200 || r.status >= 300) return { kind: "http_error", status: r.status, retryAfter: r.retryAfter };
    return { kind: "ok", json: JSON.parse(r.text), etag: r.etag };
  } catch { return { kind: "ambiguous" }; }
}
export const fetchStorebatProducts = (etag?: string | null) => read("/products", undefined, etag);
export const fetchStorebatBalance = () => read("/me");
export const fetchStorebatBuff = () => read("/muse-buff");
export const fetchStorebatQuote = (product_id: number, quantity: number, invite_code?: string) => invite_code
  ? read("/muse-buff/quote", { invite_code, quantity }) : read("/quote", { product_id, quantity });
export const fetchStorebatOrder = (id: number, buff: boolean) => {
  if (!positiveId(id)) throw new Error("invalid_order_id");
  return storebatRequest(`${buff ? "/muse-buff" : ""}/orders/${id}`);
};
export const lookupStorebatOrder = (id: string) => {
  if (!validReference(id)) throw new Error("invalid_reference");
  return storebatRequest(`/orders/lookup?idempotency_key=${id}`);
};

export type StorebatProduct = { id: number; name: string; description: string | null; price_usd: number; standard_price_usd: number | null; pricing_type: string; price_tiers: unknown[]; warranty_days: number; delivery_type: string; stock: number; image_url: string | null; excluded: boolean };
export function parseStorebatProducts(v: unknown): StorebatProduct[] | null {
  if (!record(v) || v.success !== true || !Array.isArray(v.products) || !v.products.length) return null;
  const out: StorebatProduct[] = [], ids = new Set<number>();
  for (const p of v.products) {
    if (!record(p) || !positiveId(p.id) || ids.has(p.id) || typeof p.name !== "string" || !p.name.trim() || p.name.length > 300) return null;
    ids.add(p.id);
    const price = money(p.price_usd), standard = money(p.standard_price_usd);
    const stock = p.stock == null && p.delivery_type === "activation" ? 0 : p.stock;
    if (!price || (p.standard_price_usd != null && !standard) || !["stock", "supplier_api", "activation", "api_test"].includes(String(p.delivery_type)) || !Number.isSafeInteger(stock) || Number(stock) < 0 || !Number.isSafeInteger(p.warranty_days) || Number(p.warranty_days) < 0 || typeof p.pricing_type !== "string" || !Array.isArray(p.price_tiers)) return null;
    const tiers = [];
    for (const t of p.price_tiers) {
      if (!record(t) || !positiveId(t.min_qty) || (t.max_qty != null && (!positiveId(t.max_qty) || t.max_qty < t.min_qty)) || !money(t.price_usd)) return null;
      tiers.push({ min_qty: t.min_qty, max_qty: t.max_qty ?? null, price_usd: money(t.price_usd) });
    }
    out.push({ id: p.id, name:p.name.trim(), description: typeof p.description === "string" ? p.description : null,
      price_usd: price, standard_price_usd: standard, pricing_type: p.pricing_type, price_tiers: tiers, warranty_days: Number(p.warranty_days), delivery_type: String(p.delivery_type), stock: Number(stock), image_url: typeof p.image_url === "string" ? p.image_url : null,
      excluded: p.id === 129 || p.id === STOREBAT_BUFF_ID || p.id === 2147483000 || p.api_test === true || p.delivery_type === "api_test" });
  }
  return out;
}
export function parseStorebatBuff(v: unknown): number | null {
  return record(v) && v.service === "muse_buff" && v.product_id === STOREBAT_BUFF_ID && v.unit === "billion_tokens" && v.min_quantity === 1 && v.max_quantity === 30 && v.requires_invite_code === true ? money(v.price_per_billion) || null : null;
}
export function parseStorebatBalance(v: unknown) {
  const balance = record(v) && v.success === true ? money(v.wallet_balance) : null;
  return balance === null ? null : { balance, currency: "USD" as const };
}
export function parseStorebatQuote(v: unknown, id: number, quantity: number, buff: boolean) {
  if (!record(v) || v.success !== true || !record(v.quote) || v.quote.product_id !== id || v.quote.quantity !== quantity) return null;
  const q = v.quote;
  const unit = money(buff ? q.price_per_billion : q.unit_price), total = money(buff ? q.total_usd : q.total);
  if (!unit || !total || (buff && q.unit !== "billion_tokens")) return null;
  return { unit, total, balance: money(v.wallet_balance), stock: q.stock, delivery: q.delivery_type };
}
