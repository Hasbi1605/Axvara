-- 0019_wa_outbox_prod_check_rebuild.sql — Perbaiki CHECK produksi + recovery lease runtime.
--
-- Latar: migrasi 0007 membuat whatsapp_outbox dengan CHECK
--   status IN ('pending','sent','failed','dead') — tanpa 'sending'.
-- Migrasi 0018 menambah worker_id/locked_until tetapi TIDAK mengubah CHECK
-- tabel produksi yang sudah ada (ALTER TABLE di SQLite/D1 tidak bisa
-- mengubah CHECK). Akibatnya kode yang mengklaim 'sending' selalu gagal
-- CHECK di produksi, dan error claim dianggap seperti kalah claim.
--
-- Perbaikan (forward-only, aman, idempoten):
-- - Rebuild tabel dengan CHECK yang mencakup 'sending', mempertahankan
--   semua kolom (id, idempotency_key, channel, destination, message_type,
--   payload, status, attempt_count, next_attempt_at, last_error,
--   provider_message_id, worker_id, locked_until, created_at, updated_at),
--   data, UNIQUE idempotency_key, dan index.
-- - Status tak dikenal → 'failed' (bukan antrean baru) agar bisa retry.
-- - 'sending' dengan lease lewat/crash → 'failed' untuk retry normal.
-- - 'sent'/'dead' tidak pernah diubah menjadi antrean kirim.
PRAGMA defer_foreign_keys=ON;

DROP TABLE IF EXISTS whatsapp_outbox_new;

CREATE TABLE whatsapp_outbox_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  destination TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  provider_message_id TEXT,
  worker_id TEXT,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO whatsapp_outbox_new (
  id, idempotency_key, channel, destination, message_type, payload, status,
  attempt_count, next_attempt_at, last_error, provider_message_id,
  worker_id, locked_until, created_at, updated_at
)
SELECT
  id, idempotency_key, channel, destination, message_type, payload,
  CASE
    WHEN status IN ('sent','dead') THEN status
    WHEN status = 'sending'
      AND (locked_until IS NULL OR datetime(locked_until) <= datetime('now')) THEN 'failed'
    WHEN status IN ('pending','failed','sending') THEN status
    ELSE 'failed'
  END,
  attempt_count, next_attempt_at, last_error, provider_message_id,
  CASE WHEN status = 'sending'
    AND (locked_until IS NULL OR datetime(locked_until) <= datetime('now')) THEN NULL ELSE worker_id END,
  CASE WHEN status = 'sending'
    AND (locked_until IS NULL OR datetime(locked_until) <= datetime('now')) THEN NULL ELSE locked_until END,
  created_at, updated_at
FROM whatsapp_outbox;

DROP TABLE whatsapp_outbox;
ALTER TABLE whatsapp_outbox_new RENAME TO whatsapp_outbox;

CREATE INDEX IF NOT EXISTS idx_wa_outbox_status ON whatsapp_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_wa_outbox_lease ON whatsapp_outbox(status, locked_until, next_attempt_at);

PRAGMA defer_foreign_keys=OFF;
