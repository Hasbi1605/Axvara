-- 0129_product_groups.sql — Grup produk lintas supplier (keputusan owner 16 Nov 2026).
--
-- Menggantikan pasangan WR vs SK. Satu grup berisi 2..10 produk dari supplier
-- apa pun (WR, SK, TUNVN, AIVault, Manual). supplier_pairs DIBIARKAN sebagai
-- arsip (tidak dipakai lagi, tidak di-drop).
--
-- Idempotent: grup hasil migrasi memakai id = supplier_pairs.id agar pemetaan
-- anggota deterministik dan aman dijalankan ulang.

CREATE TABLE IF NOT EXISTS product_groups (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  prefer_product_id INTEGER,
  prefer_margin     INTEGER NOT NULL DEFAULT 2000,
  winner_product_id INTEGER,
  reason            TEXT,
  decided_at        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_group_members (
  group_id   INTEGER NOT NULL REFERENCES product_groups(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL UNIQUE,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, product_id)
);

CREATE TABLE IF NOT EXISTS product_group_dirty (
  group_id INTEGER PRIMARY KEY REFERENCES product_groups(id) ON DELETE CASCADE,
  version  TEXT NOT NULL,
  pending  INTEGER NOT NULL DEFAULT 1 CHECK(pending IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_product_group_dirty_pending ON product_group_dirty(pending);

-- Salin 33 pasangan lama → grup (nama dari produk WR), prefer & winner lama.
INSERT OR IGNORE INTO product_groups(id,name,prefer_product_id,prefer_margin,winner_product_id,reason,decided_at,created_at,updated_at)
SELECT sp.id,
  COALESCE(NULLIF(TRIM(wp.name),''), 'Grup ' || sp.id),
  CASE sp.prefer WHEN 'WR' THEN sp.wr_product_id WHEN 'SK' THEN sp.sk_product_id END,
  sp.prefer_margin,
  CASE sp.winner WHEN 'WR' THEN sp.wr_product_id WHEN 'SK' THEN sp.sk_product_id END,
  sp.reason,
  sp.decided_at,
  sp.created_at,
  sp.updated_at
FROM supplier_pairs sp
LEFT JOIN products wp ON wp.id=sp.wr_product_id;

-- Idempoten: lewati produk yang sudah jadi anggota / sudah diarsipkan
-- (langkah Jaspay di bawah mengarsipkan produk MBO lama).
INSERT OR IGNORE INTO product_group_members(group_id,product_id,position,created_at)
SELECT sp.id, sp.wr_product_id, 0, sp.created_at FROM supplier_pairs sp
WHERE NOT EXISTS (SELECT 1 FROM product_group_members gm WHERE gm.product_id=sp.wr_product_id)
  AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id=sp.wr_product_id AND p.archived_at IS NOT NULL)
UNION ALL
SELECT sp.id, sp.sk_product_id, 1, sp.created_at FROM supplier_pairs sp
WHERE NOT EXISTS (SELECT 1 FROM product_group_members gm WHERE gm.product_id=sp.sk_product_id)
  AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id=sp.sk_product_id AND p.archived_at IS NOT NULL);

-- Jaspay menggantikan produk MBO lama di grupnya; produk lama diarsipkan.
-- Guard per baris = id + nama saat ini; aman/idempoten bila DB berbeda.
-- Zoom: 15 "Zoom Premium" → 113 "Zoom Pro".
UPDATE product_group_members SET product_id=113 WHERE product_id=15
  AND EXISTS(SELECT 1 FROM products WHERE id=15 AND name='Zoom Premium')
  AND EXISTS(SELECT 1 FROM products WHERE id=113 AND name='Zoom Pro')
  AND NOT EXISTS(SELECT 1 FROM product_group_members WHERE product_id=113);
UPDATE product_groups SET prefer_product_id=113 WHERE prefer_product_id=15
  AND EXISTS(SELECT 1 FROM products WHERE id=15 AND name='Zoom Premium')
  AND EXISTS(SELECT 1 FROM product_group_members WHERE group_id=product_groups.id AND product_id=113)
  AND EXISTS(SELECT 1 FROM products WHERE id=113 AND name='Zoom Pro');
UPDATE product_groups SET winner_product_id=113 WHERE winner_product_id=15
  AND EXISTS(SELECT 1 FROM products WHERE id=15 AND name='Zoom Premium')
  AND EXISTS(SELECT 1 FROM product_group_members WHERE group_id=product_groups.id AND product_id=113)
  AND EXISTS(SELECT 1 FROM products WHERE id=113 AND name='Zoom Pro');
UPDATE products SET is_active=0, archived_at=COALESCE(archived_at,datetime('now')), updated_at=datetime('now')
 WHERE id=15 AND name='Zoom Premium' AND archived_at IS NULL
  AND EXISTS(SELECT 1 FROM products WHERE id=113 AND name='Zoom Pro')
  AND NOT EXISTS(SELECT 1 FROM product_group_members WHERE product_id=15);

-- Express VPN: 20 → 121.
UPDATE product_group_members SET product_id=121 WHERE product_id=20
  AND EXISTS(SELECT 1 FROM products WHERE id=20 AND name='Express VPN')
  AND EXISTS(SELECT 1 FROM products WHERE id=121 AND name='Express VPN')
  AND NOT EXISTS(SELECT 1 FROM product_group_members WHERE product_id=121);
UPDATE product_groups SET prefer_product_id=121 WHERE prefer_product_id=20
  AND EXISTS(SELECT 1 FROM products WHERE id=20 AND name='Express VPN')
  AND EXISTS(SELECT 1 FROM product_group_members WHERE group_id=product_groups.id AND product_id=121)
  AND EXISTS(SELECT 1 FROM products WHERE id=121 AND name='Express VPN');
UPDATE product_groups SET winner_product_id=121 WHERE winner_product_id=20
  AND EXISTS(SELECT 1 FROM products WHERE id=20 AND name='Express VPN')
  AND EXISTS(SELECT 1 FROM product_group_members WHERE group_id=product_groups.id AND product_id=121)
  AND EXISTS(SELECT 1 FROM products WHERE id=121 AND name='Express VPN');
UPDATE products SET is_active=0, archived_at=COALESCE(archived_at,datetime('now')), updated_at=datetime('now')
 WHERE id=20 AND name='Express VPN' AND archived_at IS NULL
  AND EXISTS(SELECT 1 FROM products WHERE id=121 AND name='Express VPN')
  AND NOT EXISTS(SELECT 1 FROM product_group_members WHERE product_id=20);

-- Wink: 25 "Wink Premium" → 115 "Wink VIP".
UPDATE product_group_members SET product_id=115 WHERE product_id=25
  AND EXISTS(SELECT 1 FROM products WHERE id=25 AND name='Wink Premium')
  AND EXISTS(SELECT 1 FROM products WHERE id=115 AND name='Wink VIP')
  AND NOT EXISTS(SELECT 1 FROM product_group_members WHERE product_id=115);
UPDATE product_groups SET prefer_product_id=115 WHERE prefer_product_id=25
  AND EXISTS(SELECT 1 FROM products WHERE id=25 AND name='Wink Premium')
  AND EXISTS(SELECT 1 FROM product_group_members WHERE group_id=product_groups.id AND product_id=115)
  AND EXISTS(SELECT 1 FROM products WHERE id=115 AND name='Wink VIP');
UPDATE product_groups SET winner_product_id=115 WHERE winner_product_id=25
  AND EXISTS(SELECT 1 FROM products WHERE id=25 AND name='Wink Premium')
  AND EXISTS(SELECT 1 FROM product_group_members WHERE group_id=product_groups.id AND product_id=115)
  AND EXISTS(SELECT 1 FROM products WHERE id=115 AND name='Wink VIP');
UPDATE products SET is_active=0, archived_at=COALESCE(archived_at,datetime('now')), updated_at=datetime('now')
 WHERE id=25 AND name='Wink Premium' AND archived_at IS NULL
  AND EXISTS(SELECT 1 FROM products WHERE id=115 AND name='Wink VIP')
  AND NOT EXISTS(SELECT 1 FROM product_group_members WHERE product_id=25);

-- Meitu: 26 "Meitu Premium" → 114 "Meitu VIP".
UPDATE product_group_members SET product_id=114 WHERE product_id=26
  AND EXISTS(SELECT 1 FROM products WHERE id=26 AND name='Meitu Premium')
  AND EXISTS(SELECT 1 FROM products WHERE id=114 AND name='Meitu VIP')
  AND NOT EXISTS(SELECT 1 FROM product_group_members WHERE product_id=114);
UPDATE product_groups SET prefer_product_id=114 WHERE prefer_product_id=26
  AND EXISTS(SELECT 1 FROM products WHERE id=26 AND name='Meitu Premium')
  AND EXISTS(SELECT 1 FROM product_group_members WHERE group_id=product_groups.id AND product_id=114)
  AND EXISTS(SELECT 1 FROM products WHERE id=114 AND name='Meitu VIP');
UPDATE product_groups SET winner_product_id=114 WHERE winner_product_id=26
  AND EXISTS(SELECT 1 FROM products WHERE id=26 AND name='Meitu Premium')
  AND EXISTS(SELECT 1 FROM product_group_members WHERE group_id=product_groups.id AND product_id=114)
  AND EXISTS(SELECT 1 FROM products WHERE id=114 AND name='Meitu VIP');
UPDATE products SET is_active=0, archived_at=COALESCE(archived_at,datetime('now')), updated_at=datetime('now')
 WHERE id=26 AND name='Meitu Premium' AND archived_at IS NULL
  AND EXISTS(SELECT 1 FROM products WHERE id=114 AND name='Meitu VIP')
  AND NOT EXISTS(SELECT 1 FROM product_group_members WHERE product_id=26);

-- Arsip mematikan varian juga, tanpa menghapus identitas/order historis.
UPDATE product_variants SET is_active=0 WHERE product_id IN (
  SELECT id FROM products WHERE archived_at IS NOT NULL
    AND ((id=15 AND name='Zoom Premium') OR (id=20 AND name='Express VPN')
      OR (id=25 AND name='Wink Premium') OR (id=26 AND name='Meitu Premium'))
);

-- Invalidation setara supplier_pair_dirty: perubahan stok/harga/aktivitas/
-- arsip/kurs menandai grup terkait. Terproses oleh decideDirtyGroups.
CREATE TRIGGER IF NOT EXISTS pg_dirty_product_insert AFTER INSERT ON products BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m WHERE m.product_id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_product_delete AFTER DELETE ON products BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m WHERE m.product_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_product_update AFTER UPDATE OF is_active,archived_at ON products
WHEN OLD.is_active IS NOT NEW.is_active OR OLD.archived_at IS NOT NEW.archived_at BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m WHERE m.product_id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_variant_insert AFTER INSERT ON product_variants BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m WHERE m.product_id=NEW.product_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_variant_delete AFTER DELETE ON product_variants BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m WHERE m.product_id=OLD.product_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_variant_update AFTER UPDATE OF product_id,stock,price,is_active,min_qty,fulfillment_mode,duration_value,duration_unit,manual_cost,wr_variant_id,sk_variant_id,tunvn_source_product_id,tunvn_buff_quantity_b,tunvn_cost_usdt,tunvn_fx_idr_per_usdt,aivault_service_id ON product_variants
WHEN OLD.product_id IS NOT NEW.product_id OR OLD.stock IS NOT NEW.stock OR OLD.price IS NOT NEW.price OR OLD.is_active IS NOT NEW.is_active
  OR OLD.duration_value IS NOT NEW.duration_value OR OLD.duration_unit IS NOT NEW.duration_unit OR OLD.manual_cost IS NOT NEW.manual_cost
  OR OLD.min_qty IS NOT NEW.min_qty OR OLD.fulfillment_mode IS NOT NEW.fulfillment_mode
  OR OLD.wr_variant_id IS NOT NEW.wr_variant_id OR OLD.sk_variant_id IS NOT NEW.sk_variant_id
  OR OLD.tunvn_source_product_id IS NOT NEW.tunvn_source_product_id OR OLD.tunvn_buff_quantity_b IS NOT NEW.tunvn_buff_quantity_b
  OR OLD.tunvn_cost_usdt IS NOT NEW.tunvn_cost_usdt OR OLD.tunvn_fx_idr_per_usdt IS NOT NEW.tunvn_fx_idr_per_usdt
  OR OLD.aivault_service_id IS NOT NEW.aivault_service_id BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    WHERE m.product_id=OLD.product_id OR m.product_id=NEW.product_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_wr_insert AFTER INSERT ON wr_variants BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.wr_variant_id=NEW.wr_variant_id GROUP BY m.group_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_wr_delete AFTER DELETE ON wr_variants BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.wr_variant_id=OLD.wr_variant_id GROUP BY m.group_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_wr_update AFTER UPDATE OF wr_variant_id,wr_price,wr_stock,wr_delivery_class ON wr_variants
WHEN OLD.wr_variant_id IS NOT NEW.wr_variant_id OR OLD.wr_price IS NOT NEW.wr_price OR OLD.wr_stock IS NOT NEW.wr_stock OR OLD.wr_delivery_class IS NOT NEW.wr_delivery_class BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.wr_variant_id=OLD.wr_variant_id OR v.wr_variant_id=NEW.wr_variant_id GROUP BY m.group_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_sk_insert AFTER INSERT ON sk_products BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.sk_variant_id=NEW.sk_variant_id GROUP BY m.group_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_sk_delete AFTER DELETE ON sk_products BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.sk_variant_id=OLD.sk_variant_id GROUP BY m.group_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_sk_update AFTER UPDATE OF sk_variant_id,sk_price,sk_stock ON sk_products
WHEN OLD.sk_variant_id IS NOT NEW.sk_variant_id OR OLD.sk_price IS NOT NEW.sk_price OR OLD.sk_stock IS NOT NEW.sk_stock BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.sk_variant_id=OLD.sk_variant_id OR v.sk_variant_id=NEW.sk_variant_id GROUP BY m.group_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_tunvn_update AFTER UPDATE OF supplier_product_id,price_usdt,fx_idr_per_usdt ON tunvn_products
WHEN OLD.supplier_product_id IS NOT NEW.supplier_product_id OR OLD.price_usdt IS NOT NEW.price_usdt OR OLD.fx_idr_per_usdt IS NOT NEW.fx_idr_per_usdt BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.tunvn_source_product_id IN (OLD.supplier_product_id,NEW.supplier_product_id)
      OR v.sku IN ('TUNVN-'||OLD.supplier_product_id,'TUNVN-'||NEW.supplier_product_id) GROUP BY m.group_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_aivault_update AFTER UPDATE OF service_id,unit_price_usd,fx_idr_per_usd ON aivault_products
WHEN OLD.service_id IS NOT NEW.service_id OR OLD.unit_price_usd IS NOT NEW.unit_price_usd OR OLD.fx_idr_per_usd IS NOT NEW.fx_idr_per_usd BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id, lower(hex(randomblob(16))), 1 FROM product_group_members m
    JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.aivault_service_id IN (OLD.service_id,NEW.service_id) GROUP BY m.group_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_fx_update AFTER UPDATE OF fx_rate_text ON crypto_market_snapshot
WHEN OLD.fx_rate_text IS NOT NEW.fx_rate_text BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT g.id, lower(hex(randomblob(16))), 1 FROM product_groups g;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_member_insert AFTER INSERT ON product_group_members BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    VALUES(NEW.group_id, lower(hex(randomblob(16))), 1);
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_member_delete AFTER DELETE ON product_group_members BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT OLD.group_id, lower(hex(randomblob(16))), 1 WHERE EXISTS(SELECT 1 FROM product_groups WHERE id=OLD.group_id);
  UPDATE product_groups SET prefer_product_id=NULL WHERE id=OLD.group_id AND prefer_product_id=OLD.product_id;
  UPDATE product_groups SET winner_product_id=NULL WHERE id=OLD.group_id AND winner_product_id=OLD.product_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_group_update AFTER UPDATE OF prefer_product_id,prefer_margin ON product_groups BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    VALUES(NEW.id, lower(hex(randomblob(16))), 1);
END;
INSERT OR IGNORE INTO product_group_dirty(group_id,version)
  SELECT id, lower(hex(randomblob(16))) FROM product_groups;

-- Protect concurrent admin edits at the storage boundary, not just preflight.
CREATE TRIGGER IF NOT EXISTS pg_member_valid_insert BEFORE INSERT ON product_group_members BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND archived_at IS NULL)
    THEN RAISE(ABORT,'invalid_group_product') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM product_group_members WHERE group_id=NEW.group_id)>=10
    THEN RAISE(ABORT,'group_full') END;
