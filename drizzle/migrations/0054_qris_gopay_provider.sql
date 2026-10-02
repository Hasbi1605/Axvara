-- 0054_qris_gopay_provider.sql — perluas ledger QRIS untuk rail GoPay.
--
-- Prinsip: TAMBAH saja, jangan ubah perilaku DANA. Semua default mengarah ke
-- 'dana' sehingga writer lama + data lama tetap valid.
--
-- 1. Partial unique index per provider untuk alokasi nominal (cermin dana):
--    nominal aktif GoPay tidak boleh tabrakan sesama GoPay, tapi BOLEH sama
--    dengan nominal aktif DANA (matcher selalu filter provider).
CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_active_gopay_amount
  ON payment_transactions(payable_amount)
  WHERE provider='gopay' AND status IN ('initializing','pending');

-- 2. Trigger history: catat penerbitan gopay seperti dana. Trigger lama
--    di-drop lalu dibuat ulang dengan predikat IN agar tidak ada dua trigger
--    yang berebut baris yang sama.
DROP TRIGGER IF EXISTS payment_invoice_history_insert;
CREATE TRIGGER payment_invoice_history_insert
AFTER INSERT ON payment_transactions
WHEN NEW.provider IN ('dana','gopay') AND NEW.payable_amount IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO payment_invoice_history
    (provider,order_code,payable_amount,issued_at,expires_at)
  VALUES (NEW.provider,NEW.order_code,NEW.payable_amount,
          COALESCE(NEW.invoice_issued_at,NEW.created_at,datetime('now')),NEW.expires_at);
END;

DROP TRIGGER IF EXISTS payment_invoice_history_update;
CREATE TRIGGER payment_invoice_history_update
AFTER UPDATE OF payable_amount ON payment_transactions
WHEN NEW.provider IN ('dana','gopay') AND NEW.payable_amount IS NOT NULL
  AND NEW.payable_amount IS NOT OLD.payable_amount
BEGIN
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

-- 3. Event webhook ber-provider (tanpa rename tabel agar writer lama aman):
--    poller GoPay menulis provider='gopay', Hook DANA tetap default 'dana'.
ALTER TABLE dana_webhook_events ADD COLUMN provider TEXT NOT NULL DEFAULT 'dana';
CREATE INDEX IF NOT EXISTS idx_dana_webhook_events_provider
  ON dana_webhook_events(provider, status, created_at);
