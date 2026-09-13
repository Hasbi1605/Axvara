-- ============================================================
-- Migration 0029: Warung Rebahan exactly-once hardening
-- Aman untuk production existing DAN bootstrap kosong.
-- 1. Rebuild wr_order_links (SQLite tak bisa ALTER CHECK): CHECK status
--    lama (0027) tidak mengenal claimed/submitted/blocked_balance.
--    Prosedur 12-langkah SQLite dalam satu transaksi: data dicopy penuh,
--    tidak ada link yang dihapus.
-- 2. Tabel/index baru IF NOT EXISTS/OR IGNORE (rerun aman).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. State machine exactly-once untuk wr_order_links.
--    pending         = kebutuhan tercatat, request BELUM keluar. Aman retry.
--    claimed         = worker pegang lease, request BELUM dikirim.
--    submitted       = request TERKIRIM, hasil ambigu (timeout/crash).
--                      DILARANG beli ulang buta — hanya reconcile.
--    ordering        = LEGACY pra-0029 (klaim tanpa lease pemisah).
--                      Kode baru memperlakukannya sebagai submitted.
--    processing      = WR konfirmasi menerima.
--    completed/failed/retry = seperti sebelumnya.
--    blocked_balance = saldo habis: tidak makan retry transport, pulih
--                      otomatis setelah top-up (reconciler).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wr_order_links_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code      TEXT NOT NULL REFERENCES orders(code),
  wr_order_id     TEXT,
  wr_variant_id   TEXT NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  wr_cost         INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN (
                    'pending',
                    'claimed',
                    'submitted',
                    'ordering',
                    'processing',
                    'completed',
                    'failed',
                    'retry',
                    'blocked_balance'
                  )),
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TEXT,
  last_error      TEXT,
  wr_account_details TEXT,
  wr_account_iv   TEXT,
  completed_at    TEXT,
  -- Correlation key stabil per kebutuhan pembelian canonical.
  idempotency_key TEXT,
  -- Lease fencing untuk worker crash/timeout.
  lease_owner TEXT,
  lease_expires_at TEXT,
  -- Jejak request: NULL = belum kirim (aman retry); non-NULL = ambigu.
  request_sent_at TEXT,
  last_claim_at TEXT,
  -- Event dedupe webhook (monotonik).
  last_event_id TEXT,
  last_event_at TEXT,
  -- Delivery durable per link (P0-6).
  delivery_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (delivery_status IN ('not_required','queued','sending','delivered','failed')),
  delivery_channel TEXT,
  delivery_attempt_count INTEGER NOT NULL DEFAULT 0,
  delivery_next_attempt_at TEXT,
  delivery_last_error TEXT,
  delivered_at TEXT,
  -- Kaitan ke baris fulfillment_items yang tepat (P0-5).
  fulfillment_item_id INTEGER REFERENCES fulfillment_items(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Copy data lama (kolom baru = default/NULL; id dipertahankan agar
-- fulfillment_items.wr_link_id masa depan tetap konsisten).
INSERT OR IGNORE INTO wr_order_links_new
  (id, order_code, wr_order_id, wr_variant_id, quantity, wr_cost, status,
   attempt_count, max_attempts, next_attempt_at, last_error,
   wr_account_details, wr_account_iv, completed_at, created_at, updated_at)
SELECT id, order_code, wr_order_id, wr_variant_id, quantity, wr_cost, status,
   attempt_count, max_attempts, next_attempt_at, last_error,
   wr_account_details, wr_account_iv, completed_at, created_at, updated_at
FROM wr_order_links;

DROP TABLE wr_order_links;
ALTER TABLE wr_order_links_new RENAME TO wr_order_links;

-- Backfill idempotency_key: hanya baris id TERKECIL per
-- (order_code, wr_variant_id) yang mendapat key; duplikat legacy dibiarkan
-- NULL (audit trail) dan tidak ikut constraint.
UPDATE wr_order_links
SET idempotency_key = 'wr:' || order_code || ':' || wr_variant_id || ':' || CAST(COALESCE(quantity, 1) AS TEXT)
WHERE idempotency_key IS NULL
  AND id = (
    SELECT MIN(l2.id) FROM wr_order_links l2
    WHERE l2.order_code = wr_order_links.order_code
      AND l2.wr_variant_id = wr_order_links.wr_variant_id
  );

-- ────────────────────────────────────────────────────────────
-- 2. Marker kepemilikan WR di fulfillment_items (P0-5).
-- ────────────────────────────────────────────────────────────
ALTER TABLE fulfillment_items ADD COLUMN wr_link_id INTEGER
  REFERENCES wr_order_links(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fulfillment_items_wr_link
  ON fulfillment_items(wr_link_id) WHERE wr_link_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 3. Uniqueness canonical + index kerja.
-- ────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_wr_links_idempotency
  ON wr_order_links(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wr_order_links_order_code ON wr_order_links(order_code);
CREATE INDEX IF NOT EXISTS idx_wr_order_links_status ON wr_order_links(status);
CREATE INDEX IF NOT EXISTS idx_wr_order_links_retry ON wr_order_links(status, next_attempt_at)
  WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS idx_wr_links_lease
  ON wr_order_links(status, lease_expires_at)
  WHERE status IN ('claimed','submitted','ordering');
CREATE INDEX IF NOT EXISTS idx_wr_links_delivery
  ON wr_order_links(delivery_status, delivery_next_attempt_at)
  WHERE delivery_status IN ('queued','failed');
CREATE INDEX IF NOT EXISTS idx_wr_links_item
  ON wr_order_links(fulfillment_item_id) WHERE fulfillment_item_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 4. Sync cursor durable (P0-4): resumable lintas invocation.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wr_sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO wr_sync_state (key, value) VALUES
  ('products_cursor', '0'),
  ('products_generation', ''),
  ('products_snapshot_complete', '0');

-- ────────────────────────────────────────────────────────────
-- 5. Web capability token untuk retrieval kredensial (P0-6).
--    Hanya hash yang disimpan; raw token hanya di tangan pembeli.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wr_credential_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL REFERENCES orders(code) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wr_cred_token_hash ON wr_credential_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_wr_cred_order ON wr_credential_tokens(order_code) WHERE revoked = 0;

-- ────────────────────────────────────────────────────────────
-- 6. Webhook event log untuk dedupe (P1-7).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wr_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wr_order_id TEXT NOT NULL,
  event TEXT NOT NULL,
  event_id TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied INTEGER NOT NULL DEFAULT 0,
  result TEXT
);
CREATE INDEX IF NOT EXISTS idx_wr_webhook_order ON wr_webhook_events(wr_order_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wr_webhook_event
  ON wr_webhook_events(wr_order_id, event, event_id) WHERE event_id IS NOT NULL;
