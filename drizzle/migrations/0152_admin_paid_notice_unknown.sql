-- SQLite cannot ALTER a CHECK. Add a terminal state only for paid-admin
-- Telegram notices; retain all existing rows, fields and the order index.
CREATE TABLE buyer_notice_log_next (
  idempotency_key TEXT PRIMARY KEY,
  order_code TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'telegram')),
  status TEXT NOT NULL DEFAULT 'sending' CHECK (
    status IN ('sending', 'sent', 'failed')
    OR (status = 'unknown' AND channel = 'telegram' AND idempotency_key GLOB 'admin-paid:*')
  ),
  provider_id TEXT,
  error TEXT,
  access_attempts INTEGER NOT NULL DEFAULT 0 CHECK (access_attempts >= 0),
  access_retry_at TEXT,
  access_lease TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO buyer_notice_log_next
  (idempotency_key, order_code, channel, status, provider_id, error, access_attempts, access_retry_at, access_lease, created_at, updated_at)
SELECT idempotency_key, order_code, channel, status, provider_id, error, access_attempts, access_retry_at, access_lease, created_at, updated_at
FROM buyer_notice_log;

DROP TABLE buyer_notice_log;
ALTER TABLE buyer_notice_log_next RENAME TO buyer_notice_log;
CREATE INDEX idx_buyer_notice_order ON buyer_notice_log(order_code);
