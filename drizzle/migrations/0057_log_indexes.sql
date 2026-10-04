-- 0057_log_indexes.sql — Indeks tabel log WR/SK (2026-10-04, darurat kuota D1).
--
-- Insiden 4 Okt 17.54 WIB: email Cloudflare "D1 rows_read 75% dari 5 juta/hari"
-- (Workers Free). Laju naik dari ~120 rb → ~350 rb baris/jam sejak cron dipecah
-- per fase (lebih banyak request per tick). Penyedot teratas = query "ambil 1
-- baris terbaru" di wr/sk_sync_log + wr/sk_saldo_log yang TIDAK punya indeks
-- sama sekali, sehingga tiap panggilan membaca + mengurutkan seluruh tabel
-- (±800–2.900 baris) demi `ORDER BY created_at DESC LIMIT 1`.
-- Dengan indeks komposit (filter, created_at) SQLite membaca ±1–3 baris.
-- IF NOT EXISTS: idempoten.
CREATE INDEX IF NOT EXISTS idx_wr_sync_log_type_created ON wr_sync_log(sync_type, created_at);
CREATE INDEX IF NOT EXISTS idx_sk_sync_log_type_created ON sk_sync_log(sync_type, created_at);
CREATE INDEX IF NOT EXISTS idx_wr_saldo_log_source_created ON wr_saldo_log(source, created_at);
CREATE INDEX IF NOT EXISTS idx_sk_saldo_log_source_created ON sk_saldo_log(source, created_at);
