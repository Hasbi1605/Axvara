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

export function sanitizePixelverifReceiptSummary(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    const out: Record<string, unknown> = {
      status: typeof rec.status === "string" ? rec.status : null,
    };
    if (typeof rec.link === "string") out.link_present = true;
    if (typeof rec.activation_status === "string") out.activation_status = rec.activation_status;
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
        status: typeof order.status === "string" ? order.status : String(link.status ?? ""),
        link: typeof (order.result as Record<string, unknown> | undefined)?.link === "string" ? (order.result as Record<string, unknown>).link : null,
        activation_status: typeof order.activation_status === "string" ? order.activation_status : (link.activation_status ?? null),
        queue_position: (order.queue_position as number | null) ?? (link.queue_position as number | null) ?? null,
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
