// Sekalipay merchant gateway (LOCAL ONLY), distinct from the supplier adapter.
import { isSekalipayGatewayConfigured } from "./rails";
import { execRun, queryFirst, transitionPendingPaymentToPaid } from "@/lib/db";
import { SITE } from "@/lib/site";
import { parseFxTimestamp } from "./fx";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";

type Scalar = string | number | boolean | null | undefined;

export async function gatewayHmac(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function phpEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, "+");
}

export function gatewayParams(params: Record<string, Scalar>): string {
  return Object.keys(params).sort().flatMap((key) => {
    const value = params[key];
    if (value == null || (typeof value === "string" && !value.trim())) return [];
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("sekalipay_gateway_invalid_parameter");
    const text = typeof value === "boolean" ? (value ? "1" : "0") : String(value).trim();
    return [`${phpEncode(key)}=${phpEncode(text)}`];
  }).join("&");
}

export function signGatewayRequest(secret: string, method: "GET" | "POST", path: string, params: Record<string, Scalar>, timestamp: number): Promise<string> {
  if (!Number.isSafeInteger(timestamp) || !/^api\/v1\/gateway\/[A-Za-z0-9_/-]+$/.test(path)) throw new Error("sekalipay_gateway_invalid_parameter");
  return gatewayHmac(secret, `${method}|${path}|${gatewayParams(params)}|${timestamp}`);
}

export async function verifyGatewayWebhook(secret: string, raw: string, signature: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = await gatewayHmac(secret, raw);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ signature.toLowerCase().charCodeAt(i);
  return difference === 0;
}

type Fee = { flat: bigint; numerator: bigint; denominator: bigint };
export function parseGatewayFee(type: string, description: string): Fee | null {
  const flat = "(?:0|[1-9]\\d{0,2}(?:\\.\\d{3})+|[1-9]\\d*)";
  const percent = "(?:0|[1-9]\\d{0,2})(?:[.,]\\d{1,4})?";
  const regex = type === "flat" ? new RegExp(`^Rp ?(${flat})$`)
    : type === "percent" ? new RegExp(`^(${percent})%$`)
    : type === "mixed" ? new RegExp(`^Rp ?(${flat}) ?\\+ ?(${percent})%$`) : null;
  const match = regex?.exec(description.trim());
  if (!match) return null;
  const flatText = type === "percent" ? "0" : match[1].replace(/\./g, "");
  const percentage = type === "flat" ? "0" : match[type === "mixed" ? 2 : 1].replace(",", ".");
  const [whole, fraction = ""] = percentage.split(".");
  const scale = BigInt(10) ** BigInt(fraction.length);
  const numerator = BigInt(whole) * scale + BigInt(fraction || "0");
  const flatAmount = BigInt(flatText);
  if (flatAmount > BigInt(999_999_999) || numerator > BigInt(100) * scale) return null;
  return { flat: flatAmount, numerator, denominator: BigInt(100) * scale };
}

export function estimateGatewayFee(amount: number, fee: Fee): number {
  if (!Number.isSafeInteger(amount) || amount < 100 || amount > 999_999_999) throw new Error("sekalipay_gateway_invalid_amount");
  const result = fee.flat + (BigInt(amount) * fee.numerator * BigInt(2) + fee.denominator) / (fee.denominator * BigInt(2));
  if (result > BigInt(Number.MAX_SAFE_INTEGER - amount)) throw new Error("sekalipay_gateway_invalid_amount");
  return Number(result);
}

/**
 * Transport gateway Sekalipay. Whitelist IP merchant hanya VPS 13.228.147.90 dan Cloudflare Pages tidak punya egress IP tetap, jadi bila
 * SEKALIPAY_PROXY_URL (origin https murni) + SEKALIPAY_PROXY_TOKEN valid, panggilan lewat `${origin}/skg/v1/gateway/<path>` dengan header
 * `x-proxy-token`; tanpa kedua env langsung ke sekalipay.com (harness lokal/tes). Konfigurasi parsial/invalid gagal tertutup. Tanda tangan HMAC SELALU atas path kanonis upstream
 * `api/v1/gateway/<path>`; proxy hanya meneruskan X-API-Key/X-Timestamp/X-Signature + body mentah apa adanya.
 */
