-- 0010_dana_dynamic_qris.sql — DANA Business dynamic QRIS + QRIS Hook ledger

ALTER TABLE payment_transactions ADD COLUMN unique_code INTEGER;
ALTER TABLE payment_transactions ADD COLUMN qris_payload TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_active_dana_amount
  ON payment_transactions(payable_amount)
  WHERE provider='dana' AND status IN ('initializing','pending');

CREATE TABLE IF NOT EXISTS dana_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  amount INTEGER NOT NULL,
  sender_name TEXT,
  raw_text TEXT,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','matched','ignored','failed')),
  order_code TEXT REFERENCES orders(code),
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_dana_webhook_events_status
  ON dana_webhook_events(status, created_at);

UPDATE payment_methods
SET label='QRIS Dinamis', account_number='', account_name='DANA Business', qris_url=NULL
WHERE id='qris';
