-- 0012: Durable delivery markers for Telegram order/admin and paid/buyer notifications.

ALTER TABLE orders ADD COLUMN telegram_order_notified_at TEXT;
ALTER TABLE orders ADD COLUMN telegram_paid_notified_at TEXT;

-- Prevent a deployment from replaying historical Telegram orders into the
-- admin group or buyer chats. Only orders created after this migration start
-- with NULL markers and are eligible for notification/retry.
UPDATE orders
SET telegram_order_notified_at=COALESCE(created_at, datetime('now')),
    telegram_paid_notified_at=CASE
      WHEN status='lunas' AND payment_status='paid'
      THEN COALESCE(updated_at, created_at, datetime('now'))
      ELSE telegram_paid_notified_at
    END
WHERE sales_channel='telegram';

CREATE INDEX IF NOT EXISTS idx_orders_telegram_notifications
  ON orders(sales_channel, telegram_order_notified_at, telegram_paid_notified_at);
