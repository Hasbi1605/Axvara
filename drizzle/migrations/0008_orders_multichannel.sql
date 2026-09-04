-- 0008_orders_multichannel.sql — Rebuild orders table to support multi-channel (web, telegram, whatsapp)
-- and add explicit channel identity columns without breaking FKs or existing data.

-- D1 keeps foreign-key enforcement enabled inside migrations. Deferring the
-- checks is the supported way to rebuild a referenced parent table.
PRAGMA defer_foreign_keys=ON;

-- A previously interrupted local attempt must not leave a stale copy target.
DROP TABLE IF EXISTS orders_new;

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

-- 3. Move child foreign keys to a temporary namespace before dropping the
-- referenced parent. D1 runs migrations with foreign_keys=ON; deferring the
-- checks alone is insufficient because DROP TABLE performs an implicit delete
-- against the old parent. The values are restored after the replacement table
-- has taken the canonical `orders` name.
UPDATE payment_transactions
SET order_code='__axvara_0008__:' || order_code;

UPDATE fulfillment_jobs
SET order_code='__axvara_0008__:' || order_code;

UPDATE payment_proofs
SET order_code='__axvara_0008__:' || order_code;

-- 4. Drop old table
DROP TABLE orders;

-- 5. Rename new table to original name
ALTER TABLE orders_new RENAME TO orders;

-- 6. Restore child foreign keys now that the canonical parent exists again.
UPDATE payment_transactions
SET order_code=substr(order_code, length('__axvara_0008__:') + 1);

UPDATE fulfillment_jobs
SET order_code=substr(order_code, length('__axvara_0008__:') + 1);

UPDATE payment_proofs
SET order_code=substr(order_code, length('__axvara_0008__:') + 1);

-- 7. Recreate indexes
CREATE UNIQUE INDEX IF NOT EXISTS orders_quote_id_unique
  ON orders(quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_channel
  ON orders(sales_channel, channel_conversation_id);
CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders(status, payment_status);

-- Enforce the proof-review invariant under concurrent webhook deliveries.
-- If an older deployment already admitted duplicates, keep one authoritative
-- candidate (approved first, otherwise oldest submitted) and reject the rest.
WITH ranked_active_proofs AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY order_code
           ORDER BY CASE WHEN status='approved' THEN 0 ELSE 1 END, id ASC
         ) AS proof_rank
  FROM payment_proofs
  WHERE status IN ('submitted','approved')
)
UPDATE payment_proofs
SET status='rejected',
    rejection_reason=COALESCE(rejection_reason,'Duplikat aktif dinormalisasi saat migrasi'),
    reviewed_at=COALESCE(reviewed_at,datetime('now'))
WHERE id IN (SELECT id FROM ranked_active_proofs WHERE proof_rank > 1);

CREATE UNIQUE INDEX IF NOT EXISTS payment_proofs_one_active_per_order
  ON payment_proofs(order_code) WHERE status IN ('submitted','approved');

CREATE INDEX IF NOT EXISTS idx_wa_inbox_member_time
  ON whatsapp_inbox_events(conversation_id,member_id,created_at);

-- Fail the migration before commit if any child reference was not restored.
PRAGMA defer_foreign_keys=OFF;
