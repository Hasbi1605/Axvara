-- ============================================================
-- Migration 0027: Warung Rebahan H2H Integration
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Warung Rebahan Product Registry
--    Mirror produk dari WR API. Ini BUKAN tabel products utama.
--    Tabel ini menyimpan data mentah dari WR untuk mapping.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wr_products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  wr_product_id   TEXT NOT NULL UNIQUE,
  wr_product_name TEXT NOT NULL,
  wr_category     TEXT,
  wr_description  TEXT,
  axvara_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  is_excluded     INTEGER NOT NULL DEFAULT 0,
  exclude_reason  TEXT,
  last_synced_at  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────────────────────
-- 2. Warung Rebahan Variant Registry
--    Mirror varian dari WR API untuk mapping ke product_variants.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wr_variants (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  wr_variant_id         TEXT NOT NULL UNIQUE,
  wr_product_id         TEXT NOT NULL REFERENCES wr_products(wr_product_id),
  wr_variant_name       TEXT NOT NULL,
  wr_price              INTEGER NOT NULL,
  wr_duration           TEXT,
  wr_type               TEXT,
  wr_warranty           TEXT,
  wr_stock              INTEGER NOT NULL DEFAULT 0,
  wr_terms              TEXT,
  wr_delivery_terms     TEXT,
  axvara_variant_id     INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
  markup_percent        INTEGER NOT NULL DEFAULT 50,
  markup_fixed          INTEGER NOT NULL DEFAULT 0,
  axvara_sell_price     INTEGER NOT NULL DEFAULT 0,
  is_active             INTEGER NOT NULL DEFAULT 1,
  last_synced_at        TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────────────────────
-- 3. Warung Rebahan Order Links
--    Menghubungkan order Axvara dengan order Warung Rebahan.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wr_order_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code      TEXT NOT NULL REFERENCES orders(code),
  wr_order_id     TEXT,
  wr_variant_id   TEXT NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  wr_cost         INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN (
                    'pending',
                    'ordering',
                    'processing',
                    'completed',
                    'failed',
                    'retry'
                  )),
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TEXT,
  last_error      TEXT,
  wr_account_details TEXT,
  wr_account_iv   TEXT,
  completed_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wr_order_links_order_code ON wr_order_links(order_code);
CREATE INDEX IF NOT EXISTS idx_wr_order_links_status ON wr_order_links(status);
CREATE INDEX IF NOT EXISTS idx_wr_order_links_retry ON wr_order_links(status, next_attempt_at)
  WHERE status IN ('pending', 'retry');

-- ────────────────────────────────────────────────────────────
-- 4. Warung Rebahan Sync Log
--    Audit trail setiap kali sync dijalankan.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wr_sync_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_type         TEXT NOT NULL CHECK (sync_type IN ('products', 'saldo', 'order_status')),
  status            TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  products_total    INTEGER,
  products_synced   INTEGER,
  products_excluded INTEGER,
  products_new      INTEGER,
  variants_synced   INTEGER,
  stock_changes     INTEGER,
  price_changes     INTEGER,
  saldo_amount      INTEGER,
  error_message     TEXT,
  duration_ms       INTEGER,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────────────────────
-- 5. Warung Rebahan Saldo Log
--    Track saldo WR untuk monitoring & alert.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wr_saldo_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  balance     INTEGER NOT NULL,
  source      TEXT NOT NULL DEFAULT 'api_check'
              CHECK (source IN ('api_check', 'order_deduct', 'manual_topup')),
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────────────────────
-- 6. Warung Rebahan Exclusion Rules
--    Daftar nama produk yang harus di-exclude dari sync.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wr_exclusions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern   TEXT NOT NULL UNIQUE,
  reason    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed default exclusions
INSERT OR IGNORE INTO wr_exclusions (pattern, reason) VALUES
  ('%canva%', 'Axvara sudah punya Canva Edu sendiri — margin lebih tinggi'),
  ('%gemini%', 'Gemini dijual terpisah dengan metode sendiri');

-- ────────────────────────────────────────────────────────────
-- 7. Tambahkan kolom source di products utama
--    Untuk membedakan produk manual vs WR-synced.
-- ────────────────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'warung_rebahan'));

ALTER TABLE products ADD COLUMN wr_product_id TEXT;
ALTER TABLE products ADD COLUMN wr_auto_managed INTEGER NOT NULL DEFAULT 0;

-- Index untuk lookup produk WR
CREATE INDEX IF NOT EXISTS idx_products_source ON products(source) WHERE source = 'warung_rebahan';
CREATE INDEX IF NOT EXISTS idx_products_wr_id ON products(wr_product_id) WHERE wr_product_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 8. Tambahkan kolom source di product_variants utama
-- ────────────────────────────────────────────────────────────
ALTER TABLE product_variants ADD COLUMN wr_variant_id TEXT;
ALTER TABLE product_variants ADD COLUMN wr_auto_managed INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_variants_wr_id ON product_variants(wr_variant_id) WHERE wr_variant_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 9. Fulfillment WR via source='warung_rebahan'
--    SQLite tidak support ALTER CHECK constraint. Produk WR tetap pakai
--    fulfillment_mode='manual', delivery dihandle wr_order_links pipeline.
-- ────────────────────────────────────────────────────────────
