-- Durable automatic credential-send fence; explicit admin resends stay separate.
CREATE TABLE IF NOT EXISTS fulfillment_send_claims (
  item_id INTEGER NOT NULL REFERENCES fulfillment_items(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'whatsapp')),
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  token TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  part_count INTEGER NOT NULL DEFAULT 0 CHECK (part_count >= 0),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  message_id TEXT,
  error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_id, channel)
);
