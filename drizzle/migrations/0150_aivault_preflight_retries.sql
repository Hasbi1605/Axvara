-- 0150_aivault_preflight_retries.sql — hitung percobaan preflight AIVault (sebelum POST beli).
-- Terpisah dari attempt_count (hanya POST nyata) agar AIVAULT_RETRYABLE_SQL dan Retry manual tetap valid.
ALTER TABLE aivault_order_links ADD COLUMN preflight_attempts INTEGER NOT NULL DEFAULT 0;
