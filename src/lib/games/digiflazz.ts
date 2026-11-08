// src/lib/games/digiflazz.ts — klien Digiflazz server-side (docs/GAMES.md §12.1).
//
// Pages TIDAK mengirim API key ke VPS: body ditandatangani di sini
// (`sign = md5(username + key + X)`), lalu diteruskan apa adanya oleh proxy
// `/dgf/v1/*` di VPS (IP whitelist Digiflazz). Edge-compatible: tanpa node:crypto.
// Jangan pernah mencatat username/key/sign.

import { fetchWithTimeout } from "@/lib/fetch-timeout";

export const DIGIFLAZZ_TRANSACTION_TIMEOUT_MS = 30_000;
export const DIGIFLAZZ_DEFAULT_TIMEOUT_MS = 20_000;
export type DigiflazzEndpoint = "cek-saldo" | "price-list" | "transaction";

// ---- MD5 (RFC 1321), murni TS --------------------------------------------

const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 8) >> 6 << 6) + 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLen >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLen / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < padded.length; off += 64) {
    const m = Array.from({ length: 16 }, (_, i) => view.getUint32(off + i * 4, true));
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const sum = (a + (f >>> 0) + MD5_K[i] + m[g]) >>> 0;
      const s = MD5_S[(i >> 4) * 4 + (i % 4)];
      a = d; d = c; c = b;
      b = (b + (((sum << s) | (sum >>> (32 - s))) >>> 0)) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true));
  return Array.from(new Uint8Array(out.buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function digiflazzSign(username: string, key: string, suffix: string): string {
  return md5Hex(username + key + suffix);
}

// ---- Config ---------------------------------------------------------------

const proxyOrigin = () => (process.env.WARUNG_REBAHAN_PROXY_URL || "").replace(/\/+$/, "");
const proxyToken = () => (proxyOrigin() ? process.env.WARUNG_REBAHAN_PROXY_TOKEN || "" : "");
const credentials = () => ({ username: process.env.DIGIFLAZZ_USERNAME || "", key: process.env.DIGIFLAZZ_API_KEY || "" });
const isTestingMode = () => process.env.DIGIFLAZZ_TESTING === "true";

/** Kredensial Digiflazz + proxy VPS lengkap. Tanpa ini semua job Games no-op. */
export function isDigiflazzConfigured(): boolean {
  const c = credentials();
  return Boolean(c.username && c.key && proxyOrigin() && proxyToken());
}

// ---- Transport ------------------------------------------------------------

export type DigiflazzCallResult =
  | { kind: "ok"; status: number; json: unknown }
  | { kind: "ambiguous"; reason: string }
  | { kind: "config"; reason: string }
  | { kind: "http_error"; status: number; json: unknown };

export async function callDigiflazz(endpoint: DigiflazzEndpoint, body: Record<string, unknown>): Promise<DigiflazzCallResult> {
  if (!proxyOrigin() || !proxyToken()) return { kind: "config", reason: "proxy_not_configured" };
  const timeout = endpoint === "transaction" ? DIGIFLAZZ_TRANSACTION_TIMEOUT_MS : DIGIFLAZZ_DEFAULT_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetchWithTimeout(`${proxyOrigin()}/dgf/v1/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-proxy-token": proxyToken() },
      body: JSON.stringify(body),
      redirect: "manual",
    }, timeout);
  } catch {
    return { kind: "ambiguous", reason: "network_or_timeout" };
  }
  if (res.status === 401 || res.status === 404) return { kind: "config", reason: `proxy_${res.status}` };
  if (res.status === 502 || res.status === 504) return { kind: "ambiguous", reason: `proxy_${res.status}` };
  if (res.status >= 300 && res.status < 400) return { kind: "config", reason: "proxy_redirect" };
  let text = "";
  try { text = await res.text(); } catch { return { kind: "ambiguous", reason: "unreadable_body" }; }
  let json: unknown;
  try { json = JSON.parse(text); } catch {
    // Non-2xx tanpa JSON (mis. 500 HTML) tetap tidak terbaca → ambigu, bukan keputusan final.
    return { kind: "ambiguous", reason: "unreadable_json" };
  }
  if (res.status >= 200 && res.status < 300) return { kind: "ok", status: res.status, json };
  return { kind: "http_error", status: res.status, json };
}

// ---- Helpers --------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const dataOf = (json: unknown): unknown => (isRecord(json) ? json.data : undefined);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v.trim()); return Number.isFinite(n) ? n : null; }
  return null;
}
function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return ["true", "1", "yes"].includes(v.trim().toLowerCase());
  return false;
}

export type DigiflazzApiError = { kind: "api_error"; rc: string; message: string };

export async function checkBalance(): Promise<DigiflazzCallResult | { kind: "balance"; deposit: number } | DigiflazzApiError> {
  const { username, key } = credentials();
  if (!isDigiflazzConfigured()) return { kind: "config", reason: "not_configured" };
  const r = await callDigiflazz("cek-saldo", { cmd: "deposit", username, sign: digiflazzSign(username, key, "depo") });
  if (r.kind !== "ok") return r;
  const data = dataOf(r.json);
  const deposit = isRecord(data) ? num(data.deposit) : null;
  if (deposit === null) return apiError(data);
  return { kind: "balance", deposit };
}

function apiError(data: unknown): DigiflazzApiError {
  const d = isRecord(data) ? data : {};
  return { kind: "api_error", rc: str(d.rc), message: str(d.message).slice(0, 200) };
}

export interface DigiflazzPriceItem {
  buyer_sku_code: string;
  product_name: string;
  category: string;
  brand: string;
  type: string;
  price: number;
  buyer_product_status: boolean;
  seller_product_status: boolean;
  unlimited_stock: boolean;
  stock: number;
  multi: boolean;
  start_cut_off: string;
  end_cut_off: string;
  desc: string;
}

export type PriceListResult =
  | { kind: "ok"; items: DigiflazzPriceItem[]; invalid: number }
  | Exclude<DigiflazzCallResult, { kind: "ok" }>
  | DigiflazzApiError;

export function parsePriceItem(raw: unknown): DigiflazzPriceItem | null {
  if (!isRecord(raw)) return null;
  const code = str(raw.buyer_sku_code).trim();
  const price = num(raw.price);
  if (!code || price === null || price < 0) return null;
  return {
    buyer_sku_code: code,
    product_name: str(raw.product_name).trim(),
    category: str(raw.category).trim(),
    brand: str(raw.brand).trim(),
    type: str(raw.type).trim(),
    price,
    buyer_product_status: bool(raw.buyer_product_status),
    seller_product_status: bool(raw.seller_product_status),
    unlimited_stock: bool(raw.unlimited_stock),
    stock: num(raw.stock) ?? 0,
    multi: bool(raw.multi),
    start_cut_off: str(raw.start_cut_off).trim() || "00:00",
    end_cut_off: str(raw.end_cut_off).trim() || "00:00",
    desc: str(raw.desc),
  };
}

export async function fetchPrepaidPriceList(): Promise<PriceListResult> {
  const { username, key } = credentials();
  if (!isDigiflazzConfigured()) return { kind: "config", reason: "not_configured" };
  const r = await callDigiflazz("price-list", { cmd: "prepaid", username, sign: digiflazzSign(username, key, "pricelist") });
  if (r.kind !== "ok") return r;
  const data = dataOf(r.json);
  // Rate limit / salah sign: `data` berupa objek {rc,message}, bukan array.
  if (!Array.isArray(data)) return apiError(data);
  const items: DigiflazzPriceItem[] = [];
  let invalid = 0;
  for (const row of data) {
    const item = parsePriceItem(row);
    if (item) items.push(item); else invalid++;
  }
  return { kind: "ok", items, invalid };
}

export type DigiflazzTxStatus = "Sukses" | "Pending" | "Gagal";
export interface DigiflazzTransaction {
  ref_id: string;
  status: DigiflazzTxStatus;
  rc: string;
  message: string;
  sn: string | null;
  price: number | null;
  buyer_sku_code: string;
}

/** Parse `data` respons transaksi. Status tak dikenal → null (pemanggil: ambigu). */
export function parseTransactionData(data: unknown): DigiflazzTransaction | null {
  if (!isRecord(data)) return null;
  const s = str(data.status).trim().toLowerCase();
  const status: DigiflazzTxStatus | null = s === "sukses" ? "Sukses" : s === "pending" ? "Pending" : s === "gagal" ? "Gagal" : null;
  const refId = str(data.ref_id).trim();
  if (!status || !refId) return null;
  const sn = str(data.sn).trim();
  return {
    ref_id: refId, status, rc: str(data.rc).trim(), message: str(data.message).slice(0, 300),
    sn: sn || null, price: num(data.price), buyer_sku_code: str(data.buyer_sku_code).trim(),
  };
}

export type SendTransactionResult =
  | { kind: "ok"; tx: DigiflazzTransaction }
  | Exclude<DigiflazzCallResult, { kind: "ok" }>;

/** Kirim (atau cek ulang dengan payload & ref_id SAMA) transaksi top-up. */
export async function sendTransaction(input: {
  buyer_sku_code: string; customer_no: string; ref_id: string; max_price: number;
}): Promise<SendTransactionResult> {
  const { username, key } = credentials();
  if (!isDigiflazzConfigured()) return { kind: "config", reason: "not_configured" };
  const body: Record<string, unknown> = {
    username,
    buyer_sku_code: input.buyer_sku_code,
    customer_no: input.customer_no,
    ref_id: input.ref_id,
    max_price: input.max_price,
    sign: digiflazzSign(username, key, input.ref_id),
  };
  if (isTestingMode()) body.testing = true;
  const r = await callDigiflazz("transaction", body);
  if (r.kind === "ok" || r.kind === "http_error") {
    const tx = parseTransactionData(dataOf(r.json));
    if (tx) return { kind: "ok", tx };
    // 2xx dengan status tak dikenal/tak terbaca: jangan ambil keputusan final.
    if (r.kind === "ok") return { kind: "ambiguous", reason: "unknown_status" };
    // 5xx tanpa data transaksi: nasib transaksi tidak diketahui.
    if (r.status >= 500) return { kind: "ambiguous", reason: `http_${r.status}` };
    return r;
  }
  return r;
}
