-- 0169_telegram_channel_and_force_sub.sql — Channel resmi Telegram (@axvaratech),
-- Smart Force-Join cache pada telegram_users, dan tujuan siaran `telegram_channel`.
--
-- 1. Cache timestamp verifikasi keanggotaan channel per user agar klik katalog/menu
--    tidak memanggil getChatMember di setiap interaksi.
ALTER TABLE telegram_users ADD COLUMN channel_joined_checked_at TEXT DEFAULT NULL;

-- 2. Perluas CHECK constraint `broadcast_deliveries.channel` dari
--    ('whatsapp','email','telegram') menjadi ('whatsapp','email','telegram','telegram_channel')
--    sambil mempertahankan seluruh baris riwayat, FK, UNIQUE, dan kedua indeksnya.
CREATE TABLE broadcast_deliveries_v0169 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL REFERENCES broadcast_campaigns(id),
  channel TEXT NOT NULL CHECK(channel IN ('whatsapp','email','telegram','telegram_channel')),
  recipient_id TEXT NOT NULL,
  destination TEXT NOT NULL,
  unsubscribe_token TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','unknown','skipped','canceled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  lease_until TEXT,
  provider_id TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(campaign_id,channel,recipient_id)
);

INSERT INTO broadcast_deliveries_v0169
  (id,campaign_id,channel,recipient_id,destination,unsubscribe_token,status,attempts,first_attempt_at,next_attempt_at,lease_until,provider_id,last_error,updated_at)
SELECT id,campaign_id,channel,recipient_id,destination,unsubscribe_token,status,attempts,first_attempt_at,next_attempt_at,lease_until,provider_id,last_error,updated_at
FROM broadcast_deliveries;

DROP TABLE broadcast_deliveries;
ALTER TABLE broadcast_deliveries_v0169 RENAME TO broadcast_deliveries;

CREATE INDEX idx_broadcast_delivery_due ON broadcast_deliveries(status,julianday(next_attempt_at),id);
CREATE INDEX idx_broadcast_delivery_campaign ON broadcast_deliveries(campaign_id,channel,status);

-- 3. Seed konfigurasi default channel resmi @axvaratech untuk produksi (INSERT OR IGNORE:
--    tidak menimpa pengaturan admin bila sudah pernah disimpan). Smart Force-Join bersifat
--    fail-open sehingga aman walau @Axvara_bot belum dijadikan Admin channel.
INSERT OR IGNORE INTO store_settings (key, value, updated_at) VALUES (
  'telegram_channel_config',
  '{"channelUsername":"axvaratech","channelTitle":"Axvara Official","forceSubEnabled":true,"channelPromoEnabled":true,"cacheTtlSeconds":21600}',
  datetime('now')
);
