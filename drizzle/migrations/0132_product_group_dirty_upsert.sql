-- 0132: trigger pg_dirty_* memakai UPSERT eksplisit, bukan INSERT OR REPLACE.
-- Bila trigger terpicu dari statement luar berbentuk UPSERT (INSERT ... ON
-- CONFLICT DO UPDATE, mis. mirror tunvn_products), SQLite menerapkan conflict
-- algorithm ABORT milik statement luar ke statement di dalam trigger, sehingga
-- OR REPLACE diabaikan dan statement gagal "UNIQUE constraint failed:
-- product_group_dirty.group_id". Sejak 17 Nov 2026 11:10 UTC ini menggagalkan
-- seluruh sync katalog TUNVN. ON CONFLICT DO UPDATE di dalam trigger tidak
-- tertimpa oleh statement luar. Isi/kondisi trigger identik dengan 0129.

DROP TRIGGER IF EXISTS pg_dirty_product_insert;
CREATE TRIGGER pg_dirty_product_insert AFTER INSERT ON products BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m WHERE m.product_id=NEW.id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_product_delete;
CREATE TRIGGER pg_dirty_product_delete AFTER DELETE ON products BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m WHERE m.product_id=OLD.id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_product_update;
CREATE TRIGGER pg_dirty_product_update AFTER UPDATE OF is_active,archived_at ON products
WHEN OLD.is_active IS NOT NEW.is_active OR OLD.archived_at IS NOT NEW.archived_at BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m WHERE m.product_id=NEW.id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_variant_insert;
CREATE TRIGGER pg_dirty_variant_insert AFTER INSERT ON product_variants BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m WHERE m.product_id=NEW.product_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_variant_delete;
CREATE TRIGGER pg_dirty_variant_delete AFTER DELETE ON product_variants BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m WHERE m.product_id=OLD.product_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_variant_update;
CREATE TRIGGER pg_dirty_variant_update AFTER UPDATE OF product_id,stock,price,is_active,min_qty,fulfillment_mode,duration_value,duration_unit,manual_cost,wr_variant_id,sk_variant_id,tunvn_source_product_id,tunvn_buff_quantity_b,tunvn_cost_usdt,tunvn_fx_idr_per_usdt,aivault_service_id ON product_variants
WHEN OLD.product_id IS NOT NEW.product_id OR OLD.stock IS NOT NEW.stock OR OLD.price IS NOT NEW.price OR OLD.is_active IS NOT NEW.is_active
  OR OLD.duration_value IS NOT NEW.duration_value OR OLD.duration_unit IS NOT NEW.duration_unit OR OLD.manual_cost IS NOT NEW.manual_cost
  OR OLD.min_qty IS NOT NEW.min_qty OR OLD.fulfillment_mode IS NOT NEW.fulfillment_mode
  OR OLD.wr_variant_id IS NOT NEW.wr_variant_id OR OLD.sk_variant_id IS NOT NEW.sk_variant_id
  OR OLD.tunvn_source_product_id IS NOT NEW.tunvn_source_product_id OR OLD.tunvn_buff_quantity_b IS NOT NEW.tunvn_buff_quantity_b
  OR OLD.tunvn_cost_usdt IS NOT NEW.tunvn_cost_usdt OR OLD.tunvn_fx_idr_per_usdt IS NOT NEW.tunvn_fx_idr_per_usdt
  OR OLD.aivault_service_id IS NOT NEW.aivault_service_id BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    WHERE m.product_id=OLD.product_id OR m.product_id=NEW.product_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_wr_insert;
CREATE TRIGGER pg_dirty_wr_insert AFTER INSERT ON wr_variants BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.wr_variant_id=NEW.wr_variant_id GROUP BY m.group_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_wr_delete;
CREATE TRIGGER pg_dirty_wr_delete AFTER DELETE ON wr_variants BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.wr_variant_id=OLD.wr_variant_id GROUP BY m.group_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_wr_update;
CREATE TRIGGER pg_dirty_wr_update AFTER UPDATE OF wr_variant_id,wr_price,wr_stock,wr_delivery_class ON wr_variants
WHEN OLD.wr_variant_id IS NOT NEW.wr_variant_id OR OLD.wr_price IS NOT NEW.wr_price OR OLD.wr_stock IS NOT NEW.wr_stock OR OLD.wr_delivery_class IS NOT NEW.wr_delivery_class BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.wr_variant_id=OLD.wr_variant_id OR v.wr_variant_id=NEW.wr_variant_id GROUP BY m.group_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_sk_insert;
CREATE TRIGGER pg_dirty_sk_insert AFTER INSERT ON sk_products BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.sk_variant_id=NEW.sk_variant_id GROUP BY m.group_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_sk_delete;
CREATE TRIGGER pg_dirty_sk_delete AFTER DELETE ON sk_products BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.sk_variant_id=OLD.sk_variant_id GROUP BY m.group_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_sk_update;
CREATE TRIGGER pg_dirty_sk_update AFTER UPDATE OF sk_variant_id,sk_price,sk_stock ON sk_products
WHEN OLD.sk_variant_id IS NOT NEW.sk_variant_id OR OLD.sk_price IS NOT NEW.sk_price OR OLD.sk_stock IS NOT NEW.sk_stock BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.sk_variant_id=OLD.sk_variant_id OR v.sk_variant_id=NEW.sk_variant_id GROUP BY m.group_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_tunvn_update;
CREATE TRIGGER pg_dirty_tunvn_update AFTER UPDATE OF supplier_product_id,price_usdt,fx_idr_per_usdt ON tunvn_products
WHEN OLD.supplier_product_id IS NOT NEW.supplier_product_id OR OLD.price_usdt IS NOT NEW.price_usdt OR OLD.fx_idr_per_usdt IS NOT NEW.fx_idr_per_usdt BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.tunvn_source_product_id IN (OLD.supplier_product_id,NEW.supplier_product_id)
      OR v.sku IN ('TUNVN-'||OLD.supplier_product_id,'TUNVN-'||NEW.supplier_product_id) GROUP BY m.group_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_aivault_update;
