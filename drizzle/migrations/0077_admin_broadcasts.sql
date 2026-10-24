-- Reusable templates; each launch freezes its own content and recipient list.
CREATE TABLE IF NOT EXISTS broadcast_templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  cta_label TEXT NOT NULL DEFAULT '', cta_url TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS broadcast_campaigns (
  id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, template_id TEXT NOT NULL REFERENCES broadcast_templates(id),
  template_revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL, channels_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('preparing','queued','completed','canceled')),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_status ON broadcast_campaigns(status,created_at);
CREATE TABLE IF NOT EXISTS broadcast_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL REFERENCES broadcast_campaigns(id),
  channel TEXT NOT NULL CHECK(channel IN ('whatsapp','email','telegram')),
  recipient_id TEXT NOT NULL, destination TEXT NOT NULL, unsubscribe_token TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','unknown','skipped','canceled')),
  attempts INTEGER NOT NULL DEFAULT 0, first_attempt_at TEXT, next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  lease_until TEXT, provider_id TEXT, last_error TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(campaign_id,channel,recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_broadcast_delivery_due ON broadcast_deliveries(status,julianday(next_attempt_at),id);
CREATE INDEX IF NOT EXISTS idx_broadcast_delivery_campaign ON broadcast_deliveries(campaign_id,channel,status);
CREATE TABLE IF NOT EXISTS broadcast_dispatch_control (
  id INTEGER PRIMARY KEY CHECK(id=1), worker_token TEXT, lease_until TEXT,
  email_after TEXT, telegram_after TEXT
);
INSERT OR IGNORE INTO broadcast_dispatch_control(id) VALUES(1);
ALTER TABLE newsletter_subscribers ADD COLUMN unsubscribe_token TEXT;
UPDATE newsletter_subscribers SET unsubscribe_token=lower(hex(randomblob(32))) WHERE unsubscribe_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriber_unsubscribe ON newsletter_subscribers(unsubscribe_token);
ALTER TABLE telegram_users ADD COLUMN broadcast_opt_out INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_subscriber_broadcast ON newsletter_subscribers(status,id);
