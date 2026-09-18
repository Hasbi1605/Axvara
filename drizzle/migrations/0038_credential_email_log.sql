-- 0038_credential_email_log.sql — Izinkan kind/channel email kredensial di log.
--
-- Konteks (Fase B, 2026-09-18): delivery web mengirim ISI kredensial via
-- email Resend + mencatatnya di wr_email_forward_log dengan kind
-- 'credential_ready' + channel 'email-credential'. CHECK lama hanya
-- mengizinkan kind order_update/invite_sent/unknown/unmatched/skipped dan
-- channel email/whatsapp/none, sehingga INSERT ditolak diam-diam (catch
-- menelan) → tidak ada baris → retry mengirim email ganda. Tertangkap test
-- idempoten sebelum live.
--
-- SQLite tidak bisa ALTER CHECK: recreate tabel (pola migrasi 0008). Tabel
-- ini tidak punya FK anak, jadi aman tanpa namespace sementara.

PRAGMA defer_foreign_keys=ON;

DROP TABLE IF EXISTS wr_email_forward_log_new;

CREATE TABLE wr_email_forward_log_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gmail_message_id TEXT NOT NULL UNIQUE,
  wr_invoice TEXT,
  axvara_order_code TEXT REFERENCES orders(code),
  kind TEXT NOT NULL DEFAULT 'order_update'
    CHECK (kind IN ('order_update', 'invite_sent', 'unknown', 'unmatched', 'skipped', 'credential_ready')),
  buyer_email TEXT,
  buyer_notified_at TEXT,
  channel TEXT NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email', 'whatsapp', 'none', 'email-credential')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO wr_email_forward_log_new
  (id, gmail_message_id, wr_invoice, axvara_order_code, kind, buyer_email,
   buyer_notified_at, channel, error, created_at)
SELECT id, gmail_message_id, wr_invoice, axvara_order_code, kind, buyer_email,
   buyer_notified_at, channel, error, created_at
FROM wr_email_forward_log;

DROP TABLE wr_email_forward_log;

ALTER TABLE wr_email_forward_log_new RENAME TO wr_email_forward_log;

CREATE INDEX IF NOT EXISTS idx_wr_email_forward_invoice
  ON wr_email_forward_log(wr_invoice) WHERE wr_invoice IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wr_email_forward_order
  ON wr_email_forward_log(axvara_order_code) WHERE axvara_order_code IS NOT NULL;

PRAGMA defer_foreign_keys=OFF;
