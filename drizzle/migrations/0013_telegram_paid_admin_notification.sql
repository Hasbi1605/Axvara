-- 0013: Marker agar notifikasi lunas Telegram ke grup admin tidak hilang/duplikat.

ALTER TABLE orders ADD COLUMN telegram_paid_admin_notified_at TEXT;

-- Backfill agar deployment tidak me-replay order lama ke grup admin.
UPDATE orders
SET telegram_paid_admin_notified_at=CASE
  WHEN sales_channel='telegram' AND status='lunas' AND payment_status='paid'
  THEN COALESCE(updated_at, created_at, datetime('now'))
  ELSE telegram_paid_admin_notified_at
END
WHERE sales_channel='telegram';

CREATE INDEX IF NOT EXISTS idx_orders_telegram_paid_admin
  ON orders(sales_channel, telegram_paid_admin_notified_at);
