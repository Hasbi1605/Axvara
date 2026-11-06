ALTER TABLE product_variants ADD COLUMN bulk_pricing_enabled INTEGER NOT NULL DEFAULT 0 CHECK (bulk_pricing_enabled IN (0,1));
ALTER TABLE product_variants ADD COLUMN bulk_pricing_tiers TEXT NOT NULL DEFAULT '[]'
  CHECK (CASE WHEN json_valid(bulk_pricing_tiers) THEN json_type(bulk_pricing_tiers)='array' AND json_array_length(bulk_pricing_tiers)<=5 ELSE 0 END);
