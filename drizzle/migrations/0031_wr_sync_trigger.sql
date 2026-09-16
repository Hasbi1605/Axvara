-- Migration 0031: penanda sumber sync WR (manual vs cron).
-- Kartu admin sebelumnya hanya menampilkan baris products terakhir tanpa tahu
-- sumbernya, sehingga sync manual menutupi jejak sync cron otomatis.
-- Nullable + default NULL: baris lama otomatis "tak bertanda" (diperlakukan
-- sebagai manual agar tidak mengubah arti histori). Rollback aman: kode lama
-- tidak menyebut kolom ini (INSERT eksplisit), kode baru memakai fallback.
ALTER TABLE wr_sync_log ADD COLUMN trigger TEXT NOT NULL DEFAULT 'manual'
  CHECK (trigger IN ('manual', 'cron'));
