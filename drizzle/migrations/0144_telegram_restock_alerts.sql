-- Migrasi 0144 (Item 13): langganan notifikasi restok per produk Telegram.
-- Forward-only: tabel baru, tanpa menyentuh tabel lain. UNIQUE(user, product)
-- membuat tap ulang idempoten; status 'pending' diklaim atomik oleh cron
-- notify_b sebelum kirim agar tidak ada pesan ganda lintas tick.
CREATE TABLE IF NOT EXISTS telegram_restock_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  notified_at TEXT,
  UNIQUE(user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_telegram_restock_alerts_status
  ON telegram_restock_alerts(status, product_id);
CREATE INDEX IF NOT EXISTS idx_telegram_restock_alerts_user
  ON telegram_restock_alerts(user_id, status);
