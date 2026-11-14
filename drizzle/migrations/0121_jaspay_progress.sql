-- Safe status metadata only; accounts remain in the existing encrypted columns.
ALTER TABLE wr_order_links ADD COLUMN jaspay_progress TEXT
  CHECK (jaspay_progress IS NULL OR json_valid(jaspay_progress));

-- Refresh old pair decisions for the new automatic-only WR sale policy.
INSERT INTO supplier_pair_dirty(pair_id,version,pending)
SELECT id,lower(hex(randomblob(16))),1 FROM supplier_pairs WHERE 1
ON CONFLICT(pair_id) DO UPDATE SET version=excluded.version,pending=1;
