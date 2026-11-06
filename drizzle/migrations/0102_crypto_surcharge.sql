-- 0102_crypto_surcharge.sql — biaya layanan crypto AXVARA 1,5% tersimpan durable (LOCAL ONLY).
--
-- Invoice crypto baru memakai kurs mengambang + fee provider ditanggung merchant
-- (fee_paid_by_user=0, fixed_rate=0). Pembeli menanggung biaya lewat biaya layanan
-- AXVARA: surcharge = ceil(base * bps / 10000), total (USD) = base + surcharge =
-- price_amount_text. Kolom ini menyimpan rincian base/surcharge/bps pada klaim
-- initializing (sebelum POST) agar halaman pesanan, Telegram dan rekonsiliasi
-- menampilkan rincian yang SAMA tanpa menebak ulang dari kurs.
-- Tambah saja (nullable): baris lama (QRIS/gateway/crypto 1/1) tidak berubah.
ALTER TABLE payment_transactions ADD COLUMN crypto_base_usd_cents INTEGER;
ALTER TABLE payment_transactions ADD COLUMN crypto_surcharge_usd_cents INTEGER;
ALTER TABLE payment_transactions ADD COLUMN crypto_surcharge_bps INTEGER;
