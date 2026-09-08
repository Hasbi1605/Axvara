-- Preserve ledger history: reused amounts cannot be matched from receipt time alone.
ALTER TABLE dana_webhook_events ADD COLUMN reviewed_by TEXT;
ALTER TABLE dana_webhook_events ADD COLUMN review_note TEXT;
CREATE INDEX IF NOT EXISTS idx_payment_amount_history ON payment_transactions(provider,payable_amount);
