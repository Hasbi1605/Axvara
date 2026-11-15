ALTER TABLE products ADD COLUMN archived_at TEXT;
CREATE INDEX IF NOT EXISTS idx_products_archived ON products(archived_at) WHERE archived_at IS NOT NULL;

-- Last-line defense for concurrent admin writes and supplier insertions.
CREATE TRIGGER IF NOT EXISTS archived_product_activation BEFORE UPDATE OF is_active,archived_at ON products
WHEN NEW.archived_at IS NOT NULL AND NEW.is_active<>0 BEGIN
  SELECT RAISE(ABORT,'product_archived');
END;
CREATE TRIGGER IF NOT EXISTS archived_variant_activation BEFORE UPDATE OF is_active,product_id ON product_variants
WHEN NEW.is_active<>0 AND EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND archived_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT,'product_archived');
END;
CREATE TRIGGER IF NOT EXISTS archived_variant_insert BEFORE INSERT ON product_variants
WHEN NEW.is_active<>0 AND EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND archived_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT,'product_archived');
END;
