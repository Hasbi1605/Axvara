-- Market warranty estimates are based on terms at checkout and the first handover.
-- No backfill: today's catalog and mutable fulfillment timestamps aren't historical evidence.
CREATE TABLE IF NOT EXISTS market_refund_items (
  order_code TEXT NOT NULL REFERENCES orders(code) ON DELETE CASCADE,
  item_index INTEGER NOT NULL,
  unit_number INTEGER,
  unit_total INTEGER,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK(price >= 0),
  qty INTEGER NOT NULL CHECK(qty > 0),
  duration_value INTEGER,
  duration_unit TEXT,
  warranty_type TEXT,
  warranty_value INTEGER,
  warranty_unit TEXT,
  rate_bps INTEGER NOT NULL DEFAULT 10000 CHECK(rate_bps BETWEEN 0 AND 10000),
  started_at INTEGER,
  claimed_at INTEGER,
  PRIMARY KEY(order_code, item_index)
);

CREATE TABLE IF NOT EXISTS market_refund_shares (
  order_code TEXT PRIMARY KEY REFERENCES orders(code) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  snapshot TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS market_refund_snapshot_insert
AFTER INSERT ON orders
WHEN NEW.order_kind='apps' AND substr(NEW.code,1,4)='AXV-' AND json_valid(NEW.items)
BEGIN
  INSERT INTO market_refund_items (
    order_code,item_index,unit_number,unit_total,name,price,qty,duration_value,duration_unit,
    warranty_type,warranty_value,warranty_unit
  )
  SELECT NEW.code, line_index, unit_number, unit_total,
         COALESCE(NULLIF(json_extract(item,'$.name'),''),'Produk'), json_extract(item,'$.price'), qty,
         pv.duration_value,pv.duration_unit,pv.warranty_type,pv.warranty_value,pv.warranty_unit
    FROM (
      -- Match expandDeliveryLines(): keep original indexes; append extra unique units.
      WITH lines AS (
        SELECT CAST(key AS INTEGER) AS idx, value AS item, json_extract(value,'$.qty') AS qty,
               CASE WHEN json_extract(value,'$.unique_units')=1 AND json_extract(value,'$.fulfillment_mode')='unique'
                 AND json_type(value,'$.qty')='integer' AND json_extract(value,'$.qty') BETWEEN 1 AND 10
                 THEN json_extract(value,'$.qty') END AS units
        FROM json_each(NEW.items) WHERE type='object' AND json_type(NEW.items)='array'
      ), numbers(n) AS (VALUES (2),(3),(4),(5),(6),(7),(8),(9),(10))
      SELECT idx AS line_index, item, CASE WHEN units IS NOT NULL THEN 1 ELSE qty END AS qty,
             CASE WHEN units IS NOT NULL THEN 1 END AS unit_number, units AS unit_total FROM lines
      UNION ALL
      SELECT json_array_length(NEW.items)-1+ROW_NUMBER() OVER (ORDER BY idx,n), item, 1,n,units
      FROM lines JOIN numbers ON n<=units
    ) AS expanded
    LEFT JOIN product_variants pv ON pv.id=json_extract(item,'$.variant_id') AND pv.product_id=json_extract(item,'$.product_id')
    WHERE typeof(qty)='integer' AND qty>0 AND json_type(item,'$.price')='integer' AND json_extract(item,'$.price')>=0;
END;

CREATE TRIGGER IF NOT EXISTS market_refund_handover_update
AFTER UPDATE OF status ON fulfillment_items
WHEN NEW.status='delivered' AND OLD.status<>'delivered' AND substr(NEW.order_code,1,4)='AXV-'
BEGIN
  UPDATE market_refund_items SET started_at=unixepoch('now')
  WHERE order_code=NEW.order_code AND item_index=NEW.item_index AND started_at IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS market_refund_handover_insert
AFTER INSERT ON fulfillment_items
WHEN NEW.status='delivered' AND substr(NEW.order_code,1,4)='AXV-'
BEGIN
  UPDATE market_refund_items SET started_at=unixepoch('now')
  WHERE order_code=NEW.order_code AND item_index=NEW.item_index AND started_at IS NULL;
END;
