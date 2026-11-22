-- Pixel Verification is a separate, opt-in supplier. No products are activated by migration/sync.
CREATE TABLE IF NOT EXISTS pixelverif_services (
  service_key TEXT PRIMARY KEY,
  flow_type TEXT NOT NULL CHECK(flow_type IN ('normal','full')),
  validity INTEGER NOT NULL CHECK(validity = 3),
  credit_cost REAL NOT NULL CHECK(credit_cost > 0),
  available INTEGER NOT NULL DEFAULT 1 CHECK(available IN (0,1)),
  pricing_version INTEGER,
  synced_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pixelverif_services_flow ON pixelverif_services(flow_type, validity);

ALTER TABLE products ADD COLUMN pixelverif_family TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_pixelverif_family ON products(pixelverif_family) WHERE pixelverif_family IS NOT NULL;

ALTER TABLE product_variants ADD COLUMN pixelverif_flow_type TEXT CHECK(pixelverif_flow_type IN ('normal','full'));
ALTER TABLE product_variants ADD COLUMN pixelverif_validity INTEGER CHECK(pixelverif_validity IS NULL OR pixelverif_validity = 3);
ALTER TABLE product_variants ADD COLUMN pixelverif_cost_usd REAL CHECK(pixelverif_cost_usd IS NULL OR pixelverif_cost_usd > 0);
ALTER TABLE product_variants ADD COLUMN pixelverif_fx_idr_per_usd REAL CHECK(pixelverif_fx_idr_per_usd IS NULL OR pixelverif_fx_idr_per_usd > 0);
ALTER TABLE product_variants ADD COLUMN pixelverif_markup_percent REAL CHECK(pixelverif_markup_percent IS NULL OR pixelverif_markup_percent BETWEEN 0 AND 1000);
ALTER TABLE product_variants ADD COLUMN pixelverif_admin_price_idr INTEGER CHECK(pixelverif_admin_price_idr IS NULL OR pixelverif_admin_price_idr > 0);
CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_pixelverif_flow ON product_variants(pixelverif_flow_type, pixelverif_validity) WHERE pixelverif_flow_type IS NOT NULL AND pixelverif_validity IS NOT NULL;

CREATE TABLE IF NOT EXISTS pixelverif_order_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL REFERENCES orders(code),
  item_index INTEGER NOT NULL,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  flow_type TEXT NOT NULL CHECK(flow_type IN ('normal','full')),
  validity INTEGER NOT NULL CHECK(validity = 3),
  credit_cost REAL NOT NULL CHECK(credit_cost > 0),
  fx_idr_per_usd REAL,
  provider_order_id TEXT UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_order_code TEXT,
  submit_seq INTEGER NOT NULL DEFAULT 0 CHECK(submit_seq >= 0),
  last_error_code TEXT,
  activation_status TEXT,
  queue_position INTEGER,
  progress_step INTEGER,
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
  UNIQUE(order_code, item_index)
);
CREATE INDEX IF NOT EXISTS idx_pixelverif_orders_due ON pixelverif_order_links(status, next_attempt_at, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_pixelverif_orders_provider ON pixelverif_order_links(provider_order_id) WHERE provider_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pixelverif_buyer_inputs (
  order_code TEXT NOT NULL REFERENCES orders(code),
  item_index INTEGER NOT NULL,
  input_ciphertext TEXT,
  input_iv TEXT,
  email_masked TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  purged_at TEXT,
  PRIMARY KEY (order_code, item_index)
);
CREATE INDEX IF NOT EXISTS idx_pixelverif_buyer_inputs_order ON pixelverif_buyer_inputs(order_code);

ALTER TABLE fulfillment_items ADD COLUMN pixelverif_link_id INTEGER REFERENCES pixelverif_order_links(id);
CREATE INDEX IF NOT EXISTS idx_fulfillment_items_pixelverif_link ON fulfillment_items(pixelverif_link_id) WHERE pixelverif_link_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS pg_dirty_pixelverif_variant_update AFTER UPDATE OF pixelverif_flow_type,pixelverif_cost_usd,pixelverif_fx_idr_per_usd ON product_variants
WHEN OLD.pixelverif_flow_type IS NOT NEW.pixelverif_flow_type OR OLD.pixelverif_cost_usd IS NOT NEW.pixelverif_cost_usd OR OLD.pixelverif_fx_idr_per_usd IS NOT NEW.pixelverif_fx_idr_per_usd BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id,lower(hex(randomblob(16))),1 FROM product_group_members m WHERE m.product_id IN (OLD.product_id,NEW.product_id) GROUP BY m.group_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version,pending=1;
END;
