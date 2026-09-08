-- 0023_whatsapp_admin_notifications.sql — Notifikasi admin Telegram untuk order WhatsApp.
--
-- Latar: jalur WA tidak pernah memanggil notifikasi grup Telegram saat order
-- dibuat maupun saat lunas, dan retry cron hanya menyapu sales_channel='telegram'.
-- Mulai migrasi ini, order WA memakai marker idempoten yang SAMA
-- (telegram_order_notified_at / telegram_paid_admin_notified_at) dan disapu
-- cron yang sama.
--
-- Anti-replay: order WA yang sudah ada sebelum migrasi dibackfill seperti
-- order Telegram lama (0012/0013) agar deployment tidak membanjiri grup admin
-- dengan riwayat. Hanya order yang dibuat SETELAH migrasi yang eligible
-- notifikasi (marker NULL).
UPDATE orders
SET telegram_order_notified_at=COALESCE(created_at, datetime('now')),
    telegram_paid_admin_notified_at=CASE
      WHEN status='lunas' AND payment_status='paid'
      THEN COALESCE(updated_at, created_at, datetime('now'))
      ELSE telegram_paid_admin_notified_at
    END
WHERE sales_channel='whatsapp'
  AND telegram_order_notified_at IS NULL;
