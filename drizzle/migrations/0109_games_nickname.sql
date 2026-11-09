-- Paid username checks: cache doubles as the durable per-account claim.
CREATE TABLE IF NOT EXISTS games_nickname_cache (
  game_key TEXT NOT NULL,
  customer_no TEXT NOT NULL,
  ref_id TEXT NOT NULL UNIQUE,
  result TEXT NOT NULL CHECK(result IN ('pending','ok','invalid','unavailable','ambiguous')),
  nickname TEXT,
  checked_at INTEGER NOT NULL,
  expires_at INTEGER,
  PRIMARY KEY(game_key, customer_no)
);
CREATE TABLE IF NOT EXISTS games_nickname_checks (
  ref_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  buyer_sku_code TEXT NOT NULL,
  cost INTEGER NOT NULL CHECK(cost>0),
  status TEXT NOT NULL,
  rc TEXT,
  ip_hash TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_games_nickname_created ON games_nickname_checks(created_at);
CREATE INDEX IF NOT EXISTS idx_games_nickname_ip ON games_nickname_checks(ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_games_nickname_device ON games_nickname_checks(device_id, created_at);
