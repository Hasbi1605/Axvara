-- AIVault is a separate, opt-in supplier. No products are activated by migration/sync.
CREATE TABLE IF NOT EXISTS aivault_products (
  service_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),
  unit_price_usd REAL NOT NULL CHECK(unit_price_usd>0),
  pricing_tiers_json TEXT NOT NULL,
  custom_pricing INTEGER NOT NULL DEFAULT 0 CHECK(custom_pricing IN (0,1)),
  markup_percent REAL NOT NULL DEFAULT 35 CHECK(markup_percent BETWEEN 0 AND 1000),
  axvara_product_id INTEGER REFERENCES products(id),
  sell_price_idr INTEGER,
  fx_idr_per_usd REAL,
  synced_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE products ADD COLUMN aivault_family TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_aivault_family ON products(aivault_family) WHERE aivault_family IS NOT NULL;
ALTER TABLE product_variants ADD COLUMN aivault_service_id TEXT;
ALTER TABLE product_variants ADD COLUMN aivault_admin_price_idr INTEGER CHECK(aivault_admin_price_idr IS NULL OR aivault_admin_price_idr>0);
CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_aivault_service ON product_variants(aivault_service_id) WHERE aivault_service_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS aivault_order_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL REFERENCES orders(code),
  item_index INTEGER NOT NULL,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  service_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100),
  cost_usd REAL NOT NULL CHECK(cost_usd>0),
  external_order_id TEXT NOT NULL UNIQUE,
  provider_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','processing','completed','needs_admin')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  request_sent_at TEXT,
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
CREATE INDEX IF NOT EXISTS idx_aivault_orders_due ON aivault_order_links(status,next_attempt_at,lease_expires_at);
ALTER TABLE fulfillment_items ADD COLUMN aivault_link_id INTEGER REFERENCES aivault_order_links(id);
