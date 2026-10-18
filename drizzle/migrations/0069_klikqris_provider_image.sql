-- Provider QR image stays private behind AXVARA's bounded same-origin proxy.
ALTER TABLE payment_transactions ADD COLUMN provider_qris_url TEXT;
