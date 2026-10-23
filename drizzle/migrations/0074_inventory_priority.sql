-- NULL preserves FIFO for existing and newly imported credentials.
ALTER TABLE fulfillment_inventory ADD COLUMN sort_order INTEGER;
CREATE INDEX IF NOT EXISTS idx_inventory_priority
  ON fulfillment_inventory(product_id, variant_id, status, COALESCE(sort_order,id), id);