function gatewayProxy(): { origin: string; token: string } | null {
  const rawUrl = process.env.SEKALIPAY_PROXY_URL?.trim();
  const token = process.env.SEKALIPAY_PROXY_TOKEN?.trim();
  if (!rawUrl && !token) return null;
  if (!rawUrl || !token) throw new Error("sekalipay_gateway_proxy_config_error");
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.port || url.pathname.replace(/\/+$/, "") || url.search || url.hash) throw new Error("sekalipay_gateway_proxy_config_error");
    return { origin: url.origin, token };
  } catch { throw new Error("sekalipay_gateway_proxy_config_error"); }
}

/** Respons proxy 401 `unauthorized` / 404 `unknown_skg_path` = salah konfigurasi (fail closed, bukan penolakan bisnis, tanpa retry otomatis). */
async function assertNotProxyConfigError(response: Response): Promise<void> {
  if (response.status !== 401 && response.status !== 404) return;
  const body: unknown = await response.clone().json().catch(() => null);
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  if (!record) return;
  if ((response.status === 401 && record.status === false && record.reason === "unauthorized") || (response.status === 404 && JSON.stringify(record).includes("unknown_skg_path"))) {
    throw new Error("sekalipay_gateway_proxy_config_error");
  }
}

async function gatewayTransport(method: "GET" | "POST", suffix: string, params: Record<string, Scalar>, apiKey: string, secret: string, jsonContentType: boolean): Promise<Response> {
  const path = `api/v1/gateway/${suffix}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signGatewayRequest(secret, method, path, params, timestamp);
  const proxy = gatewayProxy();
  const headers: Record<string, string> = { Accept: "application/json", ...(jsonContentType ? { "Content-Type": "application/json" } : {}),
    "X-API-Key": apiKey, "X-Timestamp": String(timestamp), "X-Signature": signature, ...(proxy ? { "x-proxy-token": proxy.token } : {}) };
  const url = proxy ? `${proxy.origin}/skg/v1/gateway/${suffix}` : `https://sekalipay.com/${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000), headers,
      ...(method === "POST" ? { body: JSON.stringify(params) } : {}),
    });
  } catch (error) {
    // POST yang gagal di jaringan/timeout mungkin sudah diterima merchant: ambigu, klaim durable dipertahankan, tanpa POST ulang.
    if (method === "POST") throw new Error("sekalipay_gateway_create_ambiguous");
    throw error;
  }
  if (proxy) {
    await assertNotProxyConfigError(response);
    if (method === "POST" && (response.status === 504 || response.status === 502)) {
      const body: unknown = await response.clone().json().catch(() => null);
      const message = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).message : null;
      if (response.status === 504 || (typeof message === "string" && message.startsWith("skg_proxy_unreadable_response"))) throw new Error("sekalipay_gateway_create_ambiguous");
    }
  }
  return response;
}

export type GatewayGroup = "va" | "ewallet" | "other";
export type GatewayMethod = { code: string; name: string; type: GatewayGroup; min: number; max: number; feeText: string; estimatedFee: number; estimatedTotal: number };
/** Entri katalog merchant untuk total tertentu: tersedia (min <= total <= max, inklusif) atau tidak tersedia dengan alasan; tanpa biaya/total karangan. */
export type GatewayCatalogEntry =
  | (Omit<GatewayMethod, "estimatedFee" | "estimatedTotal"> & { available: true; estimatedFee: number; estimatedTotal: number })
  | (Omit<GatewayMethod, "estimatedFee" | "estimatedTotal"> & { available: false; reason: "below_min" | "above_max"; shortfall: number | null });
let methodCache: { key: string; until: number; methods: unknown[] } | null = null;

