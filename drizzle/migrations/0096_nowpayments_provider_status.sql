-- 0096_nowpayments_provider_status.sql — status provider durable untuk
-- fail-closed cancel guard + buyer mapping + alert dedupe (W3, LOCAL ONLY).
-- Tambah saja (nullable) — reader/writer lama tetap valid tanpa backfill.
ALTER TABLE payment_transactions ADD COLUMN provider_status_text TEXT;
ALTER TABLE payment_transactions ADD COLUMN last_admin_alert_at TEXT;
