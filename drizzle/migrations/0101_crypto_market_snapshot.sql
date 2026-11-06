-- 0101_crypto_market_snapshot.sql — FX USD/IDR otomatis + katalog koin NOWPayments (LOCAL ONLY).
--
-- Menggantikan env manual USD_IDR_RATE sebagai sumber utama (env tetap fallback darurat).
-- Snapshot pasar crypto (USD/IDR FX otomatis + katalog koin NOWPayments).
-- Satu baris (id=1) ditulis cron lite `cleanup`; lease_until = lease CAS
-- agar isolate cron paralel tidak me-refresh ganda. Tidak ada rahasia di sini.
CREATE TABLE IF NOT EXISTS crypto_market_snapshot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fx_rate_text TEXT,
  fx_source TEXT,
  fx_effective_at TEXT,
  coins_json TEXT,
  coins_refreshed_at TEXT,
  last_error TEXT,
  last_attempt_at TEXT,
  lease_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
