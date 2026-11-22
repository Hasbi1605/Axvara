import type { DatabaseAccess } from "@/lib/db-access";

export function isPaidOrder(order: Record<string, unknown>): boolean {
  return order.status === "lunas" && order.payment_status === "paid" && (order.order_kind ?? "apps") === "apps"
    && !Number(order.supplier_purchase_disabled) && ["web", "telegram"].includes(String(order.sales_channel));
}

function paidOrderSql(prefix: "" | "o.") {
  return `${prefix}status='lunas' AND ${prefix}payment_status='paid' AND ${prefix}supplier_purchase_disabled=0 AND COALESCE(${prefix}order_kind,'apps')='apps' AND ${prefix}sales_channel IN ('web','telegram')`;
}

export const PAID_ORDER_SQL = paidOrderSql("");
export const PAID_ORDER_SQL_ALIASED = paidOrderSql("o.");

// TUNVN keeps its recovery predicate and processing-preserving CASE in its own adapter until A4.
const LINK_TABLES = {
  aivault: { table: "aivault_order_links", claim: "due" },
  mirai: { table: "mirai_order_links", claim: "due" },
  storebat: { table: "storebat_order_links", claim: "due" },
  pixelverif: { table: "pixelverif_order_links", claim: "due" },
  tunvn: { table: "tunvn_order_links", claim: "adapter" },
} as const;
type DueClaimSupplier = {
  [K in keyof typeof LINK_TABLES]: (typeof LINK_TABLES)[K]["claim"] extends "due" ? K : never;
}[keyof typeof LINK_TABLES];

/** One claim CAS on the caller's metered DB; no read, settle or send fence. */
export function claimLink(db: DatabaseAccess, supplier: DueClaimSupplier, id: number, owner: string) {
  return db.execRun(`UPDATE ${LINK_TABLES[supplier].table} SET lease_owner=?,lease_expires_at=datetime('now','+90 seconds'),status='claimed'
    WHERE id=? AND status IN ('pending','claimed','processing') AND datetime(next_attempt_at)<=datetime('now') AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<datetime('now'))`, owner, id);
}
