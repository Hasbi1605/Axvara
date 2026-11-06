-- 0095_locale_usd_rails.sql — bilingual locale + USD crypto snapshot (W3, LOCAL ONLY).
--
-- Prinsip: TAMBAH saja (nullable/default), jangan ubah baris lama.
-- orders.locale default 'id' (buyer web flow; TG packet later reads column).
-- telegram_users.locale nullable = unset (TG packet later persists choice).
-- payment_transactions: hanya kolom yang WAJIB untuk snapshot USD
-- (price 'usd' + FX audit trail); bisnis tetap integer IDR di requested_amount.
-- Kolom *_text sudah ada dari 0094; jangan duplikat.
ALTER TABLE orders ADD COLUMN locale TEXT NOT NULL DEFAULT 'id' CHECK (locale IN ('id','en'));
ALTER TABLE telegram_users ADD COLUMN locale TEXT CHECK (locale IN ('id','en'));
ALTER TABLE payment_transactions ADD COLUMN fx_rate_text TEXT;
ALTER TABLE payment_transactions ADD COLUMN fx_effective_at TEXT;
