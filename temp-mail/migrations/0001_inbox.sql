CREATE TABLE IF NOT EXISTS temp_mail_messages (
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
CREATE INDEX IF NOT EXISTS idx_temp_mail_recipient_expires ON temp_mail_messages(recipient, expires_at, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_temp_mail_recipient_received ON temp_mail_messages(recipient, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_temp_mail_expires ON temp_mail_messages(expires_at);
