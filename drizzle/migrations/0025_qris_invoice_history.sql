-- Preserve all future QRIS issuances and backfill the history still available.
-- Never reactivate terminal orders: their inventory may already be resold.
ALTER TABLE payment_transactions ADD COLUMN invoice_issued_at TEXT;
UPDATE payment_transactions
SET invoice_issued_at = CASE WHEN EXISTS (
  SELECT 1 FROM orders o WHERE o.code=payment_transactions.order_code AND o.qris_reissue_count>0
) THEN COALESCE(updated_at,created_at,datetime('now')) ELSE COALESCE(created_at,datetime('now')) END
WHERE provider='dana';

-- QRIS issuance history (0025): retained independently of the mutable ledger.
CREATE TABLE IF NOT EXISTS payment_invoice_history (
  provider TEXT NOT NULL,
  order_code TEXT NOT NULL,
  payable_amount INTEGER NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (provider, order_code, payable_amount)
);
CREATE INDEX IF NOT EXISTS idx_payment_invoice_history_amount
  ON payment_invoice_history(provider, payable_amount, order_code);

-- Old reissues erased their prior amounts. Preserve the affected ranges as
-- uncertain, rather than inventing a history or automatically matching them.
CREATE TABLE IF NOT EXISTS dana_qris_legacy_ranges (
  min_amount INTEGER NOT NULL,
  max_amount INTEGER NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (min_amount, max_amount)
);

CREATE TRIGGER IF NOT EXISTS payment_invoice_history_insert
AFTER INSERT ON payment_transactions
WHEN NEW.provider='dana' AND NEW.payable_amount IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO payment_invoice_history
    (provider,order_code,payable_amount,issued_at,expires_at)
  VALUES (NEW.provider,NEW.order_code,NEW.payable_amount,
          COALESCE(NEW.invoice_issued_at,NEW.created_at,datetime('now')),NEW.expires_at);
END;

CREATE TRIGGER IF NOT EXISTS payment_invoice_history_update
AFTER UPDATE OF payable_amount ON payment_transactions
WHEN NEW.provider='dana' AND NEW.payable_amount IS NOT NULL
  AND NEW.payable_amount IS NOT OLD.payable_amount
BEGIN
  -- CI applies migrations before deploying code. An old writer can still
  -- rotate an amount during that interval without knowing invoice_issued_at.
  UPDATE payment_transactions
  SET invoice_issued_at=CASE WHEN NEW.invoice_issued_at IS OLD.invoice_issued_at
    THEN datetime('now') ELSE NEW.invoice_issued_at END
  WHERE id=NEW.id;
  INSERT OR IGNORE INTO payment_invoice_history
    (provider,order_code,payable_amount,issued_at,expires_at)
  SELECT OLD.provider,OLD.order_code,OLD.payable_amount,
         COALESCE(OLD.invoice_issued_at,OLD.created_at,datetime('now')),OLD.expires_at
  WHERE OLD.payable_amount IS NOT NULL;
  INSERT OR IGNORE INTO payment_invoice_history
    (provider,order_code,payable_amount,issued_at,expires_at)
  SELECT provider,order_code,payable_amount,
         COALESCE(invoice_issued_at,created_at,datetime('now')),expires_at
  FROM payment_transactions WHERE id=NEW.id;
END;
-- End QRIS issuance history.

INSERT OR IGNORE INTO payment_invoice_history(provider,order_code,payable_amount,issued_at,expires_at)
SELECT provider,order_code,payable_amount,COALESCE(invoice_issued_at,created_at,datetime('now')),expires_at
FROM payment_transactions WHERE provider='dana' AND payable_amount IS NOT NULL;

-- A prior nominal cannot be recovered from the overwritten row. Only amounts
-- within ranges actually affected by old reissues require manual bank review.
INSERT OR IGNORE INTO dana_qris_legacy_ranges(min_amount,max_amount)
SELECT DISTINCT pt.requested_amount+1,pt.requested_amount+299
FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code
WHERE pt.provider='dana' AND o.qris_reissue_count>0;
