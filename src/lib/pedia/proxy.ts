// src/lib/pedia/proxy.ts — Client Pages → VPS proxy `/psmm/*` (PEDIA-PRD §9.1/9.4).
//
// Pages TIDAK PERNAH menyimpan API key ProviderSMM (D7). Semua panggilan
// memakai env EXISTING `WARUNG_REBAHAN_PROXY_URL` + `_TOKEN` (host & token
// proxy sama dengan WR/SK). Timeout dispatch 20 dtk (§9.4).

import { fetchWithTimeout } from "@/lib/fetch-timeout";

export const PEDIA_PROXY_TIMEOUT_MS = 20_000;

function proxyBase(): string {
  return (process.env.WARUNG_REBAHAN_PROXY_URL || "").replace(/\/+$/, "");
}

function proxyToken(): string {
  return process.env.WARUNG_REBAHAN_PROXY_URL ? process.env.WARUNG_REBAHAN_PROXY_TOKEN || "" : "";
}

export function isPediaProxyConfigured(): boolean {
  return Boolean(proxyBase() && proxyToken());
}

export type PsmmResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; kind: "timeout" | "http" | "unreadable" | "not_configured"; status?: number; body?: unknown };

/** POST {proxy}/psmm/:action. Body diteruskan; key disuntik di VPS. */
export async function callPsmmProxy<T = unknown>(
  action: string,
  body: Record<string, unknown> = {},
  timeoutMs = PEDIA_PROXY_TIMEOUT_MS,
): Promise<PsmmResult<T>> {
  if (!isPediaProxyConfigured()) return { ok: false, kind: "not_configured" };
  let res: Response;
  try {
    res = await fetchWithTimeout(`${proxyBase()}/psmm/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-proxy-token": proxyToken() },
      body: JSON.stringify(body),
    }, timeoutMs);
  } catch {
    return { ok: false, kind: "timeout" };
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    return { ok: false, kind: "unreadable", status: res.status, body: text.slice(0, 200) };
  }
  if (res.status < 200 || res.status >= 300 || json === null || typeof json !== "object") {
    return { ok: false, kind: "http", status: res.status, body: json ?? text.slice(0, 200) };
  }
  return { ok: true, data: json as T, status: res.status };
}
