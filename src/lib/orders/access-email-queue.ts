import type { D1, D1Statement } from "@/lib/db/types";

export const ACCESS_PIN_EMAIL_PREFIX = "email:credential_access:";

/** Queue the full credentials email after an explicit admin PIN rotation. */
export function credentialAccessEmailStatement(d1: D1, orderCode: string): D1Statement {
  return d1.prepare(
    `INSERT OR IGNORE INTO buyer_notice_log
       (idempotency_key, order_code, channel, status, access_attempts, error, access_retry_at, access_lease)
     SELECT 'email:credential_access:' || code || ':v' || buyer_access_version,
            code, 'email', 'failed', 0, NULL, NULL, NULL
       FROM orders
      WHERE code=? AND buyer_access_version >= 1 AND buyer_access_format='pin6'
        AND sales_channel != 'whatsapp' AND customer_email LIKE '%@%.%'
        AND status='lunas' AND payment_status='paid'
        AND (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=orders.code AND status='completed' AND wr_account_details IS NOT NULL)
          OR EXISTS(SELECT 1 FROM fulfillment_items WHERE order_code=orders.code AND status='delivered' AND delivered_ciphertext IS NOT NULL))`,
  ).bind(orderCode);
}
