-- 0008_orders_multichannel.sql — Rebuild orders table to support multi-channel (web, telegram, whatsapp)
-- and add explicit channel identity columns without breaking FKs or existing data.

PRAGMA foreign_keys=OFF;

-- 1. Create temporary new table with expanded CHECK constraints and explicit channel columns
CREATE TABLE IF NOT EXISTS orders_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_wa TEXT NOT NULL,
  customer_email TEXT,
  items TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  payment_account TEXT,
  proof_url TEXT,
  status TEXT DEFAULT 'pending',
  admin_note TEXT,
  quote_id TEXT,
  expires_at TEXT,
  sales_channel TEXT NOT NULL DEFAULT 'web'
    CHECK (sales_channel IN ('web','telegram','whatsapp')),
  telegram_chat_id TEXT,
  telegram_user_id TEXT,
  channel_conversation_id TEXT,
  channel_member_id TEXT,
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','pending','paid','expired','failed','refunded')),
  fulfillment_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (fulfillment_status IN (
      'not_required','reserved','queued','sending','delivered',
      'manual_required','retry','failed'
    )),
  variant_id INTEGER REFERENCES product_variants(id),
  variant_snapshot TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 2. Copy existing data, mapping telegram columns to channel identity as default
INSERT INTO orders_new (
  id, code, customer_name, customer_wa, customer_email, items, subtotal,
  payment_method, payment_account, proof_url, status, admin_note, quote_id,
  expires_at, sales_channel, telegram_chat_id, telegram_user_id,
  channel_conversation_id, channel_member_id, payment_status,
  fulfillment_status, variant_id, variant_snapshot, created_at, updated_at
)
SELECT
  id, code, customer_name, customer_wa, customer_email, items, subtotal,
  payment_method, payment_account, proof_url, status, admin_note, quote_id,
  expires_at, sales_channel, telegram_chat_id, telegram_user_id,
  COALESCE(telegram_chat_id, NULL), COALESCE(telegram_user_id, NULL),
  payment_status, fulfillment_status, variant_id, variant_snapshot,
  created_at, updated_at
FROM orders;

-- 3. Drop old table
DROP TABLE orders;

-- 4. Rename new table to original name
ALTER TABLE orders_new RENAME TO orders;

-- 5. Recreate indexes
CREATE UNIQUE INDEX IF NOT EXISTS orders_quote_id_unique
  ON orders(quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_channel
  ON orders(sales_channel, channel_conversation_id);
CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders(status, payment_status);

PRAGMA foreign_keys=ON;
