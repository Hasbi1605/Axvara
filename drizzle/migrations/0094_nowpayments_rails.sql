-- 0094_nowpayments_rails.sql — provider-independent crypto ledger (LOCAL ONLY, W1).
--
-- Prinsip: TAMBAH saja (nullable + default), jangan ubah baris lama.
-- Semua kolom baru nullable/default sehingga writer QRIS lama + data lama
-- tetap valid tanpa backfill. QRIS 15 menit tidak berubah; status kadaluarsa
-- order tetap dimenangkan cron/expiry existing.
--
-- Satuan uang: bisnis tetap integer IDR (orders.subtotal,
-- payment_transactions.requested_amount). Nilai crypto (pay_amount,
-- actually_paid, outcome, fee) SELALU teks desimal via kolom *_text —
-- jangan pernah Number()/float untuk nominal.
ALTER TABLE payment_transactions ADD COLUMN currency TEXT NOT NULL DEFAULT 'IDR';
ALTER TABLE payment_transactions ADD COLUMN pay_currency TEXT;
ALTER TABLE payment_transactions ADD COLUMN pay_network TEXT;
ALTER TABLE payment_transactions ADD COLUMN price_amount_text TEXT;
ALTER TABLE payment_transactions ADD COLUMN price_currency TEXT;
ALTER TABLE payment_transactions ADD COLUMN pay_amount_text TEXT;
ALTER TABLE payment_transactions ADD COLUMN actually_paid_text TEXT;
ALTER TABLE payment_transactions ADD COLUMN outcome_amount_text TEXT;
ALTER TABLE payment_transactions ADD COLUMN outcome_currency TEXT;
ALTER TABLE payment_transactions ADD COLUMN fee_paid_by_user INTEGER;
ALTER TABLE payment_transactions ADD COLUMN provider_payment_id TEXT;
ALTER TABLE payment_transactions ADD COLUMN pay_address TEXT;
ALTER TABLE payment_transactions ADD COLUMN last_reconciled_at TEXT;

-- Cari transaksi dari sisi provider (GET /payment/:id, IPN) tanpa menebak
-- order_code. Partial index: hanya baris crypto yang terikat payment id.
CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_provider_payment
  ON payment_transactions(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
