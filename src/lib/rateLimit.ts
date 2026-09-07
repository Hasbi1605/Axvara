import type { NextRequest } from "next/server";

// Sentralisasi rate-limit (issue #14).
//
// Fakta platform yang diverifikasi 7 Sep 2026 (docs Cloudflare D1 Limits +
// WAF rate limiting rules):
// - D1 Free: 50 query per invocation Worker, 100 bound parameter per query,
//   LIKE/GLOB max 50 byte. Batch tidak menambah batas — tiap statement dalam
//   batch tetap dihitung terhadap batas yang sama.
// - WAF Free: 1 rate limiting rule, counting IP, periode 10 dtk / 1 mnt.
//   Artinya klaim lama "WAF tidak tersedia" salah — tersedia 1 rule, sehingga
//   in-memory di sini hanyalah lapis kedua (defense in depth), bukan satu-
//   satunya proteksi. Aturan WAF aktual didokumentasikan di
//   docs/ARCHITECTURE.md §9.
// - Edge isolate: tiap isolate punya Map sendiri. Counter ini best-effort dan
//   TIDAK boleh diklaim sebagai proteksi DDoS global — ia hanya menahan burst
//   per isolate + memberi respons 429 yang konsisten.
//
// Batas default per scope disatukan di sini agar tidak tersebar magic number
// di tiap route. Semua route checkout/quote/upload memakai helper ini.
const buckets = new Map<string, { c: number; t: number }>();

export const RATE_LIMITS = {
  "checkout:quote": 20,
  "checkout:orders": 10,
  "orders:lookup": 20,
  "proof:upload": 5,
  "upload:admin": 20,
  "products:write": 20,
  "auth:login": 5,
  "newsletter:subscribe": 5,
} as const;

export type RateLimitScope = keyof typeof RATE_LIMITS;

export function rateLimit(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const e = buckets.get(key);
  if (!e || now - e.t > windowMs) {
    buckets.set(key, { c: 1, t: now });
    return true;
  }
  e.c++;
  return e.c <= max;
}

/** Test-only: kosongkan bucket agar test deterministik. */
export function clearRateLimitBucketsForTest(): void {
  buckets.clear();
}

export function clientIp(req: NextRequest): string {
  // F-05 fix: prefer cf-connecting-ip (cannot be spoofed behind CF), ignore x-forwarded-for if CF header present
  const cfIp = req.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp.split(",")[0]?.trim() || cfIp;
  // Fallback for dev/non-CF environments. x-forwarded-for TIDAK dipakai di
  // sini (issue #14): nilainya dikontrol client dan dapat di-spoof untuk
  // menghindari limit per-IP. Hanya x-real-ip (di-set proxy tepercaya) yang
  // diterima sebagai fallback; selain itu kembalikan sentinel agar seluruh
  // client tanpa IP berbagi satu bucket ketat, bukan lolos tanpa limit.
  return req.headers.get("x-real-ip")?.trim() || "0.0.0.0";
}

export function rateLimitKey(req: NextRequest, scope: string): string {
  return `${scope}:${clientIp(req)}`;
}

/**
 * Cek limit untuk satu scope terpusat. Mengembalikan true bila request boleh
 * lanjut, false bila sudah melampaui batas (caller membalas 429 + Retry-After).
 */
export function checkRateLimit(req: NextRequest, scope: RateLimitScope): boolean {
  return rateLimit(rateLimitKey(req, scope), RATE_LIMITS[scope]);
}