END;
CREATE TRIGGER IF NOT EXISTS pg_prefer_valid_update BEFORE UPDATE OF prefer_product_id ON product_groups
WHEN NEW.prefer_product_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM product_group_members WHERE group_id=NEW.id AND product_id=NEW.prefer_product_id)
    THEN RAISE(ABORT,'invalid_group_prefer') END;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_member_update AFTER UPDATE OF group_id,product_id,position ON product_group_members
WHEN OLD.group_id IS NOT NEW.group_id OR OLD.product_id IS NOT NEW.product_id OR OLD.position IS NOT NEW.position BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT id,lower(hex(randomblob(16))),1 FROM product_groups WHERE id IN (OLD.group_id,NEW.group_id);
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_tunvn_insert AFTER INSERT ON tunvn_products BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id,lower(hex(randomblob(16))),1 FROM product_group_members m JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.tunvn_source_product_id=NEW.supplier_product_id OR v.sku='TUNVN-'||NEW.supplier_product_id GROUP BY m.group_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_tunvn_delete AFTER DELETE ON tunvn_products BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id,lower(hex(randomblob(16))),1 FROM product_group_members m JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.tunvn_source_product_id=OLD.supplier_product_id OR v.sku='TUNVN-'||OLD.supplier_product_id GROUP BY m.group_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_aivault_insert AFTER INSERT ON aivault_products BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id,lower(hex(randomblob(16))),1 FROM product_group_members m JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.aivault_service_id=NEW.service_id GROUP BY m.group_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_aivault_delete AFTER DELETE ON aivault_products BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT m.group_id,lower(hex(randomblob(16))),1 FROM product_group_members m JOIN product_variants v ON v.product_id=m.product_id
    WHERE v.aivault_service_id=OLD.service_id GROUP BY m.group_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_fx_insert AFTER INSERT ON crypto_market_snapshot WHEN NEW.id=1 BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT id,lower(hex(randomblob(16))),1 FROM product_groups;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_fx_delete AFTER DELETE ON crypto_market_snapshot WHEN OLD.id=1 BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT id,lower(hex(randomblob(16))),1 FROM product_groups;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_inventory_insert AFTER INSERT ON fulfillment_inventory BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT group_id,lower(hex(randomblob(16))),1 FROM product_group_members WHERE product_id=NEW.product_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_inventory_delete AFTER DELETE ON fulfillment_inventory BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT group_id,lower(hex(randomblob(16))),1 FROM product_group_members WHERE product_id=OLD.product_id;
END;
CREATE TRIGGER IF NOT EXISTS pg_dirty_inventory_update AFTER UPDATE OF product_id,variant_id,status ON fulfillment_inventory
WHEN OLD.product_id IS NOT NEW.product_id OR OLD.variant_id IS NOT NEW.variant_id OR OLD.status IS NOT NEW.status BEGIN
  INSERT OR REPLACE INTO product_group_dirty(group_id,version,pending)
    SELECT group_id,lower(hex(randomblob(16))),1 FROM product_group_members WHERE product_id IN (OLD.product_id,NEW.product_id);
END;
