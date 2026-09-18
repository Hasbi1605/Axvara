-- 0037_wr_aging_alert.sql — Penanda peringatan umur antrean WR (2026-09-18).
--
-- Konteks: auto-order dibuka untuk kelas antrean (made_by_order), yang di sisi
-- upstream dikerjakan manusia dengan estimasi 6–12 jam. Sebelum ini tidak ada
-- apa pun yang memberi tahu admin kalau sebuah pesanan menggantung lebih lama:
-- reconcileStuckWrOrders hanya bertindak bila upstream SUDAH melaporkan status
-- terminal, sehingga link yang tetap 'processing' 15 jam diam total.
--
-- Kolom ini hanya penanda idempoten "peringatan sudah dikirim" agar cron tidak
-- mengirim notifikasi berulang tiap 5 menit. Idempoten dan aman dijalankan
-- pada database yang sudah memilikinya (CI menandai migrasi yang sudah dipakai).
ALTER TABLE wr_order_links ADD COLUMN aging_alerted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_wr_links_aging
  ON wr_order_links(status, aging_alerted_at);
