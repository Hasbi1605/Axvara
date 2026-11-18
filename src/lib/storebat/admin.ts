export type StorebatAdminProduct = {
  id: number; name: string; price_usd: number; stock: number; delivery_type: string; disappeared: number;
  markup_percent: number; admin_price_idr: number | null; fx_idr_per_usd: number | null;
  axvara_product_id: number | null; variant_id: number | null; variant_price: number | null;
  variant_active: number | null; product_active: number | null; product_archived: number; label: string | null;
  family: import("./families").StorebatFamily;
};
export type StorebatAdminOrder = {
  id: number; order_code: string; item_index: number; storebat_product_id: number; quantity: number;
  kind: "product" | "muse_buff"; cost_usd: number; fx_idr_per_usd: number; refunded_usd: number | null;
  idempotency_key: string; provider_order_id: number | null; status: string; attempt_count: number;
  last_error: string | null; has_receipt: number; can_retry: number; receipt_json: string | null;
  request_sent_at: string | null; completed_at: string | null;
};
