-- 0161_drop_telegram_carts.sql
-- Keputusan owner 2026-11-23: keranjang hanya ada di web; hapus skema
-- keranjang Telegram beserta tabel telegram_carts.
DROP INDEX IF EXISTS idx_telegram_carts_user;
DROP TABLE IF EXISTS telegram_carts;
