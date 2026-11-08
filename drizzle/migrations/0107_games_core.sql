-- 0107_games_core.sql — AXVARA Games backend tahap A (2026-11-09, docs/GAMES.md §12.2).
-- Tabel baru saja (IF NOT EXISTS); tidak mengubah tabel/baris lama. Harus identik dengan drizzle/schema.sql.
-- AXVARA Games (docs/GAMES.md §12.2): katalog SKU Digiflazz, item pesanan, dan
-- percobaan dispatch. `orders.order_kind='games'` (kolom tanpa CHECK).
CREATE TABLE IF NOT EXISTS games_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_sku_code TEXT NOT NULL UNIQUE,
  backup_sku_code TEXT,
  game_brand TEXT NOT NULL DEFAULT '',
  product_type TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL,
  cost INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0),
  backup_cost INTEGER CHECK (backup_cost IS NULL OR backup_cost >= 0),
  seller_active INTEGER NOT NULL DEFAULT 0 CHECK (seller_active IN (0,1)),
  backup_seller_active INTEGER NOT NULL DEFAULT 0 CHECK (backup_seller_active IN (0,1)),
  unlimited_stock INTEGER NOT NULL DEFAULT 1 CHECK (unlimited_stock IN (0,1)),
  stock INTEGER NOT NULL DEFAULT 0,
  multi INTEGER NOT NULL DEFAULT 0 CHECK (multi IN (0,1)),
  start_cut_off TEXT NOT NULL DEFAULT '00:00',
  end_cut_off TEXT NOT NULL DEFAULT '00:00',
  description TEXT NOT NULL DEFAULT '',
  reference_price INTEGER CHECK (reference_price IS NULL OR reference_price > 0),
  sell_price INTEGER NOT NULL DEFAULT 0 CHECK (sell_price >= 0),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_games_products_brand ON games_products(game_brand, enabled);
CREATE INDEX IF NOT EXISTS idx_games_products_synced ON games_products(synced_at);

CREATE TABLE IF NOT EXISTS games_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE REFERENCES orders(code),
  product_id INTEGER NOT NULL REFERENCES games_products(id),
  buyer_sku_code TEXT NOT NULL,
  customer_no TEXT NOT NULL,
  customer_nickname TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity = 1),
  unit_price INTEGER NOT NULL CHECK (unit_price > 0),
  total INTEGER NOT NULL CHECK (total > 0),
  cost_snapshot INTEGER NOT NULL CHECK (cost_snapshot > 0),
  max_price INTEGER NOT NULL CHECK (max_price > 0),
  status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN (
    'awaiting_payment','queued','submitting','pending','success','needs_check','expired')),
  attempt_no INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no IN (1,2)),
  sn TEXT,
  supplier_message TEXT,
  lease_until TEXT,
  submit_attempts INTEGER NOT NULL DEFAULT 0,
  last_polled_at TEXT,
  completed_at TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_games_items_dispatch ON games_order_items(status, lease_until);
CREATE INDEX IF NOT EXISTS idx_games_items_poll ON games_order_items(status, last_polled_at);

CREATE TABLE IF NOT EXISTS games_dispatch_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_id TEXT NOT NULL UNIQUE,
  order_code TEXT NOT NULL REFERENCES orders(code),
  attempt_no INTEGER NOT NULL CHECK (attempt_no IN (1,2)),
  buyer_sku_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitting' CHECK (status IN (
    'submitting','pending','success','failed','ambiguous')),
  rc TEXT,
  message TEXT,
  sn TEXT,
  price INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (order_code, attempt_no)
);
CREATE INDEX IF NOT EXISTS idx_games_attempts_status ON games_dispatch_attempts(status, updated_at);
