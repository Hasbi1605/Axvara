/** Server-only AIVault transport. GETs never retry and redirects never receive keys. */
export const AIVAULT_DEFAULT_BASE_URL = "https://api.aivaulthub.store";
export const isAivaultEnabled = () => process.env.AIVAULT_ENABLED === "true";
export const isAivaultSyncEnabled = () => isAivaultEnabled() && process.env.AIVAULT_SYNC_ENABLED === "true";
export const getAivaultApiKey = () => (process.env.AIVAULT_API_KEY || "").trim();
export const getAivaultBaseUrl = () => (process.env.AIVAULT_BASE_URL || AIVAULT_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
export function isAivaultConfigured(): boolean {
  if (!isAivaultEnabled() || !getAivaultApiKey()) return false;
  try { const u = new URL(getAivaultBaseUrl()); return u.protocol === "https:" && !!u.hostname && !u.username && !u.password && !u.search && !u.hash; } catch { return false; }
}
export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const numeric = (v: unknown): number | null => {
  if (typeof v !== "number" && !(typeof v === "string" && v.trim())) return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
};
export const validServiceId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(v);
export const validProviderId = (v: unknown): v is string => (typeof v === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(v));
export type AivaultResult = { kind: "ok"; status: number; json: unknown } | { kind: "config" | "ambiguous"; reason: string } | { kind: "http_error"; status: number };
export async function aivaultRawGet(path: string): Promise<{ status: number; text: string }> {
  if (!isAivaultConfigured()) throw new Error("not_configured");
  if (!/^\/(me|products|quote\?|order\/)[A-Za-z0-9_?=&%./-]*$/.test(path)) throw new Error("invalid_path");
  const res = await fetch(`${getAivaultBaseUrl()}/api/v1${path}`, { method: "GET", headers: { "x-api-key": getAivaultApiKey(), accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  return { status: res.status, text: await res.text() };
}
export async function callAivaultRead(path: string): Promise<AivaultResult> {
  if (!isAivaultConfigured()) return { kind: "config", reason: "not_configured" };
  try {
    const r = await aivaultRawGet(path);
    if ([401,403].includes(r.status) || (r.status >= 300 && r.status < 400)) return { kind: "config", reason: `http_${r.status}` };
    if (r.status === 429 || r.status >= 500) return { kind: "ambiguous", reason: `http_${r.status}` };
    if (r.status < 200 || r.status >= 300) return { kind: "http_error", status: r.status };
    try { return { kind: "ok", status: r.status, json: JSON.parse(r.text) }; } catch { return { kind: "ambiguous", reason: "invalid_json" }; }
  } catch { return { kind: "ambiguous", reason: "network_or_timeout" }; }
}
export type PricingTier = { min: number; max: number | null; price: number };
export type AivaultProduct = { service_id: string; name: string; stock: number; custom_pricing: boolean; pricing_tiers: PricingTier[]; unit_price_usd: number };
export function parseAivaultProduct(v: unknown): AivaultProduct | null {
  if (!record(v) || !validServiceId(v.service_id) || typeof v.name !== "string" || !v.name.trim() || v.name.length > 300 || typeof v.custom_pricing !== "boolean" || !Array.isArray(v.pricing_tiers) || !v.pricing_tiers.length) return null;
  const stock = numeric(v.stock);
  if (stock === null || !Number.isSafeInteger(stock) || stock < 0) return null;
  const tiers: PricingTier[] = [];
  for (const t of v.pricing_tiers) {
    if (!record(t)) return null;
    const min = numeric(t.min), max = t.max == null ? null : numeric(t.max), price = numeric(t.price);
    if (min === null || !Number.isSafeInteger(min) || min < 1 || (t.max != null && (max === null || !Number.isSafeInteger(max) || max < min)) || price === null || price <= 0) return null;
    tiers.push({ min, max, price });
  }
  tiers.sort((a,b) => a.min - b.min);
  for (let i=1; i<tiers.length; i++) if (tiers[i-1].max === null || tiers[i].min <= tiers[i-1].max!) return null;
  const first = tiers.filter(t => t.min === 1);
  if (first.length !== 1) return null;
  return { service_id: v.service_id, name: v.name.trim(), stock, custom_pricing: v.custom_pricing, pricing_tiers: tiers, unit_price_usd: first[0].price };
}
export function parseAivaultProducts(v: unknown): AivaultProduct[] | null {
  if (!record(v) || v.currency !== "USD" || !Array.isArray(v.products)) return null;
  const items = v.products.map(parseAivaultProduct);
  if (items.some(p => !p) || new Set(items.map(p => p!.service_id)).size !== items.length) return null;
  return items as AivaultProduct[];
}
export function parseAivaultBalance(v: unknown): { balance: number; currency: "USD" } | null {
  if (!record(v) || v.currency !== "USD") return null;
  const balance = numeric(v.balance); return balance !== null && balance >= 0 ? { balance, currency: "USD" } : null;
}
export function parseAivaultQuote(v: unknown): { unit_price: number; final_total: number; stock: number; sufficient_balance: boolean; price_conflict: boolean; service_id: string; quantity: number } | null {
  if (!record(v) || !record(v.pricing) || typeof v.sufficient_balance !== "boolean" || !validServiceId(v.service_id) || !Number.isSafeInteger(v.quantity) || Number(v.quantity)<1 || v.currency!=="USD") return null;
  const unit = numeric(v.pricing.unit_price), total = numeric(v.pricing.final_total), stock = numeric(v.stock);
  if (unit === null || unit <= 0 || total === null || total <= 0 || stock === null || !Number.isSafeInteger(stock) || stock < 0) return null;
  // Never opt into normal-price/buffer purchases. Unknown custom-pricing shapes fail closed.
  const conflict = (v.custom_pricing != null && v.custom_pricing !== false) || v.stock_warning != null || v.accept_normal_price === true || v.requires_accept_normal_price === true || v.pricing.requires_accept_normal_price === true;
  return { unit_price: unit, final_total: total, stock, sufficient_balance: v.sufficient_balance, price_conflict: conflict, service_id:v.service_id, quantity:Number(v.quantity) };
}
export const fetchAivaultProducts = () => callAivaultRead("/products");
export const fetchAivaultBalance = () => callAivaultRead("/me");
export function fetchAivaultQuote(serviceId: string, quantity: number) {
  if (!validServiceId(serviceId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) throw new Error("invalid_quote");
  return callAivaultRead(`/quote?service_id=${encodeURIComponent(serviceId)}&quantity=${quantity}`);
}
export function fetchAivaultOrder(orderId: string) {
  if (!validProviderId(orderId)) throw new Error("invalid_order_id");
  return aivaultRawGet(`/order/${encodeURIComponent(orderId)}`);
}