CREATE TRIGGER pg_dirty_aivault_update AFTER UPDATE OF service_id,unit_price_usd,fx_idr_per_usd ON aivault_products
WHEN OLD.service_id IS NOT NEW.service_id OR OLD.unit_price_usd IS NOT NEW.unit_price_usd OR OLD.fx_idr_per_usd IS NOT NEW.fx_idr_per_usd BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.aivault_service_id IN (OLD.service_id,NEW.service_id) GROUP BY m.group_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_fx_update;
CREATE TRIGGER pg_dirty_fx_update AFTER UPDATE OF fx_rate_text ON crypto_market_snapshot
WHEN OLD.fx_rate_text IS NOT NEW.fx_rate_text BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT g.id, lower(hex(randomblob(16))), 1 FROM product_groups g WHERE true
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_member_insert;
CREATE TRIGGER pg_dirty_member_insert AFTER INSERT ON product_group_members BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    VALUES(NEW.group_id, lower(hex(randomblob(16))), 1)
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_member_delete;
CREATE TRIGGER pg_dirty_member_delete AFTER DELETE ON product_group_members BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT OLD.group_id, lower(hex(randomblob(16))), 1 WHERE EXISTS(SELECT 1 FROM product_groups WHERE id=OLD.group_id)
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
  UPDATE product_groups SET prefer_product_id=NULL WHERE id=OLD.group_id AND prefer_product_id=OLD.product_id;
  UPDATE product_groups SET winner_product_id=NULL WHERE id=OLD.group_id AND winner_product_id=OLD.product_id;
END;
DROP TRIGGER IF EXISTS pg_dirty_group_update;
CREATE TRIGGER pg_dirty_group_update AFTER UPDATE OF prefer_product_id,prefer_margin ON product_groups BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    VALUES(NEW.id, lower(hex(randomblob(16))), 1)
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_member_update;
CREATE TRIGGER pg_dirty_member_update AFTER UPDATE OF group_id,product_id,position ON product_group_members
WHEN OLD.group_id IS NOT NEW.group_id OR OLD.product_id IS NOT NEW.product_id OR OLD.position IS NOT NEW.position BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT id,lower(hex(randomblob(16))),1 FROM product_groups WHERE id IN (OLD.group_id,NEW.group_id)
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_tunvn_insert;
CREATE TRIGGER pg_dirty_tunvn_insert AFTER INSERT ON tunvn_products BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id,lower(hex(randomblob(16))),1 FROM product_group_members m JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.tunvn_source_product_id=NEW.supplier_product_id OR v.sku='TUNVN-'||NEW.supplier_product_id GROUP BY m.group_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_tunvn_delete;
CREATE TRIGGER pg_dirty_tunvn_delete AFTER DELETE ON tunvn_products BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id,lower(hex(randomblob(16))),1 FROM product_group_members m JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.tunvn_source_product_id=OLD.supplier_product_id OR v.sku='TUNVN-'||OLD.supplier_product_id GROUP BY m.group_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_aivault_insert;
CREATE TRIGGER pg_dirty_aivault_insert AFTER INSERT ON aivault_products BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id,lower(hex(randomblob(16))),1 FROM product_group_members m JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.aivault_service_id=NEW.service_id GROUP BY m.group_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_aivault_delete;
CREATE TRIGGER pg_dirty_aivault_delete AFTER DELETE ON aivault_products BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id,lower(hex(randomblob(16))),1 FROM product_group_members m JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.aivault_service_id=OLD.service_id GROUP BY m.group_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_fx_insert;
CREATE TRIGGER pg_dirty_fx_insert AFTER INSERT ON crypto_market_snapshot WHEN NEW.id=1 BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT id,lower(hex(randomblob(16))),1 FROM product_groups WHERE true
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_fx_delete;
CREATE TRIGGER pg_dirty_fx_delete AFTER DELETE ON crypto_market_snapshot WHEN OLD.id=1 BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT id,lower(hex(randomblob(16))),1 FROM product_groups WHERE true
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_inventory_insert;
CREATE TRIGGER pg_dirty_inventory_insert AFTER INSERT ON fulfillment_inventory BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT group_id,lower(hex(randomblob(16))),1 FROM product_group_members WHERE product_id=NEW.product_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_inventory_delete;
CREATE TRIGGER pg_dirty_inventory_delete AFTER DELETE ON fulfillment_inventory BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT group_id,lower(hex(randomblob(16))),1 FROM product_group_members WHERE product_id=OLD.product_id
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
DROP TRIGGER IF EXISTS pg_dirty_inventory_update;
CREATE TRIGGER pg_dirty_inventory_update AFTER UPDATE OF product_id,variant_id,status ON fulfillment_inventory
WHEN OLD.product_id IS NOT NEW.product_id OR OLD.variant_id IS NOT NEW.variant_id OR OLD.status IS NOT NEW.status BEGIN
  INSERT INTO product_group_dirty(group_id,version,pending)
    SELECT group_id,lower(hex(randomblob(16))),1 FROM product_group_members WHERE product_id IN (OLD.product_id,NEW.product_id)
    ON CONFLICT(group_id) DO UPDATE SET version=excluded.version, pending=1;
END;
