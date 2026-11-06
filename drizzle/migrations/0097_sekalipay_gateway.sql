-- Merchant gateway invoice and fee consent, additive to existing QRIS rows.
ALTER TABLE payment_transactions ADD COLUMN gateway_channel TEXT;
ALTER TABLE payment_transactions ADD COLUMN gateway_label TEXT;
ALTER TABLE payment_transactions ADD COLUMN gateway_estimated_fee INTEGER;
ALTER TABLE payment_transactions ADD COLUMN gateway_fee INTEGER;
ALTER TABLE payment_transactions ADD COLUMN gateway_fee_consent_required INTEGER;
ALTER TABLE payment_transactions ADD COLUMN gateway_fee_consented_at TEXT;
ALTER TABLE payment_transactions ADD COLUMN gateway_virtual_account TEXT;
ALTER TABLE payment_transactions ADD COLUMN gateway_checkout_url TEXT;
ALTER TABLE payment_transactions ADD COLUMN gateway_is_sandbox INTEGER;
