import { numeric, record } from "./client";
import { MIRAI_VND_PER_USDT } from "./pricing";

export type MiraiAdminProduct = {
  package_code: string;
  group_key: string;
  name: string;
  quota_tokens: number;
  duration_seconds: number;
  cost_usdt: number;
  min_quantity: number;
  max_quantity: number;
  unlimited: number;
  remaining_today: number;
  stock: number;
  disappeared: number;
  markup_percent: number;
  admin_price_idr: number | null;
  fx_idr_per_usdt: number | null;
  axvara_product_id: number | null;
  product_name: string | null;
  product_active: number | null;
  product_archived: number;
  variant_id: number | null;
  sku: string | null;
  label: string | null;
  variant_price: number | null;
  variant_active: number | null;
  last_seen_at: string | null;
  family: import("./families").MiraiFamily;
};

export type MiraiAdminOrder = {
  id: number;
  order_code: string;
  item_index: number;
  package_code: string;
  quantity: number;
  cost_usdt: number;
  fx_idr_per_usdt: number | null;
  external_order_id: string;
  idempotency_key: string;
  provider_order_code: string | null;
  status: string;
  attempt_count: number;
  request_sent_at: string | null;
  last_error: string | null;
  completed_at: string | null;
  receipt_json: string | null;
  has_receipt: number;
  can_retry: number;
};

function vndToUsdtSafe(value: unknown): number | null {
  const vnd = numeric(value);
  if (vnd === null || vnd < 0) return null;
  return Math.round((vnd / MIRAI_VND_PER_USDT) * 1_000_000) / 1_000_000;
}

/** Strip VND amounts from stored receipt_json summary before returning to admin UI. */
export function sanitizeMiraiReceiptSummary(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!record(parsed)) return null;
    const out: Record<string, unknown> = {
      received: typeof parsed.received === "number" ? parsed.received : 0,
      requested: typeof parsed.requested === "number" ? parsed.requested : 0,
      status: typeof parsed.status === "string" ? parsed.status : null,
    };
    const amountUsdt = vndToUsdtSafe(parsed.amount_vnd);
    const unitCostUsdt = vndToUsdtSafe(parsed.unit_price_vnd);
    if (amountUsdt !== null) out.amount_usdt = amountUsdt;
    if (unitCostUsdt !== null) out.unit_cost_usdt = unitCostUsdt;
    return JSON.stringify(out);
  } catch {
    return null;
  }
}

/** Format a decrypted Mirai receipt into a display-safe JSON string (USDT only, no VND or raw error text). */
export function formatSafeMiraiRevealReceipt(rawText: string, link: Record<string, unknown>): string {
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (record(parsed) && parsed.success === true && record(parsed.data)) {
      const d = parsed.data;
      const redeemCodes = Array.isArray(d.redeem_codes)
        ? d.redeem_codes.filter((c): c is string => typeof c === "string" && c.trim().length > 0).map((c) => c.trim())
        : typeof d.redeem_code === "string" && d.redeem_code.trim()
          ? [d.redeem_code.trim()]
          : [];
      const unitCostUsdt = vndToUsdtSafe(d.unit_price_vnd);
      const amountUsdt =
        vndToUsdtSafe(d.amount_vnd) ??
        (typeof link.cost_usdt === "number" && Number.isFinite(link.cost_usdt) ? link.cost_usdt : null);
      return JSON.stringify({
        order_code: typeof d.order_code === "string" ? d.order_code : (link.provider_order_code ?? null),
        external_order_id:
          typeof d.external_order_id === "string" ? d.external_order_id : String(link.external_order_id ?? ""),
        package_code: typeof d.package_code === "string" ? d.package_code : String(link.package_code ?? ""),
        quantity: typeof d.quantity === "number" ? d.quantity : Number(link.quantity ?? 0),
        status: typeof d.status === "string" ? d.status : String(link.status ?? ""),
        created_at: typeof d.created_at === "string" ? d.created_at : (link.created_at ?? null),
        completed_at: typeof d.completed_at === "string" ? d.completed_at : (link.completed_at ?? null),
        redeem_codes: redeemCodes,
        unit_cost_usdt: unitCostUsdt,
        amount_usdt: amountUsdt,
      });
    }
  } catch {
    // Non-JSON or error provider payload falls back to safe link metadata below.
  }

  return JSON.stringify({
    order_code: link.provider_order_code ?? null,
    external_order_id: String(link.external_order_id ?? ""),
    package_code: String(link.package_code ?? ""),
    quantity: Number(link.quantity ?? 0),
    status: String(link.status ?? ""),
    created_at: link.created_at ?? null,
    completed_at: link.completed_at ?? null,
    http_status: typeof link.receipt_http_status === "number" ? link.receipt_http_status : null,
    error: typeof link.last_error === "string" && link.last_error ? link.last_error : "provider_error",
  });
}
