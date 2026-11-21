// Fixed SQL identifiers: bare columns or the orders alias `o`.
export const PURCHASE_PAID_SQL = "status='lunas' AND payment_status='paid' AND supplier_purchase_disabled=0";
export const PURCHASE_PAID_SQL_ALIASED = "o.status='lunas' AND o.payment_status='paid' AND o.supplier_purchase_disabled=0";

export function isPaidForSupplierPurchase(order: Record<string, unknown>): boolean {
  return order.status === "lunas" && order.payment_status === "paid" && !Number(order.supplier_purchase_disabled);
}

// Admin Retry rejects NaN; link creation uses a truthiness check.
export function isPaidForSupplierRetry(link: Record<string, unknown>): boolean {
  return link.order_status === "lunas" && link.payment_status === "paid" && Number(link.supplier_purchase_disabled) === 0;
}

const RETRYABLE = ["pending", "retry", "failed", "blocked_balance"];

export function isSupplierRetryableStatus(status: string): boolean {
  return RETRYABLE.includes(status);
}

export function nextPurchaseAttemptIso(attempt: number, delays: readonly number[]): string {
  const minutes = delays[Math.min(Math.max(attempt - 1, 0), delays.length - 1)];
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
