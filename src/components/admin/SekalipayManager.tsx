"use client";

import { SupplierAdminPanel } from "./SupplierAdminPanel";

export const SK_STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu",
  claimed: "Diklaim worker",
  submitted: "Terkirim ke SK",
  ordering: "Dipesan…",
  processing: "Diproses SK",
  completed: "Selesai",
  failed: "Gagal",
  canceled: "Dibatalkan SK",
  retry: "Retry",
  blocked_balance: "Saldo SK habis",
};

export const RETRYABLE_SK_STATUS = ["pending", "retry", "failed", "blocked_balance"];

/**
 * Cermin gerbang backend `POST /api/admin/sekalipay/orders/[id]/retry`:
 * tolak bila sudah ada `sk_invoice` / `request_sent_at` (wajib rekonsiliasi),
 * dibatalkan admin, atau pesanan belum `lunas`. `failed` pra-kirim boleh retry
 * (backend me-reset attempt_count ke 0), status lain wajib attempt < max.
 */
export function canRetrySkLink(order: {
  status: string;
  attempt_count?: number;
  max_attempts?: number;
  sk_invoice?: string | null;
  request_sent_at?: string | null;
  last_error?: string | null;
  order_status?: string | null;
  order_payment_status?: string | null;
  purchase_disabled?: number;
}): boolean {
  if (!RETRYABLE_SK_STATUS.includes(order.status)) return false;
  if (order.purchase_disabled === 1) return false;
  if (order.order_status != null && order.order_status !== "lunas") return false;
  if (order.order_payment_status != null && order.order_payment_status !== "paid") return false;
  if (order.sk_invoice || order.request_sent_at) return false;
  if (String(order.last_error ?? "").startsWith("cancelled_by_admin")) return false;
  if (order.status === "failed") return true;
  return Number(order.attempt_count ?? 0) < Number(order.max_attempts ?? 3);
}

export function SekalipayManager() {
  return <SupplierAdminPanel supplier="sekalipay" />;
}
