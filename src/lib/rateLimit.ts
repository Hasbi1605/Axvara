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
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
}

export function rateLimitKey(req: NextRequest, scope: string): string {
  return `${scope}:${clientIp(req)}`;
}
