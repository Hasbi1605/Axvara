ALTER TABLE orders ADD COLUMN supplier_purchase_disabled INTEGER NOT NULL DEFAULT 0 CHECK(supplier_purchase_disabled IN (0,1));
CREATE TABLE IF NOT EXISTS tunvn_order_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL REFERENCES orders(code),
  item_index INTEGER NOT NULL,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL CHECK(kind IN ('account','buff')),
  source_product_id INTEGER,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100),
  invite_code TEXT,
  cost_usdt REAL NOT NULL CHECK(cost_usdt>0),
  currency TEXT NOT NULL DEFAULT 'usdt' CHECK(currency='usdt'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','processing','completed','needs_admin')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  request_sent_at TEXT,
  provider_order_group TEXT,
  provider_batch_id TEXT,
  provider_order_code TEXT,
  receipt_ciphertext TEXT,
  receipt_iv TEXT,
  receipt_http_status INTEGER,
  receipt_json TEXT,
  last_error TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(order_code,item_index)
);
CREATE INDEX IF NOT EXISTS idx_tunvn_orders_due ON tunvn_order_links(status,next_attempt_at,lease_expires_at);
ALTER TABLE fulfillment_items ADD COLUMN tunvn_link_id INTEGER REFERENCES tunvn_order_links(id);
