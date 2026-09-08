-- Review R10: lease klaim worker untuk antrean WhatsApp.
-- Dua worker cron yang sama-sama membaca baris due sebelum salah satunya
-- selesai mengirim menyebabkan pesan ganda. worker_id + locked_until (+5 mnt)
-- membuat klaim eksplisit: getDue melewati baris yang masih ter-lease, dan
-- CAS status+attempt_count menggugurkan worker kedua bersnapshot basi.
ALTER TABLE whatsapp_outbox ADD COLUMN worker_id TEXT;
ALTER TABLE whatsapp_outbox ADD COLUMN locked_until TEXT;
UPDATE whatsapp_outbox
SET status='failed', worker_id=NULL, locked_until=NULL
WHERE status NOT IN ('pending','sending','sent','failed','dead');
-- Crash window: baris 'sending' yang lease-nya lewat = worker mati di tengah
-- kirim → kembalikan ke 'failed' agar retry/backoff normal mengambil alih.
UPDATE whatsapp_outbox
SET status='failed', worker_id=NULL, locked_until=NULL
WHERE status='sending' AND (locked_until IS NULL OR datetime(locked_until) <= datetime('now'));
CREATE INDEX IF NOT EXISTS idx_wa_outbox_lease ON whatsapp_outbox(status, locked_until, next_attempt_at);
