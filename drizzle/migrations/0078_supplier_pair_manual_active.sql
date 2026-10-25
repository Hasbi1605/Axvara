-- Manual OFF must invalidate the winner, including changes outside the admin API.
CREATE TRIGGER IF NOT EXISTS pair_dirty_product_active_update
AFTER UPDATE OF is_active ON products
WHEN OLD.is_active IS NOT NEW.is_active BEGIN
  INSERT INTO supplier_pair_dirty(pair_id,version)
    SELECT id,lower(hex(randomblob(16))) FROM supplier_pairs
    WHERE wr_product_id=NEW.id OR sk_product_id=NEW.id
    ON CONFLICT(pair_id) DO UPDATE SET version=excluded.version,pending=1;
END;

-- Repair decisions computed before manual activation was part of pair statistics.
-- Keep the version fence: a previous sweep cannot overwrite the new decision.
INSERT INTO supplier_pair_dirty(pair_id,version)
  SELECT id,lower(hex(randomblob(16))) FROM supplier_pairs WHERE 1
  ON CONFLICT(pair_id) DO UPDATE SET version=excluded.version,pending=1;
