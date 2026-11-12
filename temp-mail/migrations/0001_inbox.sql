CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient TEXT NOT NULL,
  sender TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '(no subject)',
  body_text TEXT NOT NULL DEFAULT '',
  received_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  dedupe_hash TEXT NOT NULL,
  UNIQUE (recipient, dedupe_hash)
);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_expires ON messages(recipient, expires_at, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_received ON messages(recipient, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at);