/** Batas inklusif dari API merchant: tersedia hanya bila min <= total <= max. */
export function gatewayEligibility(amount: number, min: number, max: number): "ok" | "below_min" | "above_max" {
  return amount < min ? "below_min" : amount > max ? "above_max" : "ok";
}

/**
 * Katalog merchant untuk `amount`: semua kanal dengan biaya DIKENAL (parser ketat) dan batas valid, termasuk yang di luar batas sebagai
 * `available:false` (tanpa biaya/total; `shortfall` = min - amount dihitung di server hanya untuk below_min). Biaya tak dikenal, batas cacat,
 * QRIS, atau tipe tak dikenal tetap disembunyikan (fail closed). `payment_type` hilang -> grup "other" (bukan tebakan dari merek).
 */
export async function listSekalipayCatalog(amount: number, adminTest = false): Promise<GatewayCatalogEntry[]> {
  if (!isSekalipayGatewayConfigured(adminTest)) throw new Error("sekalipay_gateway_not_configured");
  if (!Number.isSafeInteger(amount) || amount < 100 || amount > 999_999_999) throw new Error("sekalipay_gateway_invalid_amount");
  const apiKey = process.env.SEKALIPAY_GATEWAY_API_KEY!.trim();
  const secret = process.env.SEKALIPAY_GATEWAY_SECRET_KEY!.trim();
  if (!methodCache || methodCache.key !== `${apiKey}\0${secret}` || methodCache.until <= Date.now()) {
    const response = await gatewayTransport("GET", "payment-methods", {}, apiKey, secret, false);
    if (!response.ok || response.headers.has("location")) throw new Error("sekalipay_gateway_methods_unavailable");
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("status" in body) || body.status !== true || !("data" in body) || !Array.isArray(body.data)) throw new Error("sekalipay_gateway_invalid_response");
    methodCache = { key: `${apiKey}\0${secret}`, until: Date.now() + 300_000, methods: body.data };
  }
  return methodCache.methods.flatMap((entry): GatewayCatalogEntry[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const info = row.fee_info as Record<string, unknown> | null;
    const rawType = row.payment_type;
    const type: GatewayGroup | null = rawType === "va" || rawType === "ewallet" ? rawType : rawType == null || rawType === "" ? "other" : null;
    if (typeof row.payment_code !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(row.payment_code) || /qris/i.test(row.payment_code)
      || typeof row.payment_name !== "string" || type === null
      || !Number.isSafeInteger(row.min_amount) || !Number.isSafeInteger(row.max_amount)
      || !info || typeof info.type !== "string" || typeof info.description !== "string") return [];
    const min = Number(row.min_amount);
    const max = Number(row.max_amount);
    const fee = parseGatewayFee(info.type, info.description);
    if (!fee) return [];
    const base = { code: row.payment_code, name: row.payment_name, type, min, max, feeText: info.description };
    const eligibility = gatewayEligibility(amount, min, max);
    if (eligibility === "below_min") return [{ ...base, available: false, reason: "below_min", shortfall: min - amount }];
    if (eligibility === "above_max") return [{ ...base, available: false, reason: "above_max", shortfall: null }];
    const estimatedFee = estimateGatewayFee(amount, fee);
    return [{ ...base, available: true, estimatedFee, estimatedTotal: amount + estimatedFee }];
  });
}

/** Hanya kanal yang BISA dipakai untuk `amount` (min <= total <= max). Dipakai create web/TG: kanal di luar batas tidak pernah lolos. */
export async function listSekalipayMethods(amount: number, adminTest = false): Promise<GatewayMethod[]> {
  return (await listSekalipayCatalog(amount, adminTest)).flatMap((entry): GatewayMethod[] => (entry.available
    ? [{ code: entry.code, name: entry.name, type: entry.type, min: entry.min, max: entry.max, feeText: entry.feeText, estimatedFee: entry.estimatedFee, estimatedTotal: entry.estimatedTotal }]
    : []));
}

type GatewayCustomer = { name: string; email: string; phone: string };
type Row = Record<string, unknown>;

