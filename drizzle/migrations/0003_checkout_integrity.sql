-- One-time production migration for signed checkout quotes, idempotent order
-- creation, atomic D1 stock operations, and the three repaired catalog images.
ALTER TABLE orders ADD COLUMN quote_id TEXT;
ALTER TABLE orders ADD COLUMN expires_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_quote_id_unique
  ON orders(quote_id) WHERE quote_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS operation_guards (
  operation_id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);
UPDATE orders
SET expires_at = datetime(created_at, '+24 hours')
WHERE expires_at IS NULL AND status = 'pending';
UPDATE payment_methods
SET qris_url = '/qris/axvara-qris.jpg'
WHERE id = 'qris' AND (qris_url IS NULL OR qris_url = '');
UPDATE products
SET image_url = 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=600&h=450&fit=crop'
WHERE slug = 'ai-gateway-1jt-token'
  AND image_url = 'https://images.unsplash.com/photo-1639322537224-f012857c7c2e?w=600&h=450&fit=crop';
UPDATE products
SET image_url = 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&h=450&fit=crop'
WHERE slug = 'ai-gateway-5jt-token'
  AND image_url = 'https://images.unsplash.com/photo-1639322537504-fcfecb546b11?w=600&h=450&fit=crop';
UPDATE products
SET image_url = 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=600&h=450&fit=crop'
WHERE slug = 'adobe-cc-1-bulan'
  AND image_url = 'https://images.unsplash.com/photo-1626785774573-6dd65b279390?w=600&h=450&fit=crop';
