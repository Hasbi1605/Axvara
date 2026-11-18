import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { readJsonBody } from "@/lib/http-body";
import { MARKET_INVOICE, estimateLine, type Estimate, type SharedEstimate } from "./calculate";
import type { DatabaseAccess } from "@/lib/db-access";

export const refundNow = () => Math.floor(Date.now() / 1000);
export const SHARE_TOKEN = /^[0-9a-f]{48}$/;
export const SHARE_SECONDS = 7 * 86400;
export const refundResponse = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
});

export async function refundBody(req: NextRequest, bucket: "orders:refund" | "admin:refund") {
  if (!checkRateLimit(req, bucket)) return { error: refundResponse({ error: "rate" }, 429) };
  if (req.headers.get("sec-fetch-site") === "cross-site" || !/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") || "")) {
    return { error: refundResponse({ error: "invalid" }, 400) };
  }
  const parsed = await readJsonBody(req, 4096);
  if (!parsed.ok || !parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
    return { error: refundResponse({ error: "invalid" }, 400) };
  }
  return { data: parsed.data as Record<string, unknown> };
}

export async function refundOrder(db: DatabaseAccess, input: unknown) {
  const code = typeof input === "string" ? input.trim().toUpperCase() : "";
  if (!MARKET_INVOICE.test(code)) return null;
  return db.queryFirst(`SELECT code, status, payment_status, locale, subtotal, buyer_access_version,
    buyer_access_format, quote_id, customer_wa, customer_email FROM orders WHERE code=? AND order_kind='apps'`, code);
}

export async function readEstimate(db: DatabaseAccess, order: Record<string, unknown>, now = refundNow()): Promise<Estimate> {
  if (order.payment_status === "refunded") return { state: "refunded", asOf: now, lines: [] };
  if (order.status !== "lunas" || order.payment_status !== "paid") return { state: "unpaid", asOf: now, lines: [] };
  const rows = await db.queryAll("SELECT * FROM market_refund_items WHERE order_code=? ORDER BY item_index", order.code);
  if (!rows.length || rows.reduce((total, row) => total + Number(row.price) * Number(row.qty), 0) !== Number(order.subtotal)) {
    return { state: "review", asOf: now, lines: [] };
  }
  return { state: "ready", asOf: now, lines: rows.map(row => estimateLine(row, now)) };
}

export function newShareToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(24)));
}
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function hashShare(token: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
}

export async function readShare(db: DatabaseAccess, token: string, now = refundNow()): Promise<SharedEstimate | null> {
  const row = await db.queryFirst(`SELECT s.snapshot,s.expires_at FROM market_refund_shares s JOIN orders o ON o.code=s.order_code
    WHERE s.token_hash=? AND s.expires_at>? AND o.status='lunas' AND o.payment_status='paid'`, await hashShare(token), now);
  if (!row) return null;
  return { ...JSON.parse(String(row.snapshot)), expires: Number(row.expires_at) };
}
