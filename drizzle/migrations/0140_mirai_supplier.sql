-- MiraiAPI is a separate, opt-in supplier. No products are activated by migration/sync.
CREATE TABLE IF NOT EXISTS mirai_packages (
  package_code TEXT PRIMARY KEY,
  group_key TEXT NOT NULL,
  name TEXT NOT NULL,
  quota_tokens INTEGER NOT NULL CHECK(quota_tokens > 0),
  duration_seconds INTEGER NOT NULL CHECK(duration_seconds > 0),
  reseller_price_vnd INTEGER NOT NULL CHECK(reseller_price_vnd > 0),
  cost_usdt REAL NOT NULL CHECK(cost_usdt > 0),
  min_quantity INTEGER NOT NULL DEFAULT 1 CHECK(min_quantity >= 1),
  max_quantity INTEGER NOT NULL DEFAULT 10000 CHECK(max_quantity >= min_quantity),
  preset_quantities_json TEXT NOT NULL DEFAULT '[]',
  models_json TEXT NOT NULL DEFAULT '[]',
  unlimited INTEGER NOT NULL DEFAULT 1 CHECK(unlimited IN (0,1)),
  remaining_today INTEGER NOT NULL DEFAULT 0 CHECK(remaining_today >= 0),
  markup_percent REAL NOT NULL DEFAULT 35 CHECK(markup_percent BETWEEN 0 AND 1000),
  axvara_product_id INTEGER REFERENCES products(id),
  sell_price_idr INTEGER,
  fx_idr_per_usdt REAL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  last_seen_at TEXT,
  synced_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mirai_packages_active ON mirai_packages(is_active, group_key);

ALTER TABLE products ADD COLUMN mirai_family TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_mirai_family ON products(mirai_family) WHERE mirai_family IS NOT NULL;

ALTER TABLE product_variants ADD COLUMN mirai_package_code TEXT;
ALTER TABLE product_variants ADD COLUMN mirai_markup_percent REAL CHECK(mirai_markup_percent IS NULL OR mirai_markup_percent BETWEEN 0 AND 1000);
ALTER TABLE product_variants ADD COLUMN mirai_admin_price_idr INTEGER CHECK(mirai_admin_price_idr IS NULL OR mirai_admin_price_idr > 0);
ALTER TABLE product_variants ADD COLUMN mirai_cost_usdt REAL CHECK(mirai_cost_usdt IS NULL OR mirai_cost_usdt > 0);
ALTER TABLE product_variants ADD COLUMN mirai_fx_idr_per_usdt REAL CHECK(mirai_fx_idr_per_usdt IS NULL OR mirai_fx_idr_per_usdt > 0);
CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_mirai_package ON product_variants(mirai_package_code) WHERE mirai_package_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS mirai_order_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL REFERENCES orders(code),
  item_index INTEGER NOT NULL,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  package_code TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10000),
  cost_usdt REAL NOT NULL CHECK(cost_usdt > 0),
  fx_idr_per_usdt REAL,
  external_order_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_order_code TEXT,
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
CREATE INDEX IF NOT EXISTS idx_mirai_orders_due ON mirai_order_links(status, next_attempt_at, lease_expires_at);
ALTER TABLE fulfillment_items ADD COLUMN mirai_link_id INTEGER REFERENCES mirai_order_links(id);

CREATE TRIGGER IF NOT EXISTS pg_dirty_mirai_variant_update AFTER UPDATE OF mirai_package_code,mirai_cost_usdt,mirai_fx_idr_per_usdt ON product_variants
WHEN OLD.mirai_package_code IS NOT NEW.mirai_package_code OR OLD.mirai_cost_usdt IS NOT NEW.mirai_cost_usdt OR OLD.mirai_fx_idr_per_usdt IS NOT NEW.mirai_fx_idr_per_usdt BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id,lower(hex(randomblob(16))),1 FROM product_group_members m WHERE m.product_id IN (OLD.product_id,NEW.product_id) GROUP BY m.group_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version,pending=1;
END;
