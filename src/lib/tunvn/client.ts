// src/lib/tunvn/client.ts — klien server-side TUNVN PREHUB (reseller Telegram).
//
// Setup awal 2026-11-09 (instruksi owner): fondasi SAJA. Tidak ada produk
// TUNVN yang ditampilkan, tidak ada pembelian/deposit/order buyer. Klien ini
// hanya diekspor untuk dipakai sync tersembunyi + test; tidak ada route,
// katalog publik, checkout, cron order, atau UI yang memanggilnya.
//
// Kontrak upstream (https://tunvnmmo.duckdns.org/api/docs, dibaca 2026-11-09):
//   header `X-API-Key: <TUNVN_API_KEY>`; base URL TUNVN_BASE_URL
//   (default https://tunvnmmo.duckdns.org).
//   GET  /api/products  → {success, products:[{id,name,price_vnd,price_usdt,
//                         discount_threshold,discount_price_vnd,
//                         discount_threshold_usdt,discount_price_usdt,
//                         stock,description}], usdt_vnd}
//   GET  /api/balance   → {success,user_id,username,balance_vnd,balance_usdt,
//                         usdt_vnd}
//   GET  /api/rate      → {success,usdt_vnd,description} (publik, tetap
//                         dipanggil lewat jalur yang sama)
//   POST /api/buy       → SENGAJA tidak diimplementasikan pada setup awal.
//   POST /api/deposit   → SENGAJA tidak diimplementasikan pada setup awal.
//
// Keamanan/keandalan:
// - API key TIDAK PERNAH dicatat, tidak masuk error message/return, dan tidak
//   dikirim ke URL selain TUNVN_BASE_URL yang terkonfigurasi.
// - 5 key salah/60 dtk memicu blokir sementara di upstream → semua panggilan
//   di sini READ-ONLY dan tidak ada retry otomatis; 401/403 tidak diulang.
// - Hasil jaringan tak terbaca/timeout diklasifikasikan `ambiguous` agar
//   pemanggil masa depan tidak pernah menganggapnya stok/saldo nol.

import { fetchWithTimeout } from "@/lib/fetch-timeout";

export const TUNVN_DEFAULT_BASE_URL = "https://tunvnmmo.duckdns.org";
export const TUNVN_PRODUCTS_TIMEOUT_MS = 20_000;
export const TUNVN_DEFAULT_TIMEOUT_MS = 15_000;

/** Master switch. Default MATI: tanpa env ini semua fungsi no-op total. */
export function isTunvnEnabled(): boolean {
  return process.env.TUNVN_ENABLED === "true";
}

/** Katalog tersembunyi hanya boleh disinkron bila master switch DAN saklar
 *  sync menyala secara eksplisit. Default keduanya mati. */
export function isTunvnSyncEnabled(): boolean {
  return isTunvnEnabled() && process.env.TUNVN_SYNC_ENABLED === "true";
}

export function getTunvnApiKey(): string {
  return (process.env.TUNVN_API_KEY || "").trim();
}

export function getTunvnBaseUrl(): string {
  return (process.env.TUNVN_BASE_URL || TUNVN_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
}

/** Konfigurasi lengkap = switch menyala + key ada + base URL HTTPS valid. */
export function isTunvnConfigured(): boolean {
  if (!isTunvnEnabled()) return false;
  if (!getTunvnApiKey()) return false;
  try {
    const url = new URL(getTunvnBaseUrl());
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export type TunvnCallResult =
  | { kind: "ok"; status: number; json: unknown }
  | { kind: "ambiguous"; reason: string }
  | { kind: "config"; reason: string }
  | { kind: "http_error"; status: number };

type TunvnReadEndpoint = "products" | "balance" | "rate";

/** Satu-satunya transport TUNVN pada setup awal: GET read-only, tanpa retry,
 *  tanpa body, dan key hanya pada header request ke base URL terkonfigurasi. */
export async function callTunvnRead(endpoint: TunvnReadEndpoint): Promise<TunvnCallResult> {
  if (!isTunvnConfigured()) return { kind: "config", reason: "not_configured" };
  const timeout = endpoint === "products" ? TUNVN_PRODUCTS_TIMEOUT_MS : TUNVN_DEFAULT_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetchWithTimeout(`${getTunvnBaseUrl()}/api/${endpoint}`, {
      method: "GET",
      headers: { "x-api-key": getTunvnApiKey(), accept: "application/json" },
      redirect: "manual",
    }, timeout);
  } catch {
    return { kind: "ambiguous", reason: "network_or_timeout" };
  }
  if (res.status === 401 || res.status === 403) return { kind: "config", reason: `auth_${res.status}` };
  if (res.status >= 300 && res.status < 400) return { kind: "config", reason: "unexpected_redirect" };
  if (res.status === 429 || res.status >= 500) return { kind: "ambiguous", reason: `http_${res.status}` };
  if (res.status < 200 || res.status >= 300) return { kind: "http_error", status: res.status };
  let text = "";
  try { text = await res.text(); } catch { return { kind: "ambiguous", reason: "unreadable_body" }; }
  try {
    return { kind: "ok", status: res.status, json: JSON.parse(text) };
  } catch {
    return { kind: "ambiguous", reason: "unreadable_json" };
  }
}

// ---- Parser (murni, dapat diuji tanpa jaringan) ---------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v.trim()); return Number.isFinite(n) ? n : null; }
  return null;
}
const nonNegativeInt = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n >= 0 ? Math.trunc(n) : null;
};

