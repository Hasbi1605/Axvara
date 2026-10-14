-- Additive only: historical orders retain NULL/absent snapshots and are estimates.
-- CI applies this migration before deploying the new payment/report handlers.
CREATE TABLE IF NOT EXISTS order_item_costs (
  order_code TEXT NOT NULL REFERENCES orders(code),
  item_index INTEGER NOT NULL,
  product_id INTEGER,
  variant_id INTEGER,
  source TEXT NOT NULL CHECK (source IN ('manual','wr','sk')),
  supplier_variant_id TEXT,
  unit_cost INTEGER CHECK (unit_cost IS NULL OR unit_cost >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (order_code, item_index)
);
