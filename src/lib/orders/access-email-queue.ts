import type { D1, D1Statement } from "@/lib/db/types";

export const ACCESS_PIN_EMAIL_PREFIX = "email:access_pin:";

/** Include after the order INSERT in its atomic batch. No email body is stored. */
export function checkoutPinEmailStatement(d1: D1, orderCode: string): D1Statement {
  return d1.prepare(
    `INSERT OR IGNORE INTO buyer_notice_log
       (idempotency_key, order_code, channel, status, access_attempts, error, access_retry_at, access_lease)
     SELECT 'email:access_pin:' || code || ':v' || buyer_access_version,
            code, 'email', 'failed', 0, NULL, NULL, NULL
       FROM orders
      WHERE code=? AND buyer_access_version >= 1 AND buyer_access_format='pin6'
        AND sales_channel != 'whatsapp' AND customer_email LIKE '%@%.%'`,
  ).bind(orderCode);
}
