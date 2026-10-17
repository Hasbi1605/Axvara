-- D1 read budget phase 2. Additive indexes + durable, versioned pair invalidation.
CREATE INDEX IF NOT EXISTS idx_inventory_product_variant_status ON fulfillment_inventory(product_id,variant_id,status);
CREATE INDEX IF NOT EXISTS idx_orders_telegram_buyer_status ON orders(sales_channel,telegram_user_id,status,payment_status);
CREATE TABLE IF NOT EXISTS supplier_pair_dirty (
  pair_id INTEGER PRIMARY KEY REFERENCES supplier_pairs(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  pending INTEGER NOT NULL DEFAULT 1 CHECK(pending IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_supplier_pair_dirty_pending ON supplier_pair_dirty(pending);

-- Retain processed versions to fence old full sweeps and avoid delete/reinsert ABA.
CREATE TRIGGER IF NOT EXISTS pair_dirty_product_insert AFTER INSERT ON products BEGIN
  INSERT INTO supplier_pair_dirty(pair_id,version) SELECT id,lower(hex(randomblob(16))) FROM supplier_pairs WHERE wr_product_id=NEW.id OR sk_product_id=NEW.id ON CONFLICT(pair_id) DO UPDATE SET version=excluded.version,pending=1;
END;

CREATE TRIGGER IF NOT EXISTS pair_dirty_product_delete AFTER DELETE ON products BEGIN
  INSERT INTO supplier_pair_dirty(pair_id,version) SELECT id,lower(hex(randomblob(16))) FROM supplier_pairs WHERE wr_product_id=OLD.id OR sk_product_id=OLD.id ON CONFLICT(pair_id) DO UPDATE SET version=excluded.version,pending=1;
END;

CREATE TRIGGER IF NOT EXISTS pair_dirty_variant_insert AFTER INSERT ON product_variants BEGIN
  INSERT INTO supplier_pair_dirty(pair_id,version) SELECT id,lower(hex(randomblob(16))) FROM supplier_pairs WHERE wr_product_id=NEW.product_id OR sk_product_id=NEW.product_id ON CONFLICT(pair_id) DO UPDATE SET version=excluded.version,pending=1;
END;

CREATE TRIGGER IF NOT EXISTS pair_dirty_variant_delete AFTER DELETE ON product_variants BEGIN
  INSERT INTO supplier_pair_dirty(pair_id,version) SELECT id,lower(hex(randomblob(16))) FROM supplier_pairs WHERE wr_product_id=OLD.product_id OR sk_product_id=OLD.product_id ON CONFLICT(pair_id) DO UPDATE SET version=excluded.version,pending=1;
END;

CREATE TRIGGER IF NOT EXISTS pair_dirty_variant_update AFTER UPDATE OF product_id,stock,price,is_active,wr_variant_id,sk_variant_id ON product_variants WHEN OLD.product_id IS NOT NEW.product_id OR OLD.stock IS NOT NEW.stock OR OLD.price IS NOT NEW.price OR OLD.is_active IS NOT NEW.is_active OR OLD.wr_variant_id IS NOT NEW.wr_variant_id OR OLD.sk_variant_id IS NOT NEW.sk_variant_id BEGIN
  INSERT INTO supplier_pair_dirty(pair_id,version) SELECT id,lower(hex(randomblob(16))) FROM supplier_pairs WHERE wr_product_id=OLD.product_id OR sk_product_id=OLD.product_id OR wr_product_id=NEW.product_id OR sk_product_id=NEW.product_id ON CONFLICT(pair_id) DO UPDATE SET version=excluded.version,pending=1;
END;

CREATE TRIGGER IF NOT EXISTS pair_dirty_wr_insert AFTER INSERT ON wr_variants BEGIN
  INSERT INTO supplier_pair_dirty(pair_id,version) SELECT sp.id,lower(hex(randomblob(16))) FROM supplier_pairs sp WHERE sp.wr_product_id IN (SELECT pv.product_id FROM product_variants pv WHERE pv.wr_variant_id=NEW.wr_variant_id) OR sp.sk_product_id IN (SELECT pv.product_id FROM product_variants pv WHERE pv.wr_variant_id=NEW.wr_variant_id) ON CONFLICT(pair_id) DO UPDATE SET version=excluded.version,pending=1;
END;

CREATE TRIGGER IF NOT EXISTS pair_dirty_wr_delete AFTER DELETE ON wr_variants BEGIN
  INSERT INTO supplier_pair_dirty(pair_id,version) SELECT sp.id,lower(hex(randomblob(16))) FROM supplier_pairs sp WHERE sp.wr_product_id IN (SELECT pv.product_id FROM product_variants pv WHERE pv.wr_variant_id=OLD.wr_variant_id) OR sp.sk_product_id IN (SELECT pv.product_id FROM product_variants pv WHERE pv.wr_variant_id=OLD.wr_variant_id) ON CONFLICT(pair_id) DO UPDATE SET version=excluded.version,pending=1;
END;

CREATE TRIGGER IF NOT EXISTS pair_dirty_wr_update AFTER UPDATE OF wr_variant_id,wr_price,wr_stock ON wr_variants WHEN OLD.wr_variant_id IS NOT NEW.wr_variant_id OR OLD.wr_price IS NOT NEW.wr_price OR OLD.wr_stock IS NOT NEW.wr_stock BEGIN
  INSERT INTO supplier_pair_dirty(pair_id,version) SELECT sp.id,lower(hex(randomblob(16))) FROM supplier_pairs sp WHERE sp.wr_product_id IN (SELECT pv.product_id FROM product_variants pv WHERE pv.wr_variant_id=OLD.wr_variant_id OR pv.wr_variant_id=NEW.wr_variant_id) OR sp.sk_product_id IN (SELECT pv.product_id FROM product_variants pv WHERE pv.wr_variant_id=OLD.wr_variant_id OR pv.wr_variant_id=NEW.wr_variant_id) ON CONFLICT(pair_id) DO UPDATE SET version=excluded.version,pending=1;
END;

CREATE TRIGGER IF NOT EXISTS pair_dirty_sk_insert AFTER INSERT ON sk_products BEGIN
  INSERT INTO supplier_pair_dirty(pair_id,version) SELECT sp.id,lower(hex(randomblob(16))) FROM supplier_pairs sp WHERE sp.wr_product_id IN (SELECT pv.product_id FROM product_variants pv WHERE pv.sk_variant_id=NEW.sk_variant_id) OR sp.sk_product_id IN (SELECT pv.product_id FROM product_variants pv WHERE pv.sk_variant_id=NEW.sk_variant_id) ON CONFLICT(pair_id) DO UPDATE SET version=excluded.version,pending=1;
END;

CREATE TRIGGER IF NOT EXISTS pair_dirty_sk_delete AFTER DELETE ON sk_products BEGIN
  INSERT INTO supplier_pair_dirty(pair_id,version) SELECT sp.id,lower(hex(randomblob(16))) FROM supplier_pairs sp WHERE sp.wr_product_id IN (SELECT pv.product_id FROM product_variants pv WHERE pv.sk_variant_id=OLD.sk_variant_id) OR sp.sk_product_id IN (SELECT pv.product_id FROM product_variants pv WHERE pv.sk_variant_id=OLD.sk_variant_id) ON CONFLICT(pair_id) DO UPDATE SET version=excluded.version,pending=1;
END;

CREATE TRIGGER IF NOT EXISTS pair_dirty_sk_update AFTER UPDATE OF sk_variant_id,sk_price,sk_stock ON sk_products WHEN OLD.sk_variant_id IS NOT NEW.sk_variant_id OR OLD.sk_price IS NOT NEW.sk_price OR OLD.sk_stock IS NOT NEW.sk_stock BEGIN
  INSERT INTO supplier_pair_dirty(pair_id,version) SELECT sp.id,lower(hex(randomblob(16))) FROM supplier_pairs sp WHERE sp.wr_product_id IN (SELECT pv.product_id FROM product_variants pv WHERE pv.sk_variant_id=OLD.sk_variant_id OR pv.sk_variant_id=NEW.sk_variant_id) OR sp.sk_product_id IN (SELECT pv.product_id FROM product_variants pv WHERE pv.sk_variant_id=OLD.sk_variant_id OR pv.sk_variant_id=NEW.sk_variant_id) ON CONFLICT(pair_id) DO UPDATE SET version=excluded.version,pending=1;
END;

CREATE TRIGGER IF NOT EXISTS pair_dirty_pair_insert AFTER INSERT ON supplier_pairs BEGIN
  INSERT INTO supplier_pair_dirty(pair_id,version) SELECT NEW.id,lower(hex(randomblob(16))) WHERE 1 ON CONFLICT(pair_id) DO UPDATE SET version=excluded.version,pending=1;
END;

CREATE TRIGGER IF NOT EXISTS pair_dirty_pair_update AFTER UPDATE OF wr_product_id,sk_product_id,prefer,prefer_margin ON supplier_pairs WHEN OLD.wr_product_id IS NOT NEW.wr_product_id OR OLD.sk_product_id IS NOT NEW.sk_product_id OR OLD.prefer IS NOT NEW.prefer OR OLD.prefer_margin IS NOT NEW.prefer_margin BEGIN
  INSERT INTO supplier_pair_dirty(pair_id,version) SELECT NEW.id,lower(hex(randomblob(16))) WHERE 1 ON CONFLICT(pair_id) DO UPDATE SET version=excluded.version,pending=1;
END;

INSERT INTO supplier_pair_dirty(pair_id,version) SELECT id,lower(hex(randomblob(16))) FROM supplier_pairs WHERE 1 ON CONFLICT(pair_id) DO NOTHING;
