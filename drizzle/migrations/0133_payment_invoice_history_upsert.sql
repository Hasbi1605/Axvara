-- 0133: trigger payment_invoice_history_* memakai ON CONFLICT DO NOTHING, bukan INSERT OR IGNORE.
-- Bila trigger terpicu dari statement luar berbentuk UPSERT (INSERT ... ON CONFLICT DO UPDATE),
-- SQLite menerapkan conflict algorithm ABORT milik statement luar ke INSERT OR IGNORE di dalam
-- trigger, sehingga statement gagal "UNIQUE constraint failed: payment_invoice_history.provider,
-- payment_invoice_history.order_code, payment_invoice_history.payable_amount".
-- ON CONFLICT DO NOTHING di dalam trigger tidak tertimpa oleh statement luar dan menjaga semantik
-- idempoten yang sama.

DROP TRIGGER IF EXISTS payment_invoice_history_insert;
CREATE TRIGGER payment_invoice_history_insert
AFTER INSERT ON payment_transactions
WHEN NEW.provider IN ('dana','gopay') AND NEW.payable_amount IS NOT NULL
BEGIN
  INSERT INTO payment_invoice_history
    (provider,order_code,payable_amount,issued_at,expires_at)
  VALUES (NEW.provider,NEW.order_code,NEW.payable_amount,
          COALESCE(NEW.invoice_issued_at,NEW.created_at,datetime('now')),NEW.expires_at)
  ON CONFLICT(provider, order_code, payable_amount) DO NOTHING;
END;

DROP TRIGGER IF EXISTS payment_invoice_history_update;
CREATE TRIGGER payment_invoice_history_update
AFTER UPDATE OF payable_amount ON payment_transactions
WHEN NEW.provider IN ('dana','gopay') AND NEW.payable_amount IS NOT NULL
  AND NEW.payable_amount IS NOT OLD.payable_amount
BEGIN
  -- CI applies migrations before deploying code. An old writer can still
  -- rotate an amount during that interval without knowing invoice_issued_at.
  UPDATE payment_transactions
  SET invoice_issued_at=CASE WHEN NEW.invoice_issued_at IS OLD.invoice_issued_at
    THEN datetime('now') ELSE NEW.invoice_issued_at END
  WHERE id=NEW.id;
  INSERT INTO payment_invoice_history
    (provider,order_code,payable_amount,issued_at,expires_at)
  SELECT OLD.provider,OLD.order_code,OLD.payable_amount,
         COALESCE(OLD.invoice_issued_at,OLD.created_at,datetime('now')),OLD.expires_at
  WHERE OLD.payable_amount IS NOT NULL
  ON CONFLICT(provider, order_code, payable_amount) DO NOTHING;
  INSERT INTO payment_invoice_history
    (provider,order_code,payable_amount,issued_at,expires_at)
  SELECT provider,order_code,payable_amount,
         COALESCE(invoice_issued_at,created_at,datetime('now')),expires_at
  FROM payment_transactions WHERE id=NEW.id
  ON CONFLICT(provider, order_code, payable_amount) DO NOTHING;
END;
