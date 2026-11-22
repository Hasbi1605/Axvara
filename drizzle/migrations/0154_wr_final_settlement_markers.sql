-- C1 (H4): storage only; no historical backfill or C2 activation.
-- The C1-PRE admin WR serializer must already be deployed before this migration.
ALTER TABLE wr_order_links ADD COLUMN wr_final_settle_token TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN wr_aggregate_refresh_token TEXT DEFAULT NULL;

CREATE INDEX idx_wr_final_settle_pending
  ON wr_order_links(id) WHERE wr_final_settle_token IS NOT NULL;
CREATE INDEX idx_wr_aggregate_refresh_pending
  ON orders(code) WHERE wr_aggregate_refresh_token IS NOT NULL;
