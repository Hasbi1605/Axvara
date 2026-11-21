import type { DatabaseAccess } from "@/lib/db-access";

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

const PURCHASE_LINKS = {
  wr: { table: "wr_order_links", invoice: "wr_order_id", variant: "wr_variant_id", itemLink: "wr_link_id" },
  sk: { table: "sk_order_links", invoice: "sk_invoice", variant: "sk_variant_id", itemLink: "sk_link_id" },
} as const;
type PurchaseSupplier = keyof typeof PURCHASE_LINKS;

export function claimFreshPurchase(
  db: DatabaseAccess, supplier: PurchaseSupplier, id: number, attempt: number, owner: string, expiresAt: string,
) {
  const { table, invoice } = PURCHASE_LINKS[supplier];
  // Match each existing statement's whitespace as well as its predicates.
  const indent = supplier === "wr" ? "  " : "";
  const beforeInvoice = supplier === "wr" ? " " : "\n         ";
  const beforeAttempt = supplier === "wr" ? "\n           " : " ";
  return db.execRun(
    `UPDATE ${table} SET status='claimed', attempt_count=?,
         lease_owner=?, lease_expires_at=?, last_claim_at=datetime('now'),
         updated_at=datetime('now')
       ${indent}WHERE id=? AND status IN ('pending','retry') AND request_sent_at IS NULL${beforeInvoice}AND COALESCE(${invoice},'')=''${beforeAttempt}AND attempt_count=? AND attempt_count < max_attempts
         ${indent}AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))
         ${indent}AND EXISTS (SELECT 1 FROM orders o WHERE o.code=${table}.order_code AND ${PURCHASE_PAID_SQL_ALIASED})`,
    attempt, owner, expiresAt, id, attempt - 1,
  ).catch(() => ({ changes: 0 }));
}

// Take over only an unsent stale lease, reusing the already charged attempt.
export function claimStalePurchase(
  db: DatabaseAccess, supplier: PurchaseSupplier, id: number, attempt: number, owner: string, expiresAt: string,
) {
  const { table, invoice } = PURCHASE_LINKS[supplier];
  const beforeInvoice = supplier === "wr" ? " " : "\n         ";
  return db.execRun(
    `UPDATE ${table} SET status='claimed',
         lease_owner=?, lease_expires_at=?, last_claim_at=datetime('now'),
         updated_at=datetime('now')
       WHERE id=? AND status='claimed' AND request_sent_at IS NULL${beforeInvoice}AND COALESCE(${invoice},'')='' AND attempt_count=?
         AND (lease_expires_at IS NULL OR datetime(lease_expires_at) <= datetime('now'))
         AND EXISTS (SELECT 1 FROM orders o WHERE o.code=${table}.order_code AND ${PURCHASE_PAID_SQL_ALIASED})`,
    owner, expiresAt, id, attempt,
  ).catch(() => ({ changes: 0 }));
}

export function fencePurchaseSend(db: DatabaseAccess, supplier: PurchaseSupplier, id: number, owner: string) {
  const { table, variant, itemLink } = PURCHASE_LINKS[supplier];
  return db.execRun(
    `UPDATE ${table} SET request_sent_at=datetime('now'), updated_at=datetime('now')
     WHERE id=? AND status='claimed' AND lease_owner=? AND request_sent_at IS NULL
       AND datetime(lease_expires_at) > datetime('now')
       AND EXISTS (SELECT 1 FROM orders o WHERE o.code=${table}.order_code AND ${PURCHASE_PAID_SQL_ALIASED})
       AND NOT EXISTS (SELECT 1 FROM fulfillment_items fi LEFT JOIN product_variants pv ON pv.id=fi.variant_id
         WHERE fi.order_code=${table}.order_code AND (fi.${itemLink}=${table}.id OR fi.id=${table}.fulfillment_item_id OR pv.${variant}=${table}.${variant})
           AND (COALESCE(fi.last_error,'') LIKE 'manual_handover:%' OR fi.delivered_message_id='manual'))`,
    id, owner,
  );
}

export function requeueUnsentStalePurchases(db: DatabaseAccess, supplier: PurchaseSupplier) {
  const { table, invoice } = PURCHASE_LINKS[supplier];
  // Keep the invoice rider in its original position for each supplier.
  const beforeInvoice = supplier === "wr" ? "\n         " : " ";
  return db.execRun(
    `UPDATE ${table} SET status='pending', lease_owner=NULL,
         attempt_count=MAX(0, attempt_count-1),
         lease_expires_at=NULL, last_error='stale_claim_recovered',
         updated_at=datetime('now')
       WHERE status='claimed' AND request_sent_at IS NULL${beforeInvoice}AND COALESCE(${invoice},'')=''
         AND lease_expires_at IS NOT NULL
         AND datetime(lease_expires_at) <= datetime('now')
         AND EXISTS (SELECT 1 FROM orders o WHERE o.code=${table}.order_code AND ${PURCHASE_PAID_SQL_ALIASED})`,
  );
}

/** Urutan monotonik status vendor: index naik = maju. Regresi dilarang. */
const VENDOR_STATUS_RANK: Record<string, number> = {
  pending: 0,
  claimed: 1,
  retry: 1,
  blocked_balance: 1,
  submitted: 2,
  ordering: 2,
  processing: 3,
  completed: 4,
  failed: 4,
};

export function supplierVendorStatusRank(status: unknown): number {
  return VENDOR_STATUS_RANK[String(status)] ?? -1;
}

export function casAdvanceBoundInvoice(
  execRun: DatabaseAccess["execRun"],
  supplier: PurchaseSupplier,
  boundInvoice: string,
  from: string,
  toStatus: "processing" | "completed" | "failed",
  fields: Partial<Record<"completed_at" | "last_error", unknown>> | null,
  eventId?: string,
) {
  const { table, invoice } = PURCHASE_LINKS[supplier];
  const now = new Date().toISOString();
  const sets = [`status='${toStatus}'`, `last_event_at='${now}'`];
  // Preserve SK's H5 cleanup; WR's winning lease cleanup is a separate change (B4b).
  if (supplier === "sk") sets.push("lease_owner=NULL", "lease_expires_at=NULL");
  const values: unknown[] = [];
  if (eventId) {
    sets.push(`last_event_id=?`);
    values.push(eventId);
  }
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      sets.push(`${key}=?`);
      values.push(value);
    }
  }
  sets.push(`updated_at=datetime('now')`);
  // Only the exact bound invoice at the observed status can advance.
  return execRun(
    `UPDATE ${table} SET ${sets.join(", ")} WHERE ${invoice}=? AND status=?`,
    ...values,
    boundInvoice,
    from,
  ).catch(() => ({ changes: 0 as number | undefined }));
}