async function gatewayFetch(method: "GET" | "POST", suffix: string, params: Record<string, Scalar> = {}, db: DatabaseAccess = createDatabaseAccess(), adminTest = false) {
  const apiKey = process.env.SEKALIPAY_GATEWAY_API_KEY?.trim();
  const secret = process.env.SEKALIPAY_GATEWAY_SECRET_KEY?.trim();
  if (!apiKey || !secret || (method === "POST" && !isSekalipayGatewayConfigured(adminTest))) throw new Error("sekalipay_gateway_not_configured");
  if (method === "GET" && suffix.startsWith("payment/")) {
    const admission = await db.execRun(`INSERT INTO store_settings(key,value,updated_at) VALUES('sekalipay_gateway_status_budget',json_object('minute',strftime('%Y-%m-%dT%H:%M','now'),'count',1),datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=json_object('minute',strftime('%Y-%m-%dT%H:%M','now'),'count',CASE WHEN json_extract(value,'$.minute')=strftime('%Y-%m-%dT%H:%M','now') THEN json_extract(value,'$.count')+1 ELSE 1 END),updated_at=datetime('now')
      WHERE json_valid(value) AND (json_extract(value,'$.minute')!=strftime('%Y-%m-%dT%H:%M','now') OR json_extract(value,'$.count')<20)`);
    if (!admission.changes) throw new Error("sekalipay_gateway_status_rate_limited");
  }
  const response = await gatewayTransport(method, suffix, params, apiKey, secret, true);
  if (response.headers.has("location")) throw new Error("sekalipay_gateway_redirect");
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("sekalipay_gateway_invalid_response");
  return { status: response.status, body: body as Row };
}

function paymentUrl(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > 2048) throw new Error("sekalipay_gateway_invalid_invoice");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("sekalipay_gateway_invalid_invoice"); }
  if (url.protocol !== "https:" || url.hostname !== "sekalipay.com" || url.username || url.password || url.port) throw new Error("sekalipay_gateway_invalid_invoice");
  return url.href;
}

async function savedGatewayView(orderCode: string) {
  const tx = await queryFirst(`SELECT pt.*,o.status AS order_status,o.payment_status AS order_payment_status,o.expires_at AS order_expires_at
    FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code WHERE pt.order_code=? AND pt.provider='sekalipay_gateway'`, orderCode);
  if (!tx || !tx.provider_payment_id || !tx.payable_amount) throw new Error("sekalipay_gateway_initializing");
  const live = tx.order_status === "pending" && ["pending", "unpaid"].includes(String(tx.order_payment_status))
    && Date.parse(String(tx.order_expires_at).replace(" ", "T").replace(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)$/, "$1Z")) > Date.now();
  const hidden = !live || !(Date.parse(String(tx.expires_at)) > Date.now()) || !!tx.last_error || (Number(tx.gateway_fee_consent_required) === 1 && !tx.gateway_fee_consented_at);
  return { orderCode, invoice: String(tx.provider_payment_id), channel: String(tx.gateway_channel), net: Number(tx.requested_amount),
    estimatedFee: Number(tx.gateway_estimated_fee), fee: Number(tx.gateway_fee), total: Number(tx.payable_amount),
    feeConsentRequired: Number(tx.gateway_fee_consent_required) === 1 && !tx.gateway_fee_consented_at,
    paymentLink: hidden ? null : tx.direct_url, virtualAccount: hidden ? null : tx.gateway_virtual_account,
    checkoutUrl: hidden ? null : tx.gateway_checkout_url, expiresAt: new Date(Math.min(Date.parse(String(tx.expires_at)), Date.parse(String(tx.order_expires_at).replace(" ", "T").replace(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)$/, "$1Z")))).toISOString(), isSandbox: Number(tx.gateway_is_sandbox) === 1 };
}

