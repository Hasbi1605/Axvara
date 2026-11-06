-- Null preserves historical invoices whose fixed-rate policy was not recorded.
ALTER TABLE payment_transactions ADD COLUMN fixed_rate INTEGER;
