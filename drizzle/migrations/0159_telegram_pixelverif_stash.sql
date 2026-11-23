-- 0159 — Durable AES-GCM encrypted stash for Telegram 3-step Pixel Verification
-- credential collection (replaces volatile per-isolate in-memory Maps).
-- One row per Telegram user, hard 10-minute expires_at, purged on completion,
-- cancel, restart, or maintenance cleanup.

CREATE TABLE IF NOT EXISTS telegram_pixelverif_stashes (
  user_id TEXT PRIMARY KEY,
  variant_id INTEGER NOT NULL,
  flow_id TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tg_pv_stashes_expires
  ON telegram_pixelverif_stashes(expires_at);
