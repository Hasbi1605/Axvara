// Sekalipay merchant gateway (LOCAL ONLY), distinct from the supplier adapter.
import { isSekalipayGatewayConfigured } from "./rails";
import { execRun, queryFirst, transitionPendingPaymentToPaid } from "@/lib/db";
import { SITE } from "@/lib/site";
import { parseFxTimestamp } from "./fx";
import { createDatabaseAccess, QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";

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
 * `x-proxy-token`; tanpa kedua env langsung ke sekalipay.com (harness lokal/tes). Konfigurasi parsial/invalid gagal tertutup. Mode whitelist VPS menandatangani body POST mentah;
 * direct mempertahankan Enhanced HMAC atas path kanonis upstream. Proxy hanya meneruskan header + body mentah apa adanya.
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
  const proxy = gatewayProxy();
  const body = method === "POST" ? JSON.stringify(params) : undefined;
  // ponytail: the VPS merchant uses IP whitelist; add an explicit mode only if proxied Enhanced HMAC is required.
  const signature = proxy && body !== undefined ? await gatewayHmac(secret, body) : await signGatewayRequest(secret, method, path, params, timestamp);
  const headers: Record<string, string> = { Accept: "application/json", ...(jsonContentType ? { "Content-Type": "application/json" } : {}),
    "X-API-Key": apiKey, "X-Timestamp": String(timestamp), "X-Signature": signature, ...(proxy ? { "x-proxy-token": proxy.token } : {}) };
  const url = proxy ? `${proxy.origin}/skg/v1/gateway/${suffix}` : `https://sekalipay.com/${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000), headers,
      ...(body !== undefined ? { body } : {}),
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
/** Label pembeli hanya untuk ID kanal eksak (bukan nama): kanal realtime tampil tanpa kata "Realtime"; ID/routing tetap persis. */
const GATEWAY_DISPLAY_NAMES = new Map<string, string>([["SHOPEEPAY_REALTIME", "ShopeePay"], ["DANA_REALTIME", "DANA"]]);
export function gatewayDisplayName(code: string, name: string): string {
  return GATEWAY_DISPLAY_NAMES.get(code.trim().toUpperCase()) ?? name;
}
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
 * QRIS, atau tipe tak dikenal tetap disembunyikan (fail closed). Keputusan owner 7 Nov 2026: hanya SHOPEEPAY_REALTIME yang dikecualikan
 * (ShopeePay ditawarkan lewat kanal SHOPEEPAY biasa); DANA_REALTIME DITAMPILKAN lagi (label "DANA") meski create-nya masih HTTP 500 — pembeli
 * boleh melihat gangguan lalu memilih metode lain (requote checkout), lihat `docs/agent-rules/payments.md`.
 * `payment_type` hilang -> grup "other" (bukan tebakan dari merek).
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
    if (typeof row.payment_code !== "string" || /^SHOPEEPAY_REALTIME$/i.test(row.payment_code) || !/^[A-Za-z0-9_-]{1,64}$/.test(row.payment_code) || /qris/i.test(row.payment_code)
      || typeof row.payment_name !== "string" || type === null
      || !Number.isSafeInteger(row.min_amount) || !Number.isSafeInteger(row.max_amount)
      || !info || typeof info.type !== "string" || typeof info.description !== "string") return [];
    const min = Number(row.min_amount);
    const max = Number(row.max_amount);
    const fee = parseGatewayFee(info.type, info.description);
    if (!fee) return [];
    const base = { code: row.payment_code, name: gatewayDisplayName(row.payment_code, row.payment_name), type, min, max, feeText: info.description };
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

/** `checkout_url` opsional (mis. app e-wallet): hanya URL kanonis sekalipay.com yang disimpan; selain itu diredaksi ke null. */
function optionalCheckoutUrl(value: unknown): string | null {
  try {
    return paymentUrl(value);
  } catch {
    return null;
  }
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

/**
 * Bukti read-only bahwa invoice gateway untuk `orderCode` TIDAK ada di provider.
 * Hanya 404 JSON yang jelas = "absent". 2xx `status:true` dengan objek data = "present".
 * Semua selain itu (admission/rate-limit 20/menit, timeout, jaringan, redirect, respons
 * tak terbaca, proxy config error, 4xx/5xx lain) = "unknown" — pemanggil WAJIB fail-closed
 * dan memperlakukan klaim sebagai ambigu. Tidak pernah POST/re-POST.
 */
export type GatewayInvoiceAbsence = "absent" | "present" | "unknown";

export async function confirmGatewayInvoiceAbsent(orderCode: string, db: DatabaseAccess = createDatabaseAccess()): Promise<GatewayInvoiceAbsence> {
  if (typeof orderCode !== "string" || !/^(?:AXV|AXP|AXG)-\d{8}-[A-Z0-9]{8}$/.test(orderCode)) return "unknown";
  let response: Awaited<ReturnType<typeof gatewayFetch>>;
  try {
    // gatewayFetch GET payment/* memakai admission budget existing (20/menit).
    response = await gatewayFetch("GET", `payment/${orderCode}`, {}, db);
  } catch {
    return "unknown";
  }
  if (response.status === 404) return "absent";
  if (response.status >= 200 && response.status < 300 && response.body.status === true
    && response.body.data && typeof response.body.data === "object" && !Array.isArray(response.body.data)) return "present";
  return "unknown";
}

/**
 * Tandai klaim gateway terminal setelah rejeksi create TERBACA dan invoice terbukti tidak ada.
 * Hanya baris `initializing` tanpa invoice id (klaim murni pra-POST) yang disentuh; baris
 * pending/paid/finalize tidak pernah ditimpa. `last_error` menjadi alasan durable untuk review.
 */
export async function markGatewayInvoiceCreateRejected(orderCode: string, db: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
  if (typeof orderCode !== "string" || !/^(?:AXV|AXP|AXG)-\d{8}-[A-Z0-9]{8}$/.test(orderCode)) return false;
  const result = await db.execRun(`UPDATE payment_transactions SET status='failed',last_error='sekalipay_gateway_create_rejected',updated_at=datetime('now')
    WHERE order_code=? AND provider='sekalipay_gateway' AND status='initializing' AND provider_payment_id IS NULL
      AND EXISTS(SELECT 1 FROM orders o WHERE o.code=payment_transactions.order_code AND o.status='pending' AND o.payment_status IN ('pending','unpaid'))`, orderCode);
  return Number(result.changes) === 1;
}

export function createSekalipayGatewayInvoice(orderCode?: string, amount?: number, channel?: string, customer?: GatewayCustomer, estimatedFee?: number, adminTest = false): Promise<Awaited<ReturnType<typeof savedGatewayView>>> {
  if (!isSekalipayGatewayConfigured(adminTest) && !orderCode) throw new Error("sekalipay_gateway_not_configured");
  return (async () => {
    if (!orderCode || !/^(?:AXV|AXP|AXG)-\d{8}-[A-Z0-9]{8}$/.test(orderCode) || !Number.isSafeInteger(amount) || amount! < 100 || amount! > 999_999_999
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
    const storedSandbox = tx.gateway_is_sandbox == null ? null : Number(tx.gateway_is_sandbox) === 1;
    if (tx.provider_payment_id && tx.payable_amount) return savedGatewayView(orderCode);
    const get = () => gatewayFetch("GET", `payment/${orderCode}`);
    let posted = claimed;
    let response = claimed ? await gatewayFetch("POST", "payment", {
      merchant_ref_id: orderCode, amount, payment_code: channel, customer_name: customer.name.trim(), customer_email: customer.email.trim(), customer_phone: customer.phone,
      callback_url: `${SITE.webUrl}/api/payments/sekalipay-gateway/callback`, return_url: `${SITE.webUrl}/lacak-pesanan`,
    }, undefined, adminTest) : await get();
    const duplicateRef = response.status === 409 && response.body.code === "DUPLICATE_REF_ID";
    if (duplicateRef) { response = await get(); posted = false; }
    const accepted = response.status >= 200 && response.status < 300 && response.body.status === true;
    const alreadyExists = response.status === 409 && response.body.code === "PAYMENT_ALREADY_EXISTS";
    if (!accepted && !alreadyExists) {
      // Klasifikasi penting untuk pemulihan:
      // - `DUPLICATE_REF_ID` (dan GET susulannya) / 502 / 504 = transport/proxy atau sinyal
      //   "ref mungkin sudah dipakai" => AMBIGU, klaim dipertahankan, JANGAN pernah dianggap
      //   "invoice tidak ada". Timeout/jaringan/502-unreadable sudah dipetakan transport.
      // - Rejeksi lain yang TERBACA (4xx/5xx JSON dari provider) => belum ada invoice id
      //   tersimpan; pemanggil boleh meminta `confirmGatewayInvoiceAbsent` (GET read-only)
      //   sebelum membatalkan apa pun. Tidak pernah POST ulang.
      if (duplicateRef || response.status === 502 || response.status === 504) throw new Error("sekalipay_gateway_create_ambiguous");
      throw new Error("sekalipay_gateway_create_rejected");
    }
    const data = response.body.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("sekalipay_gateway_invalid_invoice");
    const invoice = data as Row;
    const remoteSandbox = invoice.is_sandbox;
    if (posted ? typeof remoteSandbox !== "boolean" : remoteSandbox !== undefined && typeof remoteSandbox !== "boolean") throw new Error("sekalipay_gateway_invalid_invoice");
    if (typeof remoteSandbox === "boolean" && storedSandbox !== null && remoteSandbox !== storedSandbox) throw new Error("sekalipay_gateway_invalid_invoice");
    const sandbox = typeof remoteSandbox === "boolean" ? remoteSandbox : storedSandbox;
    if (sandbox === null) throw new Error("sekalipay_gateway_invalid_invoice");
    if (invoice.merchant_ref_id === orderCode && typeof invoice.invoice === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(invoice.invoice)) {
      // finalize probe: claim the invoice id atomically WITH the view row.
      // If THIS claim is the one blocked, the TX must still review-stick so
      // a late/duplicate POST cannot be rendered as a fresh invoice.
      await execRun(`UPDATE payment_transactions SET provider_payment_id=COALESCE(provider_payment_id,?),
        gateway_is_sandbox=COALESCE(gateway_is_sandbox,?),
        last_error=CASE WHEN provider_payment_id IS NULL THEN COALESCE(last_error,'sekalipay_gateway_finalize_probe') ELSE last_error END,
        updated_at=datetime('now') WHERE order_code=? AND provider='sekalipay_gateway' AND status='initializing'`,
        invoice.invoice, typeof remoteSandbox === "boolean" ? (remoteSandbox ? 1 : 0) : null, orderCode);
    }
    if (invoice.merchant_ref_id !== orderCode || typeof invoice.invoice !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(invoice.invoice)
      || invoice.payment_code !== channel || invoice.amount !== amount || !Number.isSafeInteger(invoice.fee) || Number(invoice.fee) < 0
      || !Number.isSafeInteger(invoice.total) || Number(invoice.total) !== amount! + Number(invoice.fee)
      || typeof invoice.expired_at !== "string"
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(invoice.expired_at) || !parseFxTimestamp(invoice.expired_at)
      || invoice.status !== "pending") throw new Error("sekalipay_gateway_invalid_invoice");
    const link = paymentUrl(invoice.payment_link);
    if (!link) throw new Error("sekalipay_gateway_invalid_invoice");
    const checkout = optionalCheckoutUrl(invoice.checkout_url);
    if (invoice.virtual_account != null && (typeof invoice.virtual_account !== "string" || !/^[A-Za-z0-9 -]{1,100}$/.test(invoice.virtual_account))) throw new Error("sekalipay_gateway_invalid_invoice");
    const required = Number(invoice.fee) !== estimatedFee;
    const updated = await execRun(`UPDATE payment_transactions SET payable_amount=?,gateway_fee=?,gateway_fee_consent_required=?,gateway_fee_consented_at=CASE WHEN ?=0 THEN datetime('now') ELSE NULL END,
      direct_url=?,gateway_virtual_account=?,gateway_checkout_url=?,gateway_is_sandbox=?,expires_at=?,
      status='pending',last_error=CASE WHEN last_error IS NOT NULL AND last_error NOT IN ('sekalipay_gateway_finalize_probe','sekalipay_gateway_finalize_manual_review') THEN last_error WHEN EXISTS(SELECT 1 FROM orders o WHERE o.code=payment_transactions.order_code AND o.status='pending' AND o.payment_status IN ('pending','unpaid') AND julianday(o.expires_at)>julianday('now')) AND julianday(?)>julianday('now') THEN NULL ELSE 'sekalipay_gateway_late_manual_review' END,updated_at=datetime('now')
      WHERE order_code=? AND provider='sekalipay_gateway' AND status='initializing' AND provider_payment_id=?
        AND provider_order_id=? AND requested_amount=? AND gateway_channel=? AND gateway_estimated_fee=?
        AND EXISTS(SELECT 1 FROM orders o WHERE o.code=payment_transactions.order_code AND o.subtotal=? AND o.payment_method=?)`,
      invoice.total, invoice.fee, required ? 1 : 0, required ? 1 : 0, link, invoice.virtual_account ?? null, checkout, sandbox ? 1 : 0, invoice.expired_at, invoice.expired_at, orderCode, invoice.invoice, orderCode, amount, channel, estimatedFee, amount, `sekalipay_gateway:${channel}`);
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

async function alertGatewayManualReviewOnce(orderCode: string, reason: string, db: DatabaseAccess): Promise<void> {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!chatId || !token) return;
  const claimed = await db.execRun(
    `UPDATE payment_transactions SET last_admin_alert_at=datetime('now'),updated_at=datetime('now')
     WHERE order_code=? AND provider='sekalipay_gateway' AND last_admin_alert_at IS NULL`,
    orderCode,
  ).catch(() => ({ changes: 0 }));
  if (Number(claimed.changes) !== 1) return;
  try {
    const { sendMessage } = await import("@/lib/telegram/api");
    const res = await sendMessage({
      chat_id: chatId,
      text: `Pembayaran Sekalipay Gateway perlu diperiksa manual.\nPesanan: ${orderCode}\nAlasan: ${reason}. Produk tidak dikirim otomatis. Periksa Metode & Rekonsiliasi.`,
    });
    if (!res.ok) {
      await db.execRun(
        "UPDATE payment_transactions SET last_admin_alert_at=NULL WHERE order_code=? AND provider='sekalipay_gateway'",
        orderCode,
      ).catch(() => {});
    }
  } catch {
    await db.execRun(
      "UPDATE payment_transactions SET last_admin_alert_at=NULL WHERE order_code=? AND provider='sekalipay_gateway'",
      orderCode,
    ).catch(() => {});
  }
}

export function reconcileSekalipayGatewayPayment(orderCode?: string, db: DatabaseAccess = createDatabaseAccess()): Promise<"paid" | "already_paid" | "pending" | "manual_review"> {
  if (!orderCode) throw new Error("sekalipay_gateway_not_configured");
  return (async () => {
    if (!/^(?:AXV|AXP|AXG)-\d{8}-[A-Z0-9]{8}$/.test(orderCode)) throw new Error("sekalipay_gateway_invalid_input");
    const tx = await db.queryFirst(`SELECT pt.*,o.status AS order_status,o.payment_status AS order_payment_status,o.expires_at AS order_expires_at,
      o.payment_method AS order_method,o.subtotal AS order_subtotal,o.variant_id,o.sales_channel,o.order_kind
      FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code WHERE pt.order_code=? AND pt.provider='sekalipay_gateway'`, orderCode);
    if (!tx) throw new Error("sekalipay_gateway_transaction_missing");
    if (tx.status === "paid" && tx.order_payment_status === "paid") return "already_paid";
    const response = await gatewayFetch("GET", `payment/${orderCode}`, {}, db);
    await db.execRun("UPDATE payment_transactions SET last_checked_at=datetime('now'),updated_at=datetime('now') WHERE order_code=? AND provider='sekalipay_gateway'", orderCode);
    if (response.status !== 200 || response.body.status !== true || !response.body.data || typeof response.body.data !== "object" || Array.isArray(response.body.data)) throw new Error("sekalipay_gateway_status_unavailable");
    const data = response.body.data as Row;
    // GET payment-status resmi tidak mengirim `is_sandbox` (sama seperti create tanpa field itu). Mode sandbox yang
    // tepercaya adalah nilai create-time tersimpan; field GET hanya boleh memastikan kecocokan bila ada.
    const storedSandbox = tx.gateway_is_sandbox == null ? null : Number(tx.gateway_is_sandbox) === 1;
    const remoteSandbox = data.is_sandbox;
    const sandboxOk = remoteSandbox === undefined || typeof remoteSandbox === "boolean";
    const sandbox = typeof remoteSandbox === "boolean" ? remoteSandbox : storedSandbox;
    const review = async (reason: string) => {
      await db.execRun("UPDATE payment_transactions SET last_error=CASE WHEN last_error IS NULL OR last_error IN ('sekalipay_gateway_finalize_probe','sekalipay_gateway_finalize_manual_review') THEN ? ELSE last_error END,last_checked_at=datetime('now'),updated_at=datetime('now') WHERE order_code=? AND provider='sekalipay_gateway' AND status!='paid'", reason, orderCode);
      if (reason === "sekalipay_gateway_late_manual_review") await alertGatewayManualReviewOnce(orderCode, reason, db);
      return "manual_review" as const;
    };
    if (!tx.provider_payment_id || tx.payable_amount == null || tx.gateway_fee == null || tx.gateway_is_sandbox == null) {
      if (tx.status !== "initializing" || tx.provider_order_id !== orderCode || tx.order_subtotal !== tx.requested_amount
        || tx.order_method !== `sekalipay_gateway:${tx.gateway_channel}` || data.merchant_ref_id !== orderCode
        || typeof data.invoice !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(data.invoice)
        || (tx.provider_payment_id != null && tx.provider_payment_id !== data.invoice)
        || data.payment_code !== tx.gateway_channel || data.amount !== tx.requested_amount
        || !Number.isSafeInteger(data.fee) || Number(data.fee) < 0 || !Number.isSafeInteger(data.total)
        || Number(data.amount) + Number(data.fee) !== data.total
        || !sandboxOk || (typeof remoteSandbox === "boolean" && storedSandbox !== null && remoteSandbox !== storedSandbox)
        || sandbox === null) return review("sekalipay_gateway_status_mismatch_manual_review");
      if (data.status === "pending") throw new Error("sekalipay_gateway_initializing");
      await db.execRun(`UPDATE payment_transactions SET provider_payment_id=COALESCE(provider_payment_id,?),payable_amount=COALESCE(payable_amount,?),
        gateway_fee=COALESCE(gateway_fee,?),gateway_is_sandbox=COALESCE(gateway_is_sandbox,?),gateway_fee_consent_required=1,
        last_error=CASE WHEN last_error IS NULL OR last_error IN ('sekalipay_gateway_finalize_probe','sekalipay_gateway_finalize_manual_review') THEN 'sekalipay_gateway_initializing_paid_manual_review' ELSE last_error END,
        last_checked_at=datetime('now'),updated_at=datetime('now') WHERE order_code=? AND provider='sekalipay_gateway' AND status='initializing'
        AND (provider_payment_id IS NULL OR provider_payment_id=?)`, data.invoice, data.total, data.fee, sandbox ? 1 : 0, orderCode, data.invoice);
      await alertGatewayManualReviewOnce(orderCode, "sekalipay_gateway_initializing_paid_manual_review", db);
      return "manual_review";
    }
    if (data.merchant_ref_id !== orderCode || data.invoice !== tx.provider_payment_id || data.payment_code !== tx.gateway_channel
      || data.amount !== tx.requested_amount || data.fee !== tx.gateway_fee || data.total !== tx.payable_amount
      || !Number.isSafeInteger(data.amount) || !Number.isSafeInteger(data.fee) || !Number.isSafeInteger(data.total)
      || Number(data.fee) < 0 || Number(data.amount) + Number(data.fee) !== data.total
      || !sandboxOk || (typeof remoteSandbox === "boolean" && remoteSandbox !== storedSandbox)
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
    const changed = await transitionPendingPaymentToPaid(orderCode, paidAt, tx.order_kind === "pedia" || tx.order_kind === "games" ? null : {
      variantId: tx.variant_id == null ? null : Number(tx.variant_id), inventoryId: null, salesChannel: String(tx.sales_channel),
    }, { id: Number(event.id) }, { paymentMethod: "sekalipay_gateway", eventMode: "gateway" }, db.d1);
    if (!changed) {
      const current = await db.queryFirst("SELECT status,payment_status FROM orders WHERE code=?", orderCode);
      if (current?.payment_status === "paid") return "already_paid";
      return review("sekalipay_gateway_race_manual_review");
    }
    if (tx.order_kind === "games") {
      const { schedulePaidFulfillment } = await import("./paid-fulfillment");
      await schedulePaidFulfillment(orderCode, "games");
    }
    return "paid";
  })();
}

export const SEKALIPAY_GATEWAY_STALE_LIMIT = 5;

/**
 * Rekonsiliasi berbatas untuk transaksi `sekalipay_gateway` non-final yang order-nya sudah final
 * atau lewat `expires_at` + grace 30 menit:
 * - `initializing` tanpa `provider_payment_id` / `provider_order_id` -> tutup `expired` tanpa memanggil provider.
 * - punya ref -> cek GET read-only (`payment/<ref>`): unpaid/expired/failed/404 -> `expired`/`failed`
 *   sesuai status order; paid -> `sekalipay_gateway_late_manual_review` + alert admin Telegram sekali
 *   tanpa mengubah order; error/ambigu -> biarkan, coba lagi minimal 30 menit kemudian.
 */
export async function reconcileStaleSekalipayGatewayPayments(
  db: DatabaseAccess = createDatabaseAccess(),
  options?: { limit?: number },
): Promise<{ gateway_stale_checked: number; gateway_stale_closed: number; gateway_stale_manual_review: number }> {
  const out = { gateway_stale_checked: 0, gateway_stale_closed: 0, gateway_stale_manual_review: 0 };
  if (!db.canSpend(2)) return out;
  const limit = Math.max(1, Math.min(options?.limit ?? SEKALIPAY_GATEWAY_STALE_LIMIT, 10));
  const rows = await db.queryAll(
    `SELECT pt.order_code, pt.status, pt.provider_order_id, pt.provider_payment_id,
            pt.gateway_is_sandbox, pt.last_error, o.status AS order_status
     FROM payment_transactions pt
     JOIN orders o ON o.code = pt.order_code
     WHERE pt.provider = 'sekalipay_gateway'
       AND pt.status IN ('initializing', 'pending')
       AND COALESCE(pt.last_error, '') NOT LIKE '%manual_review%'
       AND COALESCE(pt.last_error, '') NOT LIKE '%needs_review%'
       AND (
         o.status IN ('kadaluarsa', 'dibatalkan', 'batal', 'expired', 'failed')
         OR (
           (pt.expires_at IS NOT NULL OR o.expires_at IS NOT NULL)
           AND MIN(COALESCE(julianday(pt.expires_at), 1e18), COALESCE(julianday(o.expires_at), 1e18)) <= julianday('now', '-30 minutes')
         )
       )
       AND (pt.last_checked_at IS NULL OR julianday(pt.last_checked_at) <= julianday('now', '-30 minutes'))
     ORDER BY COALESCE(pt.last_checked_at, pt.created_at) ASC, pt.id ASC
     LIMIT ?`,
    limit,
  );
  const gatewayKeysReady = Boolean(
    process.env.SEKALIPAY_GATEWAY_API_KEY?.trim() && process.env.SEKALIPAY_GATEWAY_SECRET_KEY?.trim(),
  );
  const flagReview = async (orderCode: string, reason: string, remoteStatus: string | null, invoiceId: string | null) => {
    await db.execRun(
      `UPDATE payment_transactions
       SET provider_payment_id = COALESCE(provider_payment_id, ?),
           provider_status_text = COALESCE(?, provider_status_text),
           last_error = CASE
             WHEN last_error IS NULL OR last_error IN ('sekalipay_gateway_finalize_probe','sekalipay_gateway_finalize_manual_review','sekalipay_gateway_create_rejected') THEN ?
             ELSE last_error
           END,
           last_checked_at = datetime('now'),
           updated_at = datetime('now')
       WHERE order_code = ? AND provider = 'sekalipay_gateway' AND status != 'paid'`,
      invoiceId,
      remoteStatus,
      reason,
      orderCode,
    );
    await alertGatewayManualReviewOnce(orderCode, reason, db);
    out.gateway_stale_manual_review++;
  };
  for (const row of rows) {
    const orderCode = String(row.order_code);
    const hasProviderInvoiceId = typeof row.provider_payment_id === "string" && row.provider_payment_id.trim().length > 0;
    const providerOrderRef = typeof row.provider_order_id === "string" && row.provider_order_id.trim().length > 0
      ? row.provider_order_id.trim()
      : null;
    if (row.status === "initializing" && (!hasProviderInvoiceId || !providerOrderRef)) {
      if (!db.canSpend(1)) break;
      const closed = await db.execRun(
        `UPDATE payment_transactions
         SET status = 'expired',
             last_checked_at = datetime('now'),
             updated_at = datetime('now')
         WHERE order_code = ? AND provider = 'sekalipay_gateway'
           AND status = 'initializing' AND provider_payment_id IS NULL
           -- Buyer never received payment instructions: safe to close without the provider.
          AND gateway_checkout_url IS NULL AND gateway_virtual_account IS NULL AND qris_payload IS NULL AND qris_url IS NULL AND direct_url IS NULL AND provider_qris_url IS NULL`,
        orderCode,
      );
      if (Number(closed.changes) === 1) out.gateway_stale_closed++;
      continue;
    }
    if (!gatewayKeysReady) continue;
    if (!db.canSpend(4)) break;
    const claimed = await db.execRun(
      `UPDATE payment_transactions
       SET last_checked_at = datetime('now'), updated_at = datetime('now')
       WHERE order_code = ? AND provider = 'sekalipay_gateway'
         AND status IN ('initializing', 'pending')
         AND COALESCE(last_error, '') NOT LIKE '%manual_review%'
         AND COALESCE(last_error, '') NOT LIKE '%needs_review%'
         AND (last_checked_at IS NULL OR julianday(last_checked_at) <= julianday('now', '-30 minutes'))`,
      orderCode,
    );
    if (Number(claimed.changes) !== 1) continue;
    out.gateway_stale_checked++;
    const ref = providerOrderRef ?? orderCode;
    let response: Awaited<ReturnType<typeof gatewayFetch>>;
    try {
      response = await gatewayFetch("GET", `payment/${ref}`, {}, db);
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      continue;
    }
    const orderStatus = String(row.order_status ?? "");
    const closedStatus = orderStatus === "dibatalkan" || orderStatus === "failed" ? "failed" : "expired";
    if (response.status === 404) {
      const closed = await db.execRun(
        `UPDATE payment_transactions
         SET status = ?, last_checked_at = datetime('now'), updated_at = datetime('now')
         WHERE order_code = ? AND provider = 'sekalipay_gateway' AND status IN ('initializing', 'pending')`,
        closedStatus,
        orderCode,
      );
      if (Number(closed.changes) === 1) out.gateway_stale_closed++;
      continue;
    }
    if (
      response.status !== 200
      || response.body.status !== true
      || !response.body.data
      || typeof response.body.data !== "object"
      || Array.isArray(response.body.data)
    ) {
      continue;
    }
    const data = response.body.data as Row;
    const remoteStatus = typeof data.status === "string" ? data.status.trim().toLowerCase() : "";
    const safeStatusText = /^[a-z_]{1,32}$/.test(remoteStatus) ? remoteStatus : null;
    const invoiceId = typeof data.invoice === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(data.invoice)
      ? data.invoice
      : null;
    const refMismatch = (typeof data.merchant_ref_id === "string"
      && data.merchant_ref_id !== orderCode && data.merchant_ref_id !== ref)
      || (hasProviderInvoiceId && typeof data.invoice === "string" && data.invoice !== String(row.provider_payment_id));
    if (refMismatch) {
      await flagReview(orderCode, "sekalipay_gateway_status_mismatch_manual_review", safeStatusText, null);
      continue;
    }
    if (["pending", "unpaid", "expired", "canceled", "cancelled", "failed"].includes(remoteStatus)) {
      const closed = await db.execRun(
        `UPDATE payment_transactions
         SET status = ?,
             provider_status_text = COALESCE(?, provider_status_text),
             last_checked_at = datetime('now'),
             updated_at = datetime('now')
         WHERE order_code = ? AND provider = 'sekalipay_gateway' AND status IN ('initializing', 'pending')`,
        closedStatus,
        safeStatusText,
        orderCode,
      );
      if (Number(closed.changes) === 1) out.gateway_stale_closed++;
      continue;
    }
    const storedSandbox = row.gateway_is_sandbox == null ? null : Number(row.gateway_is_sandbox) === 1;
    const remoteSandbox = data.is_sandbox;
    if (typeof remoteSandbox === "boolean" && storedSandbox !== null && remoteSandbox !== storedSandbox) {
      await flagReview(orderCode, "sekalipay_gateway_status_mismatch_manual_review", safeStatusText, null);
      continue;
    }
    const isSandbox = typeof remoteSandbox === "boolean" ? remoteSandbox : storedSandbox;
    const isPaid = remoteStatus === "paid" || (remoteStatus === "completed" && isSandbox === true);
    if (isPaid) {
      await flagReview(orderCode, "sekalipay_gateway_late_manual_review", safeStatusText, invoiceId);
      continue;
    }
    if (remoteStatus) {
      await flagReview(orderCode, "sekalipay_gateway_status_manual_review", safeStatusText, invoiceId);
    }
  }
  return out;
}
