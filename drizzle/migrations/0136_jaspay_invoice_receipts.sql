-- Pin the charge to the existing exact Jaspay invoice; never backfill from catalog.
ALTER TABLE wr_order_links ADD COLUMN jaspay_invoice_total INTEGER CHECK(jaspay_invoice_total >= 0);
ALTER TABLE wr_order_links ADD COLUMN jaspay_refunded_total INTEGER CHECK(jaspay_refunded_total IS NULL OR (jaspay_refunded_total >= 0 AND jaspay_invoice_total IS NOT NULL AND jaspay_refunded_total <= jaspay_invoice_total));

CREATE TRIGGER IF NOT EXISTS jaspay_receipt_finance_revision
AFTER UPDATE OF jaspay_invoice_total, jaspay_refunded_total ON wr_order_links
WHEN OLD.jaspay_invoice_total IS NOT NEW.jaspay_invoice_total
  OR COALESCE(OLD.jaspay_refunded_total,0) != COALESCE(NEW.jaspay_refunded_total,0)
BEGIN
  INSERT INTO store_settings(key,value) VALUES('finance_revision',lower(hex(randomblob(16))))
  ON CONFLICT(key) DO UPDATE SET value=excluded.value;
END;
