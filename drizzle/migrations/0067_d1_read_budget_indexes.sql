-- 0062 renames old tables during replay. SQLite index names are global;
-- idx_pedia_tiers_product_active can still belong to an archived table.
-- A fresh name repairs the active table without touching archives or FKs.
CREATE INDEX IF NOT EXISTS idx_pedia_tiers_active_product_v2
  ON pedia_tiers(is_active, product_id, is_recommended, sort_order);
CREATE INDEX IF NOT EXISTS idx_pedia_tiers_supplier_service
  ON pedia_tiers(supplier, supplier_service_id);
CREATE INDEX IF NOT EXISTS idx_dana_events_created
  ON dana_webhook_events(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_paid_recovery
  ON orders(status, payment_status, datetime(COALESCE(paid_at, created_at)), id)
  WHERE status='lunas' AND payment_status='paid';
CREATE INDEX IF NOT EXISTS idx_wr_variants_axvara_variant
  ON wr_variants(axvara_variant_id);
CREATE INDEX IF NOT EXISTS idx_sk_products_axvara_variant
  ON sk_products(axvara_variant_id);
