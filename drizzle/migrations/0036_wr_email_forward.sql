-- 0036_wr_email_forward.sql — Log idempoten forward email WR → buyer Axvara.
--
-- Bot email (fase 2): forwarder (Apps Script label WR-INGEST) POST mentah
-- email WR ke /api/webhook/wr-email → parser ambil invoice → join ke
-- wr_order_links.wr_order_id → kirim template branding Axvara.
--
-- Idempoten: gmail_message_id UNIQUE — retry forwarder / double-delivery
-- tidak mengirim ganda ke buyer. buyer_notified_at = bukti kirim.
-- channel fallback: bila buyer tanpa email, teks template masuk outbox WA.

CREATE TABLE IF NOT EXISTS wr_email_forward_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gmail_message_id TEXT NOT NULL UNIQUE,
  wr_invoice TEXT,
  axvara_order_code TEXT REFERENCES orders(code),
  kind TEXT NOT NULL DEFAULT 'order_update'
    CHECK (kind IN ('order_update', 'invite_sent', 'unknown', 'unmatched', 'skipped')),
  buyer_email TEXT,
  buyer_notified_at TEXT,
  channel TEXT NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email', 'whatsapp', 'none')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wr_email_forward_invoice
  ON wr_email_forward_log(wr_invoice) WHERE wr_invoice IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wr_email_forward_order
  ON wr_email_forward_log(axvara_order_code) WHERE axvara_order_code IS NOT NULL;
