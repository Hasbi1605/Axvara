-- Keep historical credit/ledger rows intact. No balance is created or returned.
CREATE TABLE IF NOT EXISTS order_contact_attempts (
  order_code TEXT NOT NULL REFERENCES orders(code) ON DELETE CASCADE,
  client_hash TEXT NOT NULL,
  window_id INTEGER NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(order_code,client_hash)
);
CREATE TABLE IF NOT EXISTS pedia_followups (
  order_code TEXT PRIMARY KEY REFERENCES orders(code) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','handled')),
  note TEXT,
  handled_by TEXT,
  handled_at TEXT,
  notification_claimed_at TEXT,
  notification_attempts INTEGER NOT NULL DEFAULT 0,
  notification_retry_at TEXT,
  buyer_notification_claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pedia_followups_state ON pedia_followups(state, created_at);
-- Backfill only the private work queue, without sending historical alerts.
INSERT OR IGNORE INTO pedia_followups(order_code,reason,notification_claimed_at,buyer_notification_claimed_at)
SELECT order_code,'historical_' || status,datetime('now'),datetime('now') FROM pedia_order_items WHERE status IN ('partial','canceled');
INSERT OR IGNORE INTO pedia_followups(order_code,reason,notification_claimed_at,buyer_notification_claimed_at)
SELECT source_order_code,'historical_credit',datetime('now'),datetime('now') FROM pedia_credits WHERE remaining>0
  AND EXISTS(SELECT 1 FROM orders WHERE code=pedia_credits.source_order_code);

-- Guard/prechecks seek by chat, without scanning every pending order.
CREATE INDEX IF NOT EXISTS idx_orders_telegram_pending_chat ON orders(telegram_chat_id,status,payment_status,expires_at) WHERE telegram_chat_id IS NOT NULL;
