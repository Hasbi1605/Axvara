-- StoreBat rows are opt-in; neither migration nor sync activates merchandise.
CREATE TABLE storebat_products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price_usd REAL NOT NULL CHECK(price_usd>0),
  standard_price_usd REAL,
  pricing_type TEXT NOT NULL,
  price_tiers_json TEXT NOT NULL,
  warranty_days INTEGER NOT NULL DEFAULT 0,
  delivery_type TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),
  image_url TEXT,
  last_seen_at TEXT NOT NULL,
  disappeared INTEGER NOT NULL DEFAULT 0 CHECK(disappeared IN (0,1)),
  api_test INTEGER NOT NULL DEFAULT 0 CHECK(api_test IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE storebat_services (
  service TEXT PRIMARY KEY CHECK(service='muse_buff'),
  price_per_billion REAL NOT NULL CHECK(price_per_billion>0),
  available INTEGER NOT NULL DEFAULT 1 CHECK(available IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE products ADD COLUMN storebat_family TEXT;
CREATE UNIQUE INDEX idx_products_storebat_family ON products(storebat_family) WHERE storebat_family IS NOT NULL;
ALTER TABLE product_variants ADD COLUMN storebat_product_id INTEGER;
ALTER TABLE product_variants ADD COLUMN storebat_markup_percent REAL CHECK(storebat_markup_percent BETWEEN 0 AND 1000);
ALTER TABLE product_variants ADD COLUMN storebat_admin_price_idr INTEGER CHECK(storebat_admin_price_idr>0);
ALTER TABLE product_variants ADD COLUMN storebat_cost_usd REAL CHECK(storebat_cost_usd>0);
ALTER TABLE product_variants ADD COLUMN storebat_fx_idr_per_usd REAL CHECK(storebat_fx_idr_per_usd>0);
CREATE UNIQUE INDEX idx_variants_storebat_product ON product_variants(storebat_product_id) WHERE storebat_product_id IS NOT NULL;
CREATE TABLE storebat_order_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL REFERENCES orders(code),
  item_index INTEGER NOT NULL,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  storebat_product_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('product','muse_buff')),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100 AND (kind!='muse_buff' OR quantity<=30)),
  cost_usd REAL NOT NULL CHECK(cost_usd>0),
  fx_idr_per_usd REAL NOT NULL CHECK(fx_idr_per_usd>0),
  refunded_usd REAL CHECK(refunded_usd>=0),
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_order_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','processing','completed','needs_admin')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  request_sent_at TEXT,
  invite_ciphertext TEXT,
  invite_iv TEXT,
  receipt_ciphertext TEXT,
  receipt_iv TEXT,
  receipt_http_status INTEGER,
  receipt_source TEXT CHECK(receipt_source IN ('purchase','poll','lookup')),
  receipt_retry_after INTEGER,
  receipt_json TEXT,
  last_error TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(order_code,item_index)
);
CREATE INDEX idx_storebat_orders_due ON storebat_order_links(status,next_attempt_at,lease_expires_at);
ALTER TABLE fulfillment_items ADD COLUMN storebat_link_id INTEGER REFERENCES storebat_order_links(id);

-- Stock and price already have generic dirty triggers. Snapshot-only changes also affect ranking.
CREATE TRIGGER pg_dirty_storebat_variant_update AFTER UPDATE OF storebat_product_id,storebat_cost_usd,storebat_fx_idr_per_usd ON product_variants
WHEN OLD.storebat_product_id IS NOT NEW.storebat_product_id OR OLD.storebat_cost_usd IS NOT NEW.storebat_cost_usd OR OLD.storebat_fx_idr_per_usd IS NOT NEW.storebat_fx_idr_per_usd BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id,lower(hex(randomblob(16))),1 FROM product_group_members m WHERE m.product_id IN (OLD.product_id,NEW.product_id) GROUP BY m.group_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version,pending=1;
END;
