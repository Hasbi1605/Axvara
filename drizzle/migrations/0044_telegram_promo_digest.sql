CREATE TABLE IF NOT EXISTS telegram_promo_digests (
  business_date TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('morning','evening')),
  product_ids TEXT NOT NULL,
  full_message_id TEXT,
  short_message_id TEXT,
  full_attempts INTEGER NOT NULL DEFAULT 0,
  short_attempts INTEGER NOT NULL DEFAULT 0,
  full_error TEXT,
  short_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (business_date, slot)
);
