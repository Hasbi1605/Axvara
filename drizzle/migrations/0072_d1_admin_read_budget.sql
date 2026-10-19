-- Latest-order pagination must stop after LIMIT, rather than sorting history.
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
-- Used on every KlikQRIS status read and during fulfillment; product-first
-- inventory indexes cannot serve an order_code lookup efficiently.
CREATE INDEX IF NOT EXISTS idx_inventory_order_status ON fulfillment_inventory(order_code,status);
