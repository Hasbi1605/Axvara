CREATE TABLE IF NOT EXISTS expense_recurring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK(category IN ('hosting','internet','ai_tools','domain','ads','refund','replace','other')),
  amount INTEGER NOT NULL CHECK(amount>0 AND amount<=1000000000),
  note TEXT CHECK(note IS NULL OR length(note)<=200),
  day_of_month INTEGER NOT NULL CHECK(day_of_month BETWEEN 1 AND 31),
  start_month TEXT NOT NULL CHECK(start_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(start_month,6,2) BETWEEN '01' AND '12'),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  last_generated_month TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS operating_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spent_on TEXT NOT NULL CHECK(spent_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(spent_on,'+0 days') IS NOT NULL AND date(spent_on,'+0 days')=spent_on),
  category TEXT NOT NULL CHECK(category IN ('hosting','internet','ai_tools','domain','ads','refund','replace','other')),
  amount INTEGER NOT NULL CHECK(amount>0 AND amount<=1000000000),
  note TEXT CHECK(note IS NULL OR length(note)<=200),
  order_code TEXT REFERENCES orders(code),
  recurring_id INTEGER REFERENCES expense_recurring(id) ON DELETE SET NULL,
  recurring_month TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(recurring_id,recurring_month)
);
CREATE INDEX IF NOT EXISTS idx_expenses_spent_on ON operating_expenses(spent_on);
CREATE TRIGGER IF NOT EXISTS expense_insert_revision AFTER INSERT ON operating_expenses BEGIN
  INSERT INTO store_settings(key,value) VALUES('finance_revision',lower(hex(randomblob(16)))) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
END;
CREATE TRIGGER IF NOT EXISTS expense_update_revision AFTER UPDATE ON operating_expenses BEGIN
  INSERT INTO store_settings(key,value) VALUES('finance_revision',lower(hex(randomblob(16)))) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
END;
CREATE TRIGGER IF NOT EXISTS expense_delete_revision AFTER DELETE ON operating_expenses BEGIN
  INSERT INTO store_settings(key,value) VALUES('finance_revision',lower(hex(randomblob(16)))) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
END;

-- DDL runs once under the migration ledger. Backfills below are replay-safe.
ALTER TABLE tunvn_order_links ADD COLUMN fx_idr_per_usdt REAL;
ALTER TABLE aivault_order_links ADD COLUMN fx_idr_per_usd REAL;

-- BACKFILLS
UPDATE tunvn_order_links SET fx_idr_per_usdt=COALESCE(
  (SELECT CASE WHEN pv.sku LIKE 'TUNVN-BUFF%' THEN pv.tunvn_fx_idr_per_usdt ELSE tp.fx_idr_per_usdt END
   FROM product_variants pv LEFT JOIN tunvn_products tp ON tp.supplier_product_id=tunvn_order_links.source_product_id WHERE pv.id=tunvn_order_links.variant_id),
  (SELECT CASE WHEN CAST(fx_rate_text AS REAL)>0 THEN CAST(fx_rate_text AS REAL) END FROM crypto_market_snapshot WHERE id=1))
WHERE fx_idr_per_usdt IS NULL;
UPDATE aivault_order_links SET fx_idr_per_usd=COALESCE(
  (SELECT fx_idr_per_usd FROM aivault_products WHERE service_id=aivault_order_links.service_id),
  (SELECT CASE WHEN CAST(fx_rate_text AS REAL)>0 THEN CAST(fx_rate_text AS REAL) END FROM crypto_market_snapshot WHERE id=1))
WHERE fx_idr_per_usd IS NULL;
INSERT OR IGNORE INTO order_item_costs(order_code,item_index,product_id,variant_id,source,supplier_variant_id,unit_cost)
SELECT o.code,CAST(j.key AS INTEGER),json_extract(j.value,'$.product_id'),pv.id,'manual',NULL,pv.manual_cost
FROM orders o JOIN json_each(CASE WHEN json_valid(o.items) THEN o.items ELSE '[]' END) j
JOIN product_variants pv ON pv.id=COALESCE(json_extract(j.value,'$.variant_id'),o.variant_id)
  AND pv.product_id=json_extract(j.value,'$.product_id')
WHERE o.status='lunas' AND COALESCE(o.order_kind,'market')!='pedia'
  AND pv.manual_cost IS NOT NULL AND pv.wr_variant_id IS NULL AND pv.sk_variant_id IS NULL
  AND COALESCE(pv.sku,'') NOT LIKE 'TUNVN-%' AND pv.aivault_service_id IS NULL;