export interface TunvnProduct {
  supplier_product_id: number;
  name: string;
  description: string;
  price_vnd: number;
  /** Harga USDT upstream apa adanya (maks 4 desimal); null bila upstream
   *  mengirim <= 0 / tak terbaca — jangan menebak kurs untuk mengisinya. */
  price_usdt: number | null;
  stock: number;
  discount_threshold: number;
  discount_price_vnd: number | null;
  discount_threshold_usdt: number;
  discount_price_usdt: number | null;
}

export function parseTunvnProduct(raw: unknown): TunvnProduct | null {
  if (!isRecord(raw)) return null;
  const id = num(raw.id);
  const name = str(raw.name).trim();
  const priceVnd = nonNegativeInt(raw.price_vnd);
  const stock = nonNegativeInt(raw.stock);
  if (id === null || !Number.isInteger(id) || id <= 0 || !name || priceVnd === null || stock === null) return null;
  const usdt = num(raw.price_usdt);
  const discountVnd = nonNegativeInt(raw.discount_price_vnd);
  const discountUsdt = num(raw.discount_price_usdt);
  return {
    supplier_product_id: id,
    name,
    description: str(raw.description),
    price_vnd: priceVnd,
    price_usdt: usdt !== null && usdt > 0 ? usdt : null,
    stock,
    discount_threshold: nonNegativeInt(raw.discount_threshold) ?? 0,
    discount_price_vnd: discountVnd !== null && discountVnd > 0 ? discountVnd : null,
    discount_threshold_usdt: nonNegativeInt(raw.discount_threshold_usdt) ?? 0,
    discount_price_usdt: discountUsdt !== null && discountUsdt > 0 ? discountUsdt : null,
  };
}

export type TunvnProductsResult =
  | { kind: "ok"; items: TunvnProduct[]; invalid: number; usdt_vnd: number | null }
  | Exclude<TunvnCallResult, { kind: "ok" }>
  | { kind: "api_error"; detail: string };

export async function fetchTunvnProducts(): Promise<TunvnProductsResult> {
  const r = await callTunvnRead("products");
  if (r.kind !== "ok") return r;
  if (!isRecord(r.json) || r.json.success !== true || !Array.isArray(r.json.products)) {
    return { kind: "api_error", detail: "products_shape" };
  }
  const items: TunvnProduct[] = [];
  let invalid = 0;
  for (const row of r.json.products) {
    const item = parseTunvnProduct(row);
    if (item) items.push(item); else invalid++;
  }
  const rate = num(r.json.usdt_vnd);
  return { kind: "ok", items, invalid, usdt_vnd: rate !== null && rate > 0 ? rate : null };
}

export type TunvnBalanceResult =
  | { kind: "ok"; username: string; balance_vnd: number; balance_usdt: number; usdt_vnd: number | null }
  | Exclude<TunvnCallResult, { kind: "ok" }>
  | { kind: "api_error"; detail: string };

export async function fetchTunvnBalance(): Promise<TunvnBalanceResult> {
  const r = await callTunvnRead("balance");
  if (r.kind !== "ok") return r;
  if (!isRecord(r.json) || r.json.success !== true) return { kind: "api_error", detail: "balance_shape" };
  const vnd = nonNegativeInt(r.json.balance_vnd);
  const usdt = num(r.json.balance_usdt);
  if (vnd === null || usdt === null || usdt < 0) return { kind: "api_error", detail: "balance_shape" };
  const rate = num(r.json.usdt_vnd);
  return {
    kind: "ok",
    username: str(r.json.username).trim(),
    balance_vnd: vnd,
    balance_usdt: usdt,
    usdt_vnd: rate !== null && rate > 0 ? rate : null,
  };
}
