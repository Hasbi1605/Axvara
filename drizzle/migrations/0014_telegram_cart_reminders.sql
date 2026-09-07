-- 0014: Keranjang multi-item Telegram + reminder order pending.
-- Cart disimpan per user Telegram (satu baris per varian), checkout gabungan
-- tetap memakai SATU order + SATU invoice QRIS (payment_transactions UNIQUE per
-- order_code tidak berubah). Reminder memakai marker count di orders agar
-- idempoten dan dibatasi maksimal 2x per order.

CREATE TABLE IF NOT EXISTS telegram_carts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  variant_id INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 1 AND qty <= 100),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, variant_id)
);
CREATE INDEX IF NOT EXISTS idx_telegram_carts_user
  ON telegram_carts(user_id, updated_at);

ALTER TABLE orders ADD COLUMN telegram_reminder_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN telegram_reminder_sent_at TEXT;
