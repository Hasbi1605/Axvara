import type { NextRequest } from "next/server";

// In-memory per-isolate rate limiter — best-effort, use Cloudflare WAF for prod scale
const buckets = new Map<string, { c: number; t: number }>();

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

export function clientIp(req: NextRequest): string {
  // F-05 fix: prefer cf-connecting-ip (cannot be spoofed behind CF), ignore x-forwarded-for if CF header present
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;
  // Fallback for dev/non-CF environments
  return req.headers.get("x-real-ip") || "0.0.0.0";
}

export function rateLimitKey(req: NextRequest, scope: string): string {
  return `${scope}:${clientIp(req)}`;
}