export function createSekalipayGatewayInvoice(orderCode?: string, amount?: number, channel?: string, customer?: GatewayCustomer, estimatedFee?: number, adminTest = false): Promise<Awaited<ReturnType<typeof savedGatewayView>>> {
  if (!isSekalipayGatewayConfigured(adminTest) && !orderCode) throw new Error("sekalipay_gateway_not_configured");
  return (async () => {
    if (!orderCode || !/^AXV-\d{8}-[A-Z0-9]{8}$/.test(orderCode) || !Number.isSafeInteger(amount) || amount! < 100 || amount! > 999_999_999
      || !channel || !/^[A-Za-z0-9_-]{1,64}$/.test(channel) || /qris/i.test(channel)
      || !Number.isSafeInteger(estimatedFee) || estimatedFee! < 0 || estimatedFee! > 999_999_999
      || !customer || typeof customer.name !== "string" || !customer.name.trim() || customer.name.length > 100
      || typeof customer.email !== "string" || customer.email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)
      || typeof customer.phone !== "string" || !/^\+?[0-9]{8,20}$/.test(customer.phone)) throw new Error("sekalipay_gateway_invalid_input");
    let tx = await queryFirst("SELECT * FROM payment_transactions WHERE order_code=?", orderCode);
    let claimed = false;
    if (!tx) {
      if (!isSekalipayGatewayConfigured(adminTest)) throw new Error("sekalipay_gateway_not_configured");
      const method = (await listSekalipayMethods(amount!, adminTest)).find((entry) => entry.code === channel);
      if (!method) throw new Error("sekalipay_gateway_method_unavailable");
      const inserted = await execRun(`INSERT OR IGNORE INTO payment_transactions
        (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,status,gateway_channel,gateway_label,gateway_estimated_fee,expires_at)
        SELECT code,'sekalipay_gateway','merchant',code,'sekalipay_gateway',subtotal,'initializing',?,?,?,expires_at FROM orders
        WHERE code=? AND subtotal=? AND payment_method=? AND status='pending' AND payment_status IN ('pending','unpaid') AND julianday(expires_at)>julianday('now')`,
        channel, method.name, estimatedFee, orderCode, amount, `sekalipay_gateway:${channel}`);
      claimed = Number(inserted.changes) === 1;
      tx = await queryFirst("SELECT * FROM payment_transactions WHERE order_code=?", orderCode);
    }
    if (!tx || tx.provider !== "sekalipay_gateway" || tx.provider_order_id !== orderCode || Number(tx.requested_amount) !== amount
      || tx.gateway_channel !== channel || Number(tx.gateway_estimated_fee) !== estimatedFee) throw new Error("sekalipay_gateway_order_conflict");
    if (tx.provider_payment_id && tx.payable_amount) return savedGatewayView(orderCode);
    const get = () => gatewayFetch("GET", `payment/${orderCode}`);
    let response = claimed ? await gatewayFetch("POST", "payment", {
      merchant_ref_id: orderCode, amount, payment_code: channel, customer_name: customer.name.trim(), customer_email: customer.email.trim(), customer_phone: customer.phone,
      callback_url: `${SITE.webUrl}/api/payments/sekalipay-gateway/callback`, return_url: `${SITE.webUrl}/lacak-pesanan`,
    }, undefined, adminTest) : await get();
    if (response.status === 409 && response.body.code === "DUPLICATE_REF_ID") response = await get();
    if (!(response.status >= 200 && response.status < 300 && response.body.status === true)
      && !(response.status === 409 && response.body.code === "PAYMENT_ALREADY_EXISTS")) throw new Error("sekalipay_gateway_initializing");
    const data = response.body.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("sekalipay_gateway_invalid_invoice");
    const invoice = data as Row;
    if (invoice.merchant_ref_id === orderCode && typeof invoice.invoice === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(invoice.invoice)) {
      // finalize probe: claim the invoice id atomically WITH the view row.
      // If THIS claim is the one blocked, the TX must still review-stick so
      // a late/duplicate POST cannot be rendered as a fresh invoice.
      await execRun(`UPDATE payment_transactions SET provider_payment_id=COALESCE(provider_payment_id,?),
        last_error=CASE WHEN provider_payment_id IS NULL THEN COALESCE(last_error,'sekalipay_gateway_finalize_probe') ELSE last_error END,
        updated_at=datetime('now') WHERE order_code=? AND provider='sekalipay_gateway' AND status='initializing'`, invoice.invoice, orderCode);
    }
    if (invoice.merchant_ref_id !== orderCode || typeof invoice.invoice !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(invoice.invoice)
      || invoice.payment_code !== channel || invoice.amount !== amount || !Number.isSafeInteger(invoice.fee) || Number(invoice.fee) < 0
      || !Number.isSafeInteger(invoice.total) || Number(invoice.total) !== amount! + Number(invoice.fee)
      || typeof invoice.is_sandbox !== "boolean" || typeof invoice.expired_at !== "string"
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(invoice.expired_at) || !parseFxTimestamp(invoice.expired_at)
      || invoice.status !== "pending") throw new Error("sekalipay_gateway_invalid_invoice");
    const link = paymentUrl(invoice.payment_link);
    if (!link) throw new Error("sekalipay_gateway_invalid_invoice");
    const checkout = paymentUrl(invoice.checkout_url);
    if (invoice.virtual_account != null && (typeof invoice.virtual_account !== "string" || !/^[A-Za-z0-9 -]{1,100}$/.test(invoice.virtual_account))) throw new Error("sekalipay_gateway_invalid_invoice");
    const required = Number(invoice.fee) !== estimatedFee;
    const updated = await execRun(`UPDATE payment_transactions SET payable_amount=?,gateway_fee=?,gateway_fee_consent_required=?,gateway_fee_consented_at=CASE WHEN ?=0 THEN datetime('now') ELSE NULL END,
      direct_url=?,gateway_virtual_account=?,gateway_checkout_url=?,gateway_is_sandbox=?,expires_at=?,
      status='pending',last_error=CASE WHEN last_error IS NOT NULL AND last_error NOT IN ('sekalipay_gateway_finalize_probe','sekalipay_gateway_finalize_manual_review') THEN last_error WHEN EXISTS(SELECT 1 FROM orders o WHERE o.code=payment_transactions.order_code AND o.status='pending' AND o.payment_status IN ('pending','unpaid') AND julianday(o.expires_at)>julianday('now')) AND julianday(?)>julianday('now') THEN NULL ELSE 'sekalipay_gateway_late_manual_review' END,updated_at=datetime('now')
      WHERE order_code=? AND provider='sekalipay_gateway' AND status='initializing' AND provider_payment_id=?
        AND provider_order_id=? AND requested_amount=? AND gateway_channel=? AND gateway_estimated_fee=?
        AND EXISTS(SELECT 1 FROM orders o WHERE o.code=payment_transactions.order_code AND o.subtotal=? AND o.payment_method=?)`,
      invoice.total, invoice.fee, required ? 1 : 0, required ? 1 : 0, link, invoice.virtual_account ?? null, checkout, invoice.is_sandbox ? 1 : 0, invoice.expired_at, invoice.expired_at, orderCode, invoice.invoice, orderCode, amount, channel, estimatedFee, amount, `sekalipay_gateway:${channel}`);
    if (Number(updated.changes) !== 1) throw new Error("sekalipay_gateway_claim_conflict");
    return savedGatewayView(orderCode);
  })();
}

