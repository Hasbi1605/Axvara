-- 0059_pedia.sql — AXVARA PEDIA (toko SMM kurasi, PEDIA-PRD §8).
--
-- Desain:
-- - `orders.order_kind` ('apps' | 'pedia', default 'apps'): penanda jenis
--   order di tabel orders existing TANPA rebuild (CHECK sales_channel tidak
--   disentuh — D1 prod menolak rebuild). Order Pedia memakai
--   fulfillment_status='not_required' (tidak lewat fulfillment toko pusat).
-- - `pedia_supplier_services`: cermin katalog ProviderSMM (ditulis diff VPS).
-- - `pedia_products` + `pedia_tiers`: produk kurasi (±20) + 3 tingkat
--   kualitas (hemat/standar/premium) dengan harga per paket tersimpan
--   (dihitung saat sinkron dari rate terkini, bukan tiap request).
-- - `pedia_order_items`: 1 order = 1 item di fase 1.
-- - `pedia_credits` + `pedia_credit_ledger`: Kode Kredit Pedia (refund tanpa
--   login; kode mentah hanya dikirim ke pembeli, yang disimpan hash SHA-256).
-- - `pedia_supplier_balance_log`: log saldo supplier (pola migrasi 0057 —
--   kolom berindeks sejak awal agar tidak mengulang insiden rows_read).
--
-- Idempoten: CREATE TABLE/INDEX IF NOT EXISTS + ALTER langsung (pola
-- 0031/0033/0034/0058; jalur CI mencatat migrasi). SQLite tak punya
-- ADD COLUMN IF NOT EXISTS — rerun manual akan gagal duplicate column
-- (seperti 0030), jalur CI aman.
ALTER TABLE orders ADD COLUMN order_kind TEXT NOT NULL DEFAULT 'apps';
CREATE INDEX IF NOT EXISTS idx_orders_kind_created ON orders(order_kind, created_at);

-- Cermin katalog supplier (ditulis diff VPS).
CREATE TABLE IF NOT EXISTS pedia_supplier_services (
  supplier TEXT NOT NULL DEFAULT 'providersmm',
  service_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  rate_idr_per_1k REAL NOT NULL,
  min_qty INTEGER NOT NULL,
  max_qty INTEGER NOT NULL,
  api_refill INTEGER NOT NULL DEFAULT 0,
  api_cancel INTEGER NOT NULL DEFAULT 0,
  api_dripfeed INTEGER NOT NULL DEFAULT 0,
  present INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (supplier, service_id)
);

-- Produk kurasi.
CREATE TABLE IF NOT EXISTS pedia_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  platform TEXT NOT NULL,
  metric TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  name TEXT NOT NULL,
  tagline TEXT,
  description_md TEXT,
  checklist_json TEXT NOT NULL DEFAULT '[]',
  packages_json TEXT NOT NULL DEFAULT '[]',
  step INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 0,
  is_featured INTEGER NOT NULL DEFAULT 0,
  sold_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pedia_products_platform ON pedia_products(platform, is_active, sort_order);

CREATE TABLE IF NOT EXISTS pedia_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES pedia_products(id),
  tier TEXT NOT NULL CHECK (tier IN ('hemat','standar','premium')),
  label_note TEXT,
  supplier TEXT NOT NULL DEFAULT 'providersmm',
  supplier_service_id INTEGER NOT NULL,
  backup_service_id INTEGER,
  price_group TEXT NOT NULL CHECK (price_group IN ('G1','G2','G3')),
  markup_pct REAL NOT NULL,
  min_profit_rp INTEGER NOT NULL,
  refill_days INTEGER NOT NULL DEFAULT 0,
  eta_start TEXT,
  eta_finish TEXT,
  package_prices_json TEXT NOT NULL DEFAULT '{}',
  rate_snapshot REAL,
  is_active INTEGER NOT NULL DEFAULT 0,
  auto_disabled_reason TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, tier)
);

-- Item order Pedia (1 order = 1 item di fase 1).
CREATE TABLE IF NOT EXISTS pedia_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE REFERENCES orders(code),
  product_id INTEGER NOT NULL REFERENCES pedia_products(id),
  tier_id INTEGER NOT NULL REFERENCES pedia_tiers(id),
  snapshot_json TEXT NOT NULL,
  target_raw TEXT NOT NULL,
  target_normalized TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  total INTEGER NOT NULL,
  credit_used INTEGER NOT NULL DEFAULT 0,
  supplier TEXT NOT NULL,
  supplier_service_id INTEGER NOT NULL,
  supplier_rate_snapshot REAL NOT NULL,
  supplier_order_id TEXT,
  supplier_charge REAL,
  start_count INTEGER,
  remains INTEGER,
  status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN (
    'awaiting_payment','queued','submitting','submitted','in_progress',
    'completed','partial','canceled','needs_check','expired')),
  submit_attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  last_error TEXT,
  last_polled_at TEXT,
  refund_credit_code TEXT,
  refill_last_at TEXT,
  refill_supplier_id TEXT,
  refill_status TEXT,
  notified_paid_at TEXT,
  notified_final_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pedia_items_status ON pedia_order_items(status, last_polled_at);
CREATE INDEX IF NOT EXISTS idx_pedia_items_target ON pedia_order_items(target_normalized, product_id, status);

-- Kode Kredit Pedia (refund tanpa login).
CREATE TABLE IF NOT EXISTS pedia_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT UNIQUE NOT NULL,
  code_hint TEXT NOT NULL,
  email TEXT NOT NULL,
  amount INTEGER NOT NULL,
  remaining INTEGER NOT NULL CHECK (remaining >= 0),
  source_order_code TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('partial','canceled','admin')),
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_order_code, source_kind)
);
CREATE TABLE IF NOT EXISTS pedia_credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credit_id INTEGER NOT NULL REFERENCES pedia_credits(id),
  order_code TEXT,
  delta INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Log saldo supplier (berindeks sejak awal, belajar dari insiden 0057).
CREATE TABLE IF NOT EXISTS pedia_supplier_balance_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier TEXT NOT NULL,
  balance REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pedia_balance_log ON pedia_supplier_balance_log(supplier, created_at);
