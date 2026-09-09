-- 0024_qris_reissue.sql — Penerbitan ulang QRIS untuk order yang masih hidup.
--
-- Latar: masa hidup ORDER dan masa hidup INVOICE QRIS sebelumnya disamakan.
-- `createDanaQrisInvoice` menimpa `orders.expires_at` dengan expiry invoice
-- (15 menit), sehingga saat QR mati order langsung ikut kedaluwarsa, cron
-- membatalkannya, dan stok dilepas. Pembeli yang telat bayar harus mengulang
-- seluruh alur dari nol — di SEMUA kanal (web, Telegram, WhatsApp), bukan
-- hanya Telegram.
--
-- Tidak ada jalur reissue sebelumnya: `createDanaQrisInvoice` mengembalikan
-- baris lama (`isExisting: true`) bila `payment_transactions` sudah ada, dan
-- `src/lib/telegram/invoice-retry.ts` hanya MENGIRIM ULANG foto invoice yang
-- sama, bukan menerbitkan QRIS baru.
--
-- Karena `payment_transactions` punya UNIQUE(order_code), reissue meng-UPDATE
-- baris yang sama di tempat (nominal unik baru + expiry baru), bukan menambah
-- baris kedua. Kolom di bawah membatasi jumlah reissue per order.
ALTER TABLE orders ADD COLUMN qris_reissue_count INTEGER NOT NULL DEFAULT 0;

-- Order QRIS yang masih pending saat migrasi berjalan diberi jendela order
-- penuh (60 menit dari sekarang) supaya tidak langsung dibatalkan cron oleh
-- expiry 15 menit yang sudah tertulis. Order terminal tidak disentuh.
--
-- Format ISO dengan T/Z, bukan `datetime('now','+60 minutes')`: keluaran
-- datetime() memakai spasi, dan `Date.parse` di sisi JS menafsirkan format
-- spasi sebagai waktu LOKAL (di WIB menggeser expiry 7 jam lebih awal).
-- SQLite tetap menerima ISO pada `datetime(expires_at)`.
UPDATE orders
SET expires_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+60 minutes'),
    updated_at = datetime('now')
WHERE status = 'pending'
  AND payment_method = 'qris'
  AND EXISTS (
    SELECT 1 FROM payment_transactions pt
    WHERE pt.order_code = orders.code AND pt.provider = 'dana' AND pt.status = 'pending'
  );

-- Pencarian order yang layak reissue: pending + punya ledger DANA aktif.
CREATE INDEX IF NOT EXISTS idx_orders_qris_reissue
  ON orders(status, payment_method, qris_reissue_count);

-- Index EKSPRESI untuk predikat penjadwalan.
--
-- Semua query cron/lease membandingkan `datetime(kolom) <= datetime('now')`
-- dan bukan kolomnya langsung. Pembungkus datetime() itu WAJIB karena baris
-- lama menyimpan format spasi sementara baris baru menyimpan ISO, dan
-- perbandingan string mentah tidak akan pernah cocok antar keduanya (lihat
-- D1_EXPIRY_PREDICATE di src/lib/db.ts). Konsekuensinya index biasa pada
-- kolom tersebut TIDAK terpakai — SQLite tidak bisa memakai index kolom untuk
-- ekspresi fungsi. Index di bawah dibuat atas ekspresi yang SAMA, sehingga
-- planner bisa memakainya tanpa satu pun query diubah.
CREATE INDEX IF NOT EXISTS idx_fulfillment_jobs_next_dt
  ON fulfillment_jobs(status, datetime(next_attempt_at));
CREATE INDEX IF NOT EXISTS idx_fulfillment_jobs_locked_dt
  ON fulfillment_jobs(status, datetime(locked_until));
CREATE INDEX IF NOT EXISTS idx_fulfillment_items_next_dt
  ON fulfillment_items(status, datetime(next_attempt_at));
CREATE INDEX IF NOT EXISTS idx_orders_expires_dt
  ON orders(status, datetime(expires_at));
CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_next_dt
  ON whatsapp_outbox(status, datetime(next_attempt_at));
CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_locked_dt
  ON whatsapp_outbox(status, datetime(locked_until));
