export type PixelverifAdminProduct = {
  service_key: string;
  flow_type: string;
  validity: number;
  credit_cost: number;
  available: number;
  pricing_version: number | null;
  synced_at: string | null;
  stock: number;
  disappeared: number;
  markup_percent: number;
  admin_price_idr: number | null;
  fx_idr_per_usd: number | null;
  axvara_product_id: number | null;
  product_name: string | null;
  product_active: number | null;
  product_archived: number;
  variant_id: number | null;
  sku: string | null;
  label: string | null;
  variant_price: number | null;
  variant_active: number | null;
  variant_status?: string;
  variant_reason?: string;
};

export type PixelverifAdminOrder = {
  id: number;
  order_code: string;
  item_index: number;
  flow_type: string;
  validity: number;
  credit_cost: number;
  fx_idr_per_usd: number | null;
  provider_order_id: string | null;
  idempotency_key: string;
  status: string;
  attempt_count: number;
  request_sent_at: string | null;
  last_error: string | null;
  last_error_code: string | null;
  activation_status: string | null;
  queue_position: number | null;
  progress_step: number | null;
  completed_at: string | null;
  receipt_json: string | null;
  has_receipt: number;
  can_retry: number;
};

const KNOWN_ACTIVATION_STATUSES = new Set(["activated", "already_redeemed", "item_not_available", "failed", "invalid", "error"]);

/** Only the provider's known activation vocabulary may surface to admin/buyer. */
export function safeActivationStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return KNOWN_ACTIVATION_STATUSES.has(normalized) ? normalized : null;
}

const KNOWN_ORDER_STATUSES = new Set(["pending", "processing", "success", "failed"]);
const LINK_STATUSES = new Set(["pending", "claimed", "processing", "completed", "needs_admin"]);

/** Provider order status from the documented lifecycle only (README: pending→processing→success|failed). */
export function safeOrderStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return KNOWN_ORDER_STATUSES.has(normalized) ? normalized : null;
}

/** Redeem link must be an https URL; anything else is never surfaced. */
export function safeRedeemLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeQueuePosition(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < 1_000_000 ? value : null;
}

export function sanitizePixelverifReceiptSummary(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    const out: Record<string, unknown> = {
      status: safeOrderStatus(rec.status),
    };
    if (typeof rec.link === "string") out.link_present = true;
    const activation = safeActivationStatus(rec.activation_status);
    if (activation) out.activation_status = activation;
    return JSON.stringify(out);
  } catch {
    return null;
  }
}

export function formatSafePixelverifRevealReceipt(rawText: string, link: Record<string, unknown>): string {
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      const order = rec.order && typeof rec.order === "object" && !Array.isArray(rec.order) ? (rec.order as Record<string, unknown>) : rec;
      return JSON.stringify({
        order_code: String(link.order_code ?? ""),
        provider_order_id: String(link.provider_order_id ?? order.order_id ?? ""),
        flow_type: String(link.flow_type ?? order.flow_type ?? ""),
        validity: Number(link.validity ?? order.validity ?? 3),
        status: safeOrderStatus(order.status) ?? (LINK_STATUSES.has(String(link.status)) ? String(link.status) : null),
        link: safeRedeemLink((order.result as Record<string, unknown> | undefined)?.link),
        activation_status: safeActivationStatus(order.activation_status) ?? safeActivationStatus(link.activation_status),
        queue_position: safeQueuePosition(order.queue_position) ?? safeQueuePosition(link.queue_position),
      });
    }
  } catch {
    // fallback
  }
  return JSON.stringify({
    order_code: String(link.order_code ?? ""),
    provider_order_id: String(link.provider_order_id ?? ""),
    flow_type: String(link.flow_type ?? ""),
    status: String(link.status ?? ""),
    error: typeof link.last_error === "string" && link.last_error ? link.last_error : "provider_error",
  });
}
