-- 0021_telegram_invoice_retry.sql — Penanda pengiriman foto invoice Telegram (RR3-05).
--
-- Latar: foto invoice QRIS (sendPhoto) gagal dengan {ok:false} tetapi update
-- ditandai done — pembeli punya order/invoice aktif tanpa gambar pembayaran
-- dan tidak ada mekanisme kirim ulang. Kolom ini adalah penanda durable
-- agar cron dapat menyapu invoice yang fotonya belum sampai dan mengirim
-- ulang foto yang SAMA (tanpa order/invoice/reservasi/stok kedua).
--
-- Forward-only, nullable, idempoten: database lama (NULL = belum terkirim
-- atau versi sebelum penanda) tetap valid; guard double-tap order pending
-- yang sudah ada mencegah order kedua saat retry.
ALTER TABLE orders ADD COLUMN telegram_invoice_sent_at TEXT;
ALTER TABLE orders ADD COLUMN telegram_invoice_attempts INTEGER NOT NULL DEFAULT 0;
