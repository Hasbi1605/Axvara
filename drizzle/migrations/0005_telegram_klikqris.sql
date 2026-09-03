-- 0005_telegram_klikqris.sql — Bot Telegram + KlikQRIS payment + fulfillment system
-- Adds: telegram_users, telegram_updates, payment_transactions, fulfillment_inventory, fulfillment_jobs
-- Alters: products (fulfillment_mode, shared_secret, telegram_enabled), orders (sales_channel, telegram, payment/fulfillment status)

-- === Alter products ===
ALTER TABLE products ADD COLUMN fulfillment_mode TEXT NOT NULL DEFAULT 'manual'
  CHECK (fulfillment_mode IN ('manual','shared','unique'));
ALTER TABLE products ADD COLUMN shared_secret_ciphertext TEXT;
ALTER TABLE products ADD COLUMN shared_secret_iv TEXT;
ALTER TABLE products ADD COLUMN telegram_enabled INTEGER NOT NULL DEFAULT 1;

-- === Alter orders ===
ALTER TABLE orders ADD COLUMN sales_channel TEXT NOT NULL DEFAULT 'web'
  CHECK (sales_channel IN ('web','telegram'));
ALTER TABLE orders ADD COLUMN telegram_chat_id TEXT;
ALTER TABLE orders ADD COLUMN telegram_user_id TEXT;
ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid','pending','paid','expired','failed','refunded'));
ALTER TABLE orders ADD COLUMN fulfillment_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (fulfillment_status IN (
    'not_required','reserved','queued','sending','delivered',
    'manual_required','retry','failed'
  ));

-- === telegram_users ===
CREATE TABLE IF NOT EXISTS telegram_users (
  user_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- === telegram_updates (idempotency + lease) ===
CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('processing','done','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  lease_until TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- === payment_transactions (KlikQRIS ledger) ===
CREATE TABLE IF NOT EXISTS payment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL REFERENCES orders(code),
  provider TEXT NOT NULL,
  provider_mode TEXT NOT NULL,
  provider_order_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  requested_amount INTEGER NOT NULL,
  payable_amount INTEGER,
  status TEXT NOT NULL DEFAULT 'initializing',
  provider_signature TEXT,
  qris_url TEXT,
  direct_url TEXT,
  expires_at TEXT,
  paid_at TEXT,
  last_checked_at TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(provider, provider_order_id),
  UNIQUE(order_code)
);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_expires ON payment_transactions(expires_at);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_order ON payment_transactions(order_code);

-- === fulfillment_inventory (encrypted vault) ===
CREATE TABLE IF NOT EXISTS fulfillment_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  secret_ciphertext TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  secret_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','reserved','delivered','revoked')),
  order_code TEXT,
  reserved_at TEXT,
  delivered_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, secret_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_fulfillment_inventory_product_status
  ON fulfillment_inventory(product_id, status);

-- === fulfillment_jobs (outbox delivery) ===
CREATE TABLE IF NOT EXISTS fulfillment_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE REFERENCES orders(code),
  inventory_id INTEGER REFERENCES fulfillment_inventory(id),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','delivered','manual_required','retry','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  locked_until TEXT,
  telegram_message_id TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fulfillment_jobs_status ON fulfillment_jobs(status);
CREATE INDEX IF NOT EXISTS idx_fulfillment_jobs_next ON fulfillment_jobs(next_attempt_at);
