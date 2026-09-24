-- 0039_buyer_notice_log.sql — Ledger idempoten kabar pembeli (email + Telegram).
--
-- Konteks (audit ronde 4, 2026-09-24): semua kabar pembeli kanal WEB dulu
-- hanya masuk `whatsapp_outbox`, padahal bot WA mati (outbox produksi 18–19
-- Sep: 3 baris `dead`, `whatsapp_not_connected`) sementara email wajib di
-- checkout sejak 2026-09-23. Kabar web kini dikirim lewat email Resend.
-- Beda dengan outbox WA, email & Telegram dikirim langsung tanpa tabel
-- antrean, jadi butuh kunci idempoten sendiri: satu order bisa punya
-- beberapa item/link WR yang gagal, dan tiap jalur gagal memanggil notifikasi
-- yang sama. Baris `failed` boleh diklaim ulang; `sending` yang basi (>10
-- menit, worker mati di tengah kirim) juga boleh.
CREATE TABLE IF NOT EXISTS buyer_notice_log (
  idempotency_key TEXT PRIMARY KEY,
  order_code TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'telegram')),
  status TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  provider_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_buyer_notice_order ON buyer_notice_log(order_code);