export async function confirmGatewayFee(orderCode: string, expectedFinalTotal: number): Promise<boolean> {
  if (!Number.isSafeInteger(expectedFinalTotal) || expectedFinalTotal <= 0) return false;
  const result = await execRun(`UPDATE payment_transactions SET gateway_fee_consented_at=COALESCE(gateway_fee_consented_at,datetime('now')),updated_at=datetime('now')
    WHERE order_code=? AND provider='sekalipay_gateway' AND status='pending' AND provider_payment_id IS NOT NULL AND payable_amount=?
      AND gateway_fee>=0 AND requested_amount+gateway_fee=payable_amount AND last_error IS NULL AND julianday(expires_at)>julianday('now')
      AND EXISTS(SELECT 1 FROM orders o WHERE o.code=payment_transactions.order_code AND o.status='pending' AND o.payment_status IN ('pending','unpaid') AND julianday(o.expires_at)>julianday('now'))`, orderCode, expectedFinalTotal);
  return Number(result.changes) === 1;
}

export function reconcileSekalipayGatewayPayment(orderCode?: string, db: DatabaseAccess = createDatabaseAccess()): Promise<"paid" | "already_paid" | "pending" | "manual_review"> {
  if (!orderCode) throw new Error("sekalipay_gateway_not_configured");
  return (async () => {
    if (!/^AXV-\d{8}-[A-Z0-9]{8}$/.test(orderCode)) throw new Error("sekalipay_gateway_invalid_input");
    const tx = await db.queryFirst(`SELECT pt.*,o.status AS order_status,o.payment_status AS order_payment_status,o.expires_at AS order_expires_at,
      o.payment_method AS order_method,o.subtotal AS order_subtotal,o.variant_id,o.sales_channel,o.order_kind
      FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code WHERE pt.order_code=? AND pt.provider='sekalipay_gateway'`, orderCode);
    if (!tx) throw new Error("sekalipay_gateway_transaction_missing");
    if (tx.status === "paid" && tx.order_payment_status === "paid") return "already_paid";
    const response = await gatewayFetch("GET", `payment/${orderCode}`, {}, db);
    await db.execRun("UPDATE payment_transactions SET last_checked_at=datetime('now'),updated_at=datetime('now') WHERE order_code=? AND provider='sekalipay_gateway'", orderCode);
    if (response.status !== 200 || response.body.status !== true || !response.body.data || typeof response.body.data !== "object" || Array.isArray(response.body.data)) throw new Error("sekalipay_gateway_status_unavailable");
    const data = response.body.data as Row;
    const review = async (reason: string) => {
      await db.execRun("UPDATE payment_transactions SET last_error=CASE WHEN last_error IS NULL OR last_error IN ('sekalipay_gateway_finalize_probe','sekalipay_gateway_finalize_manual_review') THEN ? ELSE last_error END,last_checked_at=datetime('now'),updated_at=datetime('now') WHERE order_code=? AND provider='sekalipay_gateway' AND status!='paid'", reason, orderCode);
      return "manual_review" as const;
    };
    if (!tx.provider_payment_id || tx.payable_amount == null || tx.gateway_fee == null || tx.gateway_is_sandbox == null) {
      if (tx.status !== "initializing" || tx.provider_order_id !== orderCode || tx.order_subtotal !== tx.requested_amount
        || tx.order_method !== `sekalipay_gateway:${tx.gateway_channel}` || data.merchant_ref_id !== orderCode
        || typeof data.invoice !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(data.invoice)
        || (tx.provider_payment_id != null && tx.provider_payment_id !== data.invoice)
        || data.payment_code !== tx.gateway_channel || data.amount !== tx.requested_amount
        || !Number.isSafeInteger(data.fee) || Number(data.fee) < 0 || !Number.isSafeInteger(data.total)
        || Number(data.amount) + Number(data.fee) !== data.total || typeof data.is_sandbox !== "boolean") return review("sekalipay_gateway_status_mismatch_manual_review");
      if (data.status === "pending") throw new Error("sekalipay_gateway_initializing");
      await db.execRun(`UPDATE payment_transactions SET provider_payment_id=COALESCE(provider_payment_id,?),payable_amount=COALESCE(payable_amount,?),
        gateway_fee=COALESCE(gateway_fee,?),gateway_is_sandbox=COALESCE(gateway_is_sandbox,?),gateway_fee_consent_required=1,
        last_error=CASE WHEN last_error IS NULL OR last_error IN ('sekalipay_gateway_finalize_probe','sekalipay_gateway_finalize_manual_review') THEN 'sekalipay_gateway_initializing_paid_manual_review' ELSE last_error END,
        last_checked_at=datetime('now'),updated_at=datetime('now') WHERE order_code=? AND provider='sekalipay_gateway' AND status='initializing'
        AND (provider_payment_id IS NULL OR provider_payment_id=?)`, data.invoice, data.total, data.fee, data.is_sandbox ? 1 : 0, orderCode, data.invoice);
      return "manual_review";
    }
    if (data.merchant_ref_id !== orderCode || data.invoice !== tx.provider_payment_id || data.payment_code !== tx.gateway_channel
      || data.amount !== tx.requested_amount || data.fee !== tx.gateway_fee || data.total !== tx.payable_amount
      || !Number.isSafeInteger(data.amount) || !Number.isSafeInteger(data.fee) || !Number.isSafeInteger(data.total)
      || Number(data.fee) < 0 || Number(data.amount) + Number(data.fee) !== data.total
      || typeof data.is_sandbox !== "boolean" || Number(data.is_sandbox) !== Number(tx.gateway_is_sandbox)
      || tx.provider_order_id !== orderCode || tx.order_subtotal !== tx.requested_amount
      || tx.order_method !== `sekalipay_gateway:${tx.gateway_channel}`) return review("sekalipay_gateway_status_mismatch_manual_review");
    if (data.status === "pending" || data.status === "canceled" || data.status === "failed") return "pending";
    if (data.status !== "paid" && !(data.status === "completed" && tx.gateway_is_sandbox === 1)) return review("sekalipay_gateway_status_manual_review");
    const paidAt = typeof data.paid_at === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(data.paid_at) ? parseFxTimestamp(data.paid_at) : null;
    if (!paidAt || Date.parse(paidAt) > Date.now()) return review("sekalipay_gateway_paid_at_manual_review");
    const orderDeadline = Date.parse(String(tx.order_expires_at).replace(" ", "T").replace(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)$/, "$1Z"));
    const deadline = Math.min(orderDeadline, Date.parse(String(tx.expires_at)));
    if (tx.order_status !== "pending" || !["pending", "unpaid"].includes(String(tx.order_payment_status)) || !(deadline > Date.now()) || Date.parse(paidAt) > deadline) return review("sekalipay_gateway_late_manual_review");
    if (!tx.gateway_fee_consented_at || tx.last_error) return review("sekalipay_gateway_consent_manual_review");
    const eventKey = `sekalipaygw:${tx.provider_payment_id}:${data.status}`;
    const hash = await gatewayHmac("gateway-event-key", eventKey);
    await db.execRun(`INSERT OR IGNORE INTO dana_webhook_events(event_key,payload_hash,amount,raw_text,provider,status,order_code)
      VALUES(?,?,?,'{}','sekalipay_gateway','received',?)`, eventKey, hash, tx.payable_amount, orderCode);
    const event = await db.queryFirst("SELECT id,status,provider,order_code,amount FROM dana_webhook_events WHERE event_key=?", eventKey);
    if (!event || event.provider !== "sekalipay_gateway" || event.order_code !== orderCode || event.amount !== tx.payable_amount) return review("sekalipay_gateway_event_mismatch_manual_review");
    if (event.status === "matched") return review("sekalipay_gateway_event_mismatch_manual_review");
    const changed = await transitionPendingPaymentToPaid(orderCode, paidAt, tx.order_kind === "pedia" ? null : {
      variantId: tx.variant_id == null ? null : Number(tx.variant_id), inventoryId: null, salesChannel: String(tx.sales_channel),
    }, { id: Number(event.id) }, { paymentMethod: "sekalipay_gateway", eventMode: "gateway" }, db.d1);
    if (!changed) {
      const current = await db.queryFirst("SELECT status,payment_status FROM orders WHERE code=?", orderCode);
      if (current?.payment_status === "paid") return "already_paid";
      return review("sekalipay_gateway_race_manual_review");
    }
    return "paid";
  })();
}
