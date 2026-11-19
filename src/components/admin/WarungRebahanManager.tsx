"use client";

import { SupplierAdminPanel } from "./SupplierAdminPanel";

export const WR_STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu",
  claimed: "Diklaim worker",
  submitted: "Terkirim ke WR",
  ordering: "Dipesan…",
  processing: "Diproses WR",
  completed: "Selesai",
  failed: "Gagal",
  retry: "Retry",
  // Bukan kegagalan: order menunggu saldo WR cukup, lalu `reconcileBlockedBalance`
  // membangkitkannya sendiri.
  blocked_balance: "Saldo WR habis",
};

/**
 * Status yang diterima `POST /api/admin/warung/orders/[id]/retry`.
 * Wajib sama dengan `RETRYABLE` di route itu.
 */
export const RETRYABLE_WR_STATUS = ["pending", "retry", "failed", "blocked_balance"];

export const WR_RETRY_EXHAUSTED_LABEL = "Percobaan habis";

/**
 * Retry berguna bila kuota percobaan masih ada, ATAU link `failed` karena
 * kegagalan pra-kirim (tanpa wr_order_id/request_sent_at, bukan dibatalkan admin).
 */
export function canRetryWrLink(order: {
  status: string;
  attempt_count?: number;
  max_attempts?: number;
  wr_order_id?: string | null;
  request_sent_at?: string | null;
  last_error?: string | null;
  order_status?: string | null;
  purchase_disabled?: number;
}): boolean {
  if (!RETRYABLE_WR_STATUS.includes(order.status)) return false;
  if (order.purchase_disabled === 1) return false;
  if (order.order_status != null && order.order_status !== "lunas") return false;
  if (order.status === "failed") {
    return !order.wr_order_id && !order.request_sent_at && !String(order.last_error ?? "").startsWith("cancelled_by_admin");
  }
  return Number(order.attempt_count ?? 0) < Number(order.max_attempts ?? 3);
}

export function WarungRebahanManager() {
  return <SupplierAdminPanel supplier="warung" />;
}
