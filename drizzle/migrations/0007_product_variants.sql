-- 0007_product_variants.sql — Product variants + WhatsApp sessions/proofs + multi-channel support
-- Phase 1: variant schema, backfill, catalog service foundations
-- Phase 5-6: WhatsApp sessions, inbox, outbox, payment proofs

-- === product_variants ===
CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,

  duration_value INTEGER,
  duration_unit TEXT CHECK (duration_unit IS NULL OR duration_unit IN ('day','month','year','lifetime','custom')),
  duration_label TEXT,

  warranty_type TEXT NOT NULL DEFAULT 'none' CHECK (warranty_type IN ('none','limited','full','custom')),
  warranty_value INTEGER,
  warranty_unit TEXT CHECK (warranty_unit IS NULL OR warranty_unit IN ('day','month','year','lifetime')),
  warranty_label TEXT,

  price INTEGER NOT NULL CHECK (price >= 0),
  compare_price INTEGER CHECK (compare_price IS NULL OR compare_price > price),
  stock INTEGER NOT NULL DEFAULT -1,

  fulfillment_mode TEXT NOT NULL DEFAULT 'manual' CHECK (fulfillment_mode IN ('manual','shared','unique')),
  shared_secret_ciphertext TEXT,
  shared_secret_iv TEXT,

  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON product_variants(sku);

-- Add aliases for bot search matching
ALTER TABLE products ADD COLUMN aliases TEXT DEFAULT '[]';

-- Nullable variant_id on orders for compatibility period
ALTER TABLE orders ADD COLUMN variant_id INTEGER REFERENCES product_variants(id);
ALTER TABLE orders ADD COLUMN variant_snapshot TEXT;

-- Nullable variant_id on fulfillment tables
ALTER TABLE fulfillment_inventory ADD COLUMN variant_id INTEGER REFERENCES product_variants(id);
ALTER TABLE fulfillment_jobs ADD COLUMN variant_id INTEGER REFERENCES product_variants(id);
ALTER TABLE fulfillment_jobs ADD COLUMN sales_channel TEXT DEFAULT 'telegram';

-- Cannot ALTER CHECK in SQLite, so we just document: sales_channel now accepts 'web','telegram','whatsapp'
-- The app-level validation handles this; SQLite CHECK from 0005 allows any text since we can't drop the constraint

-- === whatsapp_sessions (per group member context) ===
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'fonnte',
  conversation_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  selected_product_id INTEGER,
  numbered_variant_map TEXT,
  selected_variant_id INTEGER,
  variant_message_id TEXT,
  payment_message_id TEXT,
  current_order_id INTEGER,
  current_order_code TEXT,
  current_payment_transaction_id INTEGER,
  catalog_version TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, conversation_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_sessions_expiry ON whatsapp_sessions(expires_at);

-- === whatsapp_inbox_events (webhook dedup) ===
CREATE TABLE IF NOT EXISTS whatsapp_inbox_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'fonnte',
  external_message_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'message',
  conversation_id TEXT,
  member_id TEXT,
  payload_hash TEXT,
  status TEXT NOT NULL DEFAULT 'processed' CHECK (status IN ('processed','failed','ignored')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, external_message_id)
);

-- === whatsapp_outbox (message delivery with retry) ===
CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  destination TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  provider_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wa_outbox_status ON whatsapp_outbox(status, next_attempt_at);

-- === payment_proofs (WhatsApp group proof intake) ===
CREATE TABLE IF NOT EXISTS payment_proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL REFERENCES orders(code),
  sales_channel TEXT NOT NULL DEFAULT 'whatsapp',
  conversation_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  external_message_id TEXT NOT NULL,
  reply_to_message_id TEXT,
  claimed_method TEXT NOT NULL CHECK (claimed_method IN ('QRIS','SEABANK','EWALLET')),
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sales_channel, external_message_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_proofs_order ON payment_proofs(order_code);
CREATE INDEX IF NOT EXISTS idx_payment_proofs_status ON payment_proofs(status);

-- === Backfill: create one default variant per existing product ===
INSERT INTO product_variants (product_id, sku, label, price, compare_price, stock, fulfillment_mode, shared_secret_ciphertext, shared_secret_iv, is_active, sort_order, created_at, updated_at)
SELECT
  p.id,
  'DEFAULT-' || p.id,
  'Default',
  p.price,
  p.compare_price,
  p.stock,
  COALESCE(p.fulfillment_mode, 'manual'),
  p.shared_secret_ciphertext,
  p.shared_secret_iv,
  p.is_active,
  0,
  COALESCE(p.created_at, datetime('now')),
  datetime('now')
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id);

-- Link existing fulfillment_inventory to default variants
UPDATE fulfillment_inventory
SET variant_id = (
  SELECT pv.id FROM product_variants pv
  WHERE pv.product_id = fulfillment_inventory.product_id
  AND pv.sku LIKE 'DEFAULT-%'
  LIMIT 1
)
WHERE variant_id IS NULL;
